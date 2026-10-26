import { readdir, copyFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('node_modules/onnxruntime-web/dist/', root);
const target = new URL('public/ort/', root);
await mkdir(target, { recursive: true });
for (const name of await readdir(dist)) {
  if (/^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(name)) await copyFile(new URL(name, dist), new URL(name, target));
}
console.log('ONNX Runtime Web 同版本运行时已复制到 public/ort/');
