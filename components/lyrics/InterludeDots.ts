import { LyricLine as LyricLineType } from "../../types";
import { ILyricLine } from "./ILyricLine";
import { LyricReveal } from "./LyricReveal";

const DOT_SHIFT = 6;
export const dotWidthOf = (spacing: number, radius: number) => spacing * 2 + radius * 2;

export const startOf = (
  align: "left" | "right",
  width: number,
  paddingX: number,
  contentWidth: number,
) => {
  if (align === "right") {
    return width - paddingX - DOT_SHIFT - contentWidth;
  }
  return paddingX + DOT_SHIFT;
};

export class InterludeDots implements ILyricLine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lyricLine: LyricLineType;
  private isMobile: boolean;
  private pixelRatio: number;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;
  private _height: number = 0;
  private readonly reveal = new LyricReveal();
  private textWidth: number = 0;
  private duration: number = 0;
  private align: "left" | "right";

  constructor(
    line: LyricLineType,
    isMobile: boolean,
    duration: number = 0,
    align: "left" | "right" = "left",
  ) {
    this.lyricLine = line;
    this.isMobile = isMobile;
    this.duration = line.endTime && line.endTime > line.time
      ? line.endTime - line.time
      : duration;
    this.align = align;
    this.pixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

  }

  private getEndTime() {
    if (this.duration > 0) {
      return this.lyricLine.time + this.duration;
    }
    return this.lyricLine.time + 4;
  }

  private isActiveTime(currentTime?: number) {
    if (!Number.isFinite(currentTime)) return false;
    const t = currentTime as number;
    return t >= this.lyricLine.time && t < this.getEndTime();
  }

  public update(time: number, dt: number) {
    this.reveal.update(this.isActiveTime(time), dt);
  }

  public measure(containerWidth: number) {
    const baseSize = this.isMobile ? 32 : 40;
    const paddingY = 18;
    const baseRadius = this.isMobile ? 5 : 7;
    const dotSpacing = this.isMobile ? 16 : 24;

    // Fixed height for interlude dots
    this._height = baseSize + paddingY * 2;
    this.logicalWidth = containerWidth;
    this.logicalHeight = this._height;

    // Set canvas size
    this.canvas.width = containerWidth * this.pixelRatio;
    this.canvas.height = this._height * this.pixelRatio;

    // Reset transform
    this.ctx.resetTransform();
    if (this.pixelRatio !== 1) {
      this.ctx.scale(this.pixelRatio, this.pixelRatio);
    }


    // Calculate approximate width for hover background
    this.textWidth = dotWidthOf(dotSpacing, baseRadius);
  }

  public draw(currentTime: number, isActive: boolean, isHovered: boolean, hoverProgress: number = isHovered ? 1 : 0) {
    const active = isActive || this.isActiveTime(currentTime);
    const expansion = this.reveal.height;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

    // If completely collapsed and not active, don't draw anything
    // Increased threshold to ensure it disappears cleanly
    if (expansion < 0.01 && !active) {
      return;
    }

    const paddingX = this.isMobile ? 24 : 56;
    const baseRadius = this.isMobile ? 5 : 7;
    const dotSpacing = this.isMobile ? 16 : 24;
    const contentWidth = dotWidthOf(dotSpacing, baseRadius);
    const startX = startOf(
      this.align,
      this.logicalWidth,
      paddingX,
      contentWidth,
    );
    const totalDotsWidth = contentWidth;
    const originX = startX - 16;
    const groupCenterX = 16 + baseRadius + dotSpacing;
    const groupCenterY = this._height * 0.5;

    // Calculate Progress
    // If active, we calculate progress based on line time and duration.
    // If not active, we don't care about progress color as much, but let's keep it consistent or fade out.
    let progress = 0;
    if (this.duration > 0) {
      const elapsed = currentTime - this.lyricLine.time;
      progress = Math.max(0, Math.min(1, elapsed / this.duration));
    } else if (active) {
      // If no duration, maybe pulse active?
      progress = 0.5;
    } else {
      // If inactive, progress is 1 (finished) or 0?
      // Usually if we passed it, it's 1. But drawing loop handles isActive.
      progress = 1;
    }

    this.ctx.save();
    this.ctx.globalAlpha = this.reveal.opacity;
    this.ctx.beginPath();
    this.ctx.rect(0, 0, this.logicalWidth, this._height * expansion);
    this.ctx.clip();
    this.ctx.translate(originX, -this._height * (1 - expansion) * 0.5);

    // Draw hover background (round rect) — smooth fade using hoverProgress
    if (hoverProgress > 0.001) {
      this.ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * hoverProgress})`;
      const bgWidth = Math.max(totalDotsWidth + 80, 200);
      this.ctx.beginPath();
      this.ctx.roundRect(0, 0, bgWidth, this._height, 16);
      this.ctx.fill();
    }

    for (let i = 0; i < 3; i++) {
      // Calculate color based on progress
      const dotProgressStart = i / 3;
      const dotProgressEnd = (i + 1) / 3;

      const localProgress = (progress - dotProgressStart) / (dotProgressEnd - dotProgressStart);
      const clampedLocal = Math.max(0, Math.min(1, localProgress));

      // "Like lyrics... gradual change white... to gray"
      // Inactive lyrics are usually 0.5 or 0.6 opacity.
      // Base opacity 0.5 (Gray), Active 1.0 (White)
      const colorIntensity = 0.5 + 0.5 * clampedLocal;

      const opacity = colorIntensity;

      this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      this.ctx.beginPath();

      // Draw relative to center (Dot 1 is at 0)
      // Dot 0: -spacing
      // Dot 1: 0
      // Dot 2: +spacing
      const relativeX = groupCenterX + (i - 1) * dotSpacing;

      this.ctx.arc(relativeX, groupCenterY, baseRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  public getHeight() {
    return this._height;
  }

  public getCurrentHeight() { return this._height * this.reveal.height; }

  public getFocusOffset() {
    return this._height * 0.5;
  }

  public isInterlude() {
    return true;
  }

  public getCanvas() {
    return this.canvas;
  }

  public getLogicalWidth() {
    return this.logicalWidth;
  }

  public getLogicalHeight() {
    return this.logicalHeight;
  }

  public getTextWidth() {
    return this.textWidth;
  }

  public getScalePivot() {
    const paddingX = this.isMobile ? 24 : 56;
    const baseRadius = this.isMobile ? 5 : 7;
    const dotSpacing = this.isMobile ? 16 : 24;
    const width = dotWidthOf(dotSpacing, baseRadius);
    const startX = startOf(this.align, this.logicalWidth, paddingX, width);

    return this.align === "right"
      ? startX + width
      : startX;
  }

  public getPressPivot() {
    const paddingX = this.isMobile ? 24 : 56;
    const baseRadius = this.isMobile ? 5 : 7;
    const dotSpacing = this.isMobile ? 16 : 24;
    const width = dotWidthOf(dotSpacing, baseRadius);
    return startOf(this.align, this.logicalWidth, paddingX, width) + width * 0.5;
  }

  public isBackgroundLine() {
    return false;
  }

  public getEmphasisEnd() {
    return -Infinity;
  }
}
