export interface ILyricLine {
    draw(currentTime: number, isActive: boolean, isHovered: boolean, hoverProgress?: number): void;
    measure(containerWidth: number, suggestedTranslationWidth?: number): void;
    getHeight(): number;
    getCurrentHeight(currentTime?: number): number;
    getTargetHeight(currentTime?: number): number;
    getCanvas(): OffscreenCanvas | HTMLCanvasElement;
    getLogicalWidth(): number;
    getLogicalHeight(): number;
    getTextWidth(): number;
    getScalePivot(): number;
    getPressPivot(): number;
    isInterlude(): boolean;
    getAlignment(): "left" | "right" | undefined;
    isBackgroundLine(): boolean;
}
