export interface ILyricLine {
    draw(currentTime: number, isActive: boolean, isHovered: boolean): void;
    measure(containerWidth: number, suggestedTranslationWidth?: number): void;
    getHeight(): number;
    getCurrentHeight(): number;
    getCanvas(): OffscreenCanvas | HTMLCanvasElement;
    getLogicalWidth(): number;
    getLogicalHeight(): number;
    getTextWidth(): number;
    isInterlude(): boolean;
}
