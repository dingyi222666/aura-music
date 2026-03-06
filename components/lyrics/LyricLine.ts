import { LyricLine as LyricLineType } from "../../types";
import { ILyricLine } from "./ILyricLine";

const EMPHASIS_ENTRY_LEAD = 0.4;
const EMPHASIS_MIN_DURATION = 1;
const EMPHASIS_MAX_CHARS = 7;
const EMPHASIS_RISE = 0.05;
const EMPHASIS_SWAY_X = 0.03;
const EMPHASIS_SWAY_Y = 0.025;
const EMPHASIS_SCALE = 0.1;
const EMPHASIS_GLOW = 0.3;
const EMPHASIS_TRAIL = 1.2;
const EMPHASIS_SPLIT = 0.5;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothStep = (start: number, end: number, value: number) => {
  if (start === end) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};
const remap = (start: number, end: number) => (value: number) =>
  clamp01((value - start) / (end - start || 1));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);
const beforeSplit = remap(0, EMPHASIS_SPLIT);
const afterSplit = remap(EMPHASIS_SPLIT, 1);

const cubicA = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
const cubicB = (p1: number, p2: number) => 3 * p2 - 6 * p1;
const cubicC = (p1: number) => 3 * p1;

const sampleCurve = (t: number, p1: number, p2: number) =>
  ((cubicA(p1, p2) * t + cubicB(p1, p2)) * t + cubicC(p1)) * t;

const sampleSlope = (t: number, p1: number, p2: number) =>
  3 * cubicA(p1, p2) * t * t + 2 * cubicB(p1, p2) * t + cubicC(p1);

const makeCurve = (x1: number, y1: number, x2: number, y2: number) => {
  return (value: number) => {
    if (value <= 0 || value >= 1) return clamp01(value);

    let t = value;
    for (let i = 0; i < 8; i++) {
      const slope = sampleSlope(t, x1, x2);
      if (Math.abs(slope) < 1e-6) break;
      const delta = sampleCurve(t, x1, x2) - value;
      t -= delta / slope;
    }

    t = clamp01(t);
    let low = 0;
    let high = 1;
    for (let i = 0; i < 10; i++) {
      const current = sampleCurve(t, x1, x2);
      if (Math.abs(current - value) < 1e-6) break;
      if (current > value) high = t;
      else low = t;
      t = (low + high) * 0.5;
    }

    return clamp01(sampleCurve(t, y1, y2));
  };
};

const curveRise = makeCurve(0.2, 0.4, 0.58, 1);
const curveFall = makeCurve(0.3, 0, 0.58, 1);
const emphasisShape = (value: number) =>
  value < EMPHASIS_SPLIT
    ? curveRise(beforeSplit(value))
    : 1 - curveFall(afterSplit(value));

export interface WordLayout {
  text: string;
  x: number;
  y: number;
  width: number;
  startTime: number;
  endTime: number;
  isVerbatim: boolean;
  charWidths?: number[];
  charOffsets?: number[];
}

const WRAPPED_LINE_GAP_RATIO = 0.25;

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
  private liftCanvas: OffscreenCanvas | HTMLCanvasElement;
  private liftCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(line: LyricLineType, index: number, isMobile: boolean) {
    this.lyricLine = line;
    this.isMobile = isMobile;
    this.pixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.canvas = document.createElement("canvas");
    this.liftCanvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    const liftCtx = this.liftCanvas.getContext("2d");
    if (!ctx || !liftCtx)
      throw new Error("Could not get canvas context");
    this.ctx = ctx as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
    this.liftCtx = liftCtx as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  private drawFullLine({
    currentTime,
    isActive,
    isHovered,
    hoverProgress,
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
    hoverProgress: number;
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

    if (hoverProgress > 0.001) {
      this.ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * hoverProgress})`;
      const bgWidth = Math.max(this.layout.textWidth + 32, 200);
      const bgScale = 0.98 + 0.02 * hoverProgress;
      const bgHeight = this.layout.height * bgScale;
      const bgY = (this.layout.height - bgHeight) / 2;
      this.roundRect(-16, bgY, bgWidth, bgHeight, 16);
      this.ctx.fill();
    }

    const wordCount = this.layout.words.length;
    let fastWordCount = 0;
    for (const w of this.layout.words) {
      if (w.endTime - w.startTime < 0.2) fastWordCount++;
    }

    const isFastLine = wordCount > 0 && fastWordCount / wordCount > 0.9;

    if (isActive && (!hasTimedWords || isFastLine)) {
      this.ctx.fillStyle = "#FFFFFF";
      this.layout.words.forEach((w) => this.ctx.fillText(w.text, w.x, w.y));
    } else if (isActive) {
      const FLOAT_UP = 0.05 * mainHeight;
      const lineGroups = new Map<number, WordLayout[]>();

      this.layout.words.forEach((w) => {
        const key = Math.round(w.y);
        if (!lineGroups.has(key)) lineGroups.set(key, []);
        lineGroups.get(key)!.push(w);
      });

      lineGroups.forEach((lineWords) => {
        const needsAnimation = lineWords.some((w, index) => {
          const elapsed = currentTime - w.startTime;
          const animDuration = this.getWordAnimationDuration(w, lineWords, index);
          const lead = this.shouldEmphasizeWord(w) ? EMPHASIS_ENTRY_LEAD : 0;
          return elapsed >= -lead && elapsed < animDuration;
        });

        const allPast = lineWords.every((w) => currentTime >= w.endTime);

        if (needsAnimation) {
          this.drawActiveWords(lineWords, currentTime);
        } else if (allPast) {
          this.ctx.fillStyle = "#FFFFFF";
          lineWords.forEach((w) => this.ctx.fillText(w.text, w.x, w.y - FLOAT_UP));
        } else {
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          lineWords.forEach((w) => this.ctx.fillText(w.text, w.x, w.y));
        }
      });
    } else {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      this.layout.words.forEach((w) => this.ctx.fillText(w.text, w.x, w.y));
    }

    if (
      this.layout.translationLines &&
      this.layout.translationLines.length > 0
    ) {
      this.ctx.font = transFont;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
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

  private drawActiveWords(activeWords: WordLayout[], currentTime: number) {
    const liftWords: WordLayout[] = [];
    const emphasizedWords: Array<{ word: WordLayout; index: number }> = [];

    activeWords.forEach((word, index) => {
      const elapsed = currentTime - word.startTime;
      const animationDuration = this.getWordAnimationDuration(
        word,
        activeWords,
        index,
      );

      if (
        this.shouldEmphasizeWord(word) &&
        elapsed >= -EMPHASIS_ENTRY_LEAD &&
        elapsed < animationDuration
      ) {
        emphasizedWords.push({ word, index });
      } else {
        liftWords.push(word);
      }
    });

    if (liftWords.length > 0) {
      this.drawLiftedLine(liftWords, currentTime);
    }

    for (const { word, index } of emphasizedWords) {
      this.drawEmphasizedWord(word, activeWords, index, currentTime);
    }
  }

  private drawLiftedLine(words: WordLayout[], currentTime: number) {
    const { main, mainHeight } = getFonts(this.isMobile);
    const FLOAT_UP = 0.05 * mainHeight;
    const PAD = 6;

    let maxW = 0;
    for (const w of words) if (w.width > maxW) maxW = w.width;
    const bufW = Math.ceil((maxW + PAD * 2) * this.pixelRatio);
    const bufH = Math.ceil(mainHeight * 1.5 * this.pixelRatio);
    if (this.liftCanvas.width < bufW || this.liftCanvas.height < bufH) {
      this.liftCanvas.width = Math.max(this.liftCanvas.width, bufW);
      this.liftCanvas.height = Math.max(this.liftCanvas.height, bufH);
    }

    for (const w of words) {
      const elapsed = currentTime - w.startTime;
      const duration = w.endTime - w.startTime;
      const safeDuration = Math.max(0.001, duration);

      const wordPxW = Math.ceil((w.width + PAD * 2) * this.pixelRatio);
      this.liftCtx.clearRect(
        0,
        0,
        this.liftCanvas.width,
        this.liftCanvas.height,
      );
      this.liftCtx.save();
      this.liftCtx.scale(this.pixelRatio, this.pixelRatio);
      this.liftCtx.font = main;
      this.liftCtx.textBaseline = "top";

      if (elapsed >= duration) {
        this.liftCtx.fillStyle = "#FFFFFF";
      } else if (elapsed < 0) {
        this.liftCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
      } else {
        const grad = this.liftCtx.createLinearGradient(
          PAD,
          0,
          PAD + w.width,
          0,
        );
        const p = elapsed / safeDuration;
        grad.addColorStop(Math.max(0, p), "#FFFFFF");
        grad.addColorStop(Math.min(1, p + 0.15), "rgba(255, 255, 255, 0.5)");
        this.liftCtx.fillStyle = grad;
      }

      this.liftCtx.fillText(w.text, PAD, 0);
      this.liftCtx.restore();

      let lift = 0;
      if (elapsed >= 0) {
        const floatDur = Math.max(1.0, safeDuration);
        const t = Math.min(1, elapsed / floatDur);
        lift = FLOAT_UP * t * (2 - t);
      }

      this.ctx.drawImage(
        this.liftCanvas,
        0,
        0,
        wordPxW,
        bufH,
        w.x - PAD,
        w.y - lift,
        wordPxW / this.pixelRatio,
        mainHeight * 1.5,
      );
    }
  }

  private shouldEmphasizeWord(word: WordLayout) {
    if (!word.isVerbatim) return false;

    const text = word.text.trim();
    if (!text) return false;

    const duration = word.endTime - word.startTime;
    if (duration < EMPHASIS_MIN_DURATION) return false;

    if (detectLanguage(text) === "zh") {
      return true;
    }

    const charCount = Array.from(text).length;
    return charCount > 1 && charCount <= EMPHASIS_MAX_CHARS;
  }

  private isTrailingWord(words: WordLayout[], index: number) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].text.trim()) {
        return i === index;
      }
    }

    return index === words.length - 1;
  }

  private getWordAnimationDuration(
    word: WordLayout,
    words: WordLayout[],
    index: number,
  ) {
    const duration = Math.max(EMPHASIS_MIN_DURATION, word.endTime - word.startTime);
    if (!this.shouldEmphasizeWord(word)) return duration;

    const profile = this.getEmphasisProfile(word, words, index);
    const finalDelay = profile.stagger * Math.max(0, profile.anchorCount - 1);
    const glowTail = Math.max(profile.span, profile.span * 1.4 - EMPHASIS_ENTRY_LEAD);
    return glowTail + finalDelay;
  }

  private getEmphasisProfile(word: WordLayout, words: WordLayout[], index: number) {
    let span = Math.max(EMPHASIS_MIN_DURATION, word.endTime - word.startTime);
    let zoom = span / 2;
    zoom = zoom > 1 ? Math.sqrt(zoom) : zoom ** 3;
    zoom *= 0.6;

    let bloom = span / 3;
    bloom = bloom > 1 ? Math.sqrt(bloom) : bloom ** 3;
    bloom *= 0.5;

    if (this.isTrailingWord(words, index)) {
      zoom *= 1.6;
      bloom *= 1.5;
      span *= EMPHASIS_TRAIL;
    }

    const anchorCount = Math.max(1, Array.from(word.text.trim()).length);

    return {
      span,
      zoom: Math.min(1.2, zoom),
      bloom: Math.min(0.8, bloom),
      anchorCount,
      stagger: span / 2.5 / anchorCount,
    };
  }

  private getSweepMix(positionX: number, wordWidth: number, progress: number) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    const fadeWidth = Math.max(12, wordWidth * 0.14);
    const sweepX = -fadeWidth * 0.75 + (wordWidth + fadeWidth * 1.5) * progress;
    return smoothStep(positionX - fadeWidth, positionX + fadeWidth, sweepX);
  }

  private drawBufferedEmphasisGlyph(
    glyph: string,
    font: string,
    fontHeight: number,
    glyphStart: number,
    glyphWidth: number,
    totalWidth: number,
    progress: number,
    glowLevel: number,
    targetX: number,
    targetY: number,
    scale: number,
    enableGlow: boolean,
  ) {
    const sidePad = Math.max(6, Math.ceil(fontHeight * 0.35));
    const topPad = Math.max(4, Math.ceil(fontHeight * 0.28));
    const bottomPad = Math.max(8, Math.ceil(fontHeight * 0.6));
    const logicalWidth = glyphWidth + sidePad * 2;
    const logicalHeight = fontHeight + topPad + bottomPad;
    const physicalWidth = Math.ceil(logicalWidth * this.pixelRatio);
    const physicalHeight = Math.ceil(logicalHeight * this.pixelRatio);

    if (
      this.liftCanvas.width < physicalWidth ||
      this.liftCanvas.height < physicalHeight
    ) {
      this.liftCanvas.width = Math.max(this.liftCanvas.width, physicalWidth);
      this.liftCanvas.height = Math.max(this.liftCanvas.height, physicalHeight);
    }

    this.liftCtx.clearRect(0, 0, this.liftCanvas.width, this.liftCanvas.height);
    this.liftCtx.save();
    this.liftCtx.scale(this.pixelRatio, this.pixelRatio);
    this.liftCtx.font = font;
    this.liftCtx.textBaseline = "top";

    if (enableGlow && glowLevel > 0.001) {
      this.liftCtx.shadowColor = `rgba(255, 255, 255, ${glowLevel * EMPHASIS_GLOW})`;
      this.liftCtx.shadowBlur = fontHeight * 0.22 * glowLevel;
    } else {
      this.liftCtx.shadowColor = "transparent";
      this.liftCtx.shadowBlur = 0;
    }

    const gradient = this.liftCtx.createLinearGradient(
      sidePad,
      0,
      sidePad + glyphWidth,
      0,
    );
    const leftMix = this.getSweepMix(glyphStart, totalWidth, progress);
    const middleMix = this.getSweepMix(glyphStart + glyphWidth * 0.5, totalWidth, progress);
    const rightMix = this.getSweepMix(glyphStart + glyphWidth, totalWidth, progress);

    gradient.addColorStop(0, `rgba(255, 255, 255, ${0.5 + leftMix * 0.5})`);
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.5 + middleMix * 0.5})`);
    gradient.addColorStop(1, `rgba(255, 255, 255, ${0.5 + rightMix * 0.5})`);

    this.liftCtx.fillStyle = gradient;
    this.liftCtx.fillText(glyph, sidePad, topPad);
    this.liftCtx.restore();

    this.ctx.drawImage(
      this.liftCanvas,
      0,
      0,
      physicalWidth,
      physicalHeight,
      targetX - sidePad * scale,
      targetY - topPad * scale,
      logicalWidth * scale,
      logicalHeight * scale,
    );
  }

  private drawEmphasizedWord(
    word: WordLayout,
    words: WordLayout[],
    index: number,
    currentTime: number,
  ) {
    const { main, mainHeight } = getFonts(this.isMobile);
    const elapsed = currentTime - word.startTime;
    const duration = Math.max(EMPHASIS_MIN_DURATION, word.endTime - word.startTime);
    const progress = clamp01(elapsed / duration);
    const chars = Array.from(word.text);

    if (!chars.length) return;

    if (!word.charWidths || !word.charOffsets) {
      const { charWidths, charOffsets } = this.computeCharMetrics(
        word.text,
        mainHeight,
      );
      word.charWidths = charWidths;
      word.charOffsets = charOffsets;
    }

    const profile = this.getEmphasisProfile(word, words, index);
    const punctuationTest =
      /^[^\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;

    chars.forEach((char, charIndex) => {
      const originalWidth = word.charWidths?.[charIndex] ?? 0;
      const originalOffset = word.charOffsets?.[charIndex] ?? 0;
      if (originalWidth <= 0) return;

      const charDelay = profile.stagger * charIndex;
      const motionPhase = clamp01((elapsed - charDelay) / profile.span);
      const floatPhase = clamp01(
        (elapsed + EMPHASIS_ENTRY_LEAD - charDelay) / (profile.span * 1.4),
      );
      const settle = easeOutCubic(progress);
      const accent = emphasisShape(motionPhase);
      const floatArc = Math.sin(floatPhase * Math.PI);
      const centerBias = chars.length * 0.5 - charIndex;
      const baseLift = mainHeight * EMPHASIS_RISE * settle;
      const accentLift = mainHeight * EMPHASIS_RISE * floatArc;
      const offsetX = -accent * EMPHASIS_SWAY_X * profile.zoom * centerBias * mainHeight;
      const offsetY = -accent * EMPHASIS_SWAY_Y * profile.zoom * mainHeight;
      const scale = 1 + accent * EMPHASIS_SCALE * profile.zoom;
      const drawX = originalOffset + offsetX;
      const drawY = -(baseLift + accentLift) + offsetY;
      const centerX = drawX + originalWidth * 0.5;
      const centerY = drawY + mainHeight * 0.5;
      const isPunctuation = punctuationTest.test(char);
      const glowMix = this.getSweepMix(
        originalOffset + originalWidth * 0.5,
        word.width,
        progress,
      );
      const glowLevel = accent * profile.bloom * glowMix;

      this.drawBufferedEmphasisGlyph(
        char,
        main,
        mainHeight,
        originalOffset,
        originalWidth,
        word.width,
        progress,
        glowLevel,
        word.x + centerX - (originalWidth * scale) / 2,
        word.y + centerY - (mainHeight * scale) / 2,
        scale,
        !isPunctuation,
      );
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

  public draw(currentTime: number, isActive: boolean, isHovered: boolean, hoverProgress: number = isHovered ? 1 : 0) {
    if (!this.layout) return;

    // When hoverProgress is animating (not 0 or 1), we must redraw
    const hoverAnimating = hoverProgress > 0.001 && hoverProgress < 0.999;

    const stateUnchanged =
      !isActive &&
      !this.isDirty &&
      !this.lastIsActive &&
      this.lastIsHovered === isHovered &&
      !hoverAnimating;
    if (stateUnchanged) return;

    const { main, trans, mainHeight, transHeight } = getFonts(this.isMobile);

    const paddingX = this.isMobile ? 24 : 56;
    const hasTimedWords = this.layout.words.some((w) => w.isVerbatim);

    const stateChanged =
      this.lastIsActive !== isActive || this.lastIsHovered !== isHovered;

    if (isActive && !hasTimedWords && !this.isDirty && !stateChanged && !hoverAnimating) {
      return;
    }

    this.drawFullLine({
      currentTime,
      isActive,
      isHovered,
      hoverProgress,
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
      isVerbatim: boolean,
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
    let maxLineWidth = 0;

    atoms.forEach((atom: string, index: number) => {
      const atomText = isEn && index < atoms.length - 1 ? atom + " " : atom;

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
    const chars = Array.from(text);
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
