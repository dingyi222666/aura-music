import { Spectrum } from "@aura-music/core/audioSpectrum";

export type WorkerMessage =
  | { type: "INIT"; canvas: OffscreenCanvas; config: VisualizerConfig; port: MessagePort }
  | { type: "RESIZE"; width: number; height: number }
  | { type: "DESTROY" };

export interface VisualizerConfig {
  barCount: number;
  gap: number;
  dpr?: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  close: () => void;
};
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let config: VisualizerConfig | null = null;
let port: MessagePort | null = null;
let spectrum = new Spectrum();
let frame = 0;
let last = 0;
let received = 0;

const draw = (now: number) => {
  if (!canvas || !ctx || !config) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const values = spectrum.update(dt, now - received > 120);
  const dpr = config.dpr ?? 1;
  const width = canvas.width / dpr, height = canvas.height / dpr;
  const gap = Math.min(config.gap, width / values.length * 0.4);
  const bar = (width - gap * (values.length - 1)) / values.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < values.length; i++) {
    const size = Math.max(2, values[i] * (height - 2));
    ctx.beginPath();
    ctx.roundRect(i * (bar + gap), height - size, bar, size, Math.min(bar, size) / 2);
    ctx.fill();
  }
  ctx.restore();
  frame = requestAnimationFrame(draw);
};

scope.onmessage = (event) => {
  const data = event.data;
  if (data.type === "INIT") {
    canvas = data.canvas;
    config = data.config;
    ctx = canvas.getContext("2d");
    spectrum = new Spectrum(48000, config.barCount);
    port = data.port;
    port.onmessage = (event: MessageEvent<
      { type: "SAMPLE_RATE"; rate: number } | { type: "AUDIO_DATA"; data: Float32Array }
    >) => {
      if (event.data.type === "SAMPLE_RATE") {
        spectrum = new Spectrum(event.data.rate, config!.barCount);
        return;
      }
      spectrum.push(event.data.data);
      received = performance.now();
    };
    last = performance.now();
    frame = requestAnimationFrame(draw);
    return;
  }
  if (data.type === "RESIZE" && canvas) {
    canvas.width = data.width;
    canvas.height = data.height;
    return;
  }
  if (data.type === "DESTROY") {
    cancelAnimationFrame(frame);
    port?.close();
    canvas = null;
    ctx = null;
    scope.close();
  }
};
