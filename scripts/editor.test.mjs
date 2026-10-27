import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'vue/compiler-sfc';
import { sourceHarness } from './source-harness.mjs';

const { descriptor } = parse(await readFile(new URL('../src/App.vue', import.meta.url), 'utf8'));
class Pixels {
  constructor(data, width, height) {
    this.data = typeof data === 'number' ? new Uint8ClampedArray(data * width * 4) : data;
    this.width = typeof data === 'number' ? data : width;
    this.height = typeof data === 'number' ? width : height;
  }
}
function canvas(width, height) {
  let pixels = new Pixels(width, height);
  const paint = () => { pixels.data[3] = 255; };
  const ctx = {
    getImageData: () => new Pixels(pixels.data.slice(), pixels.width, pixels.height),
    putImageData: data => { pixels = new Pixels(data.data.slice(), data.width, data.height); },
    clearRect: () => pixels.data.fill(0), stroke: paint, fill: paint,
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
  };
  return { width, height, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }) };
}
function editor() {
  const workers = [], timers = new Map();
  let timerId = 0;
  class Worker {
    messages = [];
    constructor() { workers.push(this); }
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  }
  const app = sourceHarness(descriptor.scriptSetup.content, {
    ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    onMounted() {}, onUnmounted() {}, nextTick: async () => {}, canvas, ImageData: Pixels, Worker,
    prepare: () => ({ rgb: new Float32Array(3), mask: new Float32Array(1) }),
    setTimeout: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  app.run(`
    loaded.value = true; imageSize.value = {width: 4, height: 4};
    maskCanvas = canvas(4, 4); photo.value = canvas(4, 4); overlay.value = canvas(4, 4);
    const captures = new Set();
    viewport.value = { getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 400}),
      setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
      releasePointerCapture: id => captures.delete(id) };
    function event(id, x, y, pointerType = 'touch', button = 0) {
      return {pointerId: id, clientX: x, clientY: y, pointerType, button, preventDefault() {}};
    }
  `);
  return { ...app, workers, timers };
}

test('two-finger zoom and pan restore the provisional stroke and its undo entry', () => {
  const app = editor();
  app.run('pointerDown(event(1, 100, 200))');
  assert.equal(app.run('selected.value'), 1);
  app.run('pointerDown(event(2, 300, 200))');
  assert.equal(app.run('selected.value'), 0);
  assert.equal(app.run('historySize.value'), 0);
  app.run('pointerMove(event(1, 50, 200)); pointerMove(event(2, 350, 200))');
  assert.equal(app.run('scale.value'), 1.5);
  assert.equal(app.run('pan.value.x'), 0);
  app.run('pointerMove(event(1, 70, 220)); pointerMove(event(2, 370, 220))');
  assert.equal(app.run('pan.value.x'), 20);
  assert.equal(app.run('pan.value.y'), 20);
  app.run('pointerUp(event(2, 370, 220)); pointerMove(event(1, 90, 220))');
  assert.equal(app.run('selected.value'), 0, 'remaining finger must not resume painting');
  app.run('pointerUp(event(1, 90, 220)); pointerDown(event(3, 150, 150))');
  assert.equal(app.run('selected.value'), 1, 'a new one-finger stroke can paint normally');
});

test('pinch preserves the image point under the moving midpoint and clamps scale', () => {
  const app = editor();
  app.run(`pan.value = {x: 30, y: 40}; pointerDown(event(1, 50, 100)); pointerDown(event(2, 150, 100));
    pointerMove(event(1, 0, 100)); pointerMove(event(2, 200, 100));`);
  assert.equal(app.run('scale.value'), 2);
  assert.equal(app.run('pan.value.x'), 160);
  assert.equal(app.run('pan.value.y'), 180);
  app.run('pointerMove(event(2, 10000, 100))');
  assert.equal(app.run('scale.value'), 8);
});

test('mouse middle-button and hand-tool dragging do not paint', () => {
  const app = editor();
  app.run(`pointerDown(event(1, 100, 100, 'mouse', 1)); pointerMove(event(1, 150, 125, 'mouse', 1));
    pointerUp(event(1, 150, 125, 'mouse', 1));`);
  assert.equal(app.run('pan.value.x'), 50);
  assert.equal(app.run('pan.value.y'), 25);
  assert.equal(app.run('selected.value'), 0);
  app.run(`chooseTool('hand'); pointerDown(event(2, 150, 125, 'touch')); pointerMove(event(2, 160, 145, 'touch'));`);
  assert.equal(app.run('pan.value.x'), 60);
  assert.equal(app.run('pan.value.y'), 45);
  assert.equal(app.run('selected.value'), 0);
});

test('zoom buttons start one preload, allow editing during download and permit retries', () => {
  const app = editor();
  app.run('zoomButton(1.25); zoomButton(1.5); zoomButton("fit")');
  assert.equal(app.workers.length, 1);
  assert.equal(app.workers[0].messages.length, 1);
  assert.equal(app.run('disabled.value'), false);
  const id = app.workers[0].messages[0].id;
  app.workers[0].emit({ id, type: 'progress', message: 'loading', value: .5 });
  assert.equal(app.run('modelProgress.value'), .5);
  app.workers[0].emit({ id, type: 'error', message: 'offline' });
  app.run('zoomButton(1.25)');
  assert.equal(app.workers[0].messages.length, 2);
  app.workers[0].emit({ id: app.workers[0].messages[1].id, type: 'model-ready' });
  app.run('zoomButton(1.5)');
  assert.equal(app.workers[0].messages.length, 2);
  assert.equal(app.run('modelReady.value'), true);
  assert.equal(app.timers.size, 0);
});

test('removing an image cancels a repair, frees state, ignores stale messages and allows reupload', async () => {
  const app = editor();
  app.run('working = new ImageData(4, 4); original = working; pointerDown(event(1, 100, 100)); pointerUp(event(1, 100, 100)); filename.value = "test.png"; const job = repair()');
  assert.equal(app.run('busy.value'), true);
  assert.equal([...app.timers.values()][0].duration, 300_000);
  app.run('removeImage()');
  await app.run('job');
  assert.equal(app.workers[0].terminated, true);
  app.workers[0].emit({ id: 1, type: 'model-ready' });
  assert.equal(app.run('modelReady.value'), false);
  for (const expression of ['loaded.value', 'busy.value', 'hasResult.value']) assert.equal(app.run(expression), false);
  assert.equal(app.run('selected.value'), 0);
  assert.equal(app.run('working'), undefined);
  assert.equal(app.run('error.value'), '');
  assert.equal(app.run('disabled.value'), false);
  assert.equal(app.timers.size, 0);
});

test('five-minute processing timeout stops the worker and preserves the selection', async () => {
  const app = editor();
  app.run('working = new ImageData(4, 4); pointerDown(event(1, 100, 100)); pointerUp(event(1, 100, 100)); const job = repair()');
  const timer = [...app.timers.values()][0];
  assert.equal(timer.duration, 300_000);
  timer.callback();
  await app.run('job');
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.run('selected.value'), 1);
  assert.equal(app.run('busy.value'), false);
  assert.match(app.run('error.value'), /5 分钟/);
});
