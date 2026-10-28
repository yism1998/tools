import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const template = await readFile(new URL('../public/coi-serviceworker.js', import.meta.url), 'utf8');
const origin = 'https://example.test', scope = `${origin}/tools/`;
function serviceWorker(network, version = 'v1') {
  const stores = new Map(), origins = new Map(), listeners = new Map(), precached = [];
  const key = value => typeof value === 'string' ? value : value.url;
  const cacheStorage = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { match: async (req, options) => {
          const response = store.get(key(req));
          if (response?.headers.get('vary') === 'Origin' && !options?.ignoreVary
            && (typeof req === 'string' ? null : req.headers.get('origin')) !== (origins.get(key(req)) ?? null)) return undefined;
          return response?.clone();
        },
        put: async (req, response) => { store.set(key(req), response.clone()); origins.set(key(req), typeof req === 'string' ? null : req.headers.get('origin')); },
        addAll: async requests => { for (const request of requests) {
          precached.push(request.url); store.set(request.url, new Response('cached shell', { headers: { vary: 'Origin' } }));
        } },
      };
    },
    keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
  };
  const source = template.replace('__PWA_VERSION__', version)
    .replace("'__PWA_ASSETS__'", '"index.html", "assets/app.js", "manifest.webmanifest"');
  runInNewContext(source, {
    URL, Request, Response, Headers, caches: cacheStorage, fetch: network, console,
    self: { location: { origin, href: `${scope}coi-serviceworker.js` },
      clients: { claim: async () => {} }, addEventListener: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      } },
  });
  return { stores, cacheStorage, precached,
    async dispatch(name) {
      const promises = [];
      for (const fn of listeners.get(name) || []) fn({ waitUntil: promise => promises.push(promise) });
      await Promise.all(promises);
    },
    fetch(request) {
      let result;
      for (const fn of listeners.get('fetch')) fn({ request, respondWith: value => { result = value; } });
      return result;
    },
  };
}
function navigation() { return { url: scope, mode: 'navigate', method: 'GET', headers: new Headers() }; }

test('installation precaches the app shell without downloading model or WASM', async () => {
  const sw = serviceWorker(() => assert.fail('Installation must use only the configured shell'));
  await sw.dispatch('install');
  assert.ok(sw.precached.includes(`${scope}index.html`));
  assert.ok(sw.precached.every(url => url.startsWith(scope) && !/\.(onnx|wasm)$/.test(url)));
});

test('offline navigation restores the app shell with isolation headers', async () => {
  const sw = serviceWorker(async () => { throw new Error('Offline'); });
  await sw.dispatch('install');
  const response = await sw.fetch(navigation());
  assert.equal(await response.text(), 'cached shell');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});

test('navigation prefers current network HTML and falls back on HTTP 503', async () => {
  let status = 200;
  const sw = serviceWorker(async () => new Response('fresh shell', { status }));
  await sw.dispatch('install');
  assert.equal(await (await sw.fetch(navigation())).text(), 'fresh shell');
  status = 503;
  assert.equal(await (await sw.fetch(navigation())).text(), 'fresh shell');
});

test('runtime WASM is cached on demand while model files are never duplicated', async () => {
  let calls = 0;
  const sw = serviceWorker(async () => { calls++; return new Response('runtime'); });
  const wasm = new Request(`${scope}ort/runtime.wasm`);
  await sw.fetch(wasm); await sw.fetch(wasm);
  assert.equal(calls, 1);
  const model = new Request(`${scope}models/lama_fp32.onnx`);
  await sw.fetch(model); await sw.fetch(model);
  assert.equal(calls, 3);
  const store = [...sw.stores.values()][0];
  assert.ok(!store.has(model.url));
});

test('activation only removes old app caches in the same project scope', async () => {
  const sw = serviceWorker(async () => new Response('ok'), 'v2');
  for (const name of ['lama-app:/tools/:v1', 'lama-app:/tools/:v2', 'lama-app:/other/:v1', 'lama-fp32-model']) {
    await sw.cacheStorage.open(name);
  }
  await sw.dispatch('activate');
  assert.ok(!sw.stores.has('lama-app:/tools/:v1'));
  for (const name of ['lama-app:/tools/:v2', 'lama-app:/other/:v1', 'lama-fp32-model']) assert.ok(sw.stores.has(name));
});

test('cross-origin POSTs and range requests do not enter the app cache', async () => {
  const sw = serviceWorker(async () => new Response('range', { status: 206 }));
  assert.equal(sw.fetch(new Request('https://cloudflareinsights.com/cdn-cgi/rum', { method: 'POST' })), undefined);
  await sw.fetch(new Request(`${scope}ort/runtime.wasm`, { headers: { range: 'bytes=0-4' } }));
  assert.equal(sw.stores.size, 0);
});

test('manifest identity and PNG icon sizes support installation under /tools/', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  for (const field of ['id', 'scope', 'start_url']) {
    assert.equal(new URL(manifest[field], `${scope}manifest.webmanifest`).href, scope);
  }
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(`../public/${icon.src}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    assert.equal(png.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
  }
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
});


test('offline module requests match public precached assets despite Vary: Origin', async () => {
  const sw = serviceWorker(async () => { throw new Error('Offline'); });
  await sw.dispatch('install');
  const response = await sw.fetch(new Request(`${scope}assets/app.js`, { headers: { origin } }));
  assert.equal(await response.text(), 'cached shell');
});

test('opening another resource does not overwrite the offline application page', async () => {
  let offline = false;
  const sw = serviceWorker(async () => {
    if (offline) throw new Error('Offline');
    return new Response('manifest content');
  });
  await sw.dispatch('install');
  await sw.fetch({ ...navigation(), url: `${scope}manifest.webmanifest` });
  offline = true;
  assert.equal(await (await sw.fetch(navigation())).text(), 'cached shell');
});
