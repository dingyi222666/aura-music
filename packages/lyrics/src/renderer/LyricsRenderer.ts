import { LineAnimation } from "./LineAnimation";
import { ILyricLine } from "./ILyricLine";
import { LyricsEngine, Layout } from "./LyricsEngine";
import { LyricTransition } from "./LyricTransition";

interface Frame {
  layout: Layout;
  audio: HTMLAudioElement | null;
  time: number;
  mobile: boolean;
  hovered: boolean;
  mouse: { x: number; y: number };
  pressed: number | null;
  hover: number | null;
  down: boolean;
}

// Owns canvas composition and visual state; React owns only input and lifecycle.
export class LyricsRenderer {
  time = 0;
  readonly transition = new LyricTransition();
  private fresh = true;
  private readonly animations = new Map<number, LineAnimation>();
  private readonly buffer = document.createElement("canvas");
  private readonly blend = this.buffer.getContext("2d")!;
  private mask?: CanvasGradient;
  private height = 0;
  private width = 0;

  constructor(private readonly engine: LyricsEngine) {}

  resume() {
    this.fresh = true;
    this.engine.motion.resume();
  }
  press(index: number) { this.animations.get(index)?.press(); }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, deltaTime: number, frame: Frame) {
    const currentTime = frame.time;
    const isMobile = frame.mobile;
    const lyrics = this.engine.timeline.lyrics;
    const lyricLines = frame.layout.lines;
    this.transition.select(frame.layout, !this.fresh);
    const dt = Math.max(0, Math.min(deltaTime, 64)) / 1000;
    // The media clock is already continuous. Predicting it again adds drift
    // and delays pause/seek feedback; React time is only the unloaded fallback.
    const visualTime = frame.audio?.readyState ? frame.audio.currentTime : currentTime;
    this.time = Number.isFinite(visualTime) ? visualTime : 0;
    this.fresh = false;
    const motion = this.engine.motion;
    if (this.width !== width) {
      this.width = width;
      motion.resume();
    }

    if (!lyricLines.length) return;

    const active = this.engine.timeline.active(this.time);

    this.transition.update(dt, this.time);
    const currentLineHeights = this.transition.heights;

    motion.update(dt, this.time, this.transition.heights, this.transition.focuses, height);

    const anchor = motion.anchor >= 0 ? motion.anchor : active.anchorIndex;
    const clear = motion.mode !== "auto" || frame.hovered;

    const paddingX = isMobile ? 24 : 32;
    const focalPointOffset = height * 0.25;

    const queue: Array<{
      index: number;
      line: ILyricLine;
      visualY: number;
      lineHeight: number;
      opacity: number;
      blur: number;
      scale: number;
      pressScale: number;
      drawActive: boolean;
      isHovering: boolean;
      hoverProgress: number;
    }> = [];

    lyricLines.forEach((line, index) => {
      const physics = motion.rows[index];
      if (!physics) return;

      const visualY = physics.posY.current + focalPointOffset;
      const lineHeight = currentLineHeights[index];

      // Lines with zero current height are considered non-visible (e.g. background vocals far from playhead)
      if (lineHeight <= 0.001) {
        return;
      }

      // Culling
      if (visualY + lineHeight < -100 || visualY > height + 100) {
        return;
      }

      // Hit Test for Hover (pointer devices)
      const pointerHover =
        frame.mouse.x >= paddingX - 20 &&
        frame.mouse.x <= width - paddingX + 20 &&
        frame.mouse.y >= visualY &&
        frame.mouse.y <= visualY + lineHeight;
      const hover = frame.pressed ?? frame.hover;

      const isActive = active.activeIndexes.includes(index);
      // Keep the line on its glow path until the emphasis has fully settled,
      // even after the next line takes over — otherwise the glow pops off
      // instead of easing back when lines land close together.
      const drawActive =
        isActive ||
        (visualTime >= lyrics[index].time &&
          visualTime < line.getEmphasisEnd());
      const scale = physics.scale.current;
      const isHovering = isMobile
        ? hover === index
        : pointerHover;

      // Is this line currently being pressed?
      const isPressed = frame.down && frame.pressed === index;

      // --- Per-line animation state (smooth hover / press / blur) ---
      let animState = this.animations.get(index);
      if (!animState) {
        animState = new LineAnimation();
        this.animations.set(index, animState);
      }

      // Opacity & Blur — compute raw target values
      const gap = anchor >= 0 ? Math.abs(index - anchor) : 0;

      let targetOpacity = 1;
      let targetBlur = 0;
      const isBg = line.isBackgroundLine();

      if (!isActive) {
        const floor = isMobile ? 0.4 : isBg ? 0.34 : 0.18;
        const fade = isMobile ? 0.18 : isBg ? 0.18 : 0.22;
        targetOpacity = Math.max(floor, 1 - gap * fade);

        if (!clear && !isMobile && !isBg && gap > 0) {
          targetBlur = Math.min(5, 1 + gap);
        }
      }

      const animation = animState.update(dt, isHovering, isPressed, targetBlur, targetOpacity);

      queue.push({
        index,
        line,
        visualY,
        lineHeight,
        opacity: animation.opacity,
        blur: isBg ? 0 : animation.blur,
        scale,
        pressScale: animation.press,
        drawActive,
        isHovering,
        hoverProgress: animation.hover,
      });
    });

    queue
      .sort((a, b) => {
        if (Math.abs(a.visualY - b.visualY) > 0.5) {
          return a.visualY - b.visualY;
        }
        if (a.line.isBackgroundLine() !== b.line.isBackgroundLine()) {
          return a.line.isBackgroundLine() ? 1 : -1;
        }
        return a.index - b.index;
      })
      .forEach((item) => {
        for (const layer of this.transition.layers) {
          layer.layout.lines[item.index].draw(
            this.time,
            item.drawActive,
            item.isHovering,
            item.hoverProgress,
          );
        }

        ctx.save();

        const cy = item.visualY + item.lineHeight / 2;
        const pivotX = item.line.getScalePivot();
        const effectiveScale = item.line.isInterlude() || item.line.isBackgroundLine() ? 1 : item.scale;
        ctx.translate(pivotX, cy);
        ctx.scale(effectiveScale, effectiveScale);
        ctx.translate(-pivotX, -item.lineHeight / 2);

        if (Math.abs(item.pressScale - 1) > 0.001) {
          const pressX = item.line.getPressPivot();
          ctx.translate(pressX, item.lineHeight / 2);
          ctx.scale(item.pressScale, item.pressScale);
          ctx.translate(-pressX, -item.lineHeight / 2);
        }

        ctx.globalAlpha = item.opacity;
        ctx.filter = item.blur > 0.5 ? `blur(${item.blur}px)` : "none";
        if (this.transition.layers.length === 1) {
          ctx.drawImage(item.line.getCanvas(), 0, 0, item.line.getLogicalWidth(), item.line.getLogicalHeight());
        } else {
          const dpr = window.devicePixelRatio || 1;
          const w = Math.ceil(item.line.getLogicalWidth() * dpr);
          const h = Math.ceil(Math.max(...this.transition.layers.map(({ layout }) => layout.lines[item.index].getLogicalHeight())) * dpr);
          if (this.buffer.width !== w) this.buffer.width = w;
          if (this.buffer.height < h) this.buffer.height = h;
          this.blend.clearRect(0, 0, this.buffer.width, this.buffer.height);
          this.blend.globalCompositeOperation = "lighter";
          for (const layer of this.transition.layers) {
            const line = layer.layout.lines[item.index];
            this.blend.globalAlpha = layer.weight;
            // Align the original text in both cached layouts. Only secondary
            // text fades, while the first line moves along one shared baseline.
            const offset = this.transition.focuses[item.index] - layer.layout.focuses[item.index];
            this.blend.drawImage(line.getCanvas(), 0, offset * dpr);
          }
          ctx.drawImage(this.buffer, 0, 0, w, h, 0, 0, w / dpr, h / dpr);
        }

        ctx.restore();
      });

    // Draw Mask
    ctx.globalCompositeOperation = "destination-in";
    if (!this.mask || this.height !== height) {
      this.height = height;
      this.mask = ctx.createLinearGradient(0, 0, 0, height);
      this.mask.addColorStop(0, "rgba(0,0,0,0)");
      this.mask.addColorStop(0.15, "rgba(0,0,0,1)");
      this.mask.addColorStop(0.85, "rgba(0,0,0,1)");
      this.mask.addColorStop(1, "rgba(0,0,0,0)");
    }
    ctx.fillStyle = this.mask;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "source-over";
  }
}
