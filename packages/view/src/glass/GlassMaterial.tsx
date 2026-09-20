import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LensFilter, cornerExponent, normalizeRadii, paintRim, type LensDebug, type LensParams, type Radii } from "./lens";

export const useGlass = () => {
  const [reduced, reduce] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => reduce(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return { reduced };
};

let supported: boolean | null = null;

/** The lens is a `backdrop-filter: url(#svg-filter)`. Chromium and Gecko run
 *  SVG filter graphs there; WebKit accepts the syntax but only applies the
 *  shorthand functions, so it keeps the CSS glass. Solid-surface accessibility
 *  modes keep it too. */
export const glassSupported = () => {
  if (supported === null) {
    try {
      const webkit = /apple/i.test(navigator.vendor);
      const solid = matchMedia("(prefers-contrast: more), (prefers-reduced-transparency: reduce)").matches;
      supported = !webkit && !solid && typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#glass)");
    } catch {
      supported = false;
    }
  }
  return supported;
};

export interface GlassMaterialProps {
  radius?: number;
  tone?: "regular" | "clear";
  active?: boolean;
  rim?: boolean;
  shape?: "auto" | "rect" | "pill" | "circle";
  preset?: "surface" | "dialog" | "menu" | "clear" | "knob" | "slider";
  lens?: React.RefObject<{ width: number; height: number; radius: number; fused?: boolean } | null>;
  /** Read `--glass-press` each frame and tune the existing lens graph. */
  dynamic?: boolean;
  /** Runtime optics overrides. Changing them rebuilds the displacement map. */
  amount?: number;
  blur?: number;
}

const DEG = Math.PI / 180;

/** Optics per surface kind, in KMPLiquidGlass units (dp = CSS px). Each preset
 *  is one catalog component's `drawBackdrop` call, see docs/liquid-glass.md:
 *
 *    clear   LiquidBottomTabs thumb:   lens(10, 14, chromaticAberration), Highlight.Default
 *    menu    LiquidButton:             vibrancy, blur 2, lens(12, 24)
 *    surface LiquidBottomTabs panel:   vibrancy, blur 8, lens(24, 24), Highlight.Default
 *    dialog  DialogContent (dark):     colorControls(saturation 1.5), blur 8,
 *                                      lens(24, 48, depthEffect), Highlight.Plain,
 *                                      surface 0x121212 @ .4
 *
 *  `fill` is the `onDrawSurface { drawRect(color) }` colour as CSS `r g b / a`;
 *  the panel and menu keep this app's dark press instead of the demo's tints.
 */
const presets: Record<NonNullable<GlassMaterialProps["preset"]>, { fill: string; params: LensParams }> = {
  clear: {
    fill: "0 0 0 / 0",
    params: {
      radius: 0, height: 10, amount: 14, depth: 0, dispersion: 1, blur: 0, saturation: 1,
      highlight: .5, angle: 45 * DEG, falloff: 1, rimStyle: "default",
    },
  },
  /** LiquidToggle.kt thumb. Every term is the Kotlin's: `blur(8dp * (1 - p))`,
   *  `lens(5dp * p, 10dp * p, chromaticAberration)`, `Highlight.Ambient` with
   *  its width and blur halved-and-a-half an alpha of `p` (0.38 * p here),
   *  `Shadow(4dp, black .05)`, `InnerShadow(4dp * p, alpha = p)` and the white
   *  surface at `1 - p`. `dynamic` re-runs the optics off `--glass-press`. */
  knob: {
    fill: "0 0 0 / 0",
    params: {
      radius: 0, height: 5, amount: 10, depth: 0, dispersion: 1, blur: 8, saturation: 1,
      highlight: .38, angle: 45 * DEG, falloff: 1, rimStyle: "ambient",
      rimWidth: .5 / 1.5, rimBlur: .25 / 1.5,
    },
  },
  /** LiquidSlider.kt thumb: the same material at `lens(10dp * p, 14dp * p)`. */
  slider: {
    fill: "0 0 0 / 0",
    params: {
      radius: 0, height: 10, amount: 14, depth: 0, dispersion: 1, blur: 8, saturation: 1,
      highlight: .38, angle: 45 * DEG, falloff: 1, rimStyle: "ambient",
      rimWidth: .5 / 1.5, rimBlur: .25 / 1.5,
    },
  },
  menu: {
    // Kyant0's dark card fill: #333 layered ~10% + ~30% ≈ rgb(51 51 51 / .37),
    // a neutral dark grey so white text stays legible over bright artwork.
    // A default specular rim (liquid-dom's `specularOpacity`) gives the glass a
    // lit bezel instead of reading as a flat tint.
    fill: "51 51 51 / .32",
    params: {
      radius: 0, height: 12, amount: 24, depth: 0, dispersion: 0, blur: 2, saturation: 1.5,
      highlight: .6, angle: 45 * DEG, falloff: 1, rimStyle: "default",
    },
  },
  surface: {
    fill: "51 51 51 / .34",
    params: {
      radius: 0, height: 24, amount: 24, depth: 0, dispersion: 0, blur: 8, saturation: 1.5,
      highlight: .5, angle: 45 * DEG, falloff: 1, rimStyle: "default",
    },
  },
  dialog: {
    fill: "51 51 51 / .37",
    params: {
      radius: 0, height: 24, amount: 48, depth: 1, dispersion: 0, blur: 8, saturation: 1.5,
      highlight: .38, angle: 45 * DEG, falloff: 1, rimStyle: "plain",
    },
  },
};

/** Border radii of `element` in Kotlin's order (tl, tr, br, bl). */
const cssRadii = (element: HTMLElement): Radii => {
  const style = getComputedStyle(element);
  const read = (value: string) => parseFloat(value) || 0;
  return [
    read(style.borderTopLeftRadius), read(style.borderTopRightRadius),
    read(style.borderBottomRightRadius), read(style.borderBottomLeftRadius),
  ];
};

/** The element's own corner curve, so the lens draws the outline CSS draws. */
const cssCorner = (element: HTMLElement) => cornerExponent(getComputedStyle(element).getPropertyValue("corner-shape"));

let counter = 0;

const debugEnabled = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("lensdebug");

/** Liquid glass on the surrounding surface: an SVG filter graph ported from
 *  KMPLiquidGlass, applied with `backdrop-filter`, so the browser refracts
 *  whatever is really behind the surface (fluid canvas included) on every
 *  frame. The surface's own DOM stays live text; the rim highlight is a
 *  canvas stroke blended with `plus-lighter`. Without SVG backdrop filters the
 *  CSS material in `style.css` stands in.
 */
const GlassMaterial: React.FC<GlassMaterialProps> = ({ radius, active = true, preset = "surface", shape = "auto", lens, dynamic = false, amount, blur }) => {
  const filterRef = useRef<SVGFilterElement>(null);
  const rimRef = useRef<HTMLCanvasElement>(null);
  const [id] = useState(() => `glass-lens-${++counter}`);

  // Layout effect: the surface must carry the lens state and a valid filter
  // graph before its first paint, or one frame shows the CSS material instead.
  useLayoutEffect(() => {
    const filterElement = filterRef.current;
    const rim = rimRef.current;
    const surface = rim?.parentElement;
    if (!filterElement || !rim || !surface) return;

    if (!glassSupported() || !active) {
      surface.dataset.glass = "fallback";
      return () => { delete surface.dataset.glass; };
    }

    const optics = presets[preset];
    // HighlightStyle.Ambient blends SrcOver because its unlit side is *black*
    // (`half4(t, t, t, 1) * intensity`): with plus-lighter that black side would
    // vanish and the knob would wear a white ring all the way round instead of
    // a lit edge over a shaded one. Default and Plain blend Plus, which is what
    // the stylesheet's plus-lighter gives.
    rim.style.mixBlendMode = (optics.params.rimStyle ?? "default") === "ambient" ? "normal" : "plus-lighter";
    const filter = new LensFilter(filterElement, id);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const hadSurfaceClass = surface.classList.contains("glass-surface");
    // Controls mount the material inside a thumb span rather than a panel.
    // Give that host the same surface contract so the lens has a visible fill.
    surface.classList.add("glass-surface");
    surface.dataset.glass = "lens";
    surface.style.setProperty("--glass-filter", `url(#${id})`);
    // The preset's `onDrawSurface` colour, dynamic or not: `dynamic` means the
    // *optics* are retuned per frame, not that the surface loses its fill. The
    // controls use the clear preset (0 0 0 / 0). Skipping this left the knob on
    // the global `--glass-fill` (black 30%), i.e. a flat grey slab — hidden by
    // the resting white surface, but exactly what showed through the moment the
    // press faded that white out.
    surface.style.setProperty("--glass-lens-fill", optics.fill);

    // Geometry the lens was last baked for; a change rebakes. While the size
    // is still moving (the menu morph resizes its shell every frame) the maps
    // are baked small and the rim is skipped; once it has held still the full
    // resolution bake lands. Both stay well inside a frame.
    let last = "";
    let settle = 0;
    let frame = 0;
    let disposed = false;

    // A pill or circle is always circular (its radius is half the short side);
    // everything else takes its radii and corner curve (round / squircle) from
    // the element, so the refraction band and rim sit on the CSS outline.
    const circular = shape === "pill" || shape === "circle";
    const geometry = () => {
      const live = lens?.current;
      const width = live ? live.width : surface.clientWidth;
      const height = live ? live.height : surface.clientHeight;
      const round: number | Radii = circular ? Math.min(width, height) / 2
        : live ? Math.min(live.radius, width / 2, height / 2) : radius ?? cssRadii(surface);
      return { width, height, radii: normalizeRadii(round, width, height) };
    };

    const tune = () => {
      if (!dynamic) return;
      const owner = getComputedStyle(surface);
      const value = Number.parseFloat(owner.getPropertyValue("--glass-press")) || 0;
      const press = Math.max(0, Math.min(1, value));
      const fill = owner.getPropertyValue("--glass-lens-fill").trim();
      if (fill) surface.style.setProperty("--glass-lens-fill", fill);
      // The preset carries the pulse-one optics (the toggle's lens(5, 10), the
      // slider's lens(10, 14)) and the press scales them the way the Kotlin
      // recomposes its `effects` block every frame: blur(8dp * (1 - p)),
      // lens(height * p, amount * p).
      filter.tune(optics.params.amount * press, optics.params.blur * (1 - press));
      // Kotlin's Highlight.Ambient is press-only on the thumb. Keep the
      // canvas rim in the same pass and fade it with the spring instead of
      // leaving a bright outline on the resting switch/slider.
      rim.style.opacity = String(press);
      surface.dataset.glassPress = press.toFixed(3);
    };

    const bake = async (fine: boolean) => {
      const { width, height, radii } = geometry();
      if (width < 1 || height < 1) return;
      const corner = circular || shape === "rect" ? 2 : cssCorner(surface);
      const params: LensParams = {
        ...optics.params,
        radius: radii,
        corner,
        ...(amount === undefined ? {} : { amount }),
        ...(blur === undefined ? {} : { blur }),
      };
      if (fine) paintRim(rim, width, height, radii, params, dpr);
      else rim.getContext("2d")?.clearRect(0, 0, rim.width, rim.height);
      const info = await filter.update(width, height, radii, params, fine ? 512 : 96);
      if (disposed || info.map === "stale") return;
      tune();
      if (debugEnabled()) {
        const registry = (window as unknown as { __lensFilters?: Record<string, LensDebug & { fine: boolean; corner: number; backdrop: string }> });
        registry.__lensFilters ??= {};
        registry.__lensFilters[id] = { ...info, fine, corner, backdrop: getComputedStyle(surface).backdropFilter };
        surface.dataset.lensDebug = JSON.stringify(registry.__lensFilters[id]);
      }
    };

    const tick = () => {
      if (disposed) return;
      const { width, height, radii } = geometry();
      const key = [width, height, ...radii].map((v) => Math.round(v * 4) / 4).join(",");
      if (key !== last) {
        last = key;
        void bake(false);
        window.clearTimeout(settle);
        settle = window.setTimeout(() => { if (!disposed) void bake(true); }, 90);
      }
      // A live shape (menu morph) is polled per frame; static surfaces only
      // answer the ResizeObserver.
      if (lens || dynamic) {
        tune();
        frame = requestAnimationFrame(tick);
      }
    };

    const observer = new ResizeObserver(() => tick());
    observer.observe(surface);
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer.disconnect();
      filter.destroy();
      rim.style.opacity = "";
      rim.style.mixBlendMode = "";
      delete surface.dataset.glassPress;
      if (!hadSurfaceClass) surface.classList.remove("glass-surface");
      delete surface.dataset.glass;
      surface.style.removeProperty("--glass-filter");
      surface.style.removeProperty("--glass-lens-fill");
    };
  }, [active, radius, preset, shape, lens, dynamic, amount, blur, id]);

  return <>
    <svg width="0" height="0" aria-hidden="true" className="glass-defs">
      <defs><filter ref={filterRef} /></defs>
    </svg>
    <canvas ref={rimRef} className="glass-rim" aria-hidden="true" />
  </>;
};

export default GlassMaterial;
