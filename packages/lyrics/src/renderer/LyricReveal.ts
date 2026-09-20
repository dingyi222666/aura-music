import { Spring, DEFAULT_SPRING } from "@aura-music/core/springSystem";

const CLOSE = { mass: 1, stiffness: 40, damping: 13, precision: 0.001 };

// Expand layout space and fade the content, keeping glyphs and dots at 1:1 size.
export class LyricReveal {
  private readonly spring = new Spring(0);
  height = 0;
  opacity = 0;

  update(visible: boolean, dt: number) {
    const target = visible ? 1 : 0;
    if (this.spring.target === target && this.spring.settled && this.opacity === target) return;
    this.spring.set(target, visible ? DEFAULT_SPRING : CLOSE);
    this.spring.step(dt);
    this.height = Math.max(0, Math.min(1, this.spring.current));
    this.opacity += (target - this.opacity) * (1 - Math.exp(-dt / (visible ? 0.1 : 0.24)));
    if (Math.abs(target - this.opacity) < 0.001) this.opacity = target;
  }
}
