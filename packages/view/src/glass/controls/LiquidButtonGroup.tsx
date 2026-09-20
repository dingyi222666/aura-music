// A joined liquid-glass button group (the top bar's action cluster). One glass
// surface backs the whole row; each LiquidButton inside supplies its own press
// magnify + drag rubber band (KMPLiquidGlass LiquidButton, Apache-2.0).
import React from "react";
import GlassMaterial from "../GlassMaterial";

export interface LiquidButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Glass optics preset for the shared surface. */
  preset?: "menu" | "clear" | "surface";
  active?: boolean;
  children: React.ReactNode;
}

/** Wraps a row of `LiquidButton`s (rendered non-standalone) in a single pill of
 *  liquid glass, matching the toolbar capsule the app already uses. */
export const LiquidButtonGroup: React.FC<LiquidButtonGroupProps> = ({
  preset = "menu", active = true, className = "", children, ...rest
}) => (
  <div {...rest} className={`glass-surface glass-toolbar-actions ${className}`}>
    <GlassMaterial preset={preset} active={active} shape="pill" />
    {children}
  </div>
);
