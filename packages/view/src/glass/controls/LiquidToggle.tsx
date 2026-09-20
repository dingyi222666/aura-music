// Port of Kashif-E/KMPLiquidGlass LiquidToggle.kt (Apache-2.0).
import React from "react";
import { Backdrop } from "./Backdrop";
import { toggle, toggleTravel } from "./geometry";
import { useDampedDrag } from "./useDampedDrag";

interface Props {
  checked: boolean;
  label?: string;
  onChange: () => void;
  material?: React.ReactNode;
  accent?: string;
}

export const LiquidToggle: React.FC<Props> = ({ checked, label, onChange, material, accent = "var(--glass-accent)" }) => {
  const drag = useDampedDrag({
    value: checked ? 1 : 0, min: 0, max: 1, dragSpan: toggle.drag,
    delta: (dx, span) => dx / span,
    onCommit: () => {},
    onRelease: (value, moved, animate) => {
      // didDrag decides tap-flip vs nearest-end snap (LiquidToggle.onDragStopped).
      const next = (moved ? value >= .5 : !checked) ? 1 : 0;
      animate(next);
      if (next !== (checked ? 1 : 0)) onChange();
    },
  });
  // Both the fill and the travel read the value spring, so the track can never
  // lag the thumb by a frame (Kotlin: one `dampedDragAnimation.value`).
  const progress = drag.valueSpring.to(v => v);
  return <span
    role="switch"
    tabIndex={0}
    aria-checked={checked}
    aria-label={label}
    style={{ position: "relative", display: "inline-block", flexShrink: 0,
      width: toggle.track.w, height: toggle.track.h, touchAction: "none" }}
    onPointerDown={event => { event.stopPropagation(); drag.onDown(event); }}
    onPointerMove={drag.onMove}
    onPointerUp={event => { event.stopPropagation(); drag.onUp(event); }}
    onPointerCancel={drag.onCancel}
    onLostPointerCapture={drag.onCancel}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) drag.animateTo(checked ? 0 : 1), onChange();
    }}
  >
    <span style={{ position: "absolute", left: toggle.pad, right: toggle.pad, top: toggle.pad, height: 24 }}>
      <Backdrop drag={drag} width={toggle.track.w} height={toggle.track.h}
        offset={drag.valueSpring.to(toggleTravel)} progress={progress} accent={accent} material={material} />
    </span>
  </span>;
};
