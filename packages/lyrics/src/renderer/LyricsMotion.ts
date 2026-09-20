import { LyricsTimeline } from "../parser/timeline";
import { advance, DEFAULT_SPRING, LINE_SPRING, Spring } from "@aura-music/core/springSystem";

interface Row {
  posY: Spring;
  scale: Spring;
  delay: number;
}

type Mode = "auto" | "drag" | "momentum" | "wheel" | "manual" | "rebound";
interface Sample { time: number; y: number }

// Keep the existing playback pace and trail; give line changes a clearer rebound.
const PROGRESSION = { ...LINE_SPRING, damping: 13 };
const TRACKING = { mass: 1, stiffness: 280, damping: 32, precision: 0.1 };
const SEEK = { mass: 1.08, stiffness: 124, damping: 20, precision: 0.1 };
const WHEEL = { mass: 0.9, stiffness: 200, damping: 30, precision: 0.01 };
const REBOUND = { mass: 0.9, stiffness: 280, damping: 24, precision: 0.01 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
// Song-owned motion: one camera, one interaction mode, stable row identities.
// Events provide coordinates; neither React nor the audio element lives here.
export class LyricsMotion {
  readonly rows: Row[];
  anchor = -1;
  mode: Mode = "auto";
  private readonly camera = new Spring(0);
  private readonly positions: number[] = [];
  private readonly history: Sample[] = [];
  private readonly samples: Sample[] = [];
  private height = 1;
  private limit = 0;
  private touched = -Infinity;
  private velocity = 0;
  private pending = true;
  private relocating = false;
  private time = Number.NaN;

  constructor(private readonly timeline: LyricsTimeline) {
    this.rows = timeline.lyrics.map(() => ({ posY: new Spring(0), scale: new Spring(1), delay: 0 }));
  }

  follow() {
    this.mode = "auto";
    this.touched = -Infinity;
    this.velocity = 0;
    this.samples.length = this.history.length = 0;
  }

  resume() {
    this.follow();
    this.pending = true;
  }

  private bound(value: number, rubber = false) {
    const bounded = clamp(value, 0, this.limit);
    if (!rubber || bounded === value) return bounded;
    const gap = value - bounded;
    return bounded + Math.sign(gap) * this.height * (1 - 1 / (Math.abs(gap) * 1.2 / this.height + 1));
  }

  private sample(y: number, time: number) {
    this.samples.push({ y, time });
    while (this.samples.length > 8 || (this.samples.length > 1 && time - this.samples[0].time > 120)) {
      this.samples.shift();
    }
  }

  begin(y: number, now = performance.now()) {
    this.mode = "drag";
    this.touched = now;
    this.velocity = 0;
    this.samples.length = 0;
    this.sample(y, now);
    this.camera.snap(this.camera.current);
  }

  move(y: number, now = performance.now()) {
    if (this.mode !== "drag") return;
    const last = this.samples[this.samples.length - 1];
    const delta = last.y - y;
    this.camera.snap(this.bound(this.camera.current + delta, true));
    this.velocity = this.velocity * 0.35 + clamp(delta / Math.max(0.001, (now - last.time) / 1000), -3600, 3600) * 0.65;
    this.touched = now;
    this.sample(y, now);
  }

  end(now = performance.now(), cancelled = false) {
    // Mouse-leave without a press must not suspend automatic following.
    if (this.mode !== "drag") return;
    this.touched = now;
    let sum = 0;
    let weight = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const previous = this.samples[i - 1];
      const sample = this.samples[i];
      const dt = (sample.time - previous.time) / 1000;
      if (dt <= 0 || now - sample.time > 120) continue;
      const gain = Math.max(0.2, 1 - (now - sample.time) / 120);
      sum += (previous.y - sample.y) / dt * gain;
      weight += gain;
    }
    this.velocity = cancelled ? 0 : clamp(weight ? sum / weight : 0, -3600, 3600);
    this.samples.length = 0;
    this.camera.target = this.bound(this.camera.current);
    this.mode = Math.abs(this.camera.target - this.camera.current) > 0.01
      ? "rebound"
      : Math.abs(this.velocity) >= 50 ? "momentum" : "manual";
  }

  wheel(delta: number, unit = 0, now = performance.now()) {
    const base = this.mode === "wheel" ? this.camera.target : this.camera.current;
    this.camera.target = this.bound(base + delta * (unit === 1 ? 32 : unit === 2 ? this.height : 1) * 0.95);
    this.mode = "wheel";
    this.velocity = 0;
    this.touched = now;
    this.samples.length = 0;
  }

  private delayed(time: number) {
    for (let i = this.history.length - 1; i > 0; i--) {
      const a = this.history[i - 1];
      const b = this.history[i];
      if (time >= a.time) return a.y + (b.y - a.y) * clamp((time - a.time) / (b.time - a.time || 1), 0, 1);
    }
    return this.history[0]?.y ?? this.camera.current;
  }

  update(dt: number, time: number, heights: number[], focuses: number[], height: number, now = performance.now()) {
    const resize = this.height !== height;
    this.height = Math.max(1, height);
    let bottom = 0;
    for (const index of this.timeline.order) {
      this.positions[index] = bottom;
      bottom += heights[index] ?? 0;
    }
    this.limit = Math.max(0, bottom - this.height * 0.1);
    const anchor = this.timeline.anchor(time + 0.1);
    const jump = Number.isFinite(this.time) && (
      time < this.time - 0.1 || Math.abs(time - this.time) > Math.max(0.25, dt * 2) ||
      (this.anchor >= 0 && Math.abs(anchor - this.anchor) > 5)
    );
    const restoring = this.pending || resize;
    this.pending = false;
    this.time = time;
    this.anchor = anchor;
    if (jump || restoring) this.follow();
    const hold = now - this.touched < 1800;
    const target = this.bound(anchor < 0 ? 0 : this.positions[anchor] + (focuses[anchor] ?? heights[anchor] * 0.5));

    if (this.mode === "momentum") {
      const next = this.bound(this.camera.current + this.velocity * dt, true);
      const edge = next < 0 || next > this.limit;
      this.camera.snap(next);
      this.velocity *= Math.pow(edge ? 0.87 : 0.955, dt * 60);
      if (edge) this.velocity *= Math.max(0.4, 1 - Math.abs(next - this.bound(next)) / this.height);
      if (Math.abs(this.velocity) < 50) {
        this.camera.target = this.bound(next);
        this.mode = edge ? "rebound" : "manual";
      }
    }
    if (this.mode === "manual" && !hold) this.mode = "auto";
    if (this.mode === "auto") {
      this.camera.target = target;
      if (jump || restoring) this.camera.snap(target);
      else advance(this.camera, PROGRESSION, dt * 0.8);
    } else if (this.mode === "wheel" || this.mode === "rebound") {
      this.camera.target = this.bound(this.camera.target);
      if (!advance(this.camera, this.mode === "wheel" ? WHEEL : REBOUND, dt)) {
        if (this.mode === "rebound") this.touched = now;
        this.mode = "manual";
      }
    }

    this.relocating = !restoring && (jump || this.relocating);
    const trailing = this.mode === "auto" && !this.relocating && !restoring && anchor >= 0;
    if (trailing) {
      this.history.push({ time: now, y: this.camera.current });
      while (this.history.length > 1 && now - this.history[0].time > 400) this.history.shift();
    } else {
      this.history.length = 0;
    }
    const active = this.timeline.active(time).activeIndexes;
    let moving = false;
    this.rows.forEach((row, index) => {
      const rank = this.timeline.ranks[index] - (this.timeline.ranks[anchor] ?? 0);
      const lag = clamp(rank * 70, 0, 280);
      row.delay = trailing ? row.delay + (lag - row.delay) * (1 - Math.exp(-dt / 0.08)) : 0;
      row.posY.target = this.positions[index] - (trailing ? this.delayed(now - row.delay) : this.camera.current);
      if (restoring) {
        row.posY.snap(row.posY.target);
      } else if (trailing) {
        row.posY.velocity = dt > 0 ? (row.posY.target - row.posY.current) / dt : 0;
        row.posY.current = row.posY.target;
      } else {
        // Long seeks enter near their destination, avoiding a whole-song flyby.
        if (jump) row.posY.current = row.posY.target + clamp(row.posY.current - row.posY.target, -this.height * 0.65, this.height * 0.65);
        moving = advance(row.posY, this.relocating ? SEEK : TRACKING, dt) || moving;
      }
      row.scale.target = active.includes(index) ? 1 : this.timeline.lyrics[index].isBackground ? 0.9 : 0.98;
      if (restoring) row.scale.snap(row.scale.target);
      else advance(row.scale, DEFAULT_SPRING, dt);
    });
    if (!moving) this.relocating = false;
  }
}
