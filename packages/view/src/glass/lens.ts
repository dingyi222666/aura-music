/** Liquid glass as a CSS `backdrop-filter` — a port of Kashif-E/KMPLiquidGlass
 *  (SkSL / Skia ImageFilter chain, Apache-2.0) to an SVG filter graph.
 *
 *  Source of the algorithm:
 *    backdrop/src/skiaMain/kotlin/com/kashif_e/backdrop/Shaders.kt
 *      RoundedRectSDF, RoundedRectRefractionShaderString,
 *      RoundedRectRefractionWithDispersionShaderString,
 *      DefaultHighlightShaderString, AmbientHighlightShaderString
 *    backdrop/src/skiaMain/kotlin/com/kashif_e/backdrop/effects/Lens.kt     (uniforms, corner radii)
 *    backdrop/src/skiaMain/kotlin/com/kashif_e/backdrop/effects/ColorFilter.kt (colorControls matrix)
 *    backdrop/src/skiaMain/kotlin/com/kashif_e/backdrop/effects/Blur.kt      (sigma = radius, CLAMP)
 *    backdrop/src/skiaMain/kotlin/com/kashif_e/backdrop/highlight/*.kt        (stroke rim)
 *
 *  Kotlin `drawBackdrop { effects { vibrancy(); blur(r); lens(h, a, depth, ca) } ... }`
 *  becomes, in the same order (innermost effect first, exactly like the Skia
 *  `ImageFilter.makeCompose` chain):
 *
 *    vibrancy() / colorControls(b, c, s)  -> feColorMatrix  (Kotlin's 4x5 matrix, verbatim)
 *    blur(radius)                         -> feGaussianBlur stdDeviation=radius edgeMode=duplicate
 *                                            (Skia `makeBlur(sigma = radius, CLAMP)`)
 *    lens(height, amount, depth, ca)      -> one feImage + feDisplacementMap per Kotlin
 *                                            `content.eval()` tap: 1 tap without dispersion,
 *                                            the 7 R/O/Y/G/C/B/P taps with it, weighted by
 *                                            Kotlin's channel factors and summed with
 *                                            feComposite arithmetic
 *    onDrawSurface { drawRect(color) }    -> the element's own background (`--glass-fill`)
 *    Highlight(width, blur, style)        -> `.glass-rim` canvas: Kotlin's clipped stroke,
 *                                            shaded by DefaultHighlight / AmbientHighlight,
 *                                            blended with `plus-lighter` (BlendMode.Plus)
 *    Shadow                               -> CSS box-shadow (`--glass-shadow`)
 *
 *  The displacement maps are baked on the CPU from the SDF (`refract`), so the
 *  page is never read back: the browser samples the live backdrop, fluid canvas
 *  included, every frame it changes.
 *
 *  Everything above `LensFilter` is pure and runs under `bun test`.
 */

/** Corner radii in Kotlin's order: top-left, top-right, bottom-right, bottom-left. */
export type Radii = [number, number, number, number];

/** `HighlightStyle.Default` / `.Ambient` / `.Plain`. */
export type RimStyle = "default" | "ambient" | "plain";

export interface LensParams {
  /** Corner radius in CSS px, one value or Kotlin's four (tl, tr, br, bl). */
  radius: number | Radii;
  /** `refractionHeight`: refraction band thickness in px. */
  height: number;
  /** `refractionAmount`: peak displacement in px (sampled inward, as in Lens.kt). */
  amount: number;
  /** `depthEffect`: 0..1 dome term added to the SDF gradient. Kotlin uses 0 / 1. */
  depth: number;
  /** `chromaticAberration`: 0 = single tap, 1 = Kotlin's uniform value; scales the split. */
  dispersion: number;
  /** Highlight intensity (Kotlin `HighlightStyle.Default.intensity`, the stroke's alpha). */
  highlight: number;
  /** Light angle in radians, y-down: normal = (cos, sin) as in the Kotlin shader. */
  angle: number;
  /** Highlight falloff exponent. */
  falloff: number;
  /** `blur(radius)` in px. 0 disables the pass. */
  blur: number;
  /** `colorControls(saturation)`; `vibrancy()` is 1.5. */
  saturation: number;
  /** `colorControls(brightness)`, default 0. */
  brightness?: number;
  /** `colorControls(contrast)`, default 1. */
  contrast?: number;
  /** Highlight style, default `HighlightStyle.Default`. */
  rimStyle?: RimStyle;
  /** `Highlight.width` in CSS px (dp), default 0.5. */
  rimWidth?: number;
  /** `Highlight.blurRadius` in CSS px (dp), default `rimWidth / 2`. */
  rimBlur?: number;
  /** Corner curve exponent: 2 = circle (CSS `round`, the Kotlin shape), 4 = CSS
   *  `squircle` / `superellipse(2)`. Default 2. The lens follows the element's
   *  own `corner-shape` so refraction and rim sit on the CSS outline. */
  corner?: number;
}

/** Exponent of a CSS `corner-shape` value: `superellipse(K)` is |x|^(2^K) + |y|^(2^K) = 1.
 *  Concave shapes (scoop, notch) have no lens meaning and clamp to a bevel. */
export const cornerExponent = (cornerShape: string | null | undefined): number => {
  const value = (cornerShape ?? "").trim().toLowerCase();
  if (!value || value === "round") return 2;
  if (value === "squircle") return 4;
  if (value === "bevel") return 1;
  if (value === "straight") return 64;
  const match = /superellipse\(\s*(-?[\d.]+|-?infinity)\s*\)/.exec(value);
  if (!match) return 2;
  const k = match[1].endsWith("infinity") ? (match[1].startsWith("-") ? -64 : 6) : parseFloat(match[1]);
  return Number.isFinite(k) ? Math.min(Math.max(2 ** k, 1), 64) : 2;
};

/** `Lens.kt` `cornerRadii`: each radius coerced to `size.minDimension / 2`. */
export const normalizeRadii = (radius: number | Radii, width: number, height: number): Radii => {
  const max = Math.max(0, Math.min(width, height) / 2);
  const four = typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  return four.map((value) => Math.min(Math.max(value, 0), max)) as Radii;
};

/** `radiusAt(coord, radii)` on centred coordinates (the Kotlin shader passes the
 *  raw pixel coordinate, which always lands on `radii.z`; centred coordinates
 *  are the intended per-corner lookup and agree with it for uniform radii). */
export const radiusAt = (x: number, y: number, radii: Radii) =>
  x >= 0 ? (y <= 0 ? radii[1] : radii[2]) : (y <= 0 ? radii[0] : radii[3]);

/** `sdRoundedRect`, verbatim for `n = 2`. Other exponents swap the corner arc
 *  for a superellipse |x|^n + |y|^n = r^n (CSS `corner-shape`); its distance is
 *  the level-set value divided by the gradient length, exact on the curve. */
export const sdRoundedRect = (x: number, y: number, hx: number, hy: number, r: number, n = 2) => {
  const qx = Math.abs(x) - (hx - r);
  const qy = Math.abs(y) - (hy - r);
  if (n !== 2 && qx > 0 && qy > 0 && r > 0) {
    const f = Math.pow(Math.pow(qx, n) + Math.pow(qy, n), 1 / n);
    if (f === 0) return -r;
    const gx = Math.pow(qx / f, n - 1);
    const gy = Math.pow(qy / f, n - 1);
    return (f - r) / (Math.hypot(gx, gy) || 1);
  }
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
};

/** `gradSdRoundedRect`, verbatim for `n = 2` (with a guard for the degenerate
 *  zero vector); the superellipse corner uses its own normal. */
export const gradSdRoundedRect = (x: number, y: number, hx: number, hy: number, r: number, n = 2): [number, number] => {
  const qx = Math.abs(x) - (hx - r);
  const qy = Math.abs(y) - (hy - r);
  const sx = Math.sign(x);
  const sy = Math.sign(y);
  if (qx >= 0 || qy >= 0) {
    let mx = Math.max(qx, 0);
    let my = Math.max(qy, 0);
    if (n !== 2 && mx > 0 && my > 0) {
      mx = Math.pow(mx, n - 1);
      my = Math.pow(my, n - 1);
    }
    const len = Math.hypot(mx, my) || 1;
    return [sx * mx / len, sy * my / len];
  }
  const gx = qx >= qy ? 1 : 0;
  return [sx * gx, sy * (1 - gx)];
};

/** `circleMap`, verbatim; clamped so an antialiasing fringe past the edge cannot NaN. */
export const circleMap = (x: number) => 1 - Math.sqrt(Math.max(1 - x * x, 0));

/** The refraction shader's `main()` for one pixel at CSS coordinate (x, y):
 *  returns the inward displacement `-d * grad * amount` (Lens.kt) and the
 *  dispersion spread `(cx * cy) / (hx * hy)` the chromatic taps scale it by.
 *  Interior pixels (`-sd >= refractionHeight`) get zero displacement. */
export function refract(
  x: number, y: number, width: number, height: number, radii: Radii,
  refractionHeight: number, amount: number, depth: number, corner = 2,
): [number, number, number] {
  const hx = width / 2;
  const hy = height / 2;
  const cx = x - hx;
  const cy = y - hy;
  const spread = hx > 0 && hy > 0 ? (cx * cy) / (hx * hy) : 0;
  const r = radiusAt(cx, cy, radii);
  const sd = sdRoundedRect(cx, cy, hx, hy, r, corner);
  if (-sd >= refractionHeight) return [0, 0, spread];
  const d = circleMap(1 - -Math.min(sd, 0) / refractionHeight);
  const gradRadius = Math.min(r * 1.5, Math.min(hx, hy));
  let [gx, gy] = gradSdRoundedRect(cx, cy, hx, hy, gradRadius, corner);
  const len = Math.hypot(cx, cy);
  if (len > 0) {
    gx += depth * cx / len;
    gy += depth * cy / len;
  }
  const norm = Math.hypot(gx, gy);
  if (norm > 0) {
    gx /= norm;
    gy /= norm;
  }
  return [-d * gx * amount, -d * gy * amount, spread];
}

/** One `content.eval()` tap of the dispersion shader: `k` scales `dispersedCoord`
 *  (`refractedCoord + dispersedCoord * k`), `r/g/b` are the channel weights. */
export interface Tap { k: number; r: number; g: number; b: number }

/** The seven taps of `RoundedRectRefractionWithDispersionShaderString`, in order. */
export const DISPERSION_TAPS: readonly Tap[] = [
  { k: 1, r: 1 / 3.5, g: 0, b: 0 },           // red
  { k: 2 / 3, r: 1 / 3.5, g: 1 / 7, b: 0 },   // orange
  { k: 1 / 3, r: 1 / 3.5, g: 1 / 3.5, b: 0 }, // yellow
  { k: 0, r: 0, g: 1 / 3.5, b: 0 },           // green
  { k: -1 / 3, r: 0, g: 1 / 3.5, b: 1 / 3 },  // cyan
  { k: -2 / 3, r: 0, g: 0, b: 1 / 3 },        // blue
  { k: -1, r: 1 / 7, g: 0, b: 1 / 3 },        // purple
];

/** The single tap of `RoundedRectRefractionShaderString`. */
export const SINGLE_TAP: readonly Tap[] = [{ k: 0, r: 1, g: 1, b: 1 }];

export interface LensMap {
  tap: Tap;
  /** feDisplacementMap `scale`: twice the tap's largest possible offset. */
  scale: number;
  /** RGBA, R = x offset, G = y offset, encoded as `0.5 + offset / scale`. */
  data: Uint8ClampedArray;
}

/** Bake the displacement map for every tap. The map is `mapWidth x mapHeight`
 *  and stretched over the `width x height` surface by feImage; each map pixel
 *  evaluates `refract` at the CSS coordinate of its centre. */
export function buildLensMaps(
  mapWidth: number, mapHeight: number, width: number, height: number, radii: Radii,
  params: Pick<LensParams, "height" | "amount" | "depth" | "dispersion" | "corner">, taps: readonly Tap[],
): LensMap[] {
  const { height: refractionHeight, amount, depth, dispersion, corner = 2 } = params;
  const maps: LensMap[] = taps.map((tap) => ({
    tap,
    scale: Math.max(2 * amount * (1 + Math.abs(tap.k) * dispersion), 1e-6),
    data: new Uint8ClampedArray(mapWidth * mapHeight * 4),
  }));
  const sx = width / mapWidth;
  const sy = height / mapHeight;
  for (let j = 0; j < mapHeight; j++) {
    const y = (j + 0.5) * sy;
    for (let i = 0; i < mapWidth; i++) {
      const x = (i + 0.5) * sx;
      const [dx, dy, spread] = refract(x, y, width, height, radii, refractionHeight, amount, depth, corner);
      const index = (j * mapWidth + i) * 4;
      for (const map of maps) {
        const factor = 1 + map.tap.k * dispersion * spread;
        map.data[index] = (0.5 + (dx * factor) / map.scale) * 255;
        map.data[index + 1] = (0.5 + (dy * factor) / map.scale) * 255;
        map.data[index + 2] = 0;
        map.data[index + 3] = 255;
      }
    }
  }
  return maps;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array, from: number, to: number) => {
  let crc = 0xffffffff;
  for (let i = from; i < to; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** Encode RGBA pixels as a PNG with stored (uncompressed) deflate blocks. The
 *  canvas `toDataURL` route re-encodes through the GPU process and took
 *  hundreds of milliseconds per map in software rendering; this is a few ms
 *  and byte-exact, which the displacement channels need. */
export function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const idat = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  idat[0] = 0x78;
  idat[1] = 0x01;
  let offset = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    idat[offset++] = b === blocks - 1 ? 1 : 0;
    idat[offset++] = len & 0xff;
    idat[offset++] = len >>> 8;
    idat[offset++] = ~len & 0xff;
    idat[offset++] = (~len >>> 8) & 0xff;
    idat.set(raw.subarray(start, start + len), offset);
    offset += len;
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  idat[offset++] = adler >>> 24;
  idat[offset++] = (adler >>> 16) & 0xff;
  idat[offset++] = (adler >>> 8) & 0xff;
  idat[offset++] = adler & 0xff;

  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let p = 8;
  const chunk = (type: string, body: Uint8Array) => {
    view.setUint32(p, body.length);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
    out.set(body, p + 8);
    view.setUint32(p + 8 + body.length, crc32(out, p + 4, p + 8 + body.length));
    p += 12 + body.length;
  };
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));
  return out;
}

/** `colorControlsColorFilter(brightness, contrast, saturation)` from ColorFilter.kt,
 *  as the 20 values of an feColorMatrix (same 4x5 row-major layout as Skia). */
export function colorControlsMatrix(brightness = 0, contrast = 1, saturation = 1): number[] {
  const invSat = 1 - saturation;
  const r = 0.213 * invSat;
  const g = 0.715 * invSat;
  const b = 0.072 * invSat;
  const c = contrast;
  const t = 0.5 - c * 0.5 + brightness;
  const cr = c * r;
  const cg = c * g;
  const cb = c * b;
  const cs = c * saturation;
  return [
    cr + cs, cg, cb, 0, t,
    cr, cg + cs, cb, 0, t,
    cr, cg, cb + cs, 0, t,
    0, 0, 0, 1, 0,
  ];
}

/** `dot(gradSdRoundedRect(centered, halfSize, gradRadius), float2(cos(angle), sin(angle)))`
 *  from the highlight shaders, for the CSS coordinate (x, y). */
export function rimDot(x: number, y: number, width: number, height: number, radii: Radii, angle: number, corner = 2) {
  const hx = width / 2;
  const hy = height / 2;
  const cx = x - hx;
  const cy = y - hy;
  const r = radiusAt(cx, cy, radii);
  const gradRadius = Math.min(r * 1.5, Math.min(hx, hy));
  const [gx, gy] = gradSdRoundedRect(cx, cy, hx, hy, gradRadius, corner);
  return gx * Math.cos(angle) + gy * Math.sin(angle);
}

/** The highlight shader's per-pixel intensity: `pow(abs(d), falloff)`, one-sided
 *  for Ambient (`step(0, d)`), flat for Plain (no shader). */
export function rimIntensity(
  x: number, y: number, width: number, height: number, radii: Radii,
  angle: number, falloff: number, style: RimStyle = "default", corner = 2,
) {
  if (style === "plain") return 1;
  const d = rimDot(x, y, width, height, radii, angle, corner);
  const intensity = Math.pow(Math.abs(d), falloff);
  return style === "ambient" && d < 0 ? 0 : intensity;
}

/** Kotlin `HighlightNode.configurePaint`: stroke width and mask blur in device px. */
export function rimGeometry(params: Pick<LensParams, "rimWidth" | "rimBlur">, deviceWidth: number, deviceHeight: number, dpr: number) {
  const width = params.rimWidth ?? 0.5;
  const strokeWidth = Math.ceil(Math.min(width * dpr, Math.min(deviceWidth, deviceHeight) / 2)) * 2;
  // PlatformBlurMaskFilter: Skia sigma = radius / 2.
  const sigma = ((params.rimBlur ?? width / 2) * dpr) / 2;
  return { strokeWidth, sigma };
}

/** Paint the highlight into `canvas` at device resolution. Kotlin records a
 *  stroke of `strokeWidth` centred on the outline, blurred by the mask filter,
 *  clipped to the outline, coloured by the style shader times `highlight`
 *  (the paint alpha). Ambient paints white on the lit side and black on the
 *  other (`half4(t, t, t, 1) * intensity`). The clip comes from the same SDF
 *  as the refraction, so a squircle surface gets a squircle rim. */
export function paintRim(
  canvas: HTMLCanvasElement, width: number, height: number, radii: Radii,
  params: Pick<LensParams, "highlight" | "angle" | "falloff" | "rimStyle" | "rimWidth" | "rimBlur" | "corner">, dpr: number,
) {
  const deviceWidth = Math.max(1, Math.ceil(width * dpr));
  const deviceHeight = Math.max(1, Math.ceil(height * dpr));
  if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
    canvas.width = deviceWidth;
    canvas.height = deviceHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, deviceWidth, deviceHeight);
  const gain = params.highlight;
  if (!(gain > 0)) return;
  const style = params.rimStyle ?? "default";
  const corner = params.corner ?? 2;
  const { strokeWidth, sigma } = rimGeometry(params, deviceWidth, deviceHeight, dpr);
  const half = strokeWidth / 2;
  const band = new ImageData(deviceWidth, deviceHeight);
  const clip = new ImageData(deviceWidth, deviceHeight);
  const pixels = band.data;
  const mask = clip.data;
  const hx = width / 2;
  const hy = height / 2;
  // Only pixels near the outline can be in the stroke or on the clip's edge:
  // scan the full rows that cross the corner arcs, and just the corner columns
  // of the rows between; everything else is inside the clip.
  const margin = Math.ceil(Math.max(...radii) * dpr + half + sigma * 3 + 2);
  for (let j = 0; j < deviceHeight; j++) {
    const y = (j + 0.5) / dpr;
    const cy = y - hy;
    const fullRow = j < margin || j >= deviceHeight - margin;
    const ranges = fullRow ? [[0, deviceWidth]] : [[0, Math.min(margin, deviceWidth)], [Math.max(deviceWidth - margin, 0), deviceWidth]];
    if (!fullRow) {
      for (let i = margin; i < deviceWidth - margin; i++) mask[(j * deviceWidth + i) * 4 + 3] = 255;
    }
    for (const [from, to] of ranges) {
      for (let i = from; i < to; i++) {
        const x = (i + 0.5) / dpr;
        const cx = x - hx;
        const r = radiusAt(cx, cy, radii);
        const sd = sdRoundedRect(cx, cy, hx, hy, r, corner) * dpr;
        const index = (j * deviceWidth + i) * 4;
        mask[index + 3] = Math.min(Math.max(0.5 - sd, 0), 1) * 255;
        const coverage = Math.min(Math.max(half - Math.abs(sd) + 0.5, 0), 1);
        if (coverage <= 0) continue;
        let shade = 255;
        let intensity = 1;
        if (style !== "plain") {
          const d = rimDot(x, y, width, height, radii, params.angle, corner);
          intensity = Math.pow(Math.abs(d), params.falloff);
          if (style === "ambient" && d < 0) shade = 0;
        }
        pixels[index] = shade;
        pixels[index + 1] = shade;
        pixels[index + 2] = shade;
        pixels[index + 3] = coverage * intensity * gain * 255;
      }
    }
  }
  // Compose like HighlightNode: the blurred stroke, then clipped to the outline.
  const stroke = document.createElement("canvas");
  stroke.width = deviceWidth;
  stroke.height = deviceHeight;
  stroke.getContext("2d")?.putImageData(band, 0, 0);
  const outline = document.createElement("canvas");
  outline.width = deviceWidth;
  outline.height = deviceHeight;
  outline.getContext("2d")?.putImageData(clip, 0, 0);
  if (sigma > 0.01) ctx.filter = `blur(${sigma}px)`;
  ctx.drawImage(stroke, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(outline, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

const SVG = "http://www.w3.org/2000/svg";

const identityMatrix = (values: number[]) =>
  values.every((value, index) => Math.abs(value - (index % 6 === 0 && index < 18 ? 1 : 0)) < 1e-6);

export interface LensDebug {
  id: string;
  size: string;
  map: string;
  taps: number;
  primitives: number;
  bakeMs: number;
  /** Time split, ms: SDF bake / total encode [per map: png+blob+image]. */
  split: string;
}

/** Owns one `<filter>` and rebuilds its primitive graph from `LensParams`.
 *
 *  A displacement map is an image, and an feImage whose image has not loaded
 *  yet reads as transparent black: every pixel then displaces by `-scale / 2`,
 *  which shows as one frame of the whole backdrop jumping. So a new graph is
 *  only installed once its maps are decoded; until the first one lands, the
 *  colour-and-blur part of the chain stands in, and an older graph keeps
 *  rendering while a newer one is being prepared. */
export class LensFilter {
  private urls: string[] = [];
  private generation = 0;
  private images: HTMLImageElement[] = [];
  private maps: SVGElement[] = [];
  private scales: number[] = [];
  private blur: SVGElement | null = null;
  private baseAmount = 0;

  constructor(readonly filter: SVGFilterElement, readonly id: string) {
    filter.setAttribute("id", id);
    // Never leave the graph empty: an empty filter paints transparent black,
    // which would blank the surface until the first bake lands.
    this.install([document.createElementNS(SVG, "feOffset")]);
  }

  private install(elements: Element[]) {
    const filter = this.filter;
    while (filter.firstChild) filter.removeChild(filter.firstChild);
    for (const element of elements) filter.appendChild(element);
  }

  /** Rebuild the filter for a `width x height` surface. `maxMap` caps the
   *  displacement map's long side; the map is stretched over the surface.
   *  Resolves once the lens part of the graph is live (or was superseded). */
  async update(width: number, height: number, radii: Radii, params: LensParams, maxMap = 512): Promise<LensDebug> {
    const started = performance.now();
    const generation = ++this.generation;
    const filter = this.filter;
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(width));
    filter.setAttribute("height", String(height));
    // Skia filters the layer in its own (sRGB) colour space; the displacement
    // maps must also be read untouched, which linearRGB would not do.
    filter.setAttribute("color-interpolation-filters", "sRGB");

    const elements: Element[] = [];
    this.maps = [];
    this.scales = [];
    this.blur = null;
    const add = (name: string, attrs: Record<string, string | number>) => {
      const element = document.createElementNS(SVG, name);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      elements.push(element);
      return element;
    };

    let input = "SourceGraphic";
    const matrix = colorControlsMatrix(params.brightness ?? 0, params.contrast ?? 1, params.saturation);
    if (!identityMatrix(matrix)) {
      add("feColorMatrix", { in: input, type: "matrix", values: matrix.map((v) => +v.toFixed(6)).join(" "), result: "color" });
      input = "color";
    }
    if (params.blur > 0) {
      this.blur = add("feGaussianBlur", { in: input, stdDeviation: params.blur, edgeMode: "duplicate", result: "blur" });
      input = "blur";
    }
    // An empty filter paints transparent black; pass the backdrop through instead.
    const passthrough = () => document.createElementNS(SVG, "feOffset");
    if (!filter.firstChild) {
      const base = elements.map((element) => element.cloneNode(true) as Element);
      if (!base.length) base.push(passthrough());
      this.install(base);
    }

    let taps: readonly Tap[] = [];
    let baked = 0;
    let encoded = 0;
    let mapWidth = 0;
    let mapHeight = 0;
    const urls: string[] = [];
    const images: HTMLImageElement[] = [];
    const encodeParts: string[] = [];
    // Lens.kt: `if (refractionHeight <= 0f || refractionAmount <= 0f) return`.
    if (params.height > 0 && params.amount > 0) {
      taps = params.dispersion > 0 ? DISPERSION_TAPS : SINGLE_TAP;
      const ratio = Math.min(1, maxMap / Math.max(width, height));
      mapWidth = Math.max(1, Math.ceil(width * ratio));
      mapHeight = Math.max(1, Math.ceil(height * ratio));
      const maps = buildLensMaps(mapWidth, mapHeight, width, height, radii, params, taps);
      baked = performance.now() - started;
      let sum: string | null = null;
      maps.forEach((map, index) => {
        const t0 = performance.now();
        const png = encodePng(map.data, mapWidth, mapHeight);
        const t1 = performance.now();
        const href = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        urls.push(href);
        const t2 = performance.now();
        const image = new Image();
        image.src = href;
        images.push(image);
        encoded += performance.now() - t0;
        encodeParts.push(`${(t1 - t0).toFixed(1)}+${(t2 - t1).toFixed(1)}+${(performance.now() - t2).toFixed(1)}`);
        add("feImage", {
          href, x: 0, y: 0, width, height,
          preserveAspectRatio: "none", result: `map${index}`,
        });
        const displacement = add("feDisplacementMap", {
          in: input, in2: `map${index}`, scale: +map.scale.toFixed(4),
          xChannelSelector: "R", yChannelSelector: "G", result: `tap${index}`,
        });
        this.maps.push(displacement);
        this.scales.push(map.scale);
        let out = `tap${index}`;
        if (taps.length > 1) {
          // Kotlin weights each tap's premultiplied channels and averages alpha.
          // The backdrop is opaque here, so alpha is kept at 1 per tap and the
          // arithmetic sum reproduces the weighted colour exactly.
          const { r, g, b } = map.tap;
          add("feColorMatrix", {
            in: out, type: "matrix",
            values: [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0].map((v) => +v.toFixed(6)).join(" "),
            result: `weighted${index}`,
          });
          out = `weighted${index}`;
        }
        if (sum === null) sum = out;
        else {
          add("feComposite", { in: sum, in2: out, operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: `sum${index}` });
          sum = `sum${index}`;
        }
      });
      input = sum!;
    }
    if (input === "SourceGraphic") elements.push(passthrough());

    // The decoded images keep the blobs in the memory cache, so setting the
    // same hrefs on the feImages resolves without another load.
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    if (generation !== this.generation) {
      for (const url of urls) URL.revokeObjectURL(url);
      return { id: this.id, size: `${width}x${height}`, map: "stale", taps: 0, primitives: 0, bakeMs: 0, split: "" };
    }
    this.install(elements);
    this.baseAmount = params.amount;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = urls;
    this.images = images;

    return {
      id: this.id,
      size: `${width}x${height}`,
      map: `${mapWidth}x${mapHeight}`,
      taps: taps.length,
      primitives: elements.length,
      bakeMs: Math.round((performance.now() - started) * 10) / 10,
      split: `${baked.toFixed(1)}/${encoded.toFixed(1)} [${encodeParts.join(" ")}]`,
    };
  }

  /** Update press optics without rebuilding PNG displacement maps. Maps are
   * baked at the maximum press amount; the SVG scale and blur remain cheap
   * mutable uniforms while the spring is moving. */
  tune(amount: number, blur: number) {
    const ratio = this.baseAmount > 0 ? Math.max(0, amount) / this.baseAmount : 0;
    this.maps.forEach((map, index) => map.setAttribute("scale", String(this.scales[index] * ratio)));
    this.blur?.setAttribute("stdDeviation", String(Math.max(0, blur)));
  }

  destroy() {
    this.generation++;
    while (this.filter.firstChild) this.filter.removeChild(this.filter.firstChild);
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    this.images = [];
    this.maps = [];
    this.scales = [];
    this.blur = null;
    this.baseAmount = 0;
  }
}
