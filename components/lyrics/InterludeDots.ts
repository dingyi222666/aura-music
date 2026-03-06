import { LyricLine as LyricLineType } from "../../types";
import { ILyricLine } from "./ILyricLine";
import { SpringSystem, INTERLUDE_SPRING } from "../../services/springSystem";

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
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    private lyricLine: LyricLineType;
    private index: number;
    private isMobile: boolean;
    private pixelRatio: number;
    private logicalWidth: number = 0;
    private logicalHeight: number = 0;
    private _height: number = 0;
    private springSystem: SpringSystem;
    private lastDrawTime: number = -1;
    private textWidth: number = 0;
    private duration: number = 0;
    private cacheTime = Number.NaN;
    private cacheExpansion = 0;
    private align: "left" | "right";

    constructor(
        line: LyricLineType,
        index: number,
        isMobile: boolean,
        duration: number = 0,
        align: "left" | "right" = "left",
    ) {
        this.lyricLine = line;
        this.index = index;
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
        this.ctx = ctx as
            | OffscreenCanvasRenderingContext2D
            | CanvasRenderingContext2D;

        // Initialize spring system for expansion animation
        this.springSystem = new SpringSystem({
            expansion: 0, // 0 = hidden/collapsed, 1 = fully visible
        });
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

    private getExpansion(currentTime?: number) {
        if (!Number.isFinite(currentTime)) {
            return Math.max(0, this.springSystem.getCurrent("expansion"));
        }

        if (this.cacheTime === currentTime) {
            return this.cacheExpansion;
        }

        const now = performance.now();
        let dt = this.lastDrawTime === -1 ? 0.016 : (now - this.lastDrawTime) / 1000;
        dt = Math.min(dt, 0.1);
        this.lastDrawTime = now;

        const currentTarget = this.springSystem.getTarget("expansion") || 0;
        const currentExpansion = this.springSystem.getCurrent("expansion");
        const targetExpansion = this.isActiveTime(currentTime) ? 1 : 0;

        if (currentTarget === 1 && targetExpansion === 0) {
            this.springSystem.setVelocity("expansion", 8);
        }

        if (currentTarget === 0 && targetExpansion === 1 && currentExpansion < 0.01) {
            this.springSystem.setValue("expansion", 0);
        }

        this.springSystem.setTarget("expansion", targetExpansion, INTERLUDE_SPRING);
        this.springSystem.update(dt);

        this.cacheTime = currentTime as number;
        this.cacheExpansion = Math.max(0, this.springSystem.getCurrent("expansion"));
        return this.cacheExpansion;
    }

    public measure(containerWidth: number, suggestedTranslationWidth?: number) {
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
        const now = performance.now();
        const active = isActive || this.isActiveTime(currentTime);
        const expansion = this.getExpansion(currentTime);

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

        // Draw hover background (round rect) — smooth fade using hoverProgress
        if (hoverProgress > 0.001) {
            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * hoverProgress * Math.min(1, expansion)})`;
            const bgWidth = Math.max(totalDotsWidth + 80, 200);
            const bgHeight = this._height * Math.min(1, expansion);
            const bgY = (this._height - bgHeight) / 2;
            const bgX = this.align === "right"
                ? startX + totalDotsWidth - bgWidth + 16
                : startX - 16;

            this.roundRect(bgX, bgY, bgWidth, bgHeight, 16 * Math.min(1, expansion));
            this.ctx.fill();
        }

        // Calculate center of the dot group for scaling pivot
        const groupCenterX = startX + baseRadius + dotSpacing;
        const groupCenterY = this._height / 2;

        // Center vertically and horizontally at group center
        this.ctx.translate(groupCenterX, groupCenterY);

        // Global Breathing Animation (only when active/visible)
        // "Effect is too big. Scale down!" -> Reduce amplitude
        const breatheSpeed = 3.0;
        const breatheAmt = 0.12; 
        const breatheScale = 1.0 + Math.sin(now / 1000 * breatheSpeed) * breatheAmt;
        
        // Combine physics expansion with breathing
        const finalGlobalScale = expansion * breatheScale;

        this.ctx.scale(finalGlobalScale, finalGlobalScale);

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
            
            const visibilityOpacity = Math.min(1, expansion); 
            
            const opacity = colorIntensity * visibilityOpacity;

            this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.beginPath();
            
            // Draw relative to center (Dot 1 is at 0)
            // Dot 0: -spacing
            // Dot 1: 0
            // Dot 2: +spacing
            const relativeX = (i - 1) * dotSpacing;
            
            this.ctx.arc(relativeX, 0, baseRadius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    private roundRect(x: number, y: number, w: number, h: number, r: number) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.arcTo(x + w, y, x + w, y + h, r);
        this.ctx.arcTo(x + w, y + h, x, y + h, r);
        this.ctx.arcTo(x, y + h, x, y, r);
        this.ctx.arcTo(x, y, x + w, y, r);
        this.ctx.closePath();
    }

    public getHeight() {
        return this._height;
    }

    public getCurrentHeight(_currentTime?: number) {
        const expansion = Math.max(0, Math.min(1, this.getExpansion(_currentTime)));
        return this._height * expansion;
    }

    public getTargetHeight(currentTime?: number) {
        return this.isActiveTime(currentTime) ? this._height : 0;
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

    public getAlignment(): "left" | "right" | undefined {
        return this.align;
    }

    public isBackgroundLine() {
        return false;
    }
}
