import * as ort from 'onnxruntime-web/wasm';

type Task = { id: number; type: 'repair'; image: Float32Array; mask: Float32Array };
const scope = globalThis as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<Task>) => void) | null;
};
ort.env.wasm.wasmPaths = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.origin).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = 'warning';
const MODEL_URL = `${import.meta.env.BASE_URL}models/lama_fp32.onnx`;
const CACHE = 'lama-fp32-carve-c3c0c9e-v1';
let model: Uint8Array | undefined;
let session: ort.InferenceSession | undefined;

function progress(id: number, message: string, value?: number) {
  scope.postMessage({ id, type: 'progress', message, value });
}
async function load(id: number) {
  if (model) return;
  let response: Response | undefined;
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); response = await cache.match(MODEL_URL); }
  catch { /* Caching is optional in private browsing or when storage is full. */ }
  if (!response) {
    response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`清除模型加载失败（${response.status}），请重试。`);
    if (cache) void cache.put(MODEL_URL, response.clone()).catch(() => {});
  }
  const total = Number(response.headers.get('content-length')) || 208044816;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取模型，请更新浏览器后重试。');
  const chunks: Uint8Array[] = [];
  let bytes = 0, lastProgress = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); bytes += value.byteLength;
    if (performance.now() - lastProgress > 100 || bytes === total) {
      progress(id, `加载清除模型 · ${Math.round(bytes / 1e6)} / ${Math.round(total / 1e6)} MB`, Math.min(1, bytes / total));
      lastProgress = performance.now();
    }
  }
  model = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { model.set(chunk, offset); offset += chunk.byteLength; }
}
async function create(id: number) {
  if (session) return;
  progress(id, '首次准备清除工具，请稍候…');
  session = await ort.InferenceSession.create(model!, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
scope.onmessage = async ({ data: task }) => {
  let image: ort.Tensor | undefined, mask: ort.Tensor | undefined;
  let results: ort.InferenceSession.ReturnType | undefined;
  try {
    await load(task.id);
    await create(task.id);
    progress(task.id, '正在清除涂抹区域…');
    image = new ort.Tensor('float32', task.image, [1, 3, 512, 512]);
    mask = new ort.Tensor('float32', task.mask, [1, 1, 512, 512]);
    const t = performance.now();
    results = await session!.run({ image, mask });
    const tensor = results[session!.outputNames[0]];
    const output = new Float32Array(tensor.data as Float32Array);
    if (output.length !== 3 * 512 * 512 || output.some(v => !Number.isFinite(v))) throw new Error('处理结果异常，请重试。');
    scope.postMessage({ id: task.id, type: 'result', output, runMs: performance.now() - t, backend: 'wasm', threads: ort.env.wasm.numThreads }, [output.buffer]);
  } catch (e) {
    scope.postMessage({ id: task.id, type: 'error', message: e instanceof Error ? e.message : '清除失败，请重试。' });
  } finally {
    image?.dispose(); mask?.dispose();
    if (results) for (const tensor of Object.values(results)) tensor.dispose();
  }
};
