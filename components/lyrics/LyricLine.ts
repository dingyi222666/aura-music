import { LyricLine as LyricLineType } from "../../types";
import { ILyricLine } from "./ILyricLine";

const GLOW_CONFIG = {
  // Primary glow blur radius
  blur: 4,
  // Glow intensity multiplier
  intensity: 1.3,
  // Scale boost at peak glow - increased for magnification effect
  scaleBoost: 1.3,
};

// Wave propagation for character activation

const WAVE_PHYSICS = {
  speed: 3.5, // Characters per second equivalent
  decay: 0.85, // Wave amplitude decay per character
  wavelength: 3.0, // Characters width of the wave
};

export interface WordLayout {
  text: string;
  x: number;
  y: number; // Relative Y offset within the line block
  width: number;
  startTime: number;
  endTime: number;
  isVerbatim: boolean; // To distinguish between timed words and wrapped segments
  charWidths?: number[];
  charOffsets?: number[];
  renderProgress?: number;
}

const WRAPPED_LINE_GAP_RATIO = 0.25; // Extra spacing between auto-wrapped lyric lines

export interface LineLayout {
  y: number;
  height: number;
  words: WordLayout[];
  fullText: string;
  translation?: string;
  translationLines?: string[];
  textWidth: number;
  translationWidth?: number;
}

const detectLanguage = (text: string) => {
  const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
  return cjkRegex.test(text) ? "zh" : "en";
};

// Font configuration

const getFonts = (isMobile: boolean) => {
  const baseSize = isMobile ? 32 : 40;
  const transSize = isMobile ? 18 : 22;
  return {
    main: `800 ${baseSize}px "PingFang SC", "Inter", sans-serif`,
    trans: `500 ${transSize}px "PingFang SC", "Inter", sans-serif`,
    mainHeight: baseSize,
    transHeight: transSize * 1.3,
  };
};

export class LyricLine implements ILyricLine {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private layout: LineLayout | null = null;
  private lyricLine: LyricLineType;
  private isMobile: boolean;
  private _height: number = 0;
  private lastIsActive: boolean = false;
  private lastIsHovered: boolean = false;
  private isDirty: boolean = true;
  private pixelRatio: number;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;
  private wordCacheCanvas: OffscreenCanvas | HTMLCanvasElement;
  private wordCacheCtx:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D;
  private cachedWordKey: string = "";

  constructor(line: LyricLineType, index: number, isMobile: boolean) {
    this.lyricLine = line;
    this.isMobile = isMobile;
    this.pixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.canvas = document.createElement("canvas");
    this.wordCacheCanvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    const cacheCtx = this.wordCacheCanvas.getContext("2d");
    if (!ctx || !cacheCtx) throw new Error("Could not get canvas context");
    this.ctx = ctx as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
    this.wordCacheCtx = cacheCtx as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  private drawFullLine({
    currentTime,
    isActive,
    isHovered,
    hasTimedWords,
    mainFont,
    transFont,
    mainHeight,
    transHeight,
    paddingX,
  }: {
    currentTime: number;
    isActive: boolean;
    isHovered: boolean;
    hasTimedWords: boolean;
    mainFont: string;
    transFont: string;
    mainHeight: number;
    transHeight: number;
    paddingX: number;
  }) {
    if (!this.layout) return;

    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    this.ctx.save();

    this.ctx.font = mainFont;
    this.ctx.textBaseline = "top";
    this.ctx.translate(paddingX, 0);

    // 1. Draw Background (Hover)
    if (isHovered) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      const bgWidth = Math.max(this.layout.textWidth + 32, 200);
      this.roundRect(-16, 0, bgWidth, this.layout.height, 16);
      this.ctx.fill();
    }

    // 2. Determine Active Line Context
    let activeLineY: number | null = null;
    let cursorX = 0;
    let activeWords: WordLayout[] = [];

    if (isActive && hasTimedWords) {
      const activeIdx = this.layout.words.findIndex(
        (w) => currentTime >= w.startTime && currentTime < w.endTime
      );

      let currentWord: WordLayout | null = null;
      if (activeIdx !== -1) {
        currentWord = this.layout.words[activeIdx];
      } else {
        const nextWordIdx = this.layout.words.findIndex(w => w.startTime > currentTime);
        if (nextWordIdx > 0) currentWord = this.layout.words[nextWordIdx - 1];
        else if (nextWordIdx === -1) currentWord = this.layout.words[this.layout.words.length - 1];
        else currentWord = this.layout.words[0];
      }

      if (currentWord) {
        activeLineY = currentWord.y;
        activeWords = this.layout.words.filter(w => Math.abs(w.y - activeLineY!) < 5);
        // Cursor calculation
        if (activeIdx !== -1) {
          const w = this.layout.words[activeIdx];
          const p = (currentTime - w.startTime) / (w.endTime - w.startTime);
          cursorX = w.x + w.width * p;
        } else {
          // Simplified gap logic
          const nextIdx = this.layout.words.findIndex(w => w.startTime > currentTime);
          if (nextIdx > 0) cursorX = this.layout.words[nextIdx - 1].x + this.layout.words[nextIdx - 1].width;
          else if (nextIdx === -1) {
            const last = this.layout.words[this.layout.words.length - 1];
            cursorX = last.x + last.width;
          }
          else cursorX = 0;
        }
      }
    }

    // 3. Rendering Strategy
    const firstWord = this.layout.words[0];
    const lastWord = this.layout.words[this.layout.words.length - 1];
    const lineDuration = (firstWord && lastWord) ? lastWord.endTime - firstWord.startTime : 0;
    const wordCount = this.layout.words.length;
    let fastWordCount = 0;
    for (const w of this.layout.words) {
      if (w.endTime - w.startTime < 0.2) fastWordCount++;
    }

    // Skip karaoke if line is too short (<0.8s) OR >60% of words are very fast (<0.2s)
    const isFastLine = (wordCount > 0 && (fastWordCount / wordCount) > 0.9);

    if (isActive && (!hasTimedWords || isFastLine)) {
      // CASE: Active but standard text (no timing) -> Pure White
      this.ctx.fillStyle = "#FFFFFF";
      this.layout.words.forEach(w => this.ctx.fillText(w.text, w.x, w.y));
    }
    else if (isActive && activeLineY !== null && activeWords.length > 0) {
      // CASE: Active with Timing -> Fluid Animation

      // Render static inactive lines first
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      this.layout.words.forEach(w => {
        if (Math.abs(w.y - activeLineY!) >= 5) {
          // Past lines white, Future dim
          if (w.y < activeLineY!) {
            this.ctx.fillStyle = "#FFFFFF";
            this.ctx.fillText(w.text, w.x, w.y - 2); // Static Lift for past lines
          } else {
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            this.ctx.fillText(w.text, w.x, w.y);
          }
        }
      });

      // Render Active Line with Word-by-Word Effect
      this.drawActiveWords(activeWords, currentTime);

    } else {
      // CASE: Completely Inactive Line -> Dim
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      this.layout.words.forEach(w => this.ctx.fillText(w.text, w.x, w.y));
    }

    // 4. Translation
    if (this.layout.translationLines && this.layout.translationLines.length > 0) {
      this.ctx.font = transFont;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      const lastWordY = this.layout.words.length > 0
        ? this.layout.words[this.layout.words.length - 1].y
        : 0;
      let transY = lastWordY + mainHeight * 1.2;
      this.layout.translationLines.forEach((lineText) => {
        this.ctx.fillText(lineText, 0, transY);
        transY += transHeight;
      });
    }

    this.ctx.restore();
  }

  private drawActiveWords(activeWords: WordLayout[], currentTime: number) {
    const FLOAT_DURATION = 0.250;
    const MAX_LIFT = -2;

    activeWords.forEach((w) => {
      const duration = w.endTime - w.startTime;
      const elapsed = currentTime - w.startTime;
      const isWordActive = elapsed >= 0 && elapsed < duration;

      // Check condition for Glow Animation
      // Apply glow only to short words (length <= 7) that are currently playing
      if (w.text.length <= 7 && duration > 1.5 && isWordActive) {
        this.ctx.save();
        this.ctx.translate(w.x, w.y);

        const progress = Math.max(0, Math.min(1, elapsed / duration));

        // Smooth transition for glow intensity (fade in/out)
        // 1. Attack: Quick fade in (0 -> 1)
        // 2. Sustain: Hold
        // 3. Release: Fade out (1 -> 0) near the end
        let glowIntensity = 1;
        const fadeDuration = 0.2; // Seconds for fade
        const fadeOutStart = Math.max(0, duration - fadeDuration);

        if (elapsed < fadeDuration) {
          // Fade In
          glowIntensity = Math.min(1, elapsed / fadeDuration);
          // Use ease out for smoother entry
          glowIntensity = 1 - Math.pow(1 - glowIntensity, 3);
        } else if (elapsed > fadeOutStart) {
          // Fade Out
          const fadeOutProgress = (elapsed - fadeOutStart) / fadeDuration;
          glowIntensity = Math.max(0, 1 - fadeOutProgress);
        }

        // Combine with breath envelope if needed, but simpler is often better for "glow"
        // The original code used `computeBreathEnvelope` which is mostly for attack.
        // We can combine them:
        // const decay = this.computeBreathEnvelope(progress, false, 0);
        // Let's rely on our explicit fade logic for the "presence" of the effect.

        this.drawGlowAnimation(w, elapsed, duration, glowIntensity);
        this.ctx.restore();
      } else {
        // Standard Rendering (Floating + Gradient)
        let lift = 0;
        if (elapsed > 0) {
          // Fast float with curve
          const floatProgress = Math.min(1, elapsed / FLOAT_DURATION);

          // Ease In Out Quad (Softer than cubic, less "snappy")
          const ease =
            floatProgress < 0.5
              ? 2 * floatProgress * floatProgress
              : 1 - Math.pow(-2 * floatProgress + 2, 2) / 2;

          lift = MAX_LIFT * ease;
        }

        this.ctx.save();

        this.ctx.translate(w.x, w.y + lift);

        if (elapsed >= duration) {
          // Past
          this.ctx.fillStyle = "#FFFFFF";
          this.ctx.fillText(w.text, 0, 0);
        } else if (elapsed < 0) {
          // Future
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
          this.ctx.fillText(w.text, 0, 0);
        } else {
          // Active
          // Gradient fill
          const gradient = this.ctx.createLinearGradient(0, 0, w.width, 0);
          const p = elapsed / duration;

          gradient.addColorStop(Math.max(0, p), "#FFFFFF");
          gradient.addColorStop(
            Math.min(1, p + 0.15),
            "rgba(255, 255, 255, 0.3)"
          );

          this.ctx.fillStyle = gradient;
          this.ctx.fillText(w.text, 0, 0);
        }
        this.ctx.restore();
      }
    });
  }



  private easeProgress(word: WordLayout, target: number) {
    if (word.renderProgress === undefined) {
      word.renderProgress = target;
    } else {
      // Use exponential smoothing with adaptive rate
      // Faster response when far from target, slower when close (spring-like behavior)
      const delta = target - word.renderProgress;
      const adaptiveRate = 0.15 + Math.abs(delta) * 0.2;
      word.renderProgress += delta * Math.min(adaptiveRate, 0.4);
    }
    return Math.max(0, Math.min(1, word.renderProgress));
  }

  /**
   * Compute spring-based breathing envelope using critically damped spring physics.
   */
  private computeBreathEnvelope(
    progress: number,
    isTransitioning: boolean,
    transitionProgress: number
  ): number {
    // Envelope mostly handles the "Attack" phase of the word.
    // Sustain and Release are handled by the wave and decay logic in drawGlowAnimation.
    const attackEnd = 0.2;
    if (progress < attackEnd) {
      const t = progress / attackEnd;
      // Ease out cubic for smooth entry
      return 1 - Math.pow(1 - t, 3);
    }
    return 1;
  }

  /**
   * Compute wave-based character activation using physics wave propagation.
   */
  private computeWaveActivation(
    charIndex: number,
    charCount: number,
    progress: number
  ): { activation: number; waveIntensity: number } {
    const { wavelength } = WAVE_PHYSICS;

    // Wave front position
    const waveFront =
      progress * (charCount + wavelength * 1.5) - wavelength * 0.5;

    const distFromFront = charIndex - waveFront;

    // Gaussian wave packet for intensity (flash)
    const sigma = wavelength / 2.5;
    const waveIntensity = Math.exp(
      -(distFromFront * distFromFront) / (2 * sigma * sigma)
    );

    // Activation: 1 if wave has passed (swept area)
    let activation = 0;
    if (distFromFront < -wavelength * 0.5) {
      activation = 1;
    } else if (distFromFront > wavelength) {
      activation = 0;
    } else {
      // Smooth hermite interpolation
      const t = (-distFromFront + wavelength) / (1.5 * wavelength);
      activation = Math.max(0, Math.min(1, t * t * (3 - 2 * t)));
    }

    return { activation, waveIntensity };
  }

  /**
   * Draw glow effect - single layer
   */
  private applyGlow(intensity: number, color: string = "white") {
    if (intensity < 0.01) {
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = "transparent";
      return;
    }

    // Non-linear blur for "fluid" feel
    const blur = GLOW_CONFIG.blur * (0.4 + 0.6 * Math.pow(intensity, 0.8));
    const alpha = GLOW_CONFIG.intensity * intensity;
    this.ctx.shadowColor = `rgba(255, 255, 255, ${alpha})`;
    this.ctx.shadowBlur = blur;
  }

  private drawGlowAnimation(
    word: WordLayout,
    elapsed: number,
    duration: number,
    decayFactor: number
  ) {
    const chars = word.text.split("");

    if (chars.length === 0) return;
    const charCount = chars.length;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    const { main, mainHeight } = getFonts(this.isMobile);

    // Prepare character metrics
    if (!word.charWidths || !word.charOffsets) {
      const { charWidths, charOffsets } = this.computeCharMetrics(
        word.text,
        mainHeight
      );

      word.charWidths = charWidths;
      word.charOffsets = charOffsets;
    }

    // --- CACHING LOGIC ---
    // Render the full word once to an offscreen canvas if not already cached
    if (this.cachedWordKey !== word.text) {
      const padding = 20;
      const requiredWidth = Math.ceil(word.width * this.pixelRatio) + padding;
      const requiredHeight = Math.ceil(mainHeight * 1.5 * this.pixelRatio);

      if (
        this.wordCacheCanvas.width < requiredWidth ||
        this.wordCacheCanvas.height < requiredHeight
      ) {
        this.wordCacheCanvas.width = requiredWidth;
        this.wordCacheCanvas.height = requiredHeight;
      }

      this.wordCacheCtx.clearRect(
        0,
        0,
        this.wordCacheCanvas.width,
        this.wordCacheCanvas.height
      );
      this.wordCacheCtx.save();
      this.wordCacheCtx.scale(this.pixelRatio, this.pixelRatio);
      this.wordCacheCtx.font = main;
      this.wordCacheCtx.textBaseline = "top";
      this.wordCacheCtx.fillStyle = "#FFFFFF";
      this.wordCacheCtx.fillText(word.text, 0, 0);
      this.wordCacheCtx.restore();

      this.cachedWordKey = word.text;
    }

    // --- FLUID GRID CALCULATION ---

    const charScales: number[] = [];
    const charOpacities: number[] = [];
    const charLifts: number[] = [];

    let totalDynamicWidth = 0;
    const MAX_LIFT = -2;

    // 1. Compute scales and dynamics for all characters
    chars.forEach((char, charIndex) => {
      const { activation, waveIntensity } = this.computeWaveActivation(
        charIndex,
        charCount,
        progress
      );

      // Scale Logic:
      // Only magnify the "active" part (wave peak).
      // Standard scale is 1.0.
      // Boost slightly (e.g. 1.02-1.03) only when waveIntensity is high.
      const BASE_SCALE = 1.0;
      // We want a subtle pop, so reduce scaleBoost if needed or rely on config
      const PEAK_SCALE = 1.1; // Slightly higher than base

      // Wave intensity determines how close we are to the "singing cursor"
      const scaleBoost = (PEAK_SCALE - BASE_SCALE) * waveIntensity;
      const scale = BASE_SCALE + scaleBoost;

      charScales.push(scale);

      const originalWidth = word.charWidths?.[charIndex] ?? 0;
      totalDynamicWidth += originalWidth * scale;

      // Opacity Logic:
      // 0.5 (unsung) -> 1.0 (sung)
      // Activation goes 0 -> 1 as wave passes
      const opacity = 0.5 + 0.5 * activation;
      charOpacities.push(opacity);

      // Lift Logic:
      // Unsung: 0
      // Active (Wave Peak): Animate to MAX_LIFT
      // Sung (Past): Stay at MAX_LIFT
      // We can use activation for "past" check (activation ~= 1)

      // Smooth transition for lift based on activation
      // But we want the "pop" to also lift.
      // If activation is 1, lift is MAX_LIFT.
      // If activation is 0, lift is 0.
      // waveIntensity adds a bit of extra "jump" if desired, or just smooth transition.
      let lift = activation * MAX_LIFT;

      // Optional: Add a slight bounce at the peak if desired, using waveIntensity
      // lift -= waveIntensity * 1; 

      charLifts.push(lift);
    });

    // 2. Calculate centering offset with dynamic bias
    // The "anchor" shifts from left (0.3) to right (0.7) as progress increases
    const anchor = 0.5 + (progress - 0.5) * 0.5;
    const originalWordWidth = word.width;
    const widthDiff = totalDynamicWidth - originalWordWidth;
    const startXOffset = -widthDiff * anchor;

    // 3. Draw characters using cached slices

    let currentX = startXOffset;

    this.applyGlow(decayFactor);

    chars.forEach((char, charIndex) => {
      const scale = charScales[charIndex];
      const lift = charLifts[charIndex];
      const originalWidth = word.charWidths?.[charIndex] ?? 0;
      const originalOffset = word.charOffsets?.[charIndex] ?? 0;
      const dynamicWidth = originalWidth * scale;
      const opacity = charOpacities[charIndex];

      if (opacity > 0.01) {
        this.ctx.save();

        // Apply opacity
        this.ctx.globalAlpha = opacity;

        // Position: Center of the dynamic slot
        const charCenterX = currentX + dynamicWidth / 2;
        // Use calculated lift
        const charCenterY = mainHeight / 2 + lift;

        // Translate to center, scale, translate back
        this.ctx.translate(charCenterX, charCenterY);
        this.ctx.scale(scale, scale);
        this.ctx.translate(-charCenterX, -charCenterY);

        // Draw slice from cache
        const sx = originalOffset * this.pixelRatio;
        const sy = 0;
        const sWidth = originalWidth * this.pixelRatio;
        const sHeight = this.wordCacheCanvas.height;

        if (sWidth > 0) {
          this.ctx.drawImage(
            this.wordCacheCanvas,
            sx,
            sy,
            sWidth,
            sHeight,
            currentX,
            lift, // Apply lift to Y position (redundant if we translated? No, drawImage needs dst vars)
            // Wait, we translated context to (charCenterX, charCenterY).
            // Drawing at (currentX, lift) might be double applying offset if not careful.
            // Let's look at previous logic:
            // prev: this.ctx.translate(charCenterX, charCenterY); ... ctx.translate(-charCenterX, -charCenterY);
            // prev draw: dx = currentX, dy = lift. 
            // This is correct because the context matches the "grid" position, and we draw at the specific slot.
            originalWidth,
            sHeight / this.pixelRatio
          );
        }

        this.ctx.restore();
      }

      currentX += dynamicWidth;
    });
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

  public measure(containerWidth: number, suggestedTranslationWidth?: number) {
    const { main, trans, mainHeight, transHeight } = getFonts(
      this.isMobile
    );

    const baseSize = this.isMobile ? 32 : 40;
    const paddingY = 18;
    const paddingX = this.isMobile ? 24 : 56;
    const maxWidth = containerWidth - paddingX * 2;

    // Reset context font for measurement
    this.ctx.font = main;
    this.ctx.textBaseline = "top";
    const lang = detectLanguage(this.lyricLine.text);

    // @ts-ignore: Intl.Segmenter

    const segmenter =
      typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(lang, { granularity: "word" })
        : null;

    // Measure main text
    const {
      words,
      textWidth,
      height: lineHeight,
    } = this.measureLineText({
      line: this.lyricLine,
      segmenter,
      lang,
      maxWidth,
      baseSize,
      mainHeight,
      paddingY,
      mainFont: main,
      wrapLineGap: mainHeight * WRAPPED_LINE_GAP_RATIO,
    });

    let blockHeight = lineHeight;
    let translationLines: string[] | undefined = undefined;
    let effectiveTextWidth = textWidth;
    let translationWidth = 0;

    if (this.lyricLine.translation) {
      // Use suggested width if provided and larger than current text width, but not exceeding maxWidth
      // Otherwise use textWidth (if > 0) or maxWidth
      let translationWrapWidth = textWidth > 0 ? textWidth : maxWidth;

      if (
        suggestedTranslationWidth &&
        suggestedTranslationWidth > translationWrapWidth
      ) {
        translationWrapWidth = Math.min(
          suggestedTranslationWidth,
          maxWidth
        );
      }

      const translationResult = this.measureTranslationLines({
        translation: this.lyricLine.translation,
        maxWidth: translationWrapWidth,
        transHeight,
        transFont: trans,
      });
      translationLines = translationResult.lines;
      blockHeight += translationResult.height;
      translationWidth = Math.min(translationResult.width ?? 0, maxWidth);
      effectiveTextWidth = Math.max(effectiveTextWidth, translationWidth);
    }

    blockHeight += paddingY;
    this._height = blockHeight;

    this.layout = {
      y: 0, // Relative to this canvas
      height: blockHeight,
      words,
      fullText: this.lyricLine.text,
      translation: this.lyricLine.translation,
      translationLines,
      textWidth: Math.max(effectiveTextWidth, textWidth),
      translationWidth,
    };

    // Store logical dimensions

    this.logicalWidth = containerWidth;
    this.logicalHeight = blockHeight;

    // Set canvas physical resolution for HiDPI displays

    this.canvas.width = containerWidth * this.pixelRatio;
    this.canvas.height = blockHeight * this.pixelRatio;

    // Reset transform and scale context to match physical resolution
    this.ctx.resetTransform();
    if (this.pixelRatio !== 1) {
      this.ctx.scale(this.pixelRatio, this.pixelRatio);
    }

    this.isDirty = true;
  }

  public getTextWidth() {
    return this.layout?.textWidth || 0;
  }

  public draw(currentTime: number, isActive: boolean, isHovered: boolean) {
    if (!this.layout) return;

    const stateUnchanged =
      !isActive &&
      !this.isDirty &&
      !this.lastIsActive &&
      this.lastIsHovered === isHovered;
    if (stateUnchanged) return;

    const { main, trans, mainHeight, transHeight } = getFonts(
      this.isMobile
    );

    const paddingX = this.isMobile ? 24 : 56;
    const hasTimedWords = this.layout.words.some((w) => w.isVerbatim);

    const stateChanged =
      this.lastIsActive !== isActive || this.lastIsHovered !== isHovered;

    if (isActive && !hasTimedWords && !this.isDirty && !stateChanged) {
      return;
    }

    this.drawFullLine({
      currentTime,
      isActive,
      isHovered,
      hasTimedWords,
      mainFont: main,
      transFont: trans,
      mainHeight,
      transHeight,
      paddingX,
    });

    this.lastIsActive = isActive;
    this.lastIsHovered = isHovered;
    this.isDirty = false;
  }

  public getCanvas() {
    return this.canvas;
  }

  public getHeight() {
    return this._height;
  }

  public getCurrentHeight() {
    return this._height;
  }

  public getLogicalWidth() {
    return this.logicalWidth;
  }

  public getLogicalHeight() {
    return this.logicalHeight;
  }

  public isInterlude() {
    return false;
  }

  // --- Helpers ---

  private measureLineText({
    line,
    segmenter,
    lang,
    maxWidth,
    baseSize,
    mainHeight,
    paddingY,
    mainFont,
    wrapLineGap,
  }: any) {
    this.ctx.font = mainFont;

    const words: WordLayout[] = [];
    let currentLineX = 0;
    let currentLineY = paddingY;
    let maxLineWidth = 0;

    const addWord = (
      text: string,
      start: number,
      end: number,
      isVerbatim: boolean
    ) => {
      const metrics = this.ctx.measureText(text);
      let width = metrics.width;
      if (width === 0 && text.trim().length > 0) {
        width = text.length * (baseSize * 0.5);
      }

      if (currentLineX + width > maxWidth && currentLineX > 0) {
        currentLineX = 0;
        currentLineY += mainHeight + wrapLineGap;
      }

      const { charWidths, charOffsets } = this.computeCharMetrics(
        text,
        baseSize
      );

      words.push({
        text,
        x: currentLineX,
        y: currentLineY,
        width,
        startTime: start,
        endTime: end,
        isVerbatim,
        charWidths,
        charOffsets,
      });

      currentLineX += width;
      maxLineWidth = Math.max(maxLineWidth, currentLineX);
    };

    if (line.words && line.words.length > 0) {
      line.words.forEach((w: any) => {
        addWord(w.text, w.startTime, w.endTime, true);
      });
    } else if (segmenter) {
      const segments = segmenter.segment(line.text);
      for (const seg of segments) {
        addWord(seg.segment, line.time, 999999, false);
      }
    } else if (lang === "zh") {
      line.text.split("").forEach((c: string) => {
        addWord(c, line.time, 999999, false);
      });
    } else {
      const wordsArr = line.text.split(" ");
      wordsArr.forEach((word: string, index: number) => {
        addWord(word, line.time, 999999, false);
        if (index < wordsArr.length - 1) {
          addWord(" ", line.time, 999999, false);
        }
      });
    }

    return {
      words,
      textWidth: maxLineWidth,
      height: currentLineY + mainHeight,
    };
  }

  private measureTranslationLines({
    translation,
    maxWidth,
    transHeight,
    transFont,
  }: any) {
    this.ctx.font = transFont;
    const isEn = detectLanguage(translation) === "en";
    const atoms = isEn ? translation.split(" ") : translation.split("");
    const lines: string[] = [];

    let currentTransLine = "";
    let currentTransWidth = 0;
    let maxLineWidth = 0;

    atoms.forEach((atom: string, index: number) => {
      const atomText =
        isEn && index < atoms.length - 1 ? atom + " " : atom;

      const width = this.ctx.measureText(atomText).width;

      if (currentTransWidth + width > maxWidth && currentTransWidth > 0) {
        lines.push(currentTransLine);
        maxLineWidth = Math.max(maxLineWidth, currentTransWidth);
        currentTransLine = atomText;
        currentTransWidth = width;
      } else {
        currentTransLine += atomText;
        currentTransWidth += width;
      }
    });

    if (currentTransLine) {
      lines.push(currentTransLine);
      maxLineWidth = Math.max(maxLineWidth, currentTransWidth);
    }

    return {
      lines,
      height: lines.length ? lines.length * transHeight + 4 : 0,
      width: maxLineWidth,
    };
  }

  private computeCharMetrics(text: string, baseSize: number) {
    const chars = text.split("");
    const charWidths: number[] = [];
    const charOffsets: number[] = [];
    let offset = 0;

    chars.forEach((char) => {
      const width =
        this.ctx.measureText(char).width || char.length * (baseSize * 0.5);
      charWidths.push(width);
      charOffsets.push(offset);
      offset += width;
    });

    return { charWidths, charOffsets };
  }
}
