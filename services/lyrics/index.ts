/**
 * Lyrics Parsing Module
 *
 * This module provides unified lyrics parsing for various formats:
 * - Standard LRC format with optional word-by-word timing
 * - NetEase Cloud Music YRC format
 * - Translation merging from separate translation content
 *
 * Key features:
 * - Auto-detection of lyrics format
 * - Word-level timing support (enhanced LRC and YRC)
 * - Punctuation merging for proper display
 * - Translation line matching and merging
 */

import { LyricLine } from "./types";
import { parseLrc } from "./lrc";
import { parseNeteaseLyrics, isNeteaseFormat } from "./netease";
import { mergeTranslations } from "./translation";
import { processLyricsDurations } from "./utils";

// Re-export types
export type { LyricLine, LyricWord } from "./types";

// Re-export individual parsers for direct use
export { parseLrc } from "./lrc";
export { parseNeteaseLyrics, isNeteaseFormat } from "./netease";
export { mergeTranslations, buildTranslationMap } from "./translation";
export { processLyricsDurations } from "./utils";

/**
 * Parse lyrics content with automatic format detection.
 *
 * @param content - Main lyrics content (LRC or YRC format)
 * @param translationContent - Optional translation lyrics content
 * @returns Parsed lyrics with translations merged
 *
 * @example
 * // Parse standard LRC
 * const lyrics = parseLyrics("[00:12.34]Hello world");
 *
 * @example
 * // Parse with translation
 * const lyrics = parseLyrics(lrcContent, translationLrcContent);
 *
 * @example
 * // Parse NetEase YRC format
 * const lyrics = parseLyrics("[12340,2500](12340,500,0)Hello");
 */
export const parseLyrics = (
  content: string,
  translationContent?: string,
): LyricLine[] => {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Detect format and parse accordingly
  let lines: LyricLine[];

  if (isNeteaseFormat(content)) {
    lines = parseNeteaseLyrics(content);
  } else {
    lines = parseLrc(content);
  }

  // Merge translations if provided
  if (translationContent && translationContent.trim().length > 0) {
    lines = mergeTranslations(lines, translationContent);
  }

  // Process durations for lookahead
  return processLyricsDurations(lines);
};

/**
 * Utility to merge raw lyrics strings.
 * Simple concatenation with newline separator.
 *
 * @deprecated Use parseLyrics with translationContent parameter instead
 */
export const mergeLyrics = (original: string, translation: string): string => {
  return original + "\n" + translation;
};
