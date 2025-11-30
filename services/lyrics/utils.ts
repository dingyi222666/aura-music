import { LyricLine, LyricWord, ParsedLineData } from "./types";

/**
 * Standard LRC time tag regex: [mm:ss.xx] or [mm:ss.xxx]
 */
export const LRC_LINE_REGEX = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

/**
 * Parse a time tag string like "01:23.45" or "01:23.456" to seconds.
 */
export const parseTimeTag = (timeStr: string): number => {
  const match = timeStr.match(/(\d{2}):(\d{2})\.(\d{2,3})/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const msStr = match[3];
  const ms = parseInt(msStr, 10);

  // .xx is 10ms units (centiseconds), .xxx is 1ms units (milliseconds)
  const msValue = msStr.length === 3 ? ms / 1000 : ms / 100;

  return minutes * 60 + seconds + msValue;
};

/**
 * Normalize time to a consistent precision for map key usage.
 */
export const normalizeTimeKey = (time: number): number => {
  return Math.round(time * 100) / 100;
};

/**
 * Get the display text from a parsed line, preferring words if available.
 */
export const getEntryDisplayText = (entry: ParsedLineData): string => {
  if (entry.text && entry.text.trim().length > 0) {
    return entry.text.trim();
  }
  if (entry.words && entry.words.length > 0) {
    return entry.words
      .map((w) => w.text)
      .join("")
      .trim();
  }
  return "";
};

/**
 * Check if a parsed line has meaningful content.
 */
export const hasMeaningfulContent = (entry: ParsedLineData): boolean => {
  return getEntryDisplayText(entry).length > 0;
};

/**
 * Create a LyricWord object.
 */
export const createWord = (
  text: string,
  startTime: number,
  endTime: number,
): LyricWord => ({
  text,
  startTime,
  endTime,
});

/**
 * Create a LyricLine object.
 */
export const createLine = (
  time: number,
  text: string,
  options?: {
    words?: LyricWord[];
    translation?: string;
    isPreciseTiming?: boolean;
    isInterlude?: boolean;
  },
): LyricLine => ({
  time,
  text,
  ...(options?.words && options.words.length > 0 && { words: options.words }),
  ...(options?.translation && { translation: options.translation }),
  ...(options?.isPreciseTiming && { isPreciseTiming: true }),
  ...(options?.isInterlude && { isInterlude: true }),
});

/**
 * Fix word end times based on next line's start time.
 * Only applies to lines without precise timing (non-YRC).
 */
export const fixWordEndTimes = (lines: LyricLine[]): void => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip if we have precise timing from YRC
    if (line.isPreciseTiming) continue;

    const nextLineTime = lines[i + 1]?.time ?? line.time + 5;

    if (line.words && line.words.length > 0) {
      // Fix the last word's end time
      const lastWord = line.words[line.words.length - 1];
      const duration = nextLineTime - lastWord.startTime;
      lastWord.endTime = lastWord.startTime + Math.min(duration, 5);
    }
  }
};

/**
 * Check if text contains only punctuation (no letters/digits/CJK characters).
 */
export const isPunctuationOnly = (text: string): boolean => {
  if (!text || text.length === 0) return true;
  // Match anything that is NOT: letters, digits, CJK, Kana
  const nonPunctRegex = /[\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  return !nonPunctRegex.test(text);
};

/**
 * Merge punctuation-only words with the previous word.
 * e.g., ["Hello", ",", " ", "World", "!"] -> ["Hello, ", "World!"]
 *
 * This ensures punctuation is displayed and highlighted together
 * with the preceding word, rather than as separate elements.
 */
export const mergePunctuationWords = (words: LyricWord[]): LyricWord[] => {
  if (words.length <= 1) return words;

  const result: LyricWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const current = words[i];

    // If this is punctuation-only and we have a previous word, merge into it
    if (isPunctuationOnly(current.text) && result.length > 0) {
      const prev = result[result.length - 1];
      prev.text += current.text;
      // Extend the previous word's end time to include the punctuation
      prev.endTime = current.endTime;
    } else {
      result.push({ ...current });
    }
  }

  return result;
};

/**
 * Process lyrics to fill in "_endTime" for lines to aid lookahead.
 */
export const processLyricsDurations = (lyrics: LyricLine[]): LyricLine[] => {
  lyrics = insertInterludes(lyrics);
  return lyrics.map((line, i) => {
    const nextLine = lyrics[i + 1];
    let endTime = nextLine ? nextLine.time : line.time + 5;

    // If YRC data exists, the last word's end time is a good indicator
    if (line.words && line.words.length > 0) {
      const lastWord = line.words[line.words.length - 1];
      if (lastWord.endTime > line.time) {
        endTime = lastWord.endTime;
      }
    }

    // Ensure duration isn't 0 or negative
    if (endTime <= line.time) endTime = line.time + 3;

    return { ...line, _endTime: endTime } as LyricLine;
  });
};

/**
 * Insert "..." interlude lines for long instrumental gaps.
 */
export const insertInterludes = (lyrics: LyricLine[]): LyricLine[] => {
  console.log(lyrics)

  if (lyrics.length === 0) return lyrics;

  const result: LyricLine[] = [];
  const GAP_THRESHOLD = 10; // Seconds - insert interlude for gaps > 10s between lyrics
  const OPENING_THRESHOLD = 3; // Seconds - insert for opening instrumental > 3s
  const INTERLUDE_TEXT = "...";

  // Check start of song - insert if first lyric is after 3s (opening instrumental)
  if (lyrics[0].time > OPENING_THRESHOLD) {
    result.push(createLine(lyrics[0].time / 100, INTERLUDE_TEXT, { isInterlude: true }));
  }

  for (let i = 0; i < lyrics.length; i++) {
    const currentLine = lyrics[i];
    result.push(currentLine);

    // Don't insert after the last line
    if (i === lyrics.length - 1) continue;

    const nextLine = lyrics[i + 1];

    // Calculate gap
    // Use _endTime if available, otherwise estimate
    const currentEndTime = (currentLine as any)._endTime || (currentLine.time + 5);
    const gap = nextLine.time - currentEndTime;

    // If gap is large, insert interlude
    // But also check simply time difference between start times if _endTime is not reliable
    const timeDiff = nextLine.time - currentLine.time;

    // We want to insert if there is a significant empty space.
    // If the previous line is very long, we shouldn't insert.
    // Let's assume a max reasonable line duration of 10s for the check if _endTime isn't set.
    const effectiveEndTime = (currentLine as any)._endTime || Math.min(currentLine.time + 10, nextLine.time);

    if (nextLine.time - effectiveEndTime > GAP_THRESHOLD) {
      // Insert at the middle of the gap, or shortly after the current line ends
      const interludeTime = effectiveEndTime + 2.0;
      if (interludeTime < nextLine.time - 2.0) {
        result.push(createLine(interludeTime, INTERLUDE_TEXT, { isInterlude: true }));
      }
    }
  }

  return result;
};
