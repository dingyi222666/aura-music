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
import { mergeRomanization, mergeTranslations } from "./translation";
import { parseTtml, isTtmlFormat } from "./ttml";

// Re-export types
export type { LyricLine, LyricWord } from "./types";

// Re-export parsers
export { parseLrc } from "./lrc";
export { parseNeteaseLyrics, isNeteaseFormat } from "./netease";
export { parseTtml, isTtmlFormat } from "./ttml";
export {
  mergeTranslations,
  mergeRomanization,
  buildTranslationMap,
} from "./translation";

// Re-export utilities for backward compatibility
export { INTERLUDE_TEXT } from "./parser";
export { parseTime as parseTimeTag, filterShortInterludes } from "./parser";

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
type ParseLyricsOptions = {
  yrcContent?: string;
  romanContent?: string;
};

interface NeteaseBlob {
  lyric?: string;
}

interface NeteasePayload {
  lrc?: NeteaseBlob;
  yrc?: NeteaseBlob;
  tlyric?: NeteaseBlob;
  ytlrc?: NeteaseBlob;
  romalrc?: NeteaseBlob;
}

const unwrapPayload = (
  content: string,
  translationContent?: string,
  options?: ParseLyricsOptions,
): {
  content: string;
  translationContent?: string;
  options?: ParseLyricsOptions;
} => {
  const trimmed = content?.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return { content, translationContent, options };
  }

  try {
    const json = JSON.parse(trimmed) as NeteasePayload;
    const lrc = json.lrc?.lyric?.trim();
    const yrc = json.yrc?.lyric?.trim();
    const tlyric = json.tlyric?.lyric?.trim();
    const ytlrc = json.ytlrc?.lyric?.trim();
    const roman = json.romalrc?.lyric?.trim();
    const main = lrc || yrc;

    if (!main && !tlyric && !roman) {
      return { content, translationContent, options };
    }

    return {
      content: main ?? "",
      translationContent: translationContent?.trim()
        ? translationContent
        : tlyric || ytlrc,
      options: {
        ...options,
        ...(options?.yrcContent?.trim() ? {} : lrc && yrc ? { yrcContent: yrc } : {}),
        ...(options?.romanContent?.trim() ? {} : roman ? { romanContent: roman } : {}),
      },
    };
  } catch {
    return { content, translationContent, options };
  }
};

export const parseLyrics = (
  content: string,
  translationContent?: string,
  options?: ParseLyricsOptions,
): LyricLine[] => {
  const input = unwrapPayload(content, translationContent, options);
  if (!input.content?.trim()) return [];

  // Detect format and parse
  let lines: LyricLine[];

  if (isTtmlFormat(input.content)) {
    lines = parseTtml(input.content);
  } else if (input.options?.yrcContent) {
    // Use LRC as base, enrich with YRC word timing
    lines = parseNeteaseLyrics(input.options.yrcContent, input.content);
  } else if (isNeteaseFormat(input.content)) {
    // Pure YRC format
    lines = parseNeteaseLyrics(input.content);
  } else {
    // Standard LRC format
    lines = parseLrc(input.content);
  }

  // Merge translations if provided
  if (input.translationContent?.trim()) {
    lines = mergeTranslations(lines, input.translationContent);
  }

  if (input.options?.romanContent?.trim()) {
    lines = mergeRomanization(lines, input.options.romanContent);
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
