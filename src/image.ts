export function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export function prepare(image: ImageData, selection: Uint8Array) {
  const { width: w, height: h } = image;
  let left = w, top = h, right = -1, bottom = -1;
  let selected = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!selection[y * w + x]) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y); selected++;
  }
  if (!selected) throw new Error('先用画笔涂选需要修复的区域。');
  // Keep surrounding context. Square crop + replicated padding avoids stretching.
  const span = Math.max(right - left + 1, bottom - top + 1);
  const side = Math.min(Math.max(w, h), Math.max(256, Math.ceil(span * 1.7)));
  const x0 = Math.max(0, Math.min(w - side, Math.floor((left + right + 1 - side) / 2)));
  const y0 = Math.max(0, Math.min(h - side, Math.floor((top + bottom + 1 - side) / 2)));
  const source = canvas(side, side);
  const padded = new ImageData(side, side);
  const maskSource = canvas(side, side);
  const maskPixels = new ImageData(side, side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = Math.min(w - 1, x0 + x), sy = Math.min(h - 1, y0 + y);
    const si = (sy * w + sx) * 4, di = (y * side + x) * 4;
    const alpha = image.data[si + 3] / 255;
    for (let k = 0; k < 3; k++) padded.data[di + k] = image.data[si + k] * alpha + 255 * (1 - alpha);
    padded.data[di + 3] = 255;
    const m = selection[sy * w + sx] ? 255 : 0;
    maskPixels.data[di] = maskPixels.data[di + 1] = maskPixels.data[di + 2] = m;
    maskPixels.data[di + 3] = 255;
  }
  source.getContext('2d')!.putImageData(padded, 0, 0);
  maskSource.getContext('2d')!.putImageData(maskPixels, 0, 0);
  const small = canvas(512, 512), smallMask = canvas(512, 512);
  small.getContext('2d')!.drawImage(source, 0, 0, 512, 512);
  const mc = smallMask.getContext('2d')!;
  // Bilinear + non-zero threshold conservatively keeps thin selections.
  mc.drawImage(maskSource, 0, 0, 512, 512);
  const rgba = small.getContext('2d')!.getImageData(0, 0, 512, 512).data;
  const mr = mc.getImageData(0, 0, 512, 512).data;
  const rgb = new Float32Array(3 * 512 * 512), mask = new Float32Array(512 * 512);
  for (let i = 0; i < 512 * 512; i++) {
    mask[i] = mr[i * 4] > 0 ? 1 : 0;
    // This export masks the image internally; feed full RGB in 0..1.
    for (let k = 0; k < 3; k++) rgb[k * 512 * 512 + i] = rgba[i * 4 + k] / 255;
  }
  return { rgb, mask, x0, y0, side, selected };
}

export function composite(image: ImageData, selection: Uint8Array, output: Float32Array, crop: ReturnType<typeof prepare>) {
  const predicted = new ImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    for (let k = 0; k < 3; k++) predicted.data[i * 4 + k] = Math.max(0, Math.min(255, output[k * 512 * 512 + i]));
    predicted.data[i * 4 + 3] = 255;
  }
  const p = canvas(512, 512); p.getContext('2d')!.putImageData(predicted, 0, 0);
  const big = canvas(crop.side, crop.side); big.getContext('2d')!.drawImage(p, 0, 0, crop.side, crop.side);
  const fill = big.getContext('2d')!.getImageData(0, 0, crop.side, crop.side).data;
  const result = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  let outsideChanged = 0, insideChanged = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = y * image.width + x, d = i * 4;
    if (!selection[i]) continue;
    const s = ((y - crop.y0) * crop.side + x - crop.x0) * 4;
    for (let k = 0; k < 3; k++) result.data[d + k] = fill[s + k];
    if (result.data[d] !== image.data[d] || result.data[d + 1] !== image.data[d + 1] || result.data[d + 2] !== image.data[d + 2]) insideChanged++;
  }
  // Independent full-image check of the composition invariant, including alpha.
  for (let i = 0; i < selection.length; i++) if (!selection[i]) {
    for (let k = 0; k < 4; k++) if (image.data[i * 4 + k] !== result.data[i * 4 + k]) { outsideChanged++; break; }
  }
  return { result, outsideChanged, insideChanged };
}
