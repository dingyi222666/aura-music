/** Spring specs ported from Kashif-E/KMPLiquidGlass (Apache-2.0),
 *  catalog/sharedUI/src/commonMain/kotlin/com/kashif_e/backdrop/catalog/utils/DampedDragAnimation.kt
 *
 *  Compose's spring(dampingRatio, stiffness) in react-spring terms:
 *  tension = stiffness, friction = 2 * ratio * sqrt(tension * mass), mass = 1.
 */
import { to } from "@react-spring/web";

export const spring = (ratio: number, stiffness: number) => ({
  tension: stiffness,
  friction: 2 * ratio * Math.sqrt(stiffness),
});

export const spec = {
  value: { ...spring(1, 1000), precision: .001 },
  velocity: { ...spring(.5, 300), precision: .01 },
  press: { ...spring(1, 1000), precision: .001 },
  scaleX: { ...spring(.6, 250), precision: .001 },
  scaleY: { ...spring(.7, 250), precision: .001 },
};

/** pressedScale / initialScale from DampedDragAnimation's constructor. */
export const PRESSED = 1.5;
export const INITIAL = 1;

/** ProgressConverter.Default: (1 - e^-|p|) * sign(p). */
export const convert = (p: number) => (1 - Math.exp(-Math.abs(p))) * Math.sign(p);

/** The press springs' scale with the velocity stretch applied (the Kotlin's
 *  `layerBlock`), kept separate from the transform string so the track's
 *  `clip-path` can cut exactly the shape the thumb paints. */
export const stretch = (sx: number, sy: number, v: number, divisor: number) => {
  const speed = v / divisor;
  return {
    x: sx / (1 - Math.min(Math.max(speed * .75, -.2), .2)),
    y: sy * (1 - Math.min(Math.max(speed * .25, -.2), .2)),
  };
};

/** layerBlock in LiquidToggle/LiquidSlider: the press springs scale the thumb,
 *  then velocity stretches it along the motion and squeezes it across. The
 *  divisor is per component — 50 in the toggle, 10 in the slider. */
export const thumbScale = (scaleX: any, scaleY: any, velocity: any, divisor: number) => ({
  transform: to([scaleX, scaleY, velocity], (sx: number, sy: number, v: number) => {
    const s = stretch(sx, sy, v, divisor);
    return `scale(${s.x.toFixed(4)}, ${s.y.toFixed(4)})`;
  }),
});

/** The white surface the original draws on top of the glass: it fades out as
 *  the press progresses, so a pressed thumb is bare glass. */
export const surfaceAlpha = (press: any) => to([press], (p: number) => 1 - p);

/** onDrawSurface's counterpart for the material layers: blur 8dp * (1 - p),
 *  lens k * p, ambient highlight and inner shadow alpha = p. */
export const pressLayers = (press: any) => ({
  frost: to([press], (p: number) => 8 * (1 - p)),
  lens: to([press], (p: number) => Math.max(p, 0)),
  inner: to([press], (p: number) => p),
});
