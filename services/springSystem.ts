export interface SpringConfig {
  mass: number;
  stiffness: number;
  damping: number;
  precision?: number;
}

export interface SpringState {
  current: number;
  target: number;
  velocity: number;
}

export const DEFAULT_SPRING: SpringConfig = {
  mass: 1, stiffness: 100, damping: 18, precision: 0.001,
};

export const LINE_SPRING: SpringConfig = {
  ...DEFAULT_SPRING, precision: 0.05,
};

export const LIFT_SPRING: SpringConfig = {
  mass: 1, stiffness: 14, damping: 7, precision: 0.001,
};

export const PRESS_SPRING: SpringConfig = {
  mass: 1, stiffness: 322, damping: 24, precision: 0.001,
};

export const RELEASE_SPRING: SpringConfig = {
  mass: 2, stiffness: 300, damping: 50, precision: 0.001,
};

// Exact solution of m*x'' + c*x' + k*(x-target) = 0 for a fixed target.
// Retargeting keeps both position and velocity. All three damping regimes use
// the same solver, independent of refresh rate or a single delayed frame.
export const advance = (state: SpringState, config: SpringConfig, dt: number): boolean => {
  if (!Number.isFinite(dt) || dt <= 0) return false;
  if (state.current === state.target && state.velocity === 0) return false;
  const a = config.damping / (2 * config.mass);
  const k = config.stiffness / config.mass;
  const d = a * a - k;
  const x = state.current - state.target;
  const v = state.velocity;
  let position: number;
  let velocity: number;
  if (Math.abs(d) < 1e-8 * Math.max(1, k)) {
    const decay = Math.exp(-a * dt);
    const b = v + a * x;
    position = decay * (x + b * dt);
    velocity = decay * (v - a * b * dt);
  } else if (d < 0) {
    const w = Math.sqrt(-d);
    const decay = Math.exp(-a * dt);
    const c = Math.cos(w * dt);
    const s = Math.sin(w * dt) / w;
    position = decay * (x * c + (v + a * x) * s);
    velocity = decay * (v * c - (a * v + k * x) * s);
  } else {
    const w = Math.sqrt(d);
    const slow = -k / (a + w);
    const fast = -a - w;
    const b = (v - fast * x) / (slow - fast);
    const c = x - b;
    position = b * Math.exp(slow * dt) + c * Math.exp(fast * dt);
    velocity = slow * b * Math.exp(slow * dt) + fast * c * Math.exp(fast * dt);
  }
  const precision = config.precision ?? 0.001;
  const settled = Math.abs(position) <= precision && Math.abs(velocity) <= precision;
  state.current = settled ? state.target : state.target + position;
  state.velocity = settled ? 0 : velocity;
  return !settled;
};

// A spring owns its state directly; no named channels or per-frame copies.
export class Spring implements SpringState {
  current: number;
  target: number;
  velocity = 0;

  constructor(value: number, private config: SpringConfig = DEFAULT_SPRING) {
    this.current = this.target = value;
  }

  set(value: number, config = this.config) {
    this.target = value;
    this.config = config;
  }

  snap(value: number) {
    this.current = this.target = value;
    this.velocity = 0;
  }

  step(dt: number) { return advance(this, this.config, dt); }

  get settled() {
    const precision = this.config.precision ?? 0.001;
    return Math.abs(this.current - this.target) <= precision && Math.abs(this.velocity) <= precision;
  }
}

// Sample a fresh spring by elapsed media time. Seeking and pausing give the
// same word lift regardless of which frames were rendered before this one.
export const liftAt = (elapsed: number) => {
  if (elapsed <= 0) return 0;
  const state = { current: 0, target: 1, velocity: 0 };
  advance(state, LIFT_SPRING, elapsed);
  return Math.max(0, Math.min(1, state.current));
};
