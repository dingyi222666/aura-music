// Port of Kashif-E/KMPLiquidGlass LiquidSlider.kt (Apache-2.0).
import React, { useLayoutEffect, useRef, useState } from "react";
import { Backdrop } from "./Backdrop";
import { clamp, sliderTravel } from "./geometry";
import { useDampedDrag } from "./useDampedDrag";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  onChange: (value: number) => void;
  material?: React.ReactNode;
  accent?: string;
}

export const LiquidSlider: React.FC<Props> = ({ value, min, max, step = .05, label, onChange, material, accent = "var(--glass-accent)" }) => {
  const track = useRef<HTMLDivElement>(null);
  const down = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setWidth(track.current?.clientWidth ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  const range = max - min;
  const fraction = (v: number) => range > 0 ? clamp((v - min) / range, 0, 1) : 0;
  const quantize = (v: number) => clamp(min + Math.round((v - min) / step) * step, min, max);
  const drag = useDampedDrag({
    value, min, max, dragSpan: width,
    // LiquidSlider.onDrag: delta = range * (dragAmount.x / trackWidth), applied
    // to the *target*, so a pointer move tracks the thumb 1:1.
    delta: (dx, span) => range * dx / Math.max(span, 1),
    onCommit: onChange,
    // A press that did not move is the track's detectTapGestures: jump-and-
    // animate to the tapped position. A real drag keeps its released value.
    onRelease: (at, moved, animate) => {
      const x = down.current;
      down.current = null;
      if (moved) { onChange(at); return; }
      if (x === null || !track.current) return;
      const box = track.current.getBoundingClientRect();
      if (!box.width) return;
      const progress = clamp((x - box.left) / box.width, 0, 1);
      const rtl = getComputedStyle(track.current).direction === "rtl";
      animate(quantize(min + (rtl ? 1 - progress : progress) * range));
    },
  });
  return <div
    ref={track}
    role="slider"
    tabIndex={0}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    style={{ position: "relative", height: 24, margin: "12px", touchAction: "none" }}
    onPointerDown={event => {
      // A press on the thumb must not become a track seek on release.
      const box = track.current?.querySelector("[data-control-thumb]")?.getBoundingClientRect();
      down.current = box && event.clientX >= box.left && event.clientX <= box.right ? null : event.clientX;
      drag.onDown(event);
    }}
    onPointerMove={drag.onMove}
    onPointerUp={drag.onUp}
    onPointerCancel={() => { down.current = null; drag.onCancel(); }}
    onLostPointerCapture={() => { down.current = null; drag.onCancel(); }}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
      onChange(event.key === "Home" ? min : event.key === "End" ? max :
        quantize(value + (event.key === "ArrowLeft" ? -step : step) * direction));
    }}
  >
    <Backdrop drag={drag} width={width} height={6} slider
      offset={drag.valueSpring.to(v => sliderTravel(fraction(v), width))}
      progress={drag.valueSpring.to(fraction)} accent={accent} material={material} />
  </div>;
};
