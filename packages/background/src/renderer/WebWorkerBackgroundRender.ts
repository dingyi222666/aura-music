import { subscribeAudioLevel } from "@aura-music/core/audioLevelBridge";
import type { AudioEnvelope } from "@aura-music/core/audioEnvelope";
import { BaseBackgroundRender } from "./BaseBackgroundRender";
import backgroundWorkerUrl from "./webWorkerBackground.worker.ts?worker&url";

type WorkerCommand =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; colors: string[] }
  | { type: "resize"; width: number; height: number }
  | { type: "colors"; colors: string[] }
  | { type: "play"; isPlaying: boolean }
  | { type: "beat"; enabled: boolean }
  | ({ type: "audio" } & AudioEnvelope)
  | { type: "pause"; paused: boolean }
  | { type: "snapshot"; id: number }
  | { type: "watchFrame"; id: number }
  | { type: "coverImage"; imageData: ImageBitmap }
  | { type: "clearCover" }
  | { type: "dispose" };

type WorkerEvent =
  | { type: "snapshot"; id: number; bitmap?: ImageBitmap | null }
  | { type: "frame"; id: number }
  | { type: "disposed" };

export class WebWorkerBackgroundRender extends BaseBackgroundRender {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;
  private id = 0;
  private request = 0;
  private controller: AbortController | null = null;
  private unlisten: (() => void) | null = null;
  private beat = false;
  private playing = false;
  private readonly pending = new Map<number, (event: WorkerEvent | null) => void>();

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
      const worker = new Worker(backgroundWorkerUrl, { type: "module" });
      this.worker = worker;
      worker.addEventListener("message", (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        if (data.type === "disposed") return;
        const finish = this.worker === worker ? this.pending.get(data.id) : undefined;
        if (finish) finish(data);
        // A timed-out or stopped request still owns its late bitmap reply.
        else if (data.type === "snapshot") data.bitmap?.close();
      });
      const command: WorkerCommand = {
        type: "init",
        canvas: offscreen,
        width: this.canvas.clientWidth,
        height: this.canvas.clientHeight,
        colors,
      };
      this.worker.postMessage(command, [offscreen]);
      this.setBeat(this.beat);
    } catch (error) {
      console.error("Failed to initialize web worker renderer", error);
      this.worker?.terminate();
      this.worker = null;
    }
  }

  stop() {
    const worker = this.worker;
    this.request++;
    this.controller?.abort();
    this.controller = null;
    this.unlisten?.();
    this.unlisten = null;
    for (const finish of this.pending.values()) finish(null);
    if (!worker) return;

    this.worker = null;
    const finish = () => {
      window.clearTimeout(timer);
      worker.removeEventListener("message", listen);
      worker.terminate();
    };
    const listen = (event: MessageEvent<WorkerEvent>) => {
      if (event.data.type === "disposed") finish();
    };
    const timer = window.setTimeout(finish, 1000);
    worker.addEventListener("message", listen);
    try {
      worker.postMessage({ type: "dispose" });
    } catch (error) {
      console.warn("Failed to release worker renderer cleanly", error);
      finish();
    }
  }

  async snapshot(timeout: number = 250) {
    const data = await this.watch("snapshot", timeout);
    return data?.type === "snapshot" ? data.bitmap ?? null : null;
  }

  async waitFrame(timeout: number = 1000) {
    const data = await this.watch("watchFrame", timeout);
    return data?.type === "frame";
  }

  private watch(type: "snapshot" | "watchFrame", timeout: number) {
    const worker = this.worker;
    if (!worker) return Promise.resolve<WorkerEvent | null>(null);
    const id = ++this.id;
    return new Promise<WorkerEvent | null>((resolve) => {
      const finish = (data: WorkerEvent | null) => {
        window.clearTimeout(timer);
        this.pending.delete(id);
        resolve(data);
      };
      const timer = window.setTimeout(() => finish(null), timeout);
      this.pending.set(id, finish);
      try {
        worker.postMessage({ type, id } satisfies WorkerCommand);
      } catch (error) {
        console.warn("Failed to request background frame", error);
        finish(null);
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
    this.listen();
    if (this.worker) {
      this.worker.postMessage({ type: "pause", paused });
    }
  }

  setPlaying(isPlaying: boolean) {
    this.playing = isPlaying;
    this.listen();
    if (this.worker) {
      this.worker.postMessage({ type: "play", isPlaying });
    }
  }

  setBeat(enabled: boolean) {
    this.beat = enabled;
    this.worker?.postMessage({ type: "beat", enabled });
    this.listen();
  }

  private listen() {
    const enabled = this.beat && this.playing && !this.isPaused && !!this.worker;
    if (enabled === !!this.unlisten) return;
    this.unlisten?.();
    this.unlisten = enabled ? subscribeAudioLevel((value) => {
      this.worker?.postMessage({ type: "audio", ...value });
    }) : null;
  }

  setColors(colors: string[]) {
    if (this.worker) {
      this.worker.postMessage({ type: "colors", colors });
    }
  }

  /**
   * Send the complete artwork for blur and texture mapping onto the mesh.
   * The bitmap is transferred (zero-copy) to the worker thread.
   */
  async setCoverImage(url: string) {
    const worker = this.worker;
    if (!worker) return;
    const request = ++this.request;
    this.controller?.abort();
    this.controller = new AbortController();
    if (!url) {
      worker.postMessage({ type: "clearCover" });
      return;
    }
    try {
      const response = await fetch(url, { signal: this.controller.signal });
      if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      if (this.worker !== worker || this.request !== request) {
        bitmap.close();
        return;
      }
      const command: WorkerCommand = { type: "coverImage", imageData: bitmap };
      try {
        worker.postMessage(command, [bitmap]);
      } catch (error) {
        bitmap.close();
        throw error;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("Failed to load cover image for worker renderer", error);
      if (this.worker === worker && this.request === request) {
        worker.postMessage({ type: "clearCover" });
      }
    }
  }

  /**
   * Send a pre-created ImageBitmap directly (avoids double-fetch if caller already has it).
   */
  setCoverBitmap(bitmap: ImageBitmap) {
    this.request++;
    this.controller?.abort();
    if (!this.worker) { bitmap.close(); return; }
    const command: WorkerCommand = { type: "coverImage", imageData: bitmap };
    try {
      this.worker.postMessage(command, [bitmap]);
    } catch (error) {
      bitmap.close();
      console.warn("Failed to transfer cover bitmap", error);
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
