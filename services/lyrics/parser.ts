/**
 * Core parser infrastructure for lyrics formats.
 *
 * This module provides tokenization and parsing utilities for:
 * - Standard LRC format with word-level timing
 * - Netease YRC format with word-level timing
 */

import { LyricLine, LyricWord } from "./types";

export const INTERLUDE_TEXT = "...";

// Configuration constants
export const GAP_THRESHOLD = 10; // Seconds gap to insert interlude
export const PRELUDE_THRESHOLD = 3; // Seconds before first lyric to insert prelude
export const DEFAULT_DURATION = 4; // Default line duration estimate
export const MIN_INTERLUDE_DURATION = 10; // Minimum silence to render interlude (for gap-based insertion)
export const MIN_SOURCE_INTERLUDE_DURATION = 3; // Minimum duration for source-data interludes (empty lines)

/**
 * Parse time tag string (mm:ss, mm:ss.xx, mm:ss.xxx, mm:ss:xx, mm:ss:xxx)
 * to seconds.
 */
export const parseTime = (timeStr: string): number => {
  const match = timeStr.match(/^(\d{2}):(\d{2})(?:[\.:](\d{2,3}))?$/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const msStr = match[3];
  const ms = msStr ? parseInt(msStr, 10) : 0;

  const msValue = !msStr ? 0 : msStr.length === 3 ? ms / 1000 : ms / 100;

  return minutes * 60 + seconds + msValue;
};

/**
 * Check if text contains only punctuation.
 */
export const isPunctuation = (text: string): boolean => {
  if (!text) return true;
  return !/[\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
    text,
  );
};

/**
 * Create a word object.
 */
export const createWord = (
  text: string,
  start: number,
  end: number,
): LyricWord => ({
  text,
  startTime: start,
  endTime: end,
});

/**
 * Create a line object.
 */
export const createLine = (
  time: number,
  text: string,
  options?: {
    endTime?: number;
    words?: LyricWord[];
    translation?: string;
    isPreciseTiming?: boolean;
    isInterlude?: boolean;
  },
): LyricLine => ({
  time,
  text,
  ...(options?.endTime &&
    options.endTime > time && { endTime: options.endTime }),
  ...(options?.words?.length && { words: options.words }),
  ...(options?.translation && { translation: options.translation }),
  ...(options?.isPreciseTiming && { isPreciseTiming: true }),
  ...(options?.isInterlude && { isInterlude: true }),
});

/**
 * Normalize text for comparison (remove punctuation, spaces, case).
 */
export const normalizeText = (text?: string): string => {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/['`´‘’＇]/g, "")
    .replace(/\s+/g, "")
    .replace(/[.,!?，。！？:;""\[\]()\-_/\\…（）【】「」]/g, "");
};

/**
 * Merge punctuation-only words with previous word.
 */
export const mergePunctuation = (words: LyricWord[]): LyricWord[] => {
  if (words.length <= 1) return words;

  const result: LyricWord[] = [];
  let leadingBuffer: LyricWord | null = null;

  for (const word of words) {
    if (isPunctuation(word.text)) {
      if (result.length > 0) {
        const prev = result[result.length - 1];
        prev.text += word.text;
        prev.endTime = word.endTime;
      } else if (leadingBuffer) {
        leadingBuffer = {
          ...leadingBuffer,
          text: `${leadingBuffer.text}${word.text}`,
          endTime: word.endTime,
        };
      } else {
        leadingBuffer = { ...word };
      }
      continue;
    }

    let mergedWord = { ...word };
    if (leadingBuffer) {
      mergedWord = {
        ...mergedWord,
        text: `${leadingBuffer.text}${mergedWord.text}`,
        startTime: Math.min(leadingBuffer.startTime, mergedWord.startTime),
      };
      leadingBuffer = null;
    }

    result.push(mergedWord);
  }

  if (leadingBuffer) {
    result.push(leadingBuffer);
  }

  return result;
};

/**
 * Remove source-data interludes that are too short (gap to next content line < threshold).
 * This filters out empty lines from source data that were marked as interludes
 * but have very short gaps (e.g. < 3s).
 * Gap-based interludes inserted by insertInterludes are not affected since they
 * already pass the GAP_THRESHOLD check.
 */
export const filterShortInterludes = (lines: LyricLine[]): LyricLine[] => {
  return lines.filter((line, i) => {
    if (!isInterlude(line)) return true;
    if (line.endTime && line.endTime > line.time) return true;

    // Find next content line
    let nextContentTime: number | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      if (hasContent(lines[j])) {
        nextContentTime = lines[j].time;
        break;
      }
    }

    const duration =
      nextContentTime === undefined ? Infinity : nextContentTime - line.time;

    // If no next content line, keep the interlude (end of song)
    if (!Number.isFinite(duration)) return true;

    return duration >= MIN_SOURCE_INTERLUDE_DURATION;
  });
};

/**
 * Calculate line end time based on explicit endTime, words, or estimate.
 */
export const calculateEndTime = (
  line: LyricLine,
  nextTime: number = Infinity,
): number => {
  // Explicit end time from source data (e.g. TTML <p> end) is authoritative
  if (line.endTime && line.endTime > line.time) {
    return line.endTime;
  }

  if (line.words?.length) {
    const lastWord = line.words[line.words.length - 1];
    if (lastWord.endTime > line.time) {
      if (line.isPreciseTiming) {
        return lastWord.endTime;
      }
      return Math.min(lastWord.endTime, nextTime);
    }
  }

  return Math.min(line.time + DEFAULT_DURATION, nextTime);
};

/**
 * Add duration metadata to lines for lookahead.
 */
export const addDurations = (lines: LyricLine[]): LyricLine[] => {
  return lines.map((line, i) => {
    const nextContentLine = lines.slice(i + 1).find(hasContent);
    const nextTime =
      nextContentLine?.time ?? lines[i + 1]?.time ?? line.time + 5;
    let endTime = calculateEndTime(line, nextTime);

    if (isInterlude(line)) {
      const explicit = Boolean(line.endTime && line.endTime > line.time);

      if (!explicit && nextContentLine && nextContentLine.time > line.time) {
        endTime = nextContentLine.time;
      } else if (!explicit && !nextContentLine) {
        endTime = Math.max(endTime, line.time + MIN_INTERLUDE_DURATION);
      }
    }

    if (endTime <= line.time) {
      endTime = line.time + 3;
    }

    return { ...line, endTime: endTime } as LyricLine;
  });
};

/**
 * Check if line is an interlude.
 */
export function isInterlude(line?: LyricLine): boolean {
  if (!line) return false;
  return Boolean(line.isInterlude || line.text?.trim() === INTERLUDE_TEXT);
}

/**
 * Check if line has lyric content (not interlude or empty).
 */
export function hasContent(line: LyricLine): boolean {
  if (isInterlude(line)) return false;
  if (line.isBackground) return false;
  return Boolean(line.text?.trim());
}

/**
 * Insert interlude at specified time.
 */
export const createInterlude = (time: number, endTime?: number): LyricLine => {
  return createLine(Math.max(time, 0), INTERLUDE_TEXT, {
    ...(endTime && endTime > time ? { endTime } : {}),
    isInterlude: true,
  });
};

/**
 * Insert interludes for gaps between lyrics.
 * Checks for prelude (before first lyric) and gaps between consecutive lyrics.
 */
export const insertInterludes = (lines: LyricLine[]): LyricLine[] => {
  if (lines.length === 0) return lines;

  const result: LyricLine[] = [];
  const firstLyric = lines.find(hasContent);

  // Add prelude if first lyric starts late
  const hasPrelude = lines.some(
    (line) =>
      isInterlude(line) &&
      firstLyric &&
      line.time >= 0 &&
      line.time < firstLyric.time,
  );

  if (firstLyric && firstLyric.time > PRELUDE_THRESHOLD && !hasPrelude) {
    result.push(createInterlude(0, firstLyric.time));
  }

  // Process each line and check for gaps
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    result.push(current);

    if (!hasContent(current)) continue;

    // Find next lyric line
    let nextLyric: LyricLine | undefined;
    let hasInterludeBetween = false;

    for (let j = i + 1; j < lines.length; j++) {
      if (hasContent(lines[j])) {
        nextLyric = lines[j];
        break;
      }
      if (isInterlude(lines[j])) {
        hasInterludeBetween = true;
      }
    }

    if (!nextLyric || hasInterludeBetween) continue;

    // Check gap and insert interlude if needed
    const estimatedEnd = calculateEndTime(current, nextLyric.time);
    const gap = nextLyric.time - estimatedEnd;

    if (gap > GAP_THRESHOLD && gap >= MIN_INTERLUDE_DURATION) {
      result.push(createInterlude(estimatedEnd, nextLyric.time));
    }
  }

  return result;
};
