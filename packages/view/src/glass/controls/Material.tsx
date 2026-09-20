// KMPLiquidGlass Lens.kt / Highlight.kt, Apache-2.0; control-local adapter.
import React, { useId, useLayoutEffect, useRef } from "react";
import { glassSupported } from "../GlassMaterial";
import { LensFilter, normalizeRadii, paintRim, type LensDebug, type LensParams } from "../lens";
import { clamp } from "./geometry";

interface Props { slider?: boolean }

/** Controls vary both lens height and amount with pressProgress. Reuse the
 * shared math, but keep their live optics and lifetime out of panel materials.
 *
 * This only refracts the page backdrop (`backdrop-filter`). The scaled track
 * (KMP's `rememberCombinedBackdrop(page, trackLayer)`) is painted as real DOM
 * behind the knob's content by `Backdrop`, because `feImage` referencing a
 * local element renders nothing inside a `backdrop-filter` graph in Chrome.
 */
export const Material: React.FC<Props> = ({ slider = false }) => {
  const id = `knob-${useId().replace(/:/g, "")}`;
  const node = useRef<SVGFilterElement>(null);
  const rim = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = rim.current;
    const element = node.current;
    const surface = canvas?.parentElement;
    if (!canvas || !element || !surface) return;
    const supported = glassSupported();
    const filter = supported ? new LensFilter(element, id) : null;
    // LiquidToggle.kt: lens(5dp * p, 10dp * p); LiquidSlider.kt: lens(10dp * p, 14dp * p).
    const params: LensParams = {
      radius: 12, height: slider ? 10 : 5, amount: slider ? 14 : 10,
      blur: 8, depth: 0, dispersion: 1, saturation: 1,
      highlight: .38, angle: Math.PI / 4, falloff: 1,
      rimStyle: "ambient", rimWidth: .5 / 1.5, rimBlur: .25 / 1.5,
    };
    let press = -1;
    let key = "";
    let frame = 0;
    let busy = false;
    let disposed = false;
    let size = "";
    let info: LensDebug | undefined;
    let band = 0;
    const debug = new URLSearchParams(location.search).has("lensdebug");
    surface.dataset.glass = supported ? "lens" : "fallback";
    surface.style.backdropFilter = supported ? `url(#${id})` : "blur(8px)";

    const tune = () => {
      // refract() already multiplies by -amount, matching the Android shader's
      // negative uniform. Passing a negative magnitude would disable LensFilter.
      filter?.tune(params.amount * press, 8 * (1 - press));
      canvas.style.opacity = String(press);
      surface.dataset.glassPress = press.toFixed(3);
      if (debug && info) {
        surface.dataset.lensDebug = JSON.stringify({ ...info, height: params.height * band,
          amount: -params.amount * press, blur: 8 * (1 - press) });
      }
      if (!supported) surface.style.backdropFilter = `blur(${8 * (1 - press)}px)`;
    };
    const draw = async () => {
      frame = 0;
      if (disposed) return;
      press = clamp(Number(surface.style.getPropertyValue("--glass-press")) || 0, 0, 1);
      tune();
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      if (!width || !height) return;
      const radii = normalizeRadii(Math.min(width, height) / 2, width, height);
      const geometry = `${width},${height}`;
      if (size !== geometry) {
        size = geometry;
        // Bake for the pressed 1.5x size so the ambient rim stays crisp.
        paintRim(canvas, width, height, radii, params, Math.min(devicePixelRatio, 3) * 1.5);
      }
      // The map is just 40x24. Quantise its band to 1/32 press steps while the
      // amount/blur remain continuous; no rebuilding when held or at rest.
      const step = Math.round(press * 32) / 32;
      const next = `${geometry},${step}`;
      if (!filter || busy || next === key) return;
      busy = true;
      key = next;
      try {
        info = await filter.update(width, height, radii, { ...params, height: params.height * step }, 64);
        if (disposed) return;
        band = step;
        // A newer press can arrive while images decode. Apply it immediately.
        press = clamp(Number(surface.style.getPropertyValue("--glass-press")) || 0, 0, 1);
        tune();
      } catch (err) {
        if (disposed) return;
        console.warn("Control lens could not be prepared", err);
        surface.dataset.glass = "fallback";
        surface.style.backdropFilter = `blur(${8 * (1 - press)}px)`;
      } finally {
        busy = false;
        if (!disposed) schedule();
      }
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(() => void draw());
    };
    const observer = new MutationObserver(() => {
      if (Number(surface.style.getPropertyValue("--glass-press")) !== press) schedule();
    });
    observer.observe(surface, { attributes: true, attributeFilter: ["style"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(surface);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      filter?.destroy();
      surface.style.removeProperty("backdrop-filter");
      delete surface.dataset.glass;
      delete surface.dataset.glassPress;
      delete surface.dataset.lensDebug;
    };
  }, [id, slider]);
  return <>
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}>
      <defs><filter ref={node} /></defs>
    </svg>
    <canvas ref={rim} aria-hidden="true" style={{
      position: "absolute", inset: 0, width: "100%", height: "100%",
      borderRadius: "inherit", pointerEvents: "none", opacity: 0,
    }} />
  </>;
};
