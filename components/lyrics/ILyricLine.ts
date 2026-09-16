export interface ILyricLine {
  update(time: number, dt: number): void;
  draw(
    currentTime: number,
    isActive: boolean,
    isHovered: boolean,
    hoverProgress?: number,
  ): void;
  measure(containerWidth: number, suggestedTranslationWidth?: number): void;
  getHeight(): number;
  getCurrentHeight(currentTime?: number): number;
  getFocusOffset(): number;
  getCanvas(): HTMLCanvasElement;
  getLogicalWidth(): number;
  getLogicalHeight(): number;
  getTextWidth(): number;
  getScalePivot(): number;
  getPressPivot(): number;
  isInterlude(): boolean;
  isBackgroundLine(): boolean;
  // Absolute time at which this line's word-emphasis glow has fully settled.
  // -Infinity when the line has no emphasized words.
  getEmphasisEnd(): number;
}
