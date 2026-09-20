interface Glyph {
  canvas: HTMLCanvasElement;
  pixels: number;
}

// Shared across translation layouts; bounded to eight MB of RGBA pixels.
const cache = new Map<string, Glyph>();
let pixels = 0;

export const haloOf = (text: string, font: string, size: number, width: number, ratio: number) => {
  const key = `${font}:${ratio}:${width}:${text}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.canvas;
  }
  const side = Math.max(16, Math.ceil(size * 0.9));
  const top = Math.max(10, Math.ceil(size * 0.58));
  const bottom = Math.max(14, Math.ceil(size * 0.9));
  const mask = document.createElement("canvas");
  mask.width = Math.ceil((width + side * 2) * ratio);
  mask.height = Math.ceil((size + top + bottom) * ratio);
  const source = mask.getContext("2d")!;
  source.scale(ratio, ratio);
  source.font = font;
  source.textBaseline = "top";
  source.fillStyle = "white";
  source.fillText(text, side, top);

  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  ctx.globalCompositeOperation = "lighter";
  for (const [alpha, blur] of [[0.12, 0.72], [0.24, 0.34], [0.48, 0.14]]) {
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${(size * blur).toFixed(2)}px)`;
    ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, width + side * 2, size + top + bottom);
  }
  const area = canvas.width * canvas.height;
  while (cache.size && (pixels + area > 2_000_000 || cache.size >= 96)) {
    const oldest = cache.keys().next().value!;
    pixels -= cache.get(oldest)!.pixels;
    cache.delete(oldest);
  }
  cache.set(key, { canvas, pixels: area });
  pixels += area;
  return canvas;
};
