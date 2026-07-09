import { BaseBackgroundRender } from "./BaseBackgroundRender";
import backgroundWorkerUrl from "./webWorkerBackground.worker.ts?worker&url";

type WorkerCommand =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; colors: string[] }
  | { type: "resize"; width: number; height: number }
  | { type: "colors"; colors: string[] }
  | { type: "play"; isPlaying: boolean }
  | { type: "pause"; paused: boolean }
  | { type: "snapshot"; id: number }
  | { type: "watchFrame"; id: number }
  | { type: "coverImage"; imageData: ImageBitmap }
  | { type: "dispose" };

type WorkerEvent =
  | { type: "snapshot"; id: number; bitmap?: ImageBitmap | null }
  | { type: "frame"; id: number };

export class WebWorkerBackgroundRender extends BaseBackgroundRender {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;
  private id = 0;

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
    const worker = this.worker;
    if (!worker) return;

    this.worker = null;
    try {
      worker.postMessage({ type: "dispose" });
    } catch (err) {
      console.warn("Failed to release worker renderer cleanly", err);
    }
    window.setTimeout(() => worker.terminate(), 100);
  }

  snapshot(timeout: number = 250) {
    const worker = this.worker;
    if (!worker) return Promise.resolve(null);

    const id = ++this.id;
    return new Promise<ImageBitmap | null>((resolve) => {
      let timer = 0;
      let done = false;

      const finish = (bitmap: ImageBitmap | null) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        worker.removeEventListener("message", listen);
        resolve(bitmap);
      };

      const listen = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        if (data?.type !== "snapshot" || data.id !== id) return;
        finish(data.bitmap ?? null);
      };

      timer = window.setTimeout(() => finish(null), timeout);
      worker.addEventListener("message", listen);

      try {
        const command: WorkerCommand = { type: "snapshot", id };
        worker.postMessage(command);
      } catch (err) {
        console.warn("Failed to capture worker renderer frame", err);
        finish(null);
      }
    });
  }

  waitFrame(timeout: number = 1000) {
    const worker = this.worker;
    if (!worker) return Promise.resolve(false);

    const id = ++this.id;
    return new Promise<boolean>((resolve) => {
      let timer = 0;
      let done = false;

      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        worker.removeEventListener("message", listen);
        resolve(ok);
      };

      const listen = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        if (data?.type !== "frame" || data.id !== id) return;
        finish(true);
      };

      timer = window.setTimeout(() => finish(false), timeout);
      worker.addEventListener("message", listen);

      try {
        const command: WorkerCommand = { type: "watchFrame", id };
        worker.postMessage(command);
      } catch (err) {
        console.warn("Failed to watch worker renderer frame", err);
        finish(false);
      }
    });
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

  /**
   * Send a cover image to the worker as an ImageBitmap for GPU texture upload.
   * The bitmap is transferred (zero-copy) to the worker thread.
   */
  async setCoverImage(url: string) {
    const worker = this.worker;
    if (!worker) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      if (this.worker !== worker) {
        bitmap.close();
        return;
      }
      const command: WorkerCommand = { type: "coverImage", imageData: bitmap };
      worker.postMessage(command, [bitmap]);
    } catch (error) {
      console.warn("Failed to load cover image for worker renderer", error);
    }
  }

  /**
   * Send a pre-created ImageBitmap directly (avoids double-fetch if caller already has it).
   */
  setCoverBitmap(bitmap: ImageBitmap) {
    if (!this.worker) return;
    const command: WorkerCommand = { type: "coverImage", imageData: bitmap };
    this.worker.postMessage(command, [bitmap]);
  }

  static isSupported(canvas: HTMLCanvasElement) {
    return (
      typeof window !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof canvas.transferControlToOffscreen === "function"
    );
  }
}
