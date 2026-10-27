import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sourceHarness } from './source-harness.mjs';

const source = await readFile(new URL('../src/inference.worker.ts', import.meta.url), 'utf8');
function worker(fetch) {
  const messages = [];
  let creates = 0;
  const app = sourceHarness(source, {
    self: { location: { origin: 'https://example.test' }, crossOriginIsolated: false },
    navigator: { hardwareConcurrency: 4 }, performance, fetch,
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
    postMessage: data => messages.push(data),
    ort: { env: { wasm: {} }, Tensor: class { dispose() {} }, InferenceSession: {
      create: async () => { creates++; return { outputNames: ['result'], run: async () => ({
        result: { data: new Float32Array(3 * 512 * 512), dispose() {} },
      }) }; },
    } },
  });
  return { messages, get creates() { return creates; },
    send: task => app.context.onmessage({ data: task }) };
}
function response() { return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }); }

test('first clear downloads the model and later clears reuse the model and session', async () => {
  let downloads = 0;
  const sw = worker(async () => { downloads++; return response(); });
  assert.equal(downloads, 0);
  await sw.send({ id: 1, type: 'repair', image: new Float32Array(3), mask: new Float32Array(1) });
  assert.equal(downloads, 1);
  assert.equal(sw.creates, 1);
  assert.equal(sw.messages.at(-1).type, 'result');
  await sw.send({ id: 2, type: 'repair', image: new Float32Array(3), mask: new Float32Array(1) });
  assert.equal(sw.messages.at(-1).type, 'result');
  assert.equal(sw.messages.at(-1).id, 2);
  assert.equal(downloads, 1);
  assert.equal(sw.creates, 1);
});

test('failed model download can retry when clear is clicked again', async () => {
  let downloads = 0;
  const sw = worker(async () => { if (++downloads === 1) throw new Error('Offline'); return response(); });
  await sw.send({ id: 1, type: 'repair', image: new Float32Array(3), mask: new Float32Array(1) });
  assert.equal(sw.messages.at(-1).type, 'error');
  await sw.send({ id: 2, type: 'repair', image: new Float32Array(3), mask: new Float32Array(1) });
  assert.equal(sw.messages.at(-1).type, 'result');
  assert.equal(downloads, 2);
  assert.equal(sw.creates, 1);
});
