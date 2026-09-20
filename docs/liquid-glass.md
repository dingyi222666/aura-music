# Liquid glass (`backdrop-filter` lens)

The glass is a **CSS `backdrop-filter: url(#svg-filter)`** per surface, ported 1:1 from
[Kashif-E/KMPLiquidGlass](https://github.com/Kashif-E/KMPLiquidGlass) (SkSL / Skia
`ImageFilter` chain, Apache-2.0). The browser filters whatever is really behind the surface,
fluid canvas included, on every frame; nothing is read back.

## Files

| Path | Role |
| --- | --- |
| `packages/view/src/glass/lens.ts` | Pure port: `sdRoundedRect` / `gradSdRoundedRect` / `circleMap` / `refract`, the 7 dispersion taps, `colorControlsMatrix`, highlight shading (`rimDot`, `rimIntensity`, `paintRim`), `encodePng`, and `LensFilter`, which turns `LensParams` into the `<filter>` primitive graph. |
| `packages/view/src/glass/GlassMaterial.tsx` | Mounts the `<filter>` and the rim canvas inside a surface, measures it, bakes on resize / morph, exposes `preset`, `shape` and `glassSupported()`. |
| `packages/view/src/glass/GlassDialog.tsx` | Dialog / menu shell, morph loop, content clipping. |
| `packages/view/src/style.css` | CSS material and the `[data-glass]` states. |
| `tests/glass.test.ts` | Morph tests plus the lens maths (SDF, taps, matrix, corners, PNG). |

## Mapping from the Kotlin original

Kotlin `drawBackdrop { effects { vibrancy(); blur(r); lens(h, a, depth, ca) }; highlight; onDrawSurface }`
becomes, in the same order as the Skia `ImageFilter.makeCompose` chain (innermost first):

| Kotlin | Here |
| --- | --- |
| `vibrancy()` / `colorControls(b, c, s)` (`ColorFilter.kt`) | `feColorMatrix` with the same 4x5 matrix (`colorControlsMatrix`) |
| `blur(radius)` (`Blur.kt`, `makeBlur(sigma = radius, CLAMP)`) | `feGaussianBlur stdDeviation=radius edgeMode=duplicate` |
| `lens(refractionHeight, refractionAmount, depthEffect)` (`Lens.kt`, `Shaders.kt`) | `refract()` bakes `-circleMap(1 - inside/height) * normalize(grad + depth * normalize(centred)) * amount` into an RGBA map, `feImage` + `feDisplacementMap` samples it |
| `chromaticAberration = true` (7 `content.eval` taps, R/O/Y/G/C/B/P weights) | one `feImage` + `feDisplacementMap` + weighting `feColorMatrix` per tap, summed with `feComposite arithmetic` (`DISPERSION_TAPS`) |
| `onDrawSurface { drawRect(color) }` | the surface's own `background` (`--glass-lens-fill`) |
| `Highlight(width, blurRadius, style)` (`HighlightModifier.kt`, `HighlightStyle.kt`) | `.glass-rim` canvas: a stroke of `ceil(width) * 2` centred on the outline, blurred by `radius / 2`, clipped to the outline, shaded by `pow(abs(dot(grad, light)), falloff)` (Default), one-sided (Ambient) or flat (Plain), composited with `plus-lighter` (BlendMode.Plus) |
| `Shadow` | CSS `box-shadow` (`--glass-shadow`) |
| `cornerRadii` (each coerced to `minDimension / 2`) | `normalizeRadii`, four radii from `border-radius` |

Presets (`presets` in `GlassMaterial.tsx`) are catalog components verbatim, dp = CSS px:

| Preset | Kotlin source | Effects |
| --- | --- | --- |
| `clear` (toolbar pills) | `LiquidBottomTabs` thumb | `lens(10, 14, chromaticAberration)`, `Highlight.Default` |
| `menu` | `LiquidButton` | `vibrancy()`, `blur(2)`, `lens(12, 24)` |
| `surface` (toast, search, volume) | `LiquidBottomTabs` panel | `vibrancy()`, `blur(8)`, `lens(24, 24)`, `Highlight.Default` |
| `dialog` | `DialogContent` (dark) | `colorControls(saturation 1.5)`, `blur(8)`, `lens(24, 48, depthEffect)`, `Highlight.Plain`, surface `0x121212 @ .4` |

## Corners

The SDF follows the element: `shape="pill"` / `"circle"` is always circular (radius = half the
short side); otherwise the radii come from `border-radius` and the curve from the computed
`corner-shape` (`cornerExponent`: `round` → 2, `squircle` / `superellipse(2)` → 4). Refraction
band, rim and the CSS outline therefore share one shape. `style.css` gives every glass surface
`superellipse(2)` except pills (`.glass-toolbar-actions`, `rounded-full`), which stay `round`.

## Baking and flashes

- A bake is CPU work (`buildLensMaps` + `encodePng`), a few ms for a dialog. Maps are capped at
  512 px on the long side and stretched by `feImage`.
- A moving surface (the menu morph reports its shape through the `lens` ref every frame) bakes
  a 96 px map per change; 90 ms after it holds still the full-resolution bake and the rim land.
- **An `feImage` whose image has not loaded reads as transparent black, which displaces every
  pixel by `-scale / 2` for a frame (the whole backdrop jumps).** `LensFilter.update` therefore
  decodes the maps (`Image.decode()`) before installing a graph, keeps the previous graph
  rendering meanwhile, and starts from a colour + blur graph, never an empty one. Canvas
  `toDataURL` was replaced by `encodePng` (stored deflate) because it cost hundreds of ms in
  software rendering.

## Support

`glassSupported()`: Chromium and Gecko run SVG graphs in `backdrop-filter`. WebKit accepts the
syntax but only applies shorthand functions, so Safari, `prefers-contrast: more` and
`prefers-reduced-transparency` keep the CSS material (`[data-glass="fallback"]`).

## Verification

- `bun run typecheck`, `bun run build`, `bun test tests`.
- `?lensdebug` writes `window.__lensFilters[id]` and `data-lens-debug` on each surface: map
  size, tap count, primitive count, bake ms (`split` = SDF / encode), `corner`, and the computed
  `backdrop-filter`.
- `?glassdebug` paints magenta any surface that fell back to the CSS material.
- Headless check used while porting: a striped `position: fixed` div injected above the
  background makes refraction and dispersion visible in a screenshot.
- The dev server has served stale modules repeatedly in this repo: when a change seems to have
  no effect, rebuild and check `bun run preview`.
