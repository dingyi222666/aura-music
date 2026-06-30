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
      let avail = window.innerHeight;
      if (host) {
        const cs = getComputedStyle(host);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        avail = host.clientHeight - pad;
      }

      const natural = el.scrollHeight || el.getBoundingClientRect().height;
      const fit = natural > 0 && avail > 0
        ? Math.min(1, (avail - FIT_PADDING) / natural)
        : 1;
      const cap = avail < SHORT_HEIGHT
        ? Math.min(0.94, Math.max(0.78, avail / SHORT_HEIGHT))
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
    ro.observe(el);
    if (host) ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, ...state };
}
