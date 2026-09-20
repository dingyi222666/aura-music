import { useLayoutEffect, useRef, useState } from "react";

const SHORT_HEIGHT = 880;
const FIT_PADDING = 16;

export function useFitScale<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ height: 0, scale: 1 });
  const stateRef = useRef(state);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = el.closest(".h-full") as HTMLElement | null;

    const measure = () => {
      const view = window.visualViewport?.height ?? window.innerHeight;
      let avail = view;
      if (host) {
        const cs = getComputedStyle(host);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        avail = Math.min(view, Math.max(0, host.clientHeight - pad));
      }

      const natural = el.scrollHeight || el.getBoundingClientRect().height;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const base = coarse ? 760 : SHORT_HEIGHT;
      const min = coarse ? 0.86 : 0.78;
      const max = coarse ? 0.98 : 0.94;
      const fit = natural > 0 && avail > 0
        ? Math.min(1, Math.max(0, (avail - FIT_PADDING) / natural))
        : 1;
      const cap = avail < base
        ? Math.min(max, Math.max(min, avail / base))
        : 1;
      const scale = Math.min(1, fit, cap);
      const height = Math.ceil(natural * scale);
      const next = { height, scale };

      if (
        Math.abs(stateRef.current.scale - scale) > 0.001 ||
        Math.abs(stateRef.current.height - height) > 1
      ) {
        stateRef.current = next;
        setState(next);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    const viewport = window.visualViewport;
    ro.observe(el);
    if (host) ro.observe(host);
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, ...state };
}
