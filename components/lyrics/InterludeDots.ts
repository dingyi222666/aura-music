import { LyricLine as LyricLineType } from "../../types";
import { ILyricLine } from "./ILyricLine";
import { SpringSystem, INTERLUDE_SPRING } from "../../services/springSystem";

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

    constructor(line: LyricLineType, index: number, isMobile: boolean) {
        this.lyricLine = line;
        this.index = index;
        this.isMobile = isMobile;
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

    public measure(containerWidth: number, suggestedTranslationWidth?: number) {
        const baseSize = this.isMobile ? 32 : 40;
        const paddingY = 18;

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
        const dotSpacing = this.isMobile ? 16 : 24;
        this.textWidth = dotSpacing * 2 + 40; // Approximate width
    }

    public draw(currentTime: number, isActive: boolean, isHovered: boolean) {
        // Determine target expansion state
        // Show if active (in range) or if it's the specific "..." line type
        // The user requirement says: "isInterlude 只有在到范围的时候才显示"
        // So if isActive is true, we expand. If false, we collapse.
        const targetExpansion = isActive ? 1 : 0;

        // Update spring
        const now = performance.now();
        const dt = this.lastDrawTime === -1 ? 0.016 : (now - this.lastDrawTime) / 1000;
        this.lastDrawTime = now;

        this.springSystem.setTarget("expansion", targetExpansion, INTERLUDE_SPRING);
        this.springSystem.update(dt);

        // Clamp expansion to [0, 1] to prevent overshoot effects
        const expansion = Math.max(0, Math.min(1, this.springSystem.getCurrent("expansion")));

        // Clear canvas
        this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

        // If completely collapsed and not active, don't draw anything
        if (expansion < 0.01 && !isActive) {
            return;
        }

        const paddingX = this.isMobile ? 24 : 56;
        const dotRadius = (this.isMobile ? 5 : 7) * expansion; // Scale dots with expansion
        const dotSpacing = this.isMobile ? 16 : 24;
        const totalDotsWidth = dotSpacing * 2;

        // Base opacity fades in with expansion
        const baseOpacity = 0.3 * expansion;
        const activeOpacity = 0.9 * expansion;

        this.ctx.save();

        // Draw hover background (round rect)
        // Scale background width/height with expansion for "pop" effect
        if (isHovered && expansion > 0.5) {
            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * expansion})`;
            const bgWidth = Math.max(totalDotsWidth + 80, 200);
            const bgHeight = this._height * expansion;
            const bgY = (this._height - bgHeight) / 2;

            this.roundRect(paddingX - 16, bgY, bgWidth, bgHeight, 16 * expansion);
            this.ctx.fill();
        }

        // Position dots - Left aligned with text
        // Center vertically
        this.ctx.translate(paddingX + 20, this._height / 2);

        for (let i = 0; i < 3; i++) {
            let opacity = baseOpacity;
            let scale = 1.0;

            // Always animate wave if visible (even if expanding)
            // This gives it a "live" feel as it appears
            const speed = 3.0;
            const phase = i * 0.5;
            const t = currentTime * speed - phase;
            const wave = (Math.sin(t) + 1) / 2;

            opacity = baseOpacity + (activeOpacity - baseOpacity) * wave;
            scale = 1.0 + 0.3 * wave;

            this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(i * dotSpacing, 0, dotRadius * scale, 0, Math.PI * 2);
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

    public getCurrentHeight() {
        // Return fixed height regardless of expansion state
        // This prevents layout shifts when interlude becomes active/inactive
        return this._height;
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
}
