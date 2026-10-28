import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(new URL(`${entry.name}/`, directory), `${path}/`));
    else if (!path.startsWith('models/') && /\.(html|js|mjs|css|svg|png|jpg|webmanifest)$/.test(path)
      && path !== 'coi-serviceworker.js') result.push(path);
  }
  return result.sort();
}
const paths = await files(dist);
const worker = new URL('coi-serviceworker.js', dist);
let source = await readFile(worker, 'utf8');
const hash = createHash('sha256').update(source);
for (const path of paths) hash.update(path).update(await readFile(new URL(path, dist)));
// Runtime WASM is cached on first use, never downloaded during installation.
const version = hash.digest('hex').slice(0, 16);
if (!source.includes('__PWA_VERSION__') || !source.includes("'__PWA_ASSETS__'")) {
  throw new Error('PWA Service Worker 模板不完整。');
}
source = source.replace('__PWA_VERSION__', version)
  .replace("'__PWA_ASSETS__'", paths.map(path => JSON.stringify(path)).join(', '));
await writeFile(worker, source);
console.log(`PWA 应用缓存 ${version}：${paths.length} 个页面资源，模型与 WASM 按需加载。`);
