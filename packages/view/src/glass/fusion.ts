import type { Geometry, Shape } from "./motion";

/** G3 outline used only by the transient liquid mask; settled glass uses CSS. */
export function contour(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  const corners = [[width - r, r], [width - r, height - r], [r, height - r], [r, r]];
  return corners.flatMap(([x, y], corner) => Array.from({ length: 17 }, (_, i) => {
    const angle = (corner - 1) * Math.PI / 2 + i * Math.PI / 32;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return `${corner === 0 && i === 0 ? "M" : "L"}${(x + r * Math.sign(cos) * Math.sqrt(Math.abs(cos))).toFixed(2)},${(y + r * Math.sign(sin) * Math.sqrt(Math.abs(sin))).toFixed(2)}`;
  })).join(" ") + " Z";
}

/** Blend only while the panel touches the existing trigger. No free bubble. */
export function fusion(shape: Shape, anchor: Geometry) {
  const radius = Math.min(shape.radius, shape.width / 2, shape.height / 2);
  const x = Math.abs(anchor.x - shape.x - shape.width / 2) - shape.width / 2 + radius;
  const y = Math.abs(anchor.y - shape.y - shape.height / 2) - shape.height / 2 + radius;
  const distance = Math.sqrt(Math.sqrt(Math.max(0, x) ** 4 + Math.max(0, y) ** 4))
    + Math.min(Math.max(x, y), 0) - radius;
  const button = anchor.button * .5;
  const gap = distance - button;
  // A wider, slower-fading bridge so the panel visibly melts out of the trigger
  // (liquid-dom's goo) instead of snapping free almost immediately.
  if (gap >= 44 || shape.width >= anchor.width - .5) return null;
  const t = Math.max(0, Math.min(1, (gap - 8) / 36));
  const left = Math.min(shape.x, anchor.x - button) - 8;
  const top = Math.min(shape.y, anchor.y - button) - 8;
  return {
    x: left, y: top,
    width: Math.max(shape.x + shape.width, anchor.x + button) + 8 - left,
    height: Math.max(shape.y + shape.height, anchor.y + button) + 8 - top,
    radius, button, opacity: 1 - t * t * (3 - 2 * t),
  };
}
