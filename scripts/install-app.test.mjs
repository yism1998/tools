import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'vue/compiler-sfc';
import { sourceHarness } from './source-harness.mjs';

const { descriptor } = parse(await readFile(new URL('../src/InstallApp.vue', import.meta.url), 'utf8'));
function installUI({ image = false, isolated = true, controller = null, display = false } = {}) {
  const listeners = new Map(), registrations = [], props = { hasImage: image };
  let mount, reloads = 0;
  const addEventListener = (name, fn) => listeners.set(name, fn);
  const sw = { controller, addEventListener, removeEventListener() {},
    register: async (...args) => registrations.push(args) };
  const app = sourceHarness(descriptor.scriptSetup.content, {
    ref: value => ({ value }), defineProps: () => props,
    onMounted: callback => { mount = callback; }, onUnmounted() {},
    navigator: { userAgent: 'Chrome', platform: 'Linux', maxTouchPoints: 0, serviceWorker: sw },
    window: { isSecureContext: true, crossOriginIsolated: isolated,
      matchMedia: () => ({ matches: display }), location: { reload: () => { reloads++; } },
      addEventListener, removeEventListener() {} },
  });
  app.run('guide.value = { showModal: () => guideOpened++ }');
  // Use a sandbox callback without exposing application internals to the test.
  app.context.guideOpened = 0;
  mount();
  return { ...app, props, sw, listeners, registrations, get reloads() { return reloads; } };
}

test('registers the existing Worker URL and scope even on an already-isolated page', () => {
  const app = installUI();
  assert.equal(app.registrations.length, 1);
  assert.equal(app.registrations[0][0], '/tools/coi-serviceworker.js');
  assert.equal(app.registrations[0][1].scope, '/tools/');
  assert.equal(app.reloads, 0);
});

test('uses the browser installation event from a direct user action', async () => {
  const app = installUI();
  let prompts = 0, prevented = false;
  app.listeners.get('beforeinstallprompt')({ preventDefault() { prevented = true; },
    prompt: async () => { prompts++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  await app.run('install()');
  assert.ok(prevented);
  assert.equal(prompts, 1);
  assert.equal(app.run('installed.value'), true);
});

test('fallback guidance opens when no native prompt is available; standalone hides installation', async () => {
  const app = installUI({ display: true });
  assert.equal(app.run('installed.value'), true);
  await app.run('install()');
  assert.equal(app.context.guideOpened, 1);
});

test('initial isolation activation does not reload a loaded image, and updates do not reload', () => {
  const withImage = installUI({ isolated: false, image: true });
  withImage.listeners.get('controllerchange')();
  assert.equal(withImage.reloads, 0);
  const initial = installUI({ isolated: false });
  initial.listeners.get('controllerchange')(); initial.listeners.get('controllerchange')();
  assert.equal(initial.reloads, 1);
  const existing = installUI({ isolated: false, controller: { postMessage() {} } });
  existing.listeners.get('controllerchange')();
  assert.equal(existing.reloads, 0);
});
