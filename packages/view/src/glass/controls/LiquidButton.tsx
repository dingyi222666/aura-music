// Port of Kashif-E/KMPLiquidGlass LiquidButton.kt (Apache-2.0): a press
// magnifies the glass and a drag pulls it along a rubber band (the "Q弹"
// feel), with a soft white highlight under the finger. The lens itself is
// constant (unlike the toggle/slider, whose lens rides pressProgress).
import React from "react";
import { animated } from "@react-spring/web";
import GlassMaterial from "../GlassMaterial";
import { useInteractiveHighlight } from "./useInteractiveHighlight";

export interface LiquidButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onDrag"> {
  /** Render an own glass surface (LiquidButton). Omit inside a LiquidButtonGroup,
   *  which supplies one shared surface for the whole row. */
  standalone?: boolean;
  /** Press magnification in px (LiquidButton's 4dp). */
  grow?: number;
  shape?: "auto" | "rect" | "pill" | "circle";
  children: React.ReactNode;
}

/** A single liquid-glass button. Its content and (optional) surface magnify and
 *  spring under a press; the whole thing rubber-bands toward a drag. */
export const LiquidButton: React.FC<LiquidButtonProps> = ({
  standalone = false, grow = 4, shape = "pill", className = "", style, children,
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...rest
}) => {
  const highlight = useInteractiveHighlight(grow);
  return (
    <animated.button
      {...rest}
      className={`glass-button-liquid ${standalone ? "glass-surface" : ""} ${className}`}
      style={{ position: "relative", transformOrigin: "center", transform: highlight.transform, ...style }}
      onPointerDown={event => { highlight.onPointerDown(event); onPointerDown?.(event); }}
      onPointerMove={event => { highlight.onPointerMove(event); onPointerMove?.(event); }}
      onPointerUp={event => { highlight.onPointerUp(); onPointerUp?.(event); }}
      onPointerCancel={event => { highlight.onPointerCancel(); onPointerCancel?.(event); }}
    >
      {standalone && <GlassMaterial preset="menu" shape={shape} active />}
      {children}
      {/* InteractiveHighlight's white bloom: 0.25 * pressProgress, plus-lighter. */}
      <animated.span aria-hidden="true" style={{
        position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
        background: "#fff", mixBlendMode: "plus-lighter", opacity: highlight.overlay,
      }} />
    </animated.button>
  );
};
