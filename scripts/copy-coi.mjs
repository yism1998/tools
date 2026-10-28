import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
let source = await readFile(new URL('node_modules/coi-serviceworker/coi-serviceworker.js', root), 'utf8');

function patch(before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('coi-serviceworker 源码发生变化，请检查跨源隔离补丁。');
  }
  source = source.replace(before, after);
}

// Only same-origin GET resources need isolation headers. Leave telemetry POSTs
// and third-party requests to the browser's normal network/CORS handling.
patch('const r = event.request;', `const r = event.request;
        if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) {
            return;
        }`);

// The upstream catch resolves to undefined on network failure, which is not a
// valid respondWith response. Preserve the rejection instead of hiding it.
patch('\n                .catch((e) => console.error(e))', '');

// Vue owns registration and installation UI. Keep the existing Worker URL so
// already-installed registrations update in place without a competing Worker.
const clientMarker = '\n} else {\n    (() => {';
if (source.split(clientMarker).length !== 2) throw new Error('coi-serviceworker 客户端入口发生变化。');
source = source.slice(0, source.indexOf(clientMarker)) + '\n}\n';
patch('fetch(request)', 'pwaFetch(request)');
patch('self.addEventListener("install", () => self.skipWaiting());',
  '// Activate updates after existing application windows close.');
const caching = await readFile(new URL('scripts/pwa-cache.js', root), 'utf8');
source = `${caching}\n${source}`;

await mkdir(new URL('public/', root), { recursive: true });
await writeFile(new URL('public/coi-serviceworker.js', root), source);
console.log('已生成支持跨源隔离与 PWA 缓存的 Service Worker。');
