import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'vue/compiler-sfc';
import { sourceHarness } from './source-harness.mjs';

const registrySource = await readFile(new URL('../src/tools.ts', import.meta.url), 'utf8');
const { descriptor } = parse(await readFile(new URL('../src/App.vue', import.meta.url), 'utf8'));

function navigation(hash) {
  const registry = sourceHarness(registrySource, { WatermarkPage: {} });
  const { tools, toolFromHash } = registry.context.exports;
  // Exercise the shared navigation with an additional tool without shipping a placeholder.
  tools.push({ id: 'another-tool', component: {}, label: 'Another tool', icon: 'image' });
  const listeners = new Map(), location = { hash };
  let mount, unmount;
  const app = sourceHarness(descriptor.scriptSetup.content, {
    tools, toolFromHash,
    ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    onMounted: callback => { mount = callback; }, onUnmounted: callback => { unmount = callback; },
    window: { location, addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } },
  });
  return { ...app, location, listeners, mount, unmount };
}

test('server rendering defaults to the watermark page and direct hash links activate after mounting', () => {
  const app = navigation('#/another-tool');
  assert.equal(app.run('activeTool.value.id'), 'watermark');
  app.mount();
  assert.equal(app.run('activeTool.value.id'), 'another-tool');
});

test('hash navigation follows browser back/forward and safely falls back for unknown tools', () => {
  const app = navigation('#/watermark'); app.mount();
  for (const [hash, id] of [['#/another-tool', 'another-tool'], ['#/watermark', 'watermark'],
    ['#/missing', 'watermark'], ['', 'watermark']]) {
    app.location.hash = hash; app.listeners.get('hashchange')();
    assert.equal(app.run('activeTool.value.id'), id);
  }
  app.unmount();
  assert.equal(app.listeners.size, 0);
});
