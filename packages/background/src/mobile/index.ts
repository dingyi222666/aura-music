import { loadImageElementWithCache } from "@aura-music/core/cache";

interface FlowingLayer {
  image: HTMLCanvasElement;
  startX: number;
  startY: number;
  startScale: number;
  duration: number;
  startTime: number;
}

const defaultColors = ["#8b5cf6", "#ec4899", "#f97316", "#3b82f6"];

const MESH_FLOATS = [
  -0.2351, -0.0967, 0.2135, -0.1414, 0.9221, -0.0908, 0.9221, -0.0685, 1.3027,
  0.0253, 1.2351, 0.1786, -0.3768, 0.1851, 0.2, 0.2, 0.6615, 0.3146, 0.9543,
  0.0, 0.6969, 0.1911, 1.0, 0.2, 0.0, 0.4, 0.2, 0.4, 0.0776, 0.2318, 0.6, 0.4,
  0.6615, 0.3851, 1.0, 0.4, 0.0, 0.6, 0.1291, 0.6, 0.4, 0.6, 0.4, 0.4304,
  0.4264, 0.5792, 1.2029, 0.8188, -0.1192, 1.0, 0.6, 0.8, 0.4264, 0.8104, 0.6,
  0.8, 0.8, 0.8, 1.0, 0.8, 0.0, 1.0, 0.0776, 1.0283, 0.4, 1.0, 0.6, 1.0, 0.8,
  1.0, 1.1868, 1.0283,
];
const scaleCanvas = (
  source: HTMLCanvasElement,
  newWidth: number,
  newHeight: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, newWidth, newHeight);
  return canvas;
};

const blurCanvas = (source: HTMLCanvasElement, radius: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(source, 0, 0);
  return canvas;
};

const applyMeshDistortion = (
  source: HTMLCanvasElement,
  meshVerts: number[],
) => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  const gridWidth = 5;
  const gridHeight = 5;

  const verts: number[] = [];
  for (let i = 0; i < meshVerts.length; i += 2) {
    verts.push(meshVerts[i] * source.width);
    verts.push(meshVerts[i + 1] * source.height);
  }

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const topLeft = row * 6 + col;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * 6 + col;
      const bottomRight = bottomLeft + 1;

      const srcX = (col / gridWidth) * source.width;
      const srcY = (row / gridHeight) * source.height;
      const srcW = source.width / gridWidth;
      const srcH = source.height / gridHeight;

      const x1 = verts[topLeft * 2];
      const y1 = verts[topLeft * 2 + 1];
      const x2 = verts[topRight * 2];
      const y2 = verts[topRight * 2 + 1];
      const x3 = verts[bottomRight * 2];
      const y3 = verts[bottomRight * 2 + 1];
      const x4 = verts[bottomLeft * 2];
      const y4 = verts[bottomLeft * 2 + 1];

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      ctx.clip();

      const dx1 = x2 - x1;
      const dy1 = y2 - y1;
      const dx2 = x4 - x1;
      const dy2 = y4 - y1;

      if (Math.abs(dx1 * dy2 - dx2 * dy1) > 1) {
        ctx.transform(dx1 / srcW, dy1 / srcW, dx2 / srcH, dy2 / srcH, x1, y1);
        ctx.drawImage(source, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      ctx.clip();

      const dx3 = x3 - x2;
      const dy3 = y3 - y2;
      const dx4 = x4 - x2;
      const dy4 = y4 - y2;

      if (Math.abs(dx3 * dy4 - dx4 * dy3) > 1) {
        ctx.transform(dx3 / srcW, dy3 / srcW, dx4 / srcH, dy4 / srcH, x2, y2);
        ctx.drawImage(source, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      }
      ctx.restore();
    }
  }

  return canvas;
};

const getBrightness = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0.5;

  const centerX = Math.floor(canvas.width / 2);
  const centerY = Math.floor(canvas.height / 2);
  const pixel = ctx.getImageData(centerX, centerY, 1, 1).data;
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const applyBrightnessMask = (canvas: HTMLCanvasElement) => {
  const brightness = getBrightness(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (brightness > 0.8) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.31)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (brightness < 0.2) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.31)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return canvas;
};

const processBitmap = (source: HTMLCanvasElement) => {
  const smallWidth = 150;
  const smallHeight = Math.floor((source.height / source.width) * smallWidth);
  let canvas = scaleCanvas(source, smallWidth, smallHeight);
  canvas = blurCanvas(canvas, 25);
  canvas = applyMeshDistortion(canvas, MESH_FLOATS);
  const largeWidth = 1000;
  const largeHeight = Math.floor((canvas.height / canvas.width) * largeWidth);
  canvas = scaleCanvas(canvas, largeWidth, largeHeight);
  canvas = applyMeshDistortion(canvas, MESH_FLOATS);
  canvas = blurCanvas(canvas, 12);
  canvas = applyBrightnessMask(canvas);
  return canvas;
};

const createBaseTexture = async (
  colors: string[],
  coverUrl: string | undefined,
) => {
  const size = 600;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  colors.forEach((color, idx) => {
    gradient.addColorStop(idx / Math.max(1, colors.length - 1), color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  if (coverUrl) {
    try {
      const img = await loadImageElementWithCache(coverUrl);
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (size - w) / 2;
      const y = (size - h) / 2;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, x, y, w, h);
      ctx.globalAlpha = 1.0;
    } catch (error) {
      console.warn("Failed to load cover", error);
    }
  }

  return canvas;
};

const normalizeColors = (colors: string[] | undefined): string[] => {
  if (!colors || colors.length === 0) {
    return defaultColors;
  }
  return colors;
};

export const createFlowingLayers = async (
  colors: string[] | undefined,
  coverUrl: string | undefined,
  count: number = 4,
): Promise<FlowingLayer[]> => {
  const normalized = normalizeColors(colors);
  const layers: FlowingLayer[] = [];

  for (let i = 0; i < count; i++) {
    const baseCanvas = await createBaseTexture(normalized, coverUrl);
    const processed = processBitmap(baseCanvas);

    layers.push({
      image: processed,
      startX: Math.sin(i * 1.7) * 0.06,
      startY: Math.cos(i * 1.7) * 0.06,
      startScale: 1.18 + i * 0.02,
      duration: 32000 + i * 4000,
      startTime: -i * 5000,
    });
  }

  return layers;
};

export type { FlowingLayer };
export { defaultColors };
