import { Morph, isStepping } from "./motion";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useKeyboardScope } from "@aura-music/core/react/useKeyboardScope";
import GlassMaterial, { useGlass } from "./GlassMaterial";
import { contour, fusion } from "./fusion";

export const usePresence = (open: boolean, duration = 350) => {
  const [present, show] = useState(open);
  useEffect(() => {
    if (open) { show(true); return; }
    const timer = window.setTimeout(() => show(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return open || present;
};

export const useDialog = (open: boolean, root: React.RefObject<HTMLElement>, close: () => void) => {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      (root.current?.querySelector<HTMLElement>("[autofocus], input, button, a[href], [tabindex='0']") ?? root.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, root]);
  useKeyboardScope((event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return true; }
    if (event.key === "Tab") {
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length);
      const first = nodes[0];
      const last = nodes.at(-1);
      if (!first) { event.preventDefault(); root.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    return true;
  }, 200, open);
};

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}

const GlassDialog: React.FC<Props> = ({ open, onClose, title, children, wide }) => {
  const present = usePresence(open, 220);
  const root = useRef<HTMLDivElement>(null);
  useDialog(open, root, onClose);
  if (!present) return null;
  return createPortal(<div className="glass-overlay" data-open={open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} inert={!open}
      className={`glass-surface glass-dialog ${wide ? "glass-dialog-wide" : ""}`}>
      <GlassMaterial preset="dialog" />
      {children}
    </div>
  </div>, document.body);
};

interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  ref?: React.Ref<HTMLDivElement>;
  trigger?: string;
}

/** The panel expands from a stable trigger; the trigger itself never morphs. */
export const GlassMenu: React.FC<MenuProps> = ({ open, children, className = "", ref, trigger, ...props }) => {
  const [held, hold] = useState(open);
  const present = open || held;
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const mask = useRef<SVGMaskElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const anchor = useRef<SVGCircleElement>(null);
  const id = useId().replace(/:/g, "");
  const lens = useRef<{ width: number; height: number; radius: number; fused?: boolean } | null>(null);
  const motion = useRef<Morph | null>(null);
  const { reduced } = useGlass();
  const [size, resize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !present) return;
    const measure = () => resize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [present]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !present || !size.width) return;
    const button = trigger ? element.parentElement?.querySelector<HTMLElement>(trigger) : null;
    const rect = element.getBoundingClientRect();
    const bounds = button?.getBoundingClientRect();
    const scale = rect.width / size.width || 1;
    const geometry = {
      width: size.width, height: size.height,
      x: bounds ? (bounds.x + bounds.width / 2 - rect.x) / scale : size.width - 22,
      y: bounds ? (bounds.y + bounds.height / 2 - rect.y) / scale : size.height - 22,
      button: bounds ? bounds.width / scale : 40,
    };
    if (!(motion.current instanceof Morph)) motion.current = new Morph(geometry);
    else motion.current.resize(geometry);
    if (open) hold(true);
    motion.current.set(open, reduced);
    let frame = 0;
    let previous = performance.now();
    const draw = (now: number) => {
      const state = motion.current!.step((now - previous) / 1000);
      previous = now;
      const shape = state.shapes[0];
      const blend = !reduced && button && state.active ? fusion(shape, geometry) : null;
      const surface = blend ?? shape;
      lens.current = { ...surface, fused: !!blend };
      if (blend && outline.current && anchor.current && mask.current) {
        mask.current.setAttribute("width", String(blend.width));
        mask.current.setAttribute("height", String(blend.height));
        outline.current.setAttribute("d", contour(shape.width, shape.height, shape.radius));
        outline.current.setAttribute("transform", `translate(${shape.x - blend.x} ${shape.y - blend.y})`);
        anchor.current.setAttribute("cx", String(geometry.x - blend.x));
        anchor.current.setAttribute("cy", String(geometry.y - blend.y));
        anchor.current.setAttribute("r", String(blend.button));
        anchor.current.setAttribute("opacity", String(blend.opacity));
      }
      if (shell.current) Object.assign(shell.current.style, {
        left: `${surface.x}px`, top: `${surface.y}px`, width: `${surface.width}px`,
        height: `${surface.height}px`, borderRadius: blend ? "0" : `${Math.min(shape.radius, shape.width / 2, shape.height / 2)}px`,
        maskImage: blend ? `url(#${id}-mask)` : "none",
        opacity: String(state.materialOpacity),
        visibility: state.materialOpacity > .001 ? "visible" : "hidden",
      });
      if (content.current) {
        content.current.style.opacity = String(state.opacity);
        content.current.style.filter = state.blur > 0.01 ? `blur(${state.blur}px)` : "none";
        content.current.style.transform = `translate(${state.x - size.width / 2}px, ${state.y - size.height / 2}px) scale(${state.contentScale})`;
        content.current.style.visibility = state.opacity > 0.01 ? "visible" : "hidden";
        const shape = state.shapes[0];
        // Clip the content to the panel while it morphs, corners included: a
        // square inset let text spill past the rounded silhouette on open.
        content.current.style.clipPath = state.active
          ? `inset(${Math.max(0, (size.height - shape.height / state.contentScale) / 2)}px ${Math.max(0, (size.width - shape.width / state.contentScale) / 2)}px round ${Math.max(0, shape.radius)}px)`
          : "none";
      }
      // Only the panel moves. The real trigger stays visible and clickable.
      // While the debug stepper holds the clock still the morph reads as
      // settled; keep the panel mounted so the frame can be inspected.
      if (isStepping()) {
        frame = requestAnimationFrame(draw);
      } else if (!open && (state.materialOpacity <= .08 || !state.active)) {
        // Blank the content before the panel unmounts: the resting state could
        // report full content opacity for one frame, which showed as a bare
        // grey block next to the trigger.
        if (content.current) {
          content.current.style.opacity = "0";
          content.current.style.visibility = "hidden";
        }
        hold(false);
        motion.current = null;
      } else if (state.active) frame = requestAnimationFrame(draw);
    };
    draw(previous);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, present, reduced, size.width, size.height, trigger, id]);

  if (!present) return null;
  return <div {...props} ref={(node) => {
    root.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }} inert={!open} className={`glass-menu ${className}`} data-open={open}>
    <svg width="0" height="0" aria-hidden="true" className="absolute pointer-events-none">
      <defs>
        <filter id={`${id}-join`} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="9" />
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9.5" />
        </filter>
        <mask ref={mask} id={`${id}-mask`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" style={{ maskType: "alpha" }}>
          <g filter={`url(#${id}-join)`} fill="white">
            <path ref={outline} />
            <circle ref={anchor} />
          </g>
        </mask>
      </defs>
    </svg>
    <div ref={shell} className="glass-menu-shell">
      <GlassMaterial preset="menu" radius={0} lens={lens} />
    </div>
    <div ref={content} className="glass-menu-content">{children}</div>
  </div>;
};

export default GlassDialog;
