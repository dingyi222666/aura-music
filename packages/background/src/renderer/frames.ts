interface Clock {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

/** One demand-driven loop, capped at 60 Hz without catching up missed frames. */
export class Frames {
  private id: number | null = null;
  private deadline = 0;

  constructor(
    private readonly clock: Clock,
    private readonly active: () => boolean,
    private readonly draw: (time: number) => void,
  ) {}

  get pending() { return this.id !== null; }

  wake() {
    if (this.pending || !this.active()) return;
    this.deadline = 0;
    this.id = this.clock.requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.id !== null) this.clock.cancelAnimationFrame(this.id);
    this.id = null;
  }

  private tick = (time: number) => {
    this.id = null;
    if (!this.active()) return;
    if (time + 0.5 >= this.deadline) {
      this.draw(time);
      if (this.deadline === 0) this.deadline = time;
      this.deadline += 1000 / 60;
      if (this.deadline < time) this.deadline = time + 1000 / 60;
    }
    if (this.active()) this.id = this.clock.requestAnimationFrame(this.tick);
  };
}
