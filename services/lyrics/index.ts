/**
 * Lyrics Parsing Module
 *
 * Unified lyrics parsing for various formats:
 * - Standard LRC with optional word-by-word timing
 * - Netease YRC format with word timing
 * - Translation merging
 *
 * Architecture:
 * - Tokenizer-based parsing (not regex)
 * - Single-pass processing
 * - Inline duplicate handling
 * - Automatic interlude insertion
 */

import { LyricLine } from "./types";
import { parseLrc } from "./lrc";
import { parseNeteaseLyrics, isNeteaseFormat } from "./netease";
import { mergeTranslations } from "./translation";

// Re-export types
export type { LyricLine, LyricWord } from "./types";

// Re-export parsers  
export { parseLrc } from "./lrc";
export { parseNeteaseLyrics, isNeteaseFormat } from "./netease";
export { mergeTranslations, buildTranslationMap } from "./translation";

// Re-export utilities for backward compatibility
export { INTERLUDE_TEXT } from "./parser";
export { parseTime as parseTimeTag } from "./parser";

/**
 * Parse lyrics with automatic format detection.
 *
 * @param content - Main lyrics content (LRC or YRC)
 * @param translationContent - Optional translation content (LRC format)
 * @param options - Optional YRC content for dual-format parsing
 * @returns Parsed lyrics with translations and interludes
 *
 * @example
 * // Standard LRC
 * const lyrics = parseLyrics("[00:12.34]Hello world");
 *
 * @example
 * // With translation
 * const lyrics = parseLyrics(lrcContent, translationContent);
 *
 * @example
 * // Netease YRC with LRC base
 * const lyrics = parseLyrics(lrcContent, translation, { yrcContent });
 */
export const parseLyrics = (
  content: string,
  translationContent?: string,
  options?: { yrcContent?: string }
): LyricLine[] => {
  if (!content?.trim()) return [];

  // Detect format and parse
  let lines: LyricLine[];

  if (options?.yrcContent) {
    // Use LRC as base, enrich with YRC word timing
    lines = parseNeteaseLyrics(options.yrcContent, content);
  } else if (isNeteaseFormat(content)) {
    // Pure YRC format
    lines = parseNeteaseLyrics(content);
  } else {
    // Standard LRC format
    lines = parseLrc(content);
  }

  // Merge translations if provided
  if (translationContent?.trim()) {
    lines = mergeTranslations(lines, translationContent);
  }

  return lines;
};

/**
 * Merge raw lyrics strings.
 * @deprecated Use parseLyrics with translationContent parameter
 */
export const mergeLyrics = (original: string, translation: string): string => {
  return `${original}\n${translation}`;
};
