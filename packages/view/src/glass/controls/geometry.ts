/** Geometry and maths, in the Kotlin original's units (dp == CSS px here).
 *
 *  LiquidToggle.kt:  track 64x28, thumb 40x24, padding 2, dragWidth 20
 *                    translationX = lerp(padding, padding + dragWidth, fraction)
 *  LiquidSlider.kt:  track height 6, thumb 40x24
 *                    translationX = (-w/2 + trackWidth * progress)
 *                                   clamped to [-w/4, trackWidth - 3w/4]
 */
export const toggle = {
  track: { w: 64, h: 28 },
  thumb: { w: 40, h: 24 },
  pad: 2,
  drag: 20,
  radius: 14,
};

export const slider = {
  track: 6,
  thumb: { w: 40, h: 24 },
};

export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** `fastCoerceIn` in the original: clamp without caring about NaN. */
export const coerce = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? clamp(v, lo, hi) : lo);

/** translationX of the toggle thumb. */
export const toggleTravel = (fraction: number) => lerp(toggle.pad, toggle.pad + toggle.drag, fraction);

/** translationX of the slider thumb. LiquidSlider.kt uses
 *  `(-w/2 + trackWidth * progress).coerceIn(-w/4, trackWidth - 3w/4)`, but that
 *  `coerceIn` leaves a dead zone: the thumb pins at `-w/4` once
 *  `progress < w/(4*trackWidth)`, so it reaches the edge while the value is
 *  still short of the extreme. We keep the Kotlin travel *range* but map
 *  progress linearly across it, so the thumb sits at each end exactly at
 *  min/max — no dead drag. In the middle this is identical to the Kotlin
 *  (thumb centre == fill end == `trackWidth * progress`). */
export const sliderTravel = (progress: number, trackWidth: number) =>
  lerp(-slider.thumb.w / 4, trackWidth - slider.thumb.w * 3 / 4, coerce(progress, 0, 1));

/** Liquid layer scale from pressProgress: toggle lerp(2/3→.75), lerp(0→.75);
 *  slider lerp(2/3→1), lerp(0→1). */
export const blobScale = (progress: number, full: boolean) => ({
  x: lerp(2 / 3, full ? 1 : .75, progress),
  y: lerp(0, full ? 1 : .75, progress),
});

/** Track-to-thumb coordinates for rememberBackdrop(track) + inverse layer scale.
 *
 *  The glass layer scales about the thumb's centre, and the melt source is the
 *  layer scale inverted, so a track point `q` lands at
 *  `centre + blobScale * (q - centre)` in both axes: the track is scaled about
 *  the thumb centre by exactly the blob scale, registered with the real track
 *  there. At full press the slider's source is the untouched track (1:1) even
 *  though its thumb is 1.5x larger.
 *
 *  The track's vertical centre coincides with the thumb's in both controls, so
 *  the same form holds in y with `height / 2`.
 */
export const melt = (offset: number, height: number, sx: number, sy: number, press: number, full: boolean) => {
  const scale = blobScale(press, full);
  const x = scale.x / sx;
  const y = scale.y / sy;
  return { x: 20 - (offset + 20) * x, y: height / 2 * (1 - y), sx: x, sy: y };
};
