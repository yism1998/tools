import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = new URL('../', import.meta.url);
const spec = JSON.parse(await readFile(new URL('model.json', root), 'utf8'));
const folder = new URL('public/models/', root);
const target = new URL(spec.filename, folder);
const partial = new URL(`${spec.filename}.partial`, folder);

async function valid(path) {
  try {
    if ((await stat(path)).size !== spec.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === spec.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

await mkdir(folder, { recursive: true });
if (await valid(target)) {
  console.log('LaMa 模型校验通过，使用已有文件。');
} else {
  const url = spec.downloadUrl;
  console.log(`正在下载 LaMa 模型（${(spec.bytes / 1e6).toFixed(1)} MB）…`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`模型下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if (!(await valid(partial))) throw new Error('模型大小或 SHA-256 不匹配，停止构建。');
    await rename(partial, target);
    console.log('LaMa 模型下载完成，SHA-256 校验通过。');
  } finally {
    await rm(partial, { force: true });
  }
}
