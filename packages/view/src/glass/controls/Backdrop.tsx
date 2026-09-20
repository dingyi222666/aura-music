// KMPLiquidGlass (Kashif-E), Apache-2.0: LiquidToggle / LiquidSlider.
import React from "react";
import { animated, to, type Interpolation } from "@react-spring/web";
import { Material } from "./Material";
import { melt } from "./geometry";
import { stretch } from "./spring";
import type { DampedDrag } from "./useDampedDrag";

export const capsule: React.CSSProperties = {
  position: "absolute", display: "block", borderRadius: 999, cornerShape: "round",
  pointerEvents: "none",
} as React.CSSProperties;

interface Props {
  drag: DampedDrag;
  width: number;
  height: number;
  offset: Interpolation<number>;
  /** Track fill fraction 0..1, sampled from the value spring so the track and
   *  the thumb always move in the same frame (Kotlin reads `animation.value`
   *  for both). */
  progress: Interpolation<number>;
  accent: string;
  slider?: boolean;
  material?: React.ReactNode;
}

/** The unmodified track, reused for the visible track and the melt source. */
const Track: React.FC<Pick<Props, "width" | "height" | "progress" | "accent" | "slider">> = (props) => (
  <animated.span style={{
    ...capsule, inset: 0, width: props.width, height: props.height, overflow: "hidden",
    background: props.slider ? "rgb(120 120 128 / .36)" : props.progress.to(p =>
      `color-mix(in srgb, rgb(120 120 128 / .36) ${(1 - p) * 100}%, ${props.accent} ${p * 100}%)`),
  }}>
    {props.slider && <animated.span style={{
      ...capsule, left: 0, top: 0, height: props.height,
      width: props.progress.to(p => Math.round(props.width * p)), background: props.accent,
    }} />}
  </animated.span>
);

/** KMP's combined backdrop: page + reduced track, then one blur/lens chain.
 *
 * `rememberCombinedBackdrop(page, rememberBackdrop(trackLayer){ scale(...) })`
 * puts a scaled copy of the track into the thumb's own backdrop. Here the
 * scaled track is a real DOM sibling painted *behind* the glass knob, so the
 * knob's `backdrop-filter` refracts page + track together (a local `feImage`
 * renders nothing in a Chrome backdrop-filter graph). It is clipped to the
 * knob's box, so the real track outside — cut by `clip-path` around the thumb —
 * meets it at the seam.
 */
export const Backdrop: React.FC<Props> = (props) => {
  const drag = props.drag;
  const scale = to([drag.scaleX, drag.scaleY, drag.velocity], (x, y, v) =>
    stretch(x, y, v, props.slider ? 10 : 50));
  const top = (24 - props.height) / 2;
  const cut = to([props.offset, scale], (x, s) => {
    const left = x + 20 - 20 * s.x;
    const right = x + 20 + 20 * s.x;
    const upper = props.height / 2 - 12 * s.y;
    const lower = props.height / 2 + 12 * s.y;
    const rx = 12 * s.x;
    const ry = 12 * s.y;
    // An even-odd capsule hole in a full-width track, preserving its end caps.
    return `path(evenodd, "M -100 -100 H ${props.width + 100} V 100 H -100 Z M ${left + rx} ${upper} H ${right - rx} A ${rx} ${ry} 0 0 1 ${right - rx} ${lower} H ${left + rx} A ${rx} ${ry} 0 0 1 ${left + rx} ${upper} Z")`;
  });
  const meltTransform = to([props.offset, scale, drag.pressValue], (x, s, p) => {
    // `top` already positions the track band via CSS; the transform only adds
    // the melt's own registration offset (source.y), never `top` again.
    const source = melt(x, props.height, s.x, s.y, p, !!props.slider);
    return `translate(${source.x}px, ${source.y}px) scale(${source.sx}, ${source.sy})`;
  });
  return <>
    <animated.span data-control-thumb="" style={{
      ...capsule, top: 0, left: 0, width: 40, height: 24,
      boxShadow: "0 .67px 4px rgb(0 0 0 / .05)",
      transform: to([props.offset, scale], (x, s) => `translateX(${x}px) scale(${s.x}, ${s.y})`),
    }}>
      {/* KMP/Kyant0 `rememberCombinedBackdrop(page, scaledTrack)`: the scaled
          track sits behind the knob. */}
      <animated.span data-control-melt="" style={{
        ...capsule, inset: 0, overflow: "hidden",
      }}>
        <animated.span style={{
          ...capsule, left: 0, top, width: props.width, height: props.height,
          transformOrigin: "0 0", transform: meltTransform,
        }}><Track {...props} /></animated.span>
      </animated.span>
      <animated.span className="glass-knob" style={{
        ...capsule, inset: 0, overflow: "hidden", background: "transparent",
        boxShadow: "none", ["--glass-press" as string]: drag.pressValue,
      }}>
        {/* White surface at 1 - pressProgress: a resting thumb is opaque glass
            (Kyant0 `drawRect(White, 1 - progress)`). */}
        <animated.span style={{
          ...capsule, inset: 0, background: drag.pressValue.to(p => `rgb(255 255 255 / ${1 - p})`),
        }} />
        {props.material}
        <animated.span style={{
          ...capsule, inset: 0,
          boxShadow: drag.pressValue.to(p => `inset 0 ${4 * p}px ${4 * p}px rgb(0 0 0 / ${.15 * p})`),
        }} />
        <Material slider={props.slider} />
      </animated.span>
    </animated.span>
    <animated.span data-control-track="" style={{
      ...capsule, left: 0, top, width: props.width, height: props.height, clipPath: cut,
    }}><Track {...props} /></animated.span>
  </>;
};
