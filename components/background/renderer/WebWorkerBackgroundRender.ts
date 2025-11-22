import { BaseBackgroundRender } from "./BaseBackgroundRender";
import backgroundWorkerUrl from "./webWorkerBackground.worker.ts?worker&url";

type WorkerCommand =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; colors: string[] }
  | { type: "resize"; width: number; height: number }
  | { type: "colors"; colors: string[] }
  | { type: "play"; isPlaying: boolean }
  | { type: "pause"; paused: boolean };

export class WebWorkerBackgroundRender extends BaseBackgroundRender {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;

  constructor(canvas: HTMLCanvasElement, targetFps: number = 60) {
    super(targetFps);
    this.canvas = canvas;
  }

  start(colors: string[]) {
    if (!WebWorkerBackgroundRender.isSupported(this.canvas)) {
      console.warn("WebWorker background renderer requires OffscreenCanvas support");
      return;
    }

    this.stop();

    try {
      const offscreen = this.canvas.transferControlToOffscreen();
      this.canvas.dataset.offscreenTransferred = "true";
      this.worker = new Worker(backgroundWorkerUrl, { type: "module" });
      const command: WorkerCommand = {
        type: "init",
        canvas: offscreen,
        width: this.canvas.clientWidth,
        height: this.canvas.clientHeight,
        colors,
      };
      this.worker.postMessage(command, [offscreen]);
    } catch (error) {
      console.error("Failed to initialize web worker renderer", error);
      this.worker = null;
    }
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  resize(width: number, height: number) {
    if (this.worker) {
      const command: WorkerCommand = { type: "resize", width, height };
      this.worker.postMessage(command);
    }
  }

  override setPaused(paused: boolean) {
    super.setPaused(paused);
    if (this.worker) {
      this.worker.postMessage({ type: "pause", paused });
    }
  }

  setPlaying(isPlaying: boolean) {
    if (this.worker) {
      this.worker.postMessage({ type: "play", isPlaying });
    }
  }

  setColors(colors: string[]) {
    if (this.worker) {
      this.worker.postMessage({ type: "colors", colors });
    }
  }

  static isSupported(canvas: HTMLCanvasElement) {
    return (
      typeof window !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof canvas.transferControlToOffscreen === "function"
    );
  }
}
