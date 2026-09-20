export abstract class BaseBackgroundRender {
  protected targetFps: number;
  private frameInterval: number;
  protected lastRenderTime = 0;
  protected isPaused = false;

  constructor(targetFps: number = 60) {
    this.targetFps = targetFps;
    this.frameInterval = 1000 / targetFps;
  }

  setTargetFps(fps: number) {
    this.targetFps = fps;
    this.frameInterval = 1000 / fps;
  }

  setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  protected shouldRender(now: number) {
    if (this.lastRenderTime === 0) {
      this.lastRenderTime = now;
      return true;
    }

    const elapsed = now - this.lastRenderTime;
    if (elapsed < this.frameInterval) {
      return false;
    }

    this.lastRenderTime = now - (elapsed % this.frameInterval);
    return true;
  }

  protected resetClock(startTime: number) {
    this.lastRenderTime = startTime;
  }

  abstract start(colors?: string[]): void;
  abstract stop(): void;
}
