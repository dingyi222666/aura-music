import { LyricLine as LyricLineType } from "@aura-music/core/types";
import { liftAt } from "@aura-music/core/springSystem";
import { ILyricLine } from "./ILyricLine";
import { LyricReveal } from "./LyricReveal";
import { haloOf } from "./GlyphCache";
import { endOf, BG_LEAD, BG_TRAIL } from "../parser/timeline";

const EMPHASIS_ENTRY_LEAD = 0.4;
const EMPHASIS_MIN_DURATION = 1.5;
const EMPHASIS_MAX_CHARS = 7;
const EMPHASIS_RISE = 0.05;
const EMPHASIS_SWAY_X = 0.03;
const EMPHASIS_SWAY_Y = 0.025;
const EMPHASIS_SCALE = 0.1;
const EMPHASIS_GLOW_GAIN = 1.2;
const EMPHASIS_GLOW_PAD = 0.9;
const EMPHASIS_TRAIL = 1.2;
const EMPHASIS_SPLIT = 0.5;
const BG_FONT_SCALE = 0.5;
export const BG_ACTIVE_ALPHA = 0.68;
export const BG_PAST_ALPHA = BG_ACTIVE_ALPHA;
const BG_FUTURE_ALPHA = 0.42;
const BG_IDLE_ALPHA = 0.24;
const BG_TRANS_ALPHA = 0.74;
const TRANS_ALPHA = 0.8;

const isMacPlatform = () => {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
};
// Time constant for easing a line's colour from lit (white) back to idle when
// it stops being active, so the brightness recovers instead of snapping.
const ACTIVE_FADE_TAU = 0.16;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOutPow = (value: number, power: number) =>
  1 - Math.pow(1 - clamp01(value), power);
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

type TimedWord = Pick<
  WordLayout,
  "text" | "startTime" | "endTime" | "isVerbatim"
>;

interface WrapAtom extends TimedWord {}

export interface WrappedWord extends WordLayout {
  visibleWidth: number;
  row: number;
}

export type RowMode = "future" | "past" | "active" | "mixed";

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

const HAN_REGEX = /\p{Script=Han}/u;
const HIRAGANA_REGEX = /\p{Script=Hiragana}/u;
const KATAKANA_REGEX = /\p{Script=Katakana}/u;
const HANGUL_REGEX = /\p{Script=Hangul}/u;

const detectLanguage = (text: string) => {
  if (HIRAGANA_REGEX.test(text) || KATAKANA_REGEX.test(text)) return "ja";
  if (HANGUL_REGEX.test(text)) return "ko";
  if (HAN_REGEX.test(text)) return "zh";
  return "en";
};

const segmenters = new Map<string, Intl.Segmenter>();
const segments = (text: string): string[] => {
  const locale = detectLanguage(text);
  if (typeof Intl.Segmenter === "undefined") return locale === "en" ? text.match(/\S+\s*|\s+/g) ?? [] : Array.from(text);
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  return [...segmenter.segment(text)].map((part) => part.segment);
};

const isCjk = (text: string) => {
  return (
    HAN_REGEX.test(text) ||
    HIRAGANA_REGEX.test(text) ||
    KATAKANA_REGEX.test(text) ||
    HANGUL_REGEX.test(text)
  );
};

const widthOf = (
  text: string,
  measure: (text: string) => number,
  baseSize: number,
) => {
  const width = measure(text);
  if (width > 0 || text.trim().length === 0) return width;
  return Array.from(text).length * (baseSize * 0.5);
};

const visibleWidthOf = (
  text: string,
  measure: (text: string) => number,
  baseSize: number,
) => {
  const visible = text.trimEnd();
  if (!visible) return 0;
  return widthOf(visible, measure, baseSize);
};

const rowTextOf = (text: string, lineX: number) => {
  if (lineX > 0) return text;
  return text.trimStart();
};

export const rowShiftOf = (
  align: "left" | "right" | undefined,
  rowWidth: number,
  blockWidth: number,
) => {
  if (align !== "right" || blockWidth <= rowWidth) return 0;
  return blockWidth - rowWidth;
};

export const alignWords = <T extends { x: number }>(
  words: T[],
  align: "left" | "right" | undefined,
  textWidth: number,
  blockWidth: number,
): T[] => {
  const shift = rowShiftOf(align, textWidth, blockWidth);
  if (shift <= 0) return words;
  return words.map((word) => ({
    ...word,
    x: word.x + shift,
  }));
};

export const shouldEmphasizeWord = (word: TimedWord) => {
  if (!word.isVerbatim) return false;

  const text = word.text.trim();
  if (!text) return false;

  const duration = word.endTime - word.startTime;
  if (duration < EMPHASIS_MIN_DURATION) return false;

  const charCount = Array.from(text).length;

  if (isCjk(text) && charCount > 1) return false;

  return (charCount > 1 || isCjk(text)) && charCount <= EMPHASIS_MAX_CHARS;
};

const isTrailingWord = (words: TimedWord[], index: number) => {
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].text.trim()) {
      return i === index;
    }
  }

  return index === words.length - 1;
};

const getEmphasisProfile = (
  word: TimedWord,
  words: TimedWord[],
  index: number,
) => {
  let span = Math.max(EMPHASIS_MIN_DURATION, word.endTime - word.startTime);
  let zoom = span / 2;
  zoom = zoom > 1 ? Math.sqrt(zoom) : zoom ** 3;
  zoom *= 0.6;

  let bloom = span / 3;
  bloom = bloom > 1 ? Math.sqrt(bloom) : bloom ** 3;
  bloom *= 0.5;

  if (isTrailingWord(words, index)) {
    zoom *= 1.6;
    bloom *= 1.5;
    span *= EMPHASIS_TRAIL;
  }

  const glyphs = Array.from(word.text.trim()).length;
  const anchorCount = isCjk(word.text) && glyphs > 1 ? 1 : Math.max(1, glyphs);

  return {
    span,
    zoom: Math.min(1.2, zoom),
    bloom: Math.min(0.8, bloom),
    anchorCount,
    stagger: span / 2.5 / anchorCount,
  };
};

export const getWordAnimationDuration = (
  word: TimedWord,
  words: TimedWord[],
  index: number,
) => {
  const duration = Math.max(
    EMPHASIS_MIN_DURATION,
    word.endTime - word.startTime,
  );
  if (!shouldEmphasizeWord(word)) return duration;

  const profile = getEmphasisProfile(word, words, index);
  const finalDelay = profile.stagger * Math.max(0, profile.anchorCount - 1);
  const glowTail = Math.max(
    profile.span,
    profile.span * 1.4 - EMPHASIS_ENTRY_LEAD,
  );
  return glowTail + finalDelay;
};

export const wordStateOf = (
  word: TimedWord,
  words: TimedWord[],
  index: number,
  currentTime: number,
): Exclude<RowMode, "mixed"> => {
  const elapsed = currentTime - word.startTime;
  const duration = getWordAnimationDuration(word, words, index);
  const lead = shouldEmphasizeWord(word) ? EMPHASIS_ENTRY_LEAD : 0;

  if (elapsed >= -lead && elapsed < duration) return "active";
  if (currentTime >= word.endTime) return "past";
  return "future";
};

export const rowModeOf = (words: TimedWord[], currentTime: number): RowMode => {
  let hasPast = false;
  let hasFuture = false;
  let hasActive = false;

  words.forEach((word, index) => {
    const mode = wordStateOf(word, words, index, currentTime);
    if (mode === "active") hasActive = true;
    else if (mode === "past") hasPast = true;
    else hasFuture = true;
  });

  if (hasActive) return "active";
  if (hasPast && hasFuture) return "mixed";
  if (hasPast) return "past";
  return "future";
};

export const wrapWords = ({
  atoms,
  maxWidth,
  paddingY,
  lineHeight,
  wrapLineGap,
  align,
  baseSize,
  measure,
}: {
  atoms: WrapAtom[];
  maxWidth: number;
  paddingY: number;
  lineHeight: number;
  wrapLineGap: number;
  align: "left" | "right" | undefined;
  baseSize: number;
  measure: (text: string) => number;
}) => {
  const words: WrappedWord[] = [];
  const rows: Array<{ start: number; end: number; width: number }> = [];
  let row = 0;
  let lineX = 0;
  let lineY = paddingY;
  let rowStart = 0;
  let rowWidth = 0;
  let textWidth = 0;

  const pushRow = (end: number) => {
    if (end <= rowStart) return;
    rows.push({
      start: rowStart,
      end,
      width: rowWidth,
    });
    textWidth = Math.max(textWidth, rowWidth);
    rowStart = end;
    rowWidth = 0;
  };

  atoms.forEach((atom) => {
    const rawVisibleWidth = visibleWidthOf(atom.text, measure, baseSize);

    if (lineX > 0 && lineX + rawVisibleWidth > maxWidth) {
      pushRow(words.length);
      row += 1;
      lineX = 0;
      lineY += lineHeight + wrapLineGap;
    }

    const text = rowTextOf(atom.text, lineX);
    if (!text) return;

    const width = widthOf(text, measure, baseSize);
    const visibleWidth = visibleWidthOf(text, measure, baseSize);

    const word: WrappedWord = {
      text,
      x: lineX,
      y: lineY,
      width,
      visibleWidth,
      startTime: atom.startTime,
      endTime: atom.endTime,
      isVerbatim: atom.isVerbatim,
      row,
    };

    words.push(word);
    lineX += width;
    rowWidth = Math.max(rowWidth, word.x + visibleWidth);
  });

  pushRow(words.length);

  rows.forEach((item) => {
    const shift = rowShiftOf(align, item.width, textWidth);
    if (shift <= 0) return;
    for (let i = item.start; i < item.end; i++) {
      words[i].x += shift;
    }
  });

  return {
    words,
    textWidth,
    height: lineY + lineHeight,
  };
};

export const pivotOf = (
  align: "left" | "right" | undefined,
  width: number,
  paddingX: number,
) => {
  return align === "right" ? Math.max(paddingX, width - paddingX) : paddingX;
};

export const centerOf = (
  align: "left" | "right" | undefined,
  width: number,
  textWidth: number,
  paddingX: number,
) => {
  if (textWidth <= 0) return pivotOf(align, width, paddingX);

  const start = align === "right" ? width - paddingX - textWidth : paddingX;
  return start + textWidth * 0.5;
};

const getFonts = (isMobile: boolean, scale: number = 1) => {
  const baseSize = (isMobile ? 34 : 36) * scale;
  const transSize = (isMobile ? 19 : 20) * scale;
  const mac = isMacPlatform();
  const mainFamily = mac
    ? `"SF Pro Display", "SF Pro", "PingFang SC", "Inter", sans-serif`
    : `"SF Pro Display", "PingFang SC","Inter", sans-serif`;
  const transFamily = mac
    ? `"SF Pro Text", "SF Pro", "PingFang SC", "Inter", sans-serif`
    : `"SF Pro Text", "PingFang SC", "Inter",sans-serif`;
  return {
    main: `800 ${baseSize}px ${mainFamily}`,
    trans: `600 ${transSize}px ${transFamily}`,
    mainHeight: baseSize,
    transHeight: transSize * 1.3,
  };
};

export class LyricLine implements ILyricLine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
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
  private liftCanvas: HTMLCanvasElement;
  private liftCtx: CanvasRenderingContext2D;
  private readonly reveal?: LyricReveal;
  // Absolute time when the last emphasized word's glow has fully settled, so the
  // line can keep rendering its glow recovery even after the next line starts.
  private emphasisEnd = -Infinity;
  // Eased 1→0 colour level: 1 while active/glowing, decays to 0 on deactivation
  // so the line's fill fades from white back to idle instead of snapping.
  private activeLevel = 0;
  private dt = 0;
  private rows: WordLayout[][] = [];
  private focus = 0;
  private readonly fonts: ReturnType<typeof getFonts>;

  private hasBackgroundWindow(time?: number) {
    return Boolean(this.lyricLine.isBackground && Number.isFinite(time) &&
      time! >= this.lyricLine.time - BG_LEAD && time! < endOf(this.lyricLine) + BG_TRAIL);
  }

  public update(time: number, dt: number) {
    this.dt = dt;
    this.reveal?.update(this.hasBackgroundWindow(time), dt);
  }

  constructor(line: LyricLineType, isMobile: boolean) {
    this.lyricLine = line;
    this.isMobile = isMobile;
    this.fonts = getFonts(isMobile, line.isBackground ? BG_FONT_SCALE : 1);
    this.pixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.canvas = document.createElement("canvas");
    this.liftCanvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    const liftCtx = this.liftCanvas.getContext("2d");
    if (!ctx || !liftCtx) {
      throw new Error("Could not get canvas context");
    }
    this.ctx = ctx;
    this.liftCtx = liftCtx;

    if (line.isBackground) {
      this.reveal = new LyricReveal();
    }
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

    const isBackground = Boolean(this.lyricLine.isBackground);
    let show = 1;

    if (isBackground) {
      show = (this.reveal?.height ?? 1);
      const shown = show > 0.001;
      if (!shown) {
        this.ctx.restore();
        return;
      }
    }

    // Background lines are "visually active" when currentTime is within their range
    const active =
      isActive || (isBackground && (currentTime >= this.lyricLine.time && currentTime < endOf(this.lyricLine)));

    this.ctx.font = mainFont;
    this.ctx.textBaseline = "top";

    // Compute translation for alignment (left or right)
    let translateX = paddingX;
    if (this.lyricLine.align === "right" && this.layout.textWidth > 0) {
      translateX = this.logicalWidth - paddingX - this.layout.textWidth;
    }
    this.ctx.translate(translateX, 0);

    if (isBackground) {
      this.ctx.globalAlpha = this.reveal!.opacity;
      this.ctx.beginPath();
      this.ctx.rect(-paddingX, 0, this.logicalWidth, this._height * show);
      this.ctx.clip();
    }

    if (hoverProgress > 0.001) {
      const hoverAlpha = isBackground ? 0.05 : 0.08;
      this.ctx.fillStyle = `rgba(255, 255, 255, ${hoverAlpha * hoverProgress})`;
      const bgWidth = Math.max(this.layout.textWidth + 32, 200);
      const bgScale = 0.98 + 0.02 * hoverProgress;
      const bgHeight = this.layout.height * bgScale;
      const bgY = (this.layout.height - bgHeight) / 2;
      this.ctx.beginPath();
      this.ctx.roundRect(-16, bgY, bgWidth, bgHeight, 16);
      this.ctx.fill();
    }

    if (active && !hasTimedWords) {
      this.ctx.fillStyle = isBackground
        ? `rgba(255, 255, 255, ${BG_ACTIVE_ALPHA})`
        : "#FFFFFF";
      this.layout.words.forEach((w) =>
        this.ctx.fillText(w.text, w.x, w.y),
      );
    } else if (active) {
      const FLOAT_UP = 2;
      this.rows.forEach((lineWords) => {
        const mode = rowModeOf(lineWords, currentTime);

        if (mode === "active" || mode === "mixed") {
          this.drawActiveWords(lineWords, currentTime);
        } else if (mode === "past") {
          this.ctx.fillStyle = isBackground
            ? `rgba(255, 255, 255, ${BG_PAST_ALPHA})`
            : "#FFFFFF";
          lineWords.forEach((w) =>
            this.ctx.fillText(w.text, w.x, w.y - FLOAT_UP),
          );
        } else {
          this.ctx.fillStyle = isBackground
            ? `rgba(255, 255, 255, ${BG_FUTURE_ALPHA})`
            : "rgba(255, 255, 255, 0.5)";
          lineWords.forEach((w) =>
            this.ctx.fillText(w.text, w.x, w.y),
          );
        }
      });
    } else {
      const idle = isBackground ? BG_IDLE_ALPHA : 0.3;
      // Fade from the lit (white) colour back to idle instead of snapping when
      // the line just went inactive.
      const baseOpacity = idle + (1 - idle) * clamp01(this.activeLevel);
      this.ctx.fillStyle = `rgba(255, 255, 255, ${baseOpacity})`;
      this.layout.words.forEach((w) =>
        this.ctx.fillText(w.text, w.x, w.y),
      );
    }

    const lastWordY =
      this.layout.words.length > 0
        ? this.layout.words[this.layout.words.length - 1].y
        : 0;

    const hasSecondary =
      this.layout.translationLines && this.layout.translationLines.length > 0;

    if (hasSecondary) {
      this.ctx.font = transFont;
      this.ctx.fillStyle = isBackground
        ? `rgba(255, 255, 255, ${BG_TRANS_ALPHA})`
        : `rgba(255, 255, 255, ${TRANS_ALPHA})`;
      const baseY = lastWordY + mainHeight * 1.2;
      let y = baseY;
      this.layout.translationLines!.forEach((lineText) => {
        const x =
          this.lyricLine.align === "right"
            ? Math.max(
                0,
                this.layout!.textWidth - this.ctx.measureText(lineText).width,
              )
            : 0;
        this.ctx.fillText(lineText, x, y);
        y += transHeight;
      });
    }

    this.ctx.restore();
  }

  private drawActiveWords(activeWords: WordLayout[], currentTime: number) {
    const liftWords: WordLayout[] = [];
    const emphasizedWords: Array<{ word: WordLayout; index: number }> = [];

    activeWords.forEach((word, index) => {
      const elapsed = currentTime - word.startTime;
      const animationDuration = getWordAnimationDuration(
        word,
        activeWords,
        index,
      );

      if (
        shouldEmphasizeWord(word) &&
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
    const { main, mainHeight } = this.fonts;
    const sidePad = 6;
    const topPad = Math.max(4, Math.ceil(mainHeight * 0.18));
    const bottomPad = Math.max(8, Math.ceil(mainHeight * 0.32));
    const logicalHeight = mainHeight + topPad + bottomPad;

    let maxW = 0;
    for (const w of words) if (w.width > maxW) maxW = w.width;
    const bufW = Math.ceil((maxW + sidePad * 2) * this.pixelRatio);
    const bufH = Math.ceil(logicalHeight * this.pixelRatio);
    if (this.liftCanvas.width < bufW || this.liftCanvas.height < bufH) {
      this.liftCanvas.width = Math.max(this.liftCanvas.width, bufW);
      this.liftCanvas.height = Math.max(this.liftCanvas.height, bufH);
    }

    for (const w of words) {
      const elapsed = currentTime - w.startTime;
      const duration = w.endTime - w.startTime;
      const safeDuration = Math.max(0.001, duration);

      const wordPxW = Math.ceil((w.width + sidePad * 2) * this.pixelRatio);
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
        this.liftCtx.fillStyle = this.lyricLine.isBackground
          ? `rgba(255, 255, 255, ${BG_PAST_ALPHA})`
          : "#FFFFFF";
      } else if (elapsed < 0) {
        this.liftCtx.fillStyle = this.lyricLine.isBackground
          ? `rgba(255, 255, 255, ${BG_FUTURE_ALPHA})`
          : "rgba(255, 255, 255, 0.5)";
      } else {
        const grad = this.liftCtx.createLinearGradient(
          sidePad,
          0,
          sidePad + w.width,
          0,
        );
        const p = elapsed / safeDuration;
        if (this.lyricLine.isBackground) {
          grad.addColorStop(
            Math.max(0, p),
            `rgba(255, 255, 255, ${BG_ACTIVE_ALPHA})`,
          );
          grad.addColorStop(
            Math.min(1, p + 0.15),
            `rgba(255, 255, 255, ${BG_FUTURE_ALPHA})`,
          );
        } else {
          grad.addColorStop(Math.max(0, p), "#FFFFFF");
          grad.addColorStop(Math.min(1, p + 0.15), "rgba(255, 255, 255, 0.5)");
        }
        this.liftCtx.fillStyle = grad;
      }

      this.liftCtx.fillText(w.text, sidePad, topPad);
      this.liftCtx.restore();

      const lift = 2 * liftAt(elapsed + 0.1);

      this.ctx.drawImage(
        this.liftCanvas,
        0,
        0,
        wordPxW,
        bufH,
        w.x - sidePad,
        w.y - lift - topPad,
        wordPxW / this.pixelRatio,
        logicalHeight,
      );
    }
  }

  private getSweepMix(positionX: number, wordWidth: number, progress: number) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    const fadeWidth = Math.max(12, wordWidth * 0.14);
    const sweepX = -fadeWidth * 0.75 + (wordWidth + fadeWidth * 1.5) * progress;
    return smoothStep(positionX - fadeWidth, positionX + fadeWidth, sweepX);
  }

  private fitBuffer(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ) {
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
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
    const sidePad = Math.max(16, Math.ceil(fontHeight * EMPHASIS_GLOW_PAD));
    const topPad = Math.max(10, Math.ceil(fontHeight * 0.58));
    const bottomPad = Math.max(14, Math.ceil(fontHeight * 0.9));
    const logicalWidth = glyphWidth + sidePad * 2;
    const logicalHeight = fontHeight + topPad + bottomPad;
    const physicalWidth = Math.ceil(logicalWidth * this.pixelRatio);
    const physicalHeight = Math.ceil(logicalHeight * this.pixelRatio);

    this.fitBuffer(this.liftCanvas, physicalWidth, physicalHeight);
    this.liftCtx.clearRect(0, 0, this.liftCanvas.width, this.liftCanvas.height);
    const glow = Math.min(1, glowLevel * EMPHASIS_GLOW_GAIN);
    if (enableGlow && glow > 0.001) {
      const halo = haloOf(glyph, font, fontHeight, glyphWidth, this.pixelRatio);
      this.liftCtx.save();
      this.liftCtx.globalAlpha = glow;
      this.liftCtx.drawImage(halo, 0, 0);
      this.liftCtx.restore();
    }

    this.liftCtx.save();
    this.liftCtx.scale(this.pixelRatio, this.pixelRatio);
    this.liftCtx.font = font;
    this.liftCtx.textBaseline = "top";
    this.liftCtx.globalCompositeOperation = "source-over";
    this.liftCtx.filter = "none";

    const gradient = this.liftCtx.createLinearGradient(
      sidePad,
      0,
      sidePad + glyphWidth,
      0,
    );
    const leftMix = this.getSweepMix(glyphStart, totalWidth, progress);
    const middleMix = this.getSweepMix(
      glyphStart + glyphWidth * 0.5,
      totalWidth,
      progress,
    );
    const rightMix = this.getSweepMix(
      glyphStart + glyphWidth,
      totalWidth,
      progress,
    );

    gradient.addColorStop(0, `rgba(255, 255, 255, ${0.5 + leftMix * 0.5})`);
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.5 + middleMix * 0.5})`);
    gradient.addColorStop(1, `rgba(255, 255, 255, ${0.5 + rightMix * 0.5})`);

    if (enableGlow && glow > 0.001) {
      this.liftCtx.shadowColor = `rgba(255, 255, 255, ${(glow * 0.9).toFixed(3)})`;
      this.liftCtx.shadowBlur = fontHeight * 0.08;
    } else {
      this.liftCtx.shadowColor = "transparent";
      this.liftCtx.shadowBlur = 0;
    }

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
    const { main, mainHeight } = this.fonts;
    const elapsed = currentTime - word.startTime;
    const duration = Math.max(
      EMPHASIS_MIN_DURATION,
      word.endTime - word.startTime,
    );
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

    const profile = getEmphasisProfile(word, words, index);
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
      const offsetX =
        -accent * EMPHASIS_SWAY_X * profile.zoom * centerBias * mainHeight;
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
      const glowLevel = accent * profile.bloom * (0.38 + glowMix * 0.62);

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

  public measure(containerWidth: number, suggestedTranslationWidth?: number) {
    const fontScale = this.lyricLine.isBackground ? BG_FONT_SCALE : 1;
    const { main, trans, mainHeight, transHeight } = this.fonts;

    const secondary = this.lyricLine.translation?.trim() || this.lyricLine.romanization?.trim();
    const baseSize = (this.isMobile ? 32 : 40) * fontScale;
    const top = this.lyricLine.isBackground
      ? this.isMobile
        ? 10
        : 12
      : secondary
        ? (this.isMobile ? 18 : 24)
        : (this.isMobile ? 14 : 18);
    const bottom = this.lyricLine.isBackground ? (this.isMobile ? 4 : 6) : top;
    const gap =
      mainHeight *
      (this.lyricLine.isBackground ? 0.18 : WRAPPED_LINE_GAP_RATIO);
    const paddingX = this.isMobile ? 24 : 56;
    // Duet lines get reduced max width (~65% of container)
    const duetRatio = this.lyricLine.isDuet ? (this.isMobile ? 0.88 : 0.78) : 1;
    const maxWidth = (containerWidth - paddingX * 2) * duetRatio;

    // Reset context font for measurement
    this.ctx.font = main;
    this.ctx.textBaseline = "top";

    // Measure main text
    const {
      words,
      textWidth,
      height: lineHeight,
    } = this.measureLineText({
      line: this.lyricLine,
      maxWidth,
      baseSize,
      mainHeight,
      paddingY: top,
      mainFont: main,
      wrapLineGap: gap,
    });

    let blockHeight = lineHeight;
    let translationLines: string[] | undefined;
    let effectiveTextWidth = textWidth;
    let translationWidth = 0;

    // Use suggested width if provided and larger than current text width, but not exceeding maxWidth
    // Otherwise use textWidth (if > 0) or maxWidth
    let baseWrapWidth = textWidth > 0 ? textWidth : maxWidth;
    if (
      suggestedTranslationWidth &&
      suggestedTranslationWidth > baseWrapWidth
    ) {
      baseWrapWidth = Math.min(suggestedTranslationWidth, maxWidth);
    }

    if (secondary) {
      const translationResult = this.measureTranslationLines({
        translation: secondary,
        maxWidth: baseWrapWidth,
        transHeight,
        transFont: trans,
      });
      translationLines = translationResult.lines;
      blockHeight += translationResult.height;
      translationWidth = Math.min(translationResult.width ?? 0, maxWidth);
      effectiveTextWidth = Math.max(effectiveTextWidth, translationWidth);
    }

    const placed = alignWords(
      words,
      this.lyricLine.align,
      textWidth,
      effectiveTextWidth,
    );

    blockHeight += bottom;
    this._height = blockHeight;

    this.layout = {
      y: 0, // Relative to this canvas
      height: blockHeight,
      words: placed,
      fullText: this.lyricLine.text,
      translation: this.lyricLine.translation,
      translationLines,
      textWidth: Math.max(effectiveTextWidth, textWidth),
      translationWidth,
    };

    const rows = new Map<number, WordLayout[]>();
    for (const word of placed) {
      const key = Math.round(word.y);
      const row = rows.get(key) ?? [];
      row.push(word);
      rows.set(key, row);
    }
    this.rows = [...rows.values()];
    this.focus = placed.length ? Math.min(...placed.map((word) => word.y)) + mainHeight * 0.5 : blockHeight * 0.5;
    this.emphasisEnd = this.computeEmphasisEnd();

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

  // Latest absolute time any emphasized word is still animating its glow.
  // Grouped by row to match drawFullLine's trailing-word detection exactly.
  private computeEmphasisEnd(): number {
    if (!this.layout) return -Infinity;

    let end = -Infinity;
    this.rows.forEach((rowWords) => {
      rowWords.forEach((word, index) => {
        if (!shouldEmphasizeWord(word)) return;
        const tail =
          word.startTime + getWordAnimationDuration(word, rowWords, index);
        if (tail > end) end = tail;
      });
    });
    return end;
  }

  public getEmphasisEnd() {
    return this.emphasisEnd;
  }

  public draw(
    currentTime: number,
    isActive: boolean,
    isHovered: boolean,
    hoverProgress: number = isHovered ? 1 : 0,
  ) {
    if (!this.layout) return;

    // Ease the colour level: snap up while active/glowing, decay once it ends so
    // the line fades white→idle. Updated before any early-out so the timing and
    // redraw gating stay consistent.
    if (isActive) {
      this.activeLevel = 1;
    } else if (this.activeLevel > 0.001) {
      this.activeLevel *= Math.exp(-this.dt / ACTIVE_FADE_TAU);
      if (this.activeLevel <= 0.001) this.activeLevel = 0;
    }

    const isBackground = Boolean(this.lyricLine.isBackground);
    const bgShow = isBackground ? (this.reveal?.height ?? 1) : 0;
    const bgVisible = isBackground && bgShow > 0.001;

    // When hoverProgress is animating (not 0 or 1), we must redraw
    const hoverAnimating = hoverProgress > 0.001 && hoverProgress < 0.999;

    const stateUnchanged =
      !isActive &&
      !bgVisible &&
      !this.isDirty &&
      !this.lastIsActive &&
      this.lastIsHovered === isHovered &&
      !hoverAnimating &&
      this.activeLevel <= 0.001;
    if (stateUnchanged) return;

    const { main, trans, mainHeight, transHeight } = this.fonts;

    const paddingX = this.isMobile ? 24 : 56;
    const hasTimedWords = this.layout.words.some((w) => w.isVerbatim);

    const stateChanged =
      this.lastIsActive !== isActive || this.lastIsHovered !== isHovered;

    const shouldAnimate = isActive || bgVisible;

    if (
      shouldAnimate &&
      !hasTimedWords &&
      !isBackground &&
      !this.isDirty &&
      !stateChanged &&
      !hoverAnimating
    ) {
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
    return this._height * (this.reveal?.height ?? 1);
  }

  public getFocusOffset() { return this.focus; }

  public getLogicalWidth() {
    return this.logicalWidth;
  }

  public getLogicalHeight() {
    return this.logicalHeight;
  }

  public getScalePivot() {
    const paddingX = this.isMobile ? 24 : 56;
    return pivotOf(this.lyricLine.align, this.logicalWidth, paddingX);
  }

  public getPressPivot() {
    const paddingX = this.isMobile ? 24 : 56;
    return centerOf(
      this.lyricLine.align,
      this.logicalWidth,
      this.layout?.textWidth || 0,
      paddingX,
    );
  }

  public isInterlude() {
    return false;
  }

  public isBackgroundLine() {
    return Boolean(this.lyricLine.isBackground);
  }

  // --- Helpers ---

  private measureLineText({
    line,
    maxWidth,
    baseSize,
    mainHeight,
    paddingY,
    mainFont,
    wrapLineGap,
  }: {
    line: LyricLineType;
    maxWidth: number;
    baseSize: number;
    mainHeight: number;
    paddingY: number;
    mainFont: string;
    wrapLineGap: number;
  }) {
    this.ctx.font = mainFont;

    const atoms: WrapAtom[] = line.words?.length
      ? line.words.map((word) => ({ ...word, isVerbatim: true }))
      : segments(line.text).map((text) => ({ text, startTime: line.time, endTime: Infinity, isVerbatim: false }));

    const layout = wrapWords({
      atoms,
      maxWidth,
      paddingY,
      lineHeight: mainHeight,
      wrapLineGap,
      align: line.align,
      baseSize,
      measure: (text: string) => this.ctx.measureText(text).width,
    });

    const words = layout.words.map((word) => {
      const { charWidths, charOffsets } = this.computeCharMetrics(
        word.text,
        baseSize,
      );

      return {
        text: word.text,
        x: word.x,
        y: word.y,
        width: word.width,
        startTime: word.startTime,
        endTime: word.endTime,
        isVerbatim: word.isVerbatim,
        charWidths,
        charOffsets,
      };
    });

    return {
      words,
      textWidth: layout.textWidth,
      height: layout.height,
    };
  }

  private measureTranslationLines({
    translation,
    maxWidth,
    transHeight,
    transFont,
  }: {
    translation: string;
    maxWidth: number;
    transHeight: number;
    transFont: string;
  }) {
    this.ctx.font = transFont;
    const atoms = segments(translation);
    const lines: string[] = [];

    let currentTransLine = "";
    let currentTransWidth = 0;
    let maxLineWidth = 0;

    atoms.forEach((atomText) => {

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
