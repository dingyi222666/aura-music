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
    private duration: number = 0;

    constructor(line: LyricLineType, index: number, isMobile: boolean, duration: number = 0) {
        this.lyricLine = line;
        this.index = index;
        this.isMobile = isMobile;
        this.duration = duration;
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
        const now = performance.now();
        
        // Calculate dt with clamping to prevent physics explosions on re-entry
        let dt = this.lastDrawTime === -1 ? 0.016 : (now - this.lastDrawTime) / 1000;
        // Clamp dt to prevent spring explosion when line re-enters viewport after being off-screen
        dt = Math.min(dt, 0.1);
        this.lastDrawTime = now;

        // Determine target expansion state
        const currentTarget = this.springSystem.getTarget("expansion") || 0;
        const currentExpansion = this.springSystem.getCurrent("expansion");
        const targetExpansion = isActive ? 1 : 0;

        // Detect transition from Active -> Inactive (Exit animation start)
        // "Finally scale up once, then completely scale down"
        if (currentTarget === 1 && targetExpansion === 0) {
            // Apply a positive velocity to create a "pop" effect before shrinking
            // The spring will pull it to 0, but velocity will push it up first.
            this.springSystem.setVelocity("expansion", 8); 
        }

        // If we just became active from a cold state (e.g. seek), reset spring to 0
        // so it animates cleanly from collapsed to expanded without physics explosion
        if (currentTarget === 0 && targetExpansion === 1 && currentExpansion < 0.01) {
            this.springSystem.setValue("expansion", 0);
        }

        this.springSystem.setTarget("expansion", targetExpansion, INTERLUDE_SPRING);
        this.springSystem.update(dt);

        // Clamp expansion to [0, 1.5] to allow for pop effect, but preventing negative
        // We allow > 1 for the pop effect
        const expansion = Math.max(0, this.springSystem.getCurrent("expansion"));

        // Clear canvas
        this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

        // If completely collapsed and not active, don't draw anything
        // Increased threshold to ensure it disappears cleanly
        if (expansion < 0.01 && !isActive) {
            return;
        }

        const paddingX = this.isMobile ? 24 : 56;
        const baseRadius = this.isMobile ? 5 : 7;
        const dotSpacing = this.isMobile ? 16 : 24;
        const totalDotsWidth = dotSpacing * 2;

        // Calculate Progress
        // If active, we calculate progress based on line time and duration.
        // If not active, we don't care about progress color as much, but let's keep it consistent or fade out.
        let progress = 0;
        if (this.duration > 0) {
            const elapsed = currentTime - this.lyricLine.time;
            progress = Math.max(0, Math.min(1, elapsed / this.duration));
        } else if (isActive) {
             // If no duration, maybe pulse active?
             progress = 0.5; 
        } else {
             // If inactive, progress is 1 (finished) or 0? 
             // Usually if we passed it, it's 1. But drawing loop handles isActive.
             progress = 1;
        }

        this.ctx.save();

        // Draw hover background (round rect)
        if (isHovered) {
            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * Math.min(1, expansion)})`;
            const bgWidth = Math.max(totalDotsWidth + 80, 200);
            const bgHeight = this._height * Math.min(1, expansion);
            const bgY = (this._height - bgHeight) / 2;

            this.roundRect(paddingX - 16, bgY, bgWidth, bgHeight, 16 * Math.min(1, expansion));
            this.ctx.fill();
        }

        // Position dots - Left aligned with text but slightly offset
        // "Still a bit to the right" -> Add small offset
        const offsetX = 6; 
        
        // Calculate center of the dot group for scaling pivot
        // Dot 0 is at 0, Dot 1 at spacing, Dot 2 at 2*spacing (relative to start)
        // Center is at Dot 1 (spacing)
        // We want to translate to the center of the middle dot
        const groupCenterX = paddingX + offsetX + baseRadius + dotSpacing;
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

    public getCurrentHeight() {
        // Return dynamic height based on expansion state
        // Clamp to [0, 1] to prevent layout jitter during "pop" (expansion > 1)
        // When expansion is 0, height is 0 (hidden)
        const expansion = Math.max(0, Math.min(1, this.springSystem.getCurrent("expansion")));
        return this._height * expansion;
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