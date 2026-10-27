<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
import { canvas, composite, prepare } from './image';

type Tool = 'brush' | 'eraser' | 'hand';
type HistoryEntry = { type: 'mask'; mask: ImageData } | { type: 'repair'; image: ImageData; mask: ImageData; hadResult: boolean };
type InferenceResult = { output: Float32Array; runMs: number; backend: string; threads: number };
const photo = ref<HTMLCanvasElement>(), overlay = ref<HTMLCanvasElement>();
const sampleUrl = `${import.meta.env.BASE_URL}demo.jpg`;
const viewport = ref<HTMLDivElement>(), fileInput = ref<HTMLInputElement>();
const loaded = ref(false), loading = ref(false), busy = ref(false), hasResult = ref(false);
const tool = ref<Tool>('brush'), brush = ref(44), showOriginal = ref(false);
const filename = ref(''), imageSize = ref({ width: 1, height: 1 });
const selected = ref(0), historySize = ref(0), error = ref('');
const status = ref('涂抹需要去除的部分，再点击「清除水印」。');
const progress = ref<number | null>(null), dropDepth = ref(0);
const scale = ref(1), pan = ref({ x: 0, y: 0 }), fitted = ref(true);
const cursor = ref({ x: 0, y: 0, visible: false });
const spaceHeld = ref(false), dragging = ref(false);
const disabled = computed(() => busy.value || loading.value);
const moving = computed(() => tool.value === 'hand' || spaceHeld.value);
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const stackStyle = computed(() => ({ width: `${imageSize.value.width}px`, height: `${imageSize.value.height}px`, transform: `translate(-50%, -50%) translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})` }));
const cursorStyle = computed(() => ({ left: `${cursor.value.x}px`, top: `${cursor.value.y}px`, width: `${brush.value * scale.value}px`, height: `${brush.value * scale.value}px` }));
let original: ImageData | undefined, working: ImageData | undefined;
let maskCanvas = canvas(1, 1), history: HistoryEntry[] = [];
let painting = false, last = { x: 0, y: 0 }, dragStart = { x: 0, y: 0 }, panStart = { x: 0, y: 0 };
let worker: Worker | undefined, jobId = 0, loadId = 0, resizeObserver: ResizeObserver | undefined;
let pending: { id: number; resolve: (value: InferenceResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
const PROCESS_TIMEOUT = 300_000;
type Point = { x: number; y: number };
const touches = new Map<number, Point>();
let activePointer: number | undefined, touchGesture = false;
let pinch: { distance: number; center: Point; scale: number; pan: Point } | undefined;
let touchStroke: { mask: ImageData; history: HistoryEntry[]; status: string } | undefined;

function maskPixels() { return maskCanvas.getContext('2d')!.getImageData(0, 0, maskCanvas.width, maskCanvas.height); }
function selection() {
  const pixels = maskPixels().data;
  const mask = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 0 ? 1 : 0;
  return mask;
}
function pushHistory(entry: HistoryEntry) {
  history.push(entry); if (history.length > 8) history.shift(); historySize.value = history.length;
}
function renderMask() {
  if (!loaded.value || !overlay.value) return;
  const ctx = overlay.value.getContext('2d')!;
  const mask = selection(), pixels = new ImageData(maskCanvas.width, maskCanvas.height);
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { pixels.data.set([100, 114, 244, 120], i * 4); n++; }
  selected.value = n;
  ctx.clearRect(0, 0, pixels.width, pixels.height);
  if (!showOriginal.value) ctx.putImageData(pixels, 0, 0);
}
function renderPhoto() {
  const pixels = showOriginal.value ? original : working;
  if (pixels) photo.value?.getContext('2d')!.putImageData(pixels, 0, 0);
  renderMask();
}
function fitImage() {
  if (!loaded.value || !viewport.value) return;
  const r = viewport.value.getBoundingClientRect();
  scale.value = Math.max(.01, Math.min((r.width - 72) / imageSize.value.width, (r.height - 96) / imageSize.value.height, 1));
  pan.value = { x: 0, y: 0 }; fitted.value = true;
}
function zoomTo(value: number, anchor?: { x: number; y: number }) {
  if (!loaded.value || disabled.value) return;
  const next = Math.min(8, Math.max(.05, value)), ratio = next / scale.value;
  const a = anchor || { x: 0, y: 0 };
  pan.value = { x: a.x - (a.x - pan.value.x) * ratio, y: a.y - (a.y - pan.value.y) * ratio };
  scale.value = next; fitted.value = false;
}
function zoomButton(value: number | 'fit') {
  if (!loaded.value || disabled.value) return;
  if (value === 'fit') fitImage(); else zoomTo(value);
}
function wheel(e: WheelEvent) {
  if (!loaded.value || disabled.value) return;
  const r = viewport.value!.getBoundingClientRect();
  zoomTo(scale.value * Math.exp(-Math.max(-80, Math.min(80, e.deltaY)) * .004), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 });
  updateCursor(e.clientX, e.clientY);
}
function updateCursor(clientX: number, clientY: number) {
  if (!overlay.value || !viewport.value) return;
  const r = viewport.value.getBoundingClientRect(), image = overlay.value.getBoundingClientRect();
  cursor.value = { x: clientX - r.left, y: clientY - r.top,
    visible: !disabled.value && !moving.value && !showOriginal.value && clientX >= image.left && clientX <= image.right && clientY >= image.top && clientY <= image.bottom };
}
function imagePoint(e: PointerEvent) {
  const r = overlay.value!.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale.value, y: (e.clientY - r.top) / scale.value };
}
function dab(a: { x: number; y: number }, b: { x: number; y: number }) {
  const ctx = maskCanvas.getContext('2d')!;
  ctx.globalCompositeOperation = tool.value === 'eraser' ? 'destination-out' : 'source-over';
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = brush.value;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(b.x, b.y, brush.value / 2, 0, Math.PI * 2); ctx.fill();
  renderMask();
}
function pointerDown(e: PointerEvent) {
  if (disabled.value || !loaded.value || (e.button !== 0 && e.button !== 1)) return;
  if (e.pointerType === 'touch') {
    e.preventDefault();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.value!.setPointerCapture(e.pointerId);
    if (touches.size >= 2) {
      // Undo the provisional one-finger stroke when a second finger arrives.
      if (touchStroke) {
        maskCanvas.getContext('2d')!.putImageData(touchStroke.mask, 0, 0);
        history = touchStroke.history; historySize.value = history.length; renderMask();
        status.value = touchStroke.status;
        touchStroke = undefined;
      }
      painting = false; dragging.value = false; activePointer = undefined;
      touchGesture = true; cursor.value.visible = false; beginPinch(); return;
    }
    if (touchGesture) return;
  } else if (activePointer !== undefined || touches.size) return;
  if (moving.value || e.button === 1) {
    e.preventDefault(); dragging.value = true; cursor.value.visible = false;
    dragStart = { x: e.clientX, y: e.clientY }; panStart = { ...pan.value };
  } else {
    if (showOriginal.value) return;
    updateCursor(e.clientX, e.clientY); if (!cursor.value.visible) return;
    e.preventDefault();
    const mask = maskPixels();
    if (e.pointerType === 'touch') touchStroke = { mask, history: [...history], status: status.value };
    pushHistory({ type: 'mask', mask });
    painting = true; last = imagePoint(e); dab(last, last);
    status.value = '已涂抹的区域将被清除，其余部分保持原样。';
  }
  activePointer = e.pointerId;
  viewport.value!.setPointerCapture(e.pointerId);
}
function touchPair() {
  const [a, b] = touches.values();
  return { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
function beginPinch() {
  const { distance, center } = touchPair();
  pinch = { distance, center, scale: scale.value, pan: { ...pan.value } };
}
function pointerMove(e: PointerEvent) {
  if (disabled.value) return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    e.preventDefault();
    const { distance, center } = touchPair(), r = viewport.value!.getBoundingClientRect();
    const next = Math.min(8, Math.max(.05, pinch.scale * distance / pinch.distance));
    const ratio = next / pinch.scale;
    pan.value = {
      x: center.x - r.left - r.width / 2 - (pinch.center.x - r.left - r.width / 2 - pinch.pan.x) * ratio,
      y: center.y - r.top - r.height / 2 - (pinch.center.y - r.top - r.height / 2 - pinch.pan.y) * ratio,
    };
    scale.value = next; fitted.value = false; cursor.value.visible = false; return;
  }
  if (touchGesture) return;
  updateCursor(e.clientX, e.clientY);
  if (e.pointerId !== activePointer) return;
  if (dragging.value) {
    pan.value = { x: panStart.x + e.clientX - dragStart.x, y: panStart.y + e.clientY - dragStart.y };
    fitted.value = false; return;
  }
  if (!painting) return;
  const p = imagePoint(e); dab(last, p); last = p;
}
function pointerUp(e?: PointerEvent) {
  if (!e) {
    const ids = [...touches.keys(), ...(activePointer === undefined ? [] : [activePointer])];
    touches.clear(); touchGesture = false; pinch = undefined; touchStroke = undefined; activePointer = undefined;
    painting = false; dragging.value = false;
    for (const id of ids) if (viewport.value?.hasPointerCapture(id)) viewport.value.releasePointerCapture(id);
    return;
  }
  touches.delete(e.pointerId);
  if (touchGesture) {
    if (touches.size >= 2) beginPinch(); else pinch = undefined;
    if (!touches.size) touchGesture = false;
  }
  if (e.pointerId !== activePointer) return;
  activePointer = undefined; touchStroke = undefined;
  painting = false; dragging.value = false;
  if (e && viewport.value?.hasPointerCapture(e.pointerId)) viewport.value.releasePointerCapture(e.pointerId);
}
function undo() {
  if (disabled.value) return;
  const entry = history.pop(); if (!entry) return;
  if (entry.type === 'repair') { working = entry.image; hasResult.value = entry.hadResult; }
  maskCanvas.getContext('2d')!.putImageData(entry.mask, 0, 0);
  historySize.value = history.length; showOriginal.value = false; renderPhoto(); status.value = '已撤销上一步。';
}
function clearMask() {
  if (disabled.value || !selected.value) return;
  pushHistory({ type: 'mask', mask: maskPixels() });
  maskCanvas.getContext('2d')!.clearRect(0, 0, maskCanvas.width, maskCanvas.height); renderMask();
}
function chooseTool(value: Tool) { tool.value = value; cursor.value.visible = false; showOriginal.value = false; renderPhoto(); }
function compareOriginal() { showOriginal.value = !showOriginal.value; cursor.value.visible = false; renderPhoto(); }
function openFile() { if (!disabled.value) fileInput.value?.click(); }
function removeImage() {
  ++loadId; cancel(); pointerUp();
  original = undefined; working = undefined; maskCanvas = canvas(1, 1);
  history = []; historySize.value = 0; selected.value = 0;
  loaded.value = false; loading.value = false; busy.value = false; hasResult.value = false;
  showOriginal.value = false; tool.value = 'brush'; filename.value = ''; error.value = ''; progress.value = null;
  imageSize.value = { width: 1, height: 1 }; scale.value = 1; pan.value = { x: 0, y: 0 }; fitted.value = true;
  cursor.value.visible = false; dropDepth.value = 0; spaceHeld.value = false;
  if (fileInput.value) fileInput.value.value = '';
  for (const el of [photo.value, overlay.value]) if (el) { el.width = 1; el.height = 1; }
  status.value = '涂抹需要去除的部分，再点击「清除水印」。';
}
async function loadImage(url: string, name: string, sample = false) {
  const id = ++loadId; loading.value = true; error.value = ''; pointerUp();
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (id !== loadId) return;
    const factor = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(8_000_000 / (image.naturalWidth * image.naturalHeight)));
    const w = Math.max(1, Math.round(image.naturalWidth * factor)), h = Math.max(1, Math.round(image.naturalHeight * factor));
    const c = canvas(w, h), ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0, w, h);
    if (sample) {
      ctx.font = `600 ${Math.round(w * .056)}px Arial`; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
      ctx.strokeText('LaMa DEMO', w * .09, h * .78); ctx.fillText('LaMa DEMO', w * .09, h * .78);
    }
    original = ctx.getImageData(0, 0, w, h); working = original;
    maskCanvas = canvas(w, h); history = []; historySize.value = 0; selected.value = 0;
    loaded.value = true; hasResult.value = false; showOriginal.value = false; tool.value = 'brush';
    imageSize.value = { width: w, height: h }; filename.value = name;
    await nextTick();
    for (const el of [photo.value!, overlay.value!]) { el.width = w; el.height = h; }
    fitImage(); renderPhoto();
    status.value = factor < 1 ? '图片已缩小到工作尺寸，请涂抹需要去除的部分。' : '涂抹需要去除的部分，再点击「清除水印」。';
  } catch { if (id === loadId) error.value = '这张图片无法读取，请使用 PNG、JPG 或 WebP。'; }
  finally { if (id === loadId) loading.value = false; }
}
async function acceptFile(file: File) {
  if (disabled.value) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !(!file.type && /\.(png|jpe?g|webp)$/i.test(file.name))) {
    error.value = '请选择 PNG、JPG 或 WebP 图片。'; return;
  }
  const url = URL.createObjectURL(file);
  try { await loadImage(url, file.name); } finally { URL.revokeObjectURL(url); }
}
async function fileChanged(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.files?.[0]) await acceptFile(el.files[0]); el.value = '';
}
function isFileDrag(e: DragEvent) { return Array.from(e.dataTransfer?.types || []).includes('Files'); }
function dragEnter(e: DragEvent) { if (isFileDrag(e)) { e.preventDefault(); if (!disabled.value) dropDepth.value++; } }
function dragLeave(e: DragEvent) { if (isFileDrag(e)) dropDepth.value = Math.max(0, dropDepth.value - 1); }
function dragOver(e: DragEvent) {
  if (isFileDrag(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = disabled.value ? 'none' : 'copy'; }
}
async function drop(e: DragEvent) {
  e.preventDefault(); dropDepth.value = 0;
  if (e.dataTransfer?.files[0]) await acceptFile(e.dataTransfer.files[0]);
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
  const instance = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== instance) return;
    if (!pending || data.id !== pending.id) return;
    if (data.type === 'progress') { status.value = data.message; progress.value = data.value ?? null; return; }
    clearTimeout(pending.timer); const job = pending; pending = undefined;
    if (data.type === 'error') job.reject(new Error(data.message)); else job.resolve(data);
  };
  worker.onerror = () => { if (worker === instance) cancel('清除工具启动失败，请重新尝试。'); };
  return worker;
}
function request(data: { image: Float32Array; mask: Float32Array }) {
  return new Promise<InferenceResult>((resolve, reject) => {
    const id = ++jobId;
    pending = { id, resolve, reject, timer: setTimeout(() => cancel('处理已超过 5 分钟，已停止。请缩小涂抹区域后重试。'), PROCESS_TIMEOUT) };
    try { ensureWorker().postMessage({ id, type: 'repair', ...data }, [data.image.buffer, data.mask.buffer]); }
    catch { cancel('清除工具启动失败，请重新尝试。'); }
  });
}
function cancel(message = '已取消清除，涂抹区域已保留。') {
  worker?.terminate(); worker = undefined;
  if (pending) { clearTimeout(pending.timer); const job = pending; pending = undefined; job.reject(new Error(message)); }
}
async function repair() {
  if (!working || disabled.value || !selected.value) return;
  const base = working, mask = selection(), savedMask = maskPixels();
  const id = loadId;
  pointerUp();
  const crop = prepare(base, mask);
  busy.value = true; cursor.value.visible = false; showOriginal.value = false; error.value = ''; progress.value = null;
  status.value = '正在准备清除…'; renderPhoto();
  try {
    const raw = await request({ image: crop.rgb, mask: crop.mask });
    if (id !== loadId) return;
    const combined = composite(base, mask, raw.output, crop);
    if (combined.outsideChanged !== 0) throw new Error('图像校验未通过，请重试。');
    pushHistory({ type: 'repair', image: base, mask: savedMask, hadResult: hasResult.value });
    working = combined.result; hasResult.value = true;
    maskCanvas.getContext('2d')!.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    renderPhoto(); status.value = '清除完成，可继续涂抹，或导出图片。';
    console.info('[LaMa repair]', JSON.stringify({ backend: raw.backend, threads: raw.threads, inferenceMs: raw.runMs,
      selectedPixels: crop.selected, outsideMaskChangedPixels: combined.outsideChanged, insideMaskChangedPixels: combined.insideChanged }));
  } catch (e) { if (id === loadId) { error.value = (e as Error).message; status.value = '涂抹区域已保留，可重新尝试。'; } }
  finally { if (id === loadId) { busy.value = false; progress.value = null; } }
}
function download() {
  if (!working || disabled.value || !hasResult.value) return;
  const c = canvas(working.width, working.height); c.getContext('2d')!.putImageData(working, 0, 0);
  c.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${filename.value.replace(/\.[^.]+$/, '')}-修复.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
function keyboard(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable=true]')) return;
  if (e.code === 'Space' && loaded.value) { e.preventDefault(); spaceHeld.value = true; cursor.value.visible = false; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && loaded.value) { e.preventDefault(); undo(); }
  if (e.key === 'Escape') { dropDepth.value = 0; if (showOriginal.value) compareOriginal(); }
}
function releaseKey(e: KeyboardEvent) { if (e.code === 'Space') spaceHeld.value = false; }
function blur() { spaceHeld.value = false; dropDepth.value = 0; pointerUp(); }
onMounted(() => {
  resizeObserver = new ResizeObserver(() => { if (fitted.value) fitImage(); });
  if (viewport.value) resizeObserver.observe(viewport.value);
  window.addEventListener('keydown', keyboard); window.addEventListener('keyup', releaseKey); window.addEventListener('blur', blur);
});
onUnmounted(() => {
  cancel(); resizeObserver?.disconnect();
  window.removeEventListener('keydown', keyboard); window.removeEventListener('keyup', releaseKey); window.removeEventListener('blur', blur);
});
</script>

<template>
  <div class="editor-app" @dragenter="dragEnter" @dragleave="dragLeave" @dragover="dragOver" @drop="drop">
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="fileChanged" />
    <header class="app-header">
      <div class="brand"><span class="brand-icon"><Icon name="spark" :size="21" /></span><b>LaMa</b><span class="brand-separator"></span><span class="brand-description">水印清除</span></div>
      <span class="privacy"><Icon name="lock" :size="13" /> 仅在本机处理</span>
      <div class="header-actions"><button v-if="loaded" class="button button-quiet" :disabled="disabled" @click="openFile"><Icon name="upload" :size="16" /><span>更换图片</span></button><button class="button button-dark" :disabled="disabled || !hasResult" @click="download"><Icon name="download" :size="16" />导出图片</button></div>
    </header>
    <div class="usage-hint">
      <span><b>触屏</b> 双指缩放、双指拖动；选择「移动画布」后可单指拖动。</span>
      <span><b>PC</b> 鼠标滚轮缩放，按住空格或鼠标中键拖动。</span>
      <small>首次点击「清除水印」会下载约 208 MB 模型；已有缓存时直接加载。</small>
    </div>
    <main class="editor-layout">
      <aside class="tool-panel">
        <div class="panel-intro"><h1>清除工具</h1><p>涂抹需要去除的区域</p></div>
        <div class="tool-section"><div class="tools">
          <button :class="['tool-button', { active: tool === 'brush' }]" :disabled="disabled || !loaded" :aria-pressed="tool === 'brush'" @click="chooseTool('brush')"><Icon name="brush" /><span>涂抹</span><span class="tool-dot"></span></button>
          <button :class="['tool-button', { active: tool === 'eraser' }]" :disabled="disabled || !loaded" :aria-pressed="tool === 'eraser'" @click="chooseTool('eraser')"><Icon name="eraser" /><span>擦除选区</span></button>
          <button :class="['tool-button', { active: tool === 'hand' }]" :disabled="disabled || !loaded" :aria-pressed="tool === 'hand'" @click="chooseTool('hand')"><Icon name="hand" /><span>移动画布</span><kbd>空格</kbd></button>
        </div></div>
        <div class="brush-section"><div class="field-heading"><label for="brush-size">画笔大小</label><span>{{ brush }}<small> px</small></span></div><div class="brush-slider"><i class="brush-small"></i><input id="brush-size" v-model.number="brush" type="range" min="6" max="180" step="2" :disabled="disabled || !loaded || tool === 'hand'" /><i class="brush-large"></i></div><div class="selection-actions"><button :disabled="disabled || !historySize" @click="undo"><Icon name="undo" :size="15" />撤销</button><button :disabled="disabled || !selected || showOriginal" @click="clearMask"><Icon name="trash" :size="15" />清空选区</button></div></div>
        <div class="panel-bottom"><div class="brush-note"><span class="sample-dot"></span><p>蓝色区域将被清除<br /><span>涂抹时覆盖完整边缘</span></p></div><button class="button button-primary repair-button" :disabled="disabled || !selected" @click="repair"><span v-if="busy" class="spinner"></span><Icon v-else name="spark" :size="18" />{{ busy ? '正在清除' : '清除水印' }}</button><button v-if="busy" class="cancel-button" @click="cancel()">取消处理</button></div>
      </aside>
      <section class="canvas-panel" aria-label="图片编辑器">
        <div class="canvas-toolbar"><div class="file-info"><Icon name="image" :size="16" /><span>{{ loaded ? filename : '添加一张图片，清除水印' }}</span><small v-if="loaded">{{ imageSize.width }} × {{ imageSize.height }}</small></div><div class="canvas-actions"><button v-if="hasResult" :class="['compare-button', { active: showOriginal }]" :aria-pressed="showOriginal" :disabled="disabled" @click="compareOriginal"><Icon name="compare" :size="16" />{{ showOriginal ? '返回编辑' : '查看原图' }}</button><button v-if="loaded" class="remove-image" aria-label="删除当前图片" title="删除当前图片" :disabled="loading" @click="removeImage"><Icon name="close" :size="18" /></button></div></div>
        <div ref="viewport" :class="['canvas-viewport', { moving, dragging, 'is-busy': disabled }]" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp" @pointerleave="cursor.visible = false" @wheel.prevent="wheel" @contextmenu.prevent>
          <div v-show="loaded" class="canvas-stack" :style="stackStyle"><canvas ref="photo" aria-label="图片预览"></canvas><canvas ref="overlay" aria-label="使用圆形画笔涂抹需要去除的部分"></canvas></div>
          <div v-if="!loaded" class="empty-state"><div class="upload-art"><div class="art-back"></div><div class="art-front"><Icon name="image" :size="44" /><span><Icon name="plus" :size="17" /></span></div></div><h2>把图片拖到这里</h2><p>或从你的设备中选择一张图片</p><button class="button button-primary upload-button" :disabled="loading" @click="openFile"><Icon name="upload" :size="17" />{{ loading ? '正在读取…' : '选择图片' }}</button><span class="formats">支持 JPG、PNG、WebP</span><button class="sample-link" :disabled="loading" @click="loadImage(sampleUrl, '示例图片.jpg', true)">没有图片？试用示例 <span>↗</span></button></div>
          <div v-if="cursor.visible && loaded && !moving && !disabled && !showOriginal" :class="['brush-cursor', { erasing: tool === 'eraser' }]" :style="cursorStyle"><span></span></div>
          <span v-if="showOriginal" class="original-badge">原始图片 · 仅预览</span>
          <div v-if="loaded" class="zoom-controls" @pointerdown.stop @pointermove.stop @pointerup.stop><button aria-label="缩小" title="缩小" :disabled="disabled || scale <= .05" @click="zoomButton(scale / 1.25)"><Icon name="minus" :size="17" /></button><button class="zoom-value" aria-label="恢复原始尺寸" title="原始尺寸" :disabled="disabled" @click="zoomButton(1)">{{ zoomLabel }}</button><button aria-label="放大" title="放大" :disabled="disabled || scale >= 8" @click="zoomButton(scale * 1.25)"><Icon name="plus" :size="17" /></button><span class="zoom-divider"></span><button aria-label="适应画布" title="适应画布" :disabled="disabled" @click="zoomButton('fit')"><Icon name="fit" :size="17" /></button></div>
          <div v-if="loading && loaded" class="reading-overlay"><span class="spinner"></span>正在读取图片…</div>
        </div>
        <div class="canvas-footer" role="status" aria-live="polite"><div class="status-text"><span v-if="busy" class="spinner"></span><span v-else class="status-dot" :class="{ selected: selected > 0 }"></span><span>{{ loaded ? status : '你的图片只在当前浏览器中处理。' }}</span></div><span class="navigation-hint" v-if="loaded">滚轮缩放<span>·</span>空格拖动</span><div v-if="busy && progress !== null" class="load-progress"><span :style="{ width: `${Math.round(progress * 100)}%` }"></span></div></div>
      </section>
    </main>
    <div v-if="error" class="error-toast" role="alert"><span>{{ error }}</span><button aria-label="关闭提示" @click="error = ''"><Icon name="close" :size="16" /></button></div>
    <div v-if="dropDepth > 0" class="drop-overlay"><div><Icon name="upload" :size="32" /><h2>{{ loaded ? '松开以更换图片' : '松开以添加图片' }}</h2><p>图片会留在你的设备上</p></div></div>
  </div>
</template>
