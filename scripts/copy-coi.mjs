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

await mkdir(new URL('public/', root), { recursive: true });
await writeFile(new URL('public/coi-serviceworker.js', root), source);
console.log('跨源隔离 Service Worker 已复制并应用同源 GET 补丁。');
