import { advance, type SpringState } from "@aura-music/core/springSystem";

/** Debug clock: `?glassdebug&slow` scales the morph so a single-frame artifact
 *  stays on screen long enough to inspect. 1 in every normal session. */
export let timeScale = 1;
export const setTimeScale = (value: number) => { timeScale = value; };

/** Debug stepper: hold the morph still and advance exactly one frame per call,
 *  so a single-frame artifact can be parked on screen and screenshotted. */
let stepping = false;
let queued = 0;
export const setStepping = (value: boolean) => { stepping = value; };
export const isStepping = () => stepping;
export const stepMorph = (frames = 1) => { queued += frames; };

export interface Shape { x: number; y: number; width: number; height: number; radius: number }
export interface Geometry { width: number; height: number; x: number; y: number; button: number }

const state = (value: number): SpringState => ({ current: value, target: value, velocity: 0 });

export function bezier(value: number, x1: number, y1: number, x2: number, y2: number) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    if (x < value) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
}

class Tween {
  value: number;
  private start: number;
  private target: number;
  private elapsed = 0;
  private duration = 0;
  private curve = [0, 0, .58, 1];
  constructor(value: number) { this.value = this.start = this.target = value; }
  to(value: number, duration: number, curve = [0, 0, .58, 1]) {
    this.start = this.value;
    this.target = value;
    this.elapsed = 0;
    this.duration = duration;
    this.curve = curve;
  }
  step(delta: number, reduced: boolean) {
    this.elapsed += delta;
    const t = reduced || !this.duration ? 1 : this.elapsed / this.duration;
    this.value = this.start + (this.target - this.start) * bezier(t, ...this.curve as [number, number, number, number]);
    return this.value;
  }
}

/** MenuDemo's independent position/size/content tracks, adapted to a fixed anchor.
 * Start from rest so the liquid contact is visible while the trigger stays put.
 * See docs/liquid-glass.md for upstream attribution and the complete parameter table.
 */
export class Morph {
  private x: SpringState;
  private y: SpringState;
  private returningX = new Tween(0);
  private returningY = new Tween(0);
  private opacity = state(0);
  private width = new Tween(40);
  private height = new Tween(40);
  private radius = new Tween(130);
  private content = new Tween(2);
  private blur = new Tween(8);
  private material = new Tween(0);
  private opened = false;
  private elapsed = 0;
  private reduced = false;
  constructor(private geometry: Geometry) {
    this.x = state(geometry.x); this.y = state(geometry.y);
  }
  resize(geometry: Geometry) {
    const changed = geometry.width !== this.geometry.width || geometry.height !== this.geometry.height;
    this.geometry = geometry;
    if (!this.opened || !changed) return;
    this.x.target = geometry.width / 2;
    this.y.target = geometry.height / 2;
    this.width.to(geometry.width, .2);
    this.height.to(geometry.height, .2);
    this.elapsed = 0;
  }
  set(open: boolean, reduced = false) {
    this.reduced = reduced;
    if (open === this.opened) return;
    this.opened = open;
    this.elapsed = 0;
    const x = open ? this.geometry.width / 2 : this.geometry.x;
    const y = open ? this.geometry.height / 2 : this.geometry.y;
    this.x.target = x;
    this.y.target = y;
    if (!open) {
      this.returningX = new Tween(this.x.current);
      this.returningY = new Tween(this.y.current);
      this.returningX.to(x, .25);
      this.returningY.to(y, .25);
    }
    this.opacity.target = open ? 1 : 0;
    this.width.to(open ? this.geometry.width : 40, open ? .3 : .25, open ? [.8, .3, .5, .8] : [0, 0, .58, 1]);
    this.height.to(open ? this.geometry.height : 40, open ? .3 : .25, open ? [.8, .3, .5, .8] : [0, 0, .58, 1]);
    this.radius.to(open ? 48 : 130, .7);
    this.content.to(open ? 1 : 2, .3);
    this.blur.to(open ? 0 : 8, .3);
    this.material.to(open ? 1 : 0, open ? .16 : .28);
  }
  step(delta: number) {
    const scaled = stepping ? (queued > 0 ? (queued--, 1 / 60) : 0) : delta * timeScale;
    const time = Math.max(scaled, 0);
    const dt = Math.min(time, .064);
    this.elapsed += time;
    let active = false;
    const move = (spring: SpringState, stiffness: number, damping: number) => {
      if (this.reduced) { spring.current = spring.target; spring.velocity = 0; }
      else active = advance(spring, { mass: 1, stiffness, damping, precision: .02 }, dt) || active;
      return spring.current;
    };
    const x = this.opened ? move(this.x, 144, 14) : this.returningX.step(time, this.reduced);
    const y = this.opened ? move(this.y, 144, 14) : this.returningY.step(time, this.reduced);
    if (!this.opened) {
      this.x.current = x; this.y.current = y;
      this.x.velocity = this.y.velocity = 0;
    }
    const opacity = move(this.opacity, 137, 20);
    const width = this.width.step(time, this.reduced);
    const height = this.height.step(time, this.reduced);
    const radius = this.radius.step(time, this.reduced);
    return {
      shapes: [
        { x: x - width / 2, y: y - height / 2, width, height, radius },
      ] satisfies Shape[],
      x, y,
      blur: this.blur.step(time, this.reduced),
      opacity: Math.max(0, Math.min(1, opacity)),
      contentScale: this.content.step(time, this.reduced),
      materialOpacity: this.material.step(time, this.reduced),
      active: !this.reduced && (this.opened ? active || this.elapsed < .7 : this.elapsed < .3),
    };
  }
}
