import { Layout } from "./LyricsEngine";

interface Layer {
  layout: Layout;
  weight: number;
  start: number;
  end: number;
}

// Presentation-only transition: timing and cached line objects remain intact.
export class LyricTransition {
  layers: Layer[] = [];
  readonly heights: number[] = [];
  readonly focuses: number[] = [];
  private selected?: Layout;
  private elapsed = 0;

  select(layout: Layout, animate = true) {
    if (layout === this.selected) return;
    const previous = this.selected;
    this.selected = layout;
    this.elapsed = 0;
    if (!animate || !previous || previous.width !== layout.width || previous.mobile !== layout.mobile) {
      this.layers = [{ layout, weight: 1, start: 1, end: 1 }];
      return;
    }
    // Retarget from the weights currently on screen, including rapid toggles.
    this.layers = this.layers.filter((layer) => layer.weight > 0);
    for (const layer of this.layers) {
      layer.start = layer.weight;
      layer.end = layer.layout === layout ? 1 : 0;
    }
    if (!this.layers.some((layer) => layer.layout === layout)) {
      this.layers.push({ layout, weight: 0, start: 0, end: 1 });
    }
  }

  update(dt: number, time: number) {
    this.elapsed = Math.min(0.32, this.elapsed + dt);
    const t = this.elapsed / 0.32;
    const eased = t * t * (3 - 2 * t);
    for (const layer of this.layers) {
      layer.weight = layer.start + (layer.end - layer.start) * eased;
    }
    if (t === 1 && this.layers.length > 1) this.layers = this.layers.filter((layer) => layer.end === 1);
    const length = this.selected?.lines.length ?? 0;
    this.heights.length = this.focuses.length = length;
    this.heights.fill(0);
    this.focuses.fill(0);
    for (const { layout, weight } of this.layers) {
      for (let i = 0; i < length; i++) {
        layout.lines[i].update(time, dt);
        this.heights[i] += layout.lines[i].getCurrentHeight(time) * weight;
        this.focuses[i] += layout.focuses[i] * weight;
      }
    }
  }
}
