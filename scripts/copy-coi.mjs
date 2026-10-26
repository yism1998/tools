import { copyFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
await copyFile(new URL('node_modules/coi-serviceworker/coi-serviceworker.js', root), new URL('public/coi-serviceworker.js', root));
console.log('跨源隔离 Service Worker 已复制。');
