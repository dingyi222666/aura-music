// Port of Kashif-E/KMPLiquidGlass + Kyant0/AndroidLiquidGlass InteractiveHighlight
// + LiquidButton's layerBlock (Apache-2.0): a press magnifies the glass and a
// drag pulls it along a rubber band (the "Q弹" feel). A soft white highlight
// blooms *under the pointer* (a localised spotlight, not the whole surface)
// on hover and press, following the cursor.
import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { to, useSpring, type Interpolation } from "@react-spring/web";
import { spring } from "./spring";

// InteractiveHighlight uses spring(0.5, 300) for press/position.
const CONFIG = { ...spring(.5, 300), precision: .0001 };
const GLOW = { ...spring(.9, 220), precision: .0001 };
const FOLLOW = { ...spring(.9, 700), precision: .01 }; // the spotlight trails the cursor

export interface InteractiveHighlightOptions {
  /** Press magnification in px (LiquidButton's 4dp). */
  grow?: number;
  /** Capture the pointer so a drag keeps tracking. Turn OFF when the element
   *  wraps its own clickable children (a button group), so their clicks fire. */
  capture?: boolean;
  /** Bloom the highlight on hover, not only on press. */
  hover?: boolean;
  /** Spotlight radius in px. */
  radius?: number;
}

export interface InteractiveHighlight {
  /** `translate(...) scale(...)` from press magnify + directional drag stretch. */
  transform: Interpolation<string>;
  /** A localised radial white highlight at the pointer (use as `background`). */
  spotlight: Interpolation<string>;
  /** Flat press intensity 0..0.25 (a simple full white overlay, for buttons). */
  overlay: Interpolation<number>;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

const tanh = Math.tanh ?? ((x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
});

export const useInteractiveHighlight = (options: number | InteractiveHighlightOptions = {}): InteractiveHighlight => {
  const opts = typeof options === "number" ? { grow: options } : options;
  const { grow = 4, capture = true, hover = true, radius } = opts;
  const [press, pressApi] = useSpring(() => ({ p: 0, config: CONFIG }));
  const [pos, posApi] = useSpring(() => ({ x: 0, y: 0, config: CONFIG }));
  const [glow, glowApi] = useSpring(() => ({ h: 0, config: GLOW }));
  const [spot, spotApi] = useSpring(() => ({ x: 0, y: 0, config: FOLLOW }));
  const rect = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const start = useRef({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const measure = (element: HTMLElement) => {
    const r = element.getBoundingClientRect();
    rect.current = { x: r.left, y: r.top, w: Math.max(r.width, 1), h: Math.max(r.height, 1) };
  };
  const track = (element: HTMLElement, clientX: number, clientY: number, snap = false) => {
    measure(element);
    const x = clientX - rect.current.x;
    const y = clientY - rect.current.y;
    if (snap) spotApi.set({ x, y });
    else spotApi.start({ x, y });
  };

  const finish = useCallback(() => {
    if (active.current === null) return;
    active.current = null;
    pressApi.start({ p: 0 });
    posApi.start({ x: 0, y: 0 });
  }, [pressApi, posApi]);

  // Without pointer capture a pointerup can land off the element; catch it globally.
  useEffect(() => {
    if (capture) return;
    const up = () => finish();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [capture, finish]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || active.current !== null) return;
    const element = event.currentTarget;
    if (capture) element.setPointerCapture(event.pointerId);
    active.current = event.pointerId;
    start.current = { x: event.clientX, y: event.clientY };
    track(element, event.clientX, event.clientY);
    pressApi.start({ p: 1 });
    posApi.set({ x: 0, y: 0 });
  }, [capture, pressApi, posApi]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    track(event.currentTarget, event.clientX, event.clientY);
    if (active.current !== event.pointerId) return;
    // positionAnimation.snapTo(change.position); offset = position - start.
    posApi.set({ x: event.clientX - start.current.x, y: event.clientY - start.current.y });
  }, [posApi]);

  const onPointerUp = useCallback(() => finish(), [finish]);
  const onPointerCancel = useCallback(() => finish(), [finish]);
  const onPointerEnter = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!hover) return;
    track(event.currentTarget, event.clientX, event.clientY, true);
    glowApi.start({ h: 1 });
  }, [hover, glowApi]);
  const onPointerLeave = useCallback(() => { if (hover) glowApi.start({ h: 0 }); }, [hover, glowApi]);

  const transform = to([press.p, pos.x, pos.y], (p, ox, oy) => {
    const { w, h } = rect.current;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    const scale = 1 + (grow / h) * p;
    // The drag rubber band: bounded translation with a 0.05 initial slope.
    const tx = minDim * tanh(.05 * ox / minDim) * p;
    const ty = minDim * tanh(.05 * oy / minDim) * p;
    // Directional stretch: the plate deforms toward the drag (multi-axis).
    const maxDragScale = grow / h;
    const angle = Math.atan2(oy, ox);
    const sx = scale + maxDragScale * Math.abs(Math.cos(angle) * ox / maxDim) * Math.min(w / h, 1) * p;
    const sy = scale + maxDragScale * Math.abs(Math.sin(angle) * oy / maxDim) * Math.min(h / w, 1) * p;
    return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  });

  // Kyant0's InteractiveHighlight shader: a faint full-surface wash (White 0.08)
  // plus a radial glow (White 0.15) at the pointer, radius = 1.5 * minDimension
  // so it spans the full height, `smoothstep(radius, radius/2)` falloff — full
  // to 50%, fading to 0 at the edge. Hover shows it at half strength.
  const spotlight = to([spot.x, spot.y, press.p, glow.h], (x, y, p, hgl) => {
    const k = Math.max(p, hgl * .5);
    if (k < .002) return "transparent";
    const { w, h } = rect.current;
    const r = radius ?? Math.min(w, h) * 1.5;
    const peak = .15 * k;
    const base = .08 * k;
    return `radial-gradient(circle ${r.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px,` +
      ` rgb(255 255 255 / ${peak.toFixed(3)}) 0%, rgb(255 255 255 / ${peak.toFixed(3)}) 50%,` +
      ` rgb(255 255 255 / 0) 100%),` +
      ` rgb(255 255 255 / ${base.toFixed(3)})`;
  });
  const overlay = to([press.p, glow.h], (p, hgl) => Math.max(.08 * p, .04 * hgl));

  return { transform, spotlight, overlay, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerEnter, onPointerLeave };
};
