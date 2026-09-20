// Port of Kashif-E/KMPLiquidGlass DampedDragAnimation.kt (Apache-2.0).
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useSpring, type SpringValue } from "@react-spring/web";
import { INITIAL, PRESSED, spec } from "./spring";
import { coerce } from "./geometry";

export interface DampedDrag {
  valueSpring: SpringValue<number>;
  pressValue: SpringValue<number>;
  scaleX: SpringValue<number>;
  scaleY: SpringValue<number>;
  velocity: SpringValue<number>;
  pressed: boolean;
  onDown: (event: PointerEvent<HTMLElement>) => void;
  onMove: (event: PointerEvent<HTMLElement>) => void;
  onUp: (event: PointerEvent<HTMLElement>) => void;
  onCancel: () => void;
  animateTo: (value: number) => void;
}
interface Options {
  value: number;
  min: number;
  max: number;
  dragSpan: number | (() => number);
  delta: (dx: number, span: number) => number;
  onCommit: (value: number) => void;
  onRelease?: (value: number, moved: boolean, animate: (value: number) => void) => void;
}

export const useDampedDrag = (opts: Options): DampedDrag => {
  const latest = useRef(opts);
  latest.current = opts;
  const [val, position] = useSpring(() => ({ v: opts.value, config: spec.value }));
  const [press, pressure] = useSpring(() => ({ p: 0, config: spec.press }));
  const [scaleX, horizontal] = useSpring(() => ({ s: INITIAL, config: spec.scaleX }));
  const [scaleY, vertical] = useSpring(() => ({ s: INITIAL, config: spec.scaleY }));
  const [velocity, speed] = useSpring(() => ({ v: 0, config: spec.velocity }));
  const target = useRef(opts.value);
  const emitted = useRef(opts.value);
  const pointer = useRef<{ id: number; x: number; scale: number; direction: number } | null>(null);
  const moved = useRef(false);
  const frame = useRef(0);
  const [pressed, setPressed] = useState(false);

  const hold = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPressed(true);
    pressure.start({ p: 1 });
    horizontal.start({ s: PRESSED });
    vertical.start({ s: PRESSED });
  }, [pressure, horizontal, vertical]);

  // release(): wait one frame, then until the displayed value is within 2.5%
  // of its current target. A new press cancels this wait; no stale promise can
  // collapse the thumb during a later hold.
  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const settle = () => {
      const range = latest.current.max - latest.current.min;
      if (Math.abs(val.v.get() - target.current) > Math.max(range * .025, .001)) {
        frame.current = requestAnimationFrame(settle);
        return;
      }
      frame.current = 0;
      setPressed(false);
      pressure.start({ p: 0 });
      horizontal.start({ s: INITIAL });
      vertical.start({ s: INITIAL });
      speed.start({ v: 0 });
    };
    frame.current = requestAnimationFrame(settle);
  }, [val.v, pressure, horizontal, vertical, speed]);

  const update = useCallback((next: number, track: boolean) => {
    const cfg = latest.current;
    target.current = coerce(next, cfg.min, cfg.max);
    position.start({
      v: target.current,
      onChange: track ? () => {
        // SpringValue velocity is units/ms; Kotlin tracks value units/second,
        // normalised by the value range (not pointer pixels).
        speed.start({ v: val.v.velocity * 1000 / Math.max(cfg.max - cfg.min, .001) });
      } : undefined,
    });
  }, [position, speed, val.v]);

  const animate = useCallback((next: number) => {
    hold();
    update(next, false);
    speed.start({ v: 0 });
    release();
  }, [hold, update, speed, release]);
  const animateTo = useCallback((next: number) => {
    animate(next);
    emitted.current = target.current;
    latest.current.onCommit(target.current);
  }, [animate]);

  useEffect(() => {
    // Parent echoes of our own drag must not restart the press animation.
    if (opts.value === emitted.current || opts.value === target.current) return;
    emitted.current = opts.value;
    if (pointer.current) update(opts.value, true);
    else animate(opts.value);
  }, [opts.value, animate, update]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || pointer.current) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    pointer.current = {
      id: event.pointerId, x: event.clientX,
      scale: element.clientWidth / Math.max(element.getBoundingClientRect().width, 1),
      direction: getComputedStyle(element).direction === "rtl" ? -1 : 1,
    };
    moved.current = false;
    hold();
  }, [hold]);
  const onMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = (event.clientX - state.x) * state.scale * state.direction;
    state.x = event.clientX;
    if (!dx) return;
    moved.current = true;
    const cfg = latest.current;
    const span = typeof cfg.dragSpan === "function" ? cfg.dragSpan() : cfg.dragSpan;
    update(target.current + cfg.delta(dx, span), true);
    emitted.current = target.current;
    cfg.onCommit(target.current);
  }, [update]);
  const onUp = useCallback((event: PointerEvent<HTMLElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    latest.current.onRelease?.(target.current, moved.current, animateTo);
    moved.current = false;
    release();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [animateTo, release]);
  const onCancel = useCallback(() => {
    if (!pointer.current) return;
    pointer.current = null;
    moved.current = false;
    update(latest.current.value, false);
    release();
  }, [update, release]);

  return { valueSpring: val.v, pressValue: press.p, scaleX: scaleX.s, scaleY: scaleY.s,
    velocity: velocity.v, pressed, onDown, onMove, onUp, onCancel, animateTo };
};
