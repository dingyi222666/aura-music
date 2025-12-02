/**
 * Shared utilities (minimal - most moved to parser.ts).
 */

export { INTERLUDE_TEXT } from "./parser";
export { parseTime as parseTimeTag } from "./parser";
export { createWord, createLine } from "./parser";
export { isPunctuation as isPunctuationOnly } from "./parser";
export { normalizeText } from "./parser";

// Legacy regex for backward compatibility
export const LRC_LINE_REGEX = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

// Re-export for backward compatibility
export { addDurations as processLyricsDurations } from "./parser";
export { mergePunctuation as mergePunctuationWords } from "./parser";
export { hasContent as hasMeaningfulContent } from "./parser";

/**
 * Normalize time key for map lookups.
 */
export const normalizeTimeKey = (time: number): number => {
  return Math.round(time * 100) / 100;
};

/**
 * Get display text from parsed line data.
 * @deprecated - use line.text directly
 */
export const getEntryDisplayText = (entry: { text: string; words?: { text: string }[] }): string => {
  if (entry.text?.trim()) return entry.text.trim();
  if (entry.words?.length) {
    return entry.words.map(w => w.text).join("").trim();
  }
  return "";
};

/**
 * Fix word end times (now handled during parsing).
 * @deprecated - handled inline during parse
 */
export const fixWordEndTimes = (): void => {
  // No-op: handled during parsing
};
