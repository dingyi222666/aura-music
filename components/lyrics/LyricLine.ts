import { LyricLine as LyricLineType } from "../../types";

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
  renderSnapshot?: WordRenderSnapshot;
}

type WordRenderPhase = "before" | "active-standard" | "active-glow" | "after";

interface WordRenderSnapshot {
  phase: WordRenderPhase;
  rawProgress: number;
  lastGlowSample?: number;
}

// Apple Music Style Physics Constants
const BREATH_PHYSICS = {
  // Spring parameters for breathing lift effect
  mass: 1.0,
  stiffness: 180, // Natural frequency ~13.4 Hz
  damping: 18, // Slightly under-damped for subtle overshoot
  // Lift amounts based on word length
  liftAmountShort: 2.8, // 1-3 chars
  liftAmountMedium: 2.2, // 4-5 chars
  liftAmountLong: 1.6, // 6+ chars
  // Overshoot factor (1.0 = no overshoot, 1.15 = 15% overshoot)
  overshootFactor: 1.12,
};

// Multi-layer glow configuration (Apple Music style)
const GLOW_CONFIG = {
  // Primary glow blur radius
  blur: 24,
  // Glow intensity multiplier
  intensity: 0.85,
  // Scale boost at peak glow
  scaleBoost: 1.035,
};

// Wave propagation for character activation
const WAVE_PHYSICS = {
  speed: 2.8, // Characters per second equivalent
  decay: 0.85, // Wave amplitude decay per character
  wavelength: 2.5, // Characters width of the wave
};

export interface LineLayout {
  y: number; // Absolute Y position in the document (managed externally now, but kept for compatibility if needed)
  height: number;
  words: WordLayout[];
  fullText: string;
  translation?: string;
  translationLines?: string[]; // New field for wrapped translation
  textWidth: number; // Max width of the text block
}

const detectLanguage = (text: string) => {
  const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
  return cjkRegex.test(text) ? "zh" : "en";
};

// Font configuration
const getFonts = (isMobile: boolean) => {
  // Sizes matched to previous Tailwind classes (text-3xl/4xl/5xl)
  const baseSize = isMobile ? 32 : 40;
  const transSize = isMobile ? 18 : 22;
  return {
    main: `800 ${baseSize}px "PingFang SC", "Inter", sans-serif`,
    trans: `500 ${transSize}px "PingFang SC", "Inter", sans-serif`,
    mainHeight: baseSize, // Increased line height for better wrapping
    transHeight: transSize * 1.3,
  };
};

export class LyricLine {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private layout: LineLayout | null = null;
  private lyricLine: LyricLineType;
  private index: number;
  private isMobile: boolean;
  private lastDrawTime: number = -1;
  private _height: number = 0;
  private lastIsActive: boolean = false;
  private lastIsHovered: boolean = false;
  private isDirty: boolean = true;
  private pixelRatio: number;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;

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
  }

  private shouldUseGlow(word: WordLayout, duration: number) {
    return duration > 1 && word.text.length <= 7;
  }

  private computeWordSnapshot(
    word: WordLayout,
    currentTime: number,
  ): WordRenderSnapshot {
    const duration = word.endTime - word.startTime;
    if (currentTime <= word.startTime) {
      return { phase: "before", rawProgress: 0 };
    }

    if (duration <= 0 || currentTime >= word.endTime) {
      return { phase: "after", rawProgress: 1 };
    }

    const elapsed = currentTime - word.startTime;
    const rawProgress = Math.max(0, Math.min(1, elapsed / duration));
    const phase = this.shouldUseGlow(word, duration)
      ? "active-glow"
      : "active-standard";

    return { phase, rawProgress };
  }

  private shouldRedrawWord(
    word: WordLayout,
    snapshot: WordRenderSnapshot,
    currentTime: number,
  ) {
    if (!word.renderSnapshot) return true;
    if (word.renderSnapshot.phase !== snapshot.phase) return true;

    if (snapshot.phase === "active-standard") {
      return (
        Math.abs(snapshot.rawProgress - word.renderSnapshot.rawProgress) > 0.003
      );
    }

    if (snapshot.phase === "active-glow") {
      const progressDelta = Math.abs(
        snapshot.rawProgress - word.renderSnapshot.rawProgress,
      );
      const timeDelta =
        !word.renderSnapshot.lastGlowSample ||
        currentTime - word.renderSnapshot.lastGlowSample > 0.05;

      return progressDelta > 0.002 || timeDelta;
    }

    return false;
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
    snapshots,
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
    snapshots?: Map<WordLayout, WordRenderSnapshot>;
  }) {
    if (!this.layout) return;

    // Use logical dimensions for clearRect since context is already scaled
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    this.ctx.save();

    if (isHovered) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      const bgWidth = Math.max(this.layout.textWidth + 32, 200);
      this.roundRect(paddingX - 16, 0, bgWidth, this.layout.height, 16);
      this.ctx.fill();
    }

    this.ctx.font = mainFont;
    this.ctx.textBaseline = "top";
    this.ctx.translate(paddingX, 0);

    if (!isActive) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      this.layout.words.forEach((w) => {
        this.ctx.fillText(w.text, w.x, w.y);
        w.renderSnapshot = undefined;
        w.renderProgress = undefined;
      });
    } else if (!hasTimedWords) {
      this.ctx.fillStyle = "#ffffff";
      this.layout.words.forEach((w) => {
        this.ctx.fillText(w.text, w.x, w.y);
        w.renderSnapshot = undefined;
        w.renderProgress = undefined;
      });
    } else {
      this.layout.words.forEach((w) => {
        const snapshot =
          snapshots?.get(w) ?? this.computeWordSnapshot(w, currentTime);
        this.drawLyricWord(w, currentTime);
        w.renderSnapshot = {
          ...snapshot,
          lastGlowSample:
            snapshot.phase === "active-glow" ? currentTime : undefined,
        };
      });
    }

    if (
      this.layout.translationLines &&
      this.layout.translationLines.length > 0
    ) {
      this.ctx.font = transFont;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";

      const lastWordY =
        this.layout.words.length > 0
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

  public measure(containerWidth: number, suggestedTranslationWidth?: number) {
    const { main, trans, mainHeight, transHeight } = getFonts(this.isMobile);
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
    });

    let blockHeight = lineHeight;
    let translationLines: string[] | undefined = undefined;

    if (this.lyricLine.translation) {
      // Use suggested width if provided and larger than current text width, but not exceeding maxWidth
      // Otherwise use textWidth (if > 0) or maxWidth
      let translationWrapWidth = textWidth > 0 ? textWidth : maxWidth;

      if (suggestedTranslationWidth && suggestedTranslationWidth > translationWrapWidth) {
        translationWrapWidth = Math.min(suggestedTranslationWidth, maxWidth);
      }

      const translationResult = this.measureTranslationLines({
        translation: this.lyricLine.translation,
        maxWidth: translationWrapWidth,
        transHeight,
        transFont: trans,
      });
      translationLines = translationResult.lines;
      blockHeight += translationResult.height;
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
      textWidth,
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

    // Special handling for interludes - always redraw when active for smooth animation
    const isInterlude = this.lyricLine.isInterlude || this.lyricLine.text === "...";

    const stateUnchanged =
      !isActive &&
      !this.isDirty &&
      !this.lastIsActive &&
      this.lastIsHovered === isHovered;
    if (stateUnchanged) return;

    const { main, trans, mainHeight, transHeight } = getFonts(this.isMobile);
    const paddingX = this.isMobile ? 24 : 56;
    const hasTimedWords = this.layout.words.some((w) => w.isVerbatim);

    const stateChanged =
      this.lastIsActive !== isActive || this.lastIsHovered !== isHovered;

    // Interludes need continuous redraw when active for smooth animation
    if (isActive && !hasTimedWords && !this.isDirty && !stateChanged && !isInterlude) {
      return;
    }

    const canIncremental =
      !this.isDirty && isActive && hasTimedWords && !stateChanged;

    let snapshots: Map<WordLayout, WordRenderSnapshot> | undefined;
    if (canIncremental) {
      snapshots = new Map<WordLayout, WordRenderSnapshot>();
      let needsWordUpdate = false;
      this.layout.words.forEach((word) => {
        const snapshot = this.computeWordSnapshot(word, currentTime);
        snapshots!.set(word, snapshot);
        if (!needsWordUpdate) {
          needsWordUpdate = this.shouldRedrawWord(word, snapshot, currentTime);
        }
      });

      if (!needsWordUpdate) {
        this.lastIsActive = isActive;
        this.lastIsHovered = isHovered;
        this.isDirty = false;
        return;
      }
    }

    if (isInterlude) {
      this.drawInterludeDots(isActive, isHovered, currentTime);
      this.lastIsActive = isActive;
      this.lastIsHovered = isHovered;
      this.isDirty = false;
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
      snapshots,
    });

    this.lastIsActive = isActive;
    this.lastIsHovered = isHovered;
    this.isDirty = false;
  }

  private drawInterludeDots(isActive: boolean, isHovered: boolean, currentTime: number) {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

    const { mainHeight } = getFonts(this.isMobile);
    const paddingX = this.isMobile ? 24 : 56;

    // Dots configuration
    const dotRadius = this.isMobile ? 4 : 6;
    const dotSpacing = this.isMobile ? 16 : 24;
    const totalDotsWidth = dotSpacing * 2; // 3 dots, 2 spaces
    const baseOpacity = 0.3;
    const activeOpacity = 0.9;

    this.ctx.save();

    // Draw hover background (round rect) like normal lyrics
    if (isHovered) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      const bgWidth = Math.max(totalDotsWidth + 80, 200); // Wider background for hover
      this.roundRect(paddingX - 16, 0, bgWidth, this.layout!.height, 16);
      this.ctx.fill();
    }

    // Position dots
    this.ctx.translate(paddingX + 20, this.layout!.height / 2);

    for (let i = 0; i < 3; i++) {
      let opacity = baseOpacity;
      let scale = 1.0;

      if (isActive) {
        // Create a wave effect based on time
        // Offset phase by index for cascading animation
        const speed = 3.0;
        const phase = i * 0.5;
        const t = currentTime * speed - phase;

        // Sine wave 0..1
        const wave = (Math.sin(t) + 1) / 2;

        opacity = baseOpacity + (activeOpacity - baseOpacity) * wave;
        scale = 1.0 + 0.3 * wave;
      }

      this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      this.ctx.beginPath();
      this.ctx.arc(i * dotSpacing, 0, dotRadius * scale, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  public getCanvas() {
    return this.canvas;
  }

  public getHeight() {
    return this._height;
  }

  public getLogicalWidth() {
    return this.logicalWidth;
  }

  public getLogicalHeight() {
    return this.logicalHeight;
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
      isVerbatim: boolean,
    ) => {
      const metrics = this.ctx.measureText(text);
      let width = metrics.width;
      if (width === 0 && text.trim().length > 0) {
        width = text.length * (baseSize * 0.5);
      }

      if (currentLineX + width > maxWidth && currentLineX > 0) {
        currentLineX = 0;
        currentLineY += mainHeight;
      }

      const { charWidths, charOffsets } = this.computeCharMetrics(
        text,
        baseSize,
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

    atoms.forEach((atom: string, index: number) => {
      const atomText = isEn && index < atoms.length - 1 ? atom + " " : atom;
      const width = this.ctx.measureText(atomText).width;

      if (currentTransWidth + width > maxWidth && currentTransWidth > 0) {
        lines.push(currentTransLine);
        currentTransLine = atomText;
        currentTransWidth = width;
      } else {
        currentTransLine += atomText;
        currentTransWidth += width;
      }
    });

    if (currentTransLine) {
      lines.push(currentTransLine);
    }

    return {
      lines,
      height: lines.length ? lines.length * transHeight + 4 : 0,
    };
  }

  private drawLyricWord(word: WordLayout, currentTime: number) {
    this.ctx.save();
    this.ctx.translate(word.x, word.y);

    const duration = word.endTime - word.startTime;
    const elapsed = currentTime - word.startTime;
    const { mainHeight } = getFonts(this.isMobile);

    if (currentTime < word.startTime) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      this.ctx.fillText(word.text, 0, 0);
      word.renderProgress = 0;
      this.ctx.restore();
      return;
    } else if (currentTime > word.endTime) {
      word.renderProgress = 1;
      this.drawStandardAnimation(word, 1, duration, mainHeight);
      this.ctx.restore();
      return;
    } else {
      let progress = 0;
      if (duration > 0) {
        progress = Math.max(0, Math.min(1, elapsed / duration));
      }
      const easedProgress = this.easeProgress(word, progress);

      const useGlow = this.shouldUseGlow(word, duration);
      if (useGlow) {
        this.drawGlowAnimation(word, currentTime, elapsed, duration);
      } else {
        this.drawStandardAnimation(word, easedProgress, duration, mainHeight);
      }
    }

    this.ctx.restore();
  }

  /**
   * Compute spring-based breathing envelope using critically damped spring physics.
   * This creates the natural "breath" feel with optional subtle overshoot.
   */
  private computeBreathEnvelope(
    progress: number,
    isTransitioning: boolean,
    transitionProgress: number,
  ): number {
    // Use a spring-inspired envelope: fast rise, natural decay
    // Formula: x(t) = 1 - (1 + ωt)e^(-ωt) for critically damped rise
    // Modified to create breathing pattern with overshoot

    const { overshootFactor } = BREATH_PHYSICS;

    // Phase 1: Attack (0 -> peak with overshoot)
    // Phase 2: Sustain at peak
    // Phase 3: Release (peak -> 0)

    const attackEnd = 0.25;
    const sustainEnd = 0.7;

    let envelope = 0;

    if (progress < attackEnd) {
      // Attack phase: Spring-like rise with overshoot
      const t = progress / attackEnd;
      // Critically damped response with overshoot
      const omega = 8; // Natural frequency
      const dampedT = t * 3; // Scale for faster response
      const springResponse =
        1 - (1 + omega * dampedT) * Math.exp(-omega * dampedT);
      // Add overshoot at the peak of attack
      const overshoot =
        Math.sin(t * Math.PI) * (overshootFactor - 1) * springResponse;
      envelope = springResponse + overshoot;
    } else if (progress < sustainEnd) {
      // Sustain phase: Gentle breathing oscillation
      const sustainT = (progress - attackEnd) / (sustainEnd - attackEnd);
      // Subtle sine wave for "breathing" feel
      const breathOscillation = Math.sin(sustainT * Math.PI * 2) * 0.08;
      envelope = 1 + breathOscillation;
    } else {
      // Release phase: Smooth exponential decay
      const releaseT = (progress - sustainEnd) / (1 - sustainEnd);
      // Exponential decay for natural release
      envelope = Math.exp(-releaseT * 3);
    }

    // Apply transition fade-out with physics-based deceleration
    if (isTransitioning) {
      // Use spring-based deceleration curve
      const decel = 1 - Math.pow(transitionProgress, 2) * (3 - 2 * transitionProgress);
      envelope *= decel;
    }

    return Math.max(0, Math.min(1.2, envelope));
  }

  /**
   * Compute wave-based character activation using physics wave propagation.
   * Creates the smooth left-to-right highlight sweep.
   */
  private computeWaveActivation(
    charIndex: number,
    charCount: number,
    progress: number,
  ): { activation: number; waveIntensity: number } {
    const { speed, decay, wavelength } = WAVE_PHYSICS;

    // Wave front position (0 to charCount)
    const waveFront = progress * (charCount + wavelength * 2) - wavelength;

    // Distance from wave front
    const distFromFront = charIndex - waveFront;

    // Gaussian wave packet for smooth activation
    const sigma = wavelength / 2;
    const wavePacket = Math.exp(
      -(distFromFront * distFromFront) / (2 * sigma * sigma),
    );

    // Activation: 1 if wave has passed, smooth transition at front
    let activation = 0;
    if (distFromFront < -wavelength) {
      activation = 1;
    } else if (distFromFront > wavelength) {
      activation = 0;
    } else {
      // Smooth step using hermite interpolation
      const t = (-distFromFront + wavelength) / (2 * wavelength);
      activation = t * t * (3 - 2 * t);
    }

    // Wave intensity for glow effect (peaks at wave front)
    const waveIntensity = wavePacket * Math.pow(decay, Math.abs(distFromFront));

    return { activation, waveIntensity };
  }

  /**
   * Draw glow effect - single layer to avoid multiple shadows
   */
  private applyGlow(intensity: number) {
    if (intensity < 0.01) {
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = "transparent";
      return;
    }
    const blur = GLOW_CONFIG.blur * (0.5 + 0.5 * intensity);
    const alpha = GLOW_CONFIG.intensity * intensity;
    this.ctx.shadowColor = `rgba(255, 255, 255, ${alpha})`;
    this.ctx.shadowBlur = blur;
  }

  private drawGlowAnimation(
    word: WordLayout,
    currentTime: number,
    elapsed: number,
    duration: number,
  ) {
    const chars = word.text.split("");
    if (chars.length === 0) {
      this.ctx.fillText(word.text, 0, 0);
      return;
    }

    const charCount = chars.length;

    // Calculate effective duration based on character count
    const baseTimePerChar =
      charCount <= 3 ? 0.28 : charCount <= 5 ? 0.22 : 0.16;
    const MAX_GLOW_DURATION = Math.max(1.2, charCount * baseTimePerChar);
    const effectiveDuration = Math.min(duration, MAX_GLOW_DURATION);
    const TRANSITION_DURATION = 0.35;

    const isAnimating = elapsed < effectiveDuration;
    const isTransitioning =
      elapsed >= effectiveDuration &&
      elapsed < effectiveDuration + TRANSITION_DURATION;

    // Calculate animation progress
    let effectiveP = 0;
    if (effectiveDuration > 0) {
      const rawP = Math.max(0, Math.min(1, elapsed / effectiveDuration));
      effectiveP = 1 - Math.pow(1 - rawP, 2.5);
    }
    if (!isAnimating && !isTransitioning) effectiveP = 1;

    // Calculate transition progress
    let transitionProgress = 0;
    if (isTransitioning) {
      transitionProgress = (elapsed - effectiveDuration) / TRANSITION_DURATION;
    }

    // Compute physics-based breathing envelope
    const breathEnvelope = this.computeBreathEnvelope(
      Math.min(1, effectiveP),
      isTransitioning,
      transitionProgress,
    );

    // Calculate breath lift using spring physics
    const baseLift =
      charCount <= 3
        ? BREATH_PHYSICS.liftAmountShort
        : charCount <= 5
          ? BREATH_PHYSICS.liftAmountMedium
          : BREATH_PHYSICS.liftAmountLong;
    const breathLift = baseLift * breathEnvelope;

    // Prepare character metrics
    if (!word.charWidths || !word.charOffsets) {
      const { charWidths, charOffsets } = this.computeCharMetrics(
        word.text,
        getFonts(this.isMobile).mainHeight,
      );
      word.charWidths = charWidths;
      word.charOffsets = charOffsets;
    }

    const { mainHeight } = getFonts(this.isMobile);

    // Draw base text layer (dim inactive layer) - NO glow here
    this.ctx.save();
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = "transparent";
    this.ctx.fillStyle = `rgba(255, 255, 255, ${0.30 + 0.15 * breathEnvelope})`;
    this.ctx.fillText(word.text, 0, 0);
    this.ctx.restore();

    // Draw individual characters with wave activation, glow, and scale
    chars.forEach((char, charIndex) => {
      const charX = word.charOffsets?.[charIndex] ?? 0;
      const charWidth = word.charWidths?.[charIndex] ?? this.ctx.measureText(char).width;

      // Compute wave-based activation
      const { activation, waveIntensity } = this.computeWaveActivation(
        charIndex,
        charCount,
        effectiveP,
      );

      // Combine activation with breathing envelope
      const combinedIntensity = Math.max(activation, waveIntensity * breathEnvelope);
      const brightness = 0.40 + combinedIntensity * 0.60;

      // Calculate per-character scale based on wave intensity
      const charScale = 1 + (GLOW_CONFIG.scaleBoost - 1) * waveIntensity * breathEnvelope;
      // Per-character lift (wave front lifts more)
      const charLift = breathLift * (0.6 + 0.4 * waveIntensity);

      this.ctx.save();

      // Transform from character center for scale
      const charCenterX = charX + charWidth / 2;
      const charCenterY = mainHeight / 2;

      this.ctx.translate(charCenterX, charCenterY);
      this.ctx.scale(charScale, charScale);
      this.ctx.translate(-charCenterX, -charCenterY - charLift);

      // Apply glow based on wave intensity (glow follows the wave front)
      const glowIntensity = waveIntensity * breathEnvelope;
      this.applyGlow(glowIntensity);

      // Draw character with appropriate brightness
      this.ctx.fillStyle =
        activation > 0.95
          ? "#ffffff"
          : `rgba(255, 255, 255, ${Math.min(1, brightness)})`;
      this.ctx.fillText(char, charX, 0);

      this.ctx.restore();
    });

    // Clean up shadow state
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = "transparent";
  }

  private drawStandardAnimation(
    word: WordLayout,
    progress: number,
    duration: number,
    mainHeight: number,
  ) {
    // Dim color must match the inactive word color (0.5 opacity)
    const dimColor = "rgba(255, 255, 255, 0.5)";

    // If animation is complete, draw the full word with subtle float
    if (progress >= 1) {
      this.ctx.save();
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText(word.text, 0, -1.5);
      this.ctx.restore();
      return;
    }

    const highlightX = word.width * progress;
    // Gradient transition zone - larger, extending more into dim area
    const transitionZone = Math.min(48, word.width * 0.35);

    // Subtle lift: smooth ease-out curve
    const liftAmount = -1.8;
    const liftProgress = 1 - Math.pow(1 - progress, 2);
    const lift = liftAmount * liftProgress;

    this.ctx.save();
    this.ctx.translate(0, lift);

    // Transition zone: starts slightly before current position, extends further into dim area
    const gradientStart = Math.max(0, highlightX - transitionZone * 0.3);
    const gradientEnd = Math.min(word.width, highlightX + transitionZone * 0.7);

    // Create gradient: white (left) -> dim (right)
    const revealGradient = this.ctx.createLinearGradient(
      gradientStart,
      0,
      gradientEnd,
      0,
    );
    revealGradient.addColorStop(0, "#ffffff");
    revealGradient.addColorStop(1, dimColor);

    // Draw fully highlighted portion (left of transition zone)
    if (gradientStart > 0) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(-2, -mainHeight * 0.3, gradientStart + 2, mainHeight * 1.5);
      this.ctx.clip();
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText(word.text, 0, 0);
      this.ctx.restore();
    }

    // Draw the gradient transition zone
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(gradientStart, -mainHeight * 0.3, gradientEnd - gradientStart, mainHeight * 1.5);
    this.ctx.clip();
    this.ctx.fillStyle = revealGradient;
    this.ctx.fillText(word.text, 0, 0);
    this.ctx.restore();

    // Draw dim portion (right of transition zone)
    if (gradientEnd < word.width) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(gradientEnd, -mainHeight * 0.3, word.width - gradientEnd + 2, mainHeight * 1.5);
      this.ctx.clip();
      this.ctx.fillStyle = dimColor;
      this.ctx.fillText(word.text, 0, 0);
      this.ctx.restore();
    }

    // Add subtle glow at the current playback position
    const cursorGlowIntensity = 0.2;
    this.ctx.save();
    this.ctx.shadowColor = `rgba(255, 255, 255, ${cursorGlowIntensity})`;
    this.ctx.shadowBlur = 6;
    this.ctx.beginPath();
    this.ctx.rect(highlightX - 3, 0, 6, mainHeight * 0.8);
    this.ctx.clip();
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    this.ctx.fillText(word.text, 0, 0);
    this.ctx.restore();

    // Clean up
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = "transparent";
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
   * Attempt to remove easeInOutCubic to clean up unused code.
   * The physics-based animations now use spring mechanics directly.
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
