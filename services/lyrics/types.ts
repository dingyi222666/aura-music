import { LyricLine, LyricWord } from "../../types";

// Re-export types for convenience
export type { LyricLine, LyricWord };

/**
 * Internal representation of a parsed lyric line during processing.
 * Contains additional metadata used for sorting and merging.
 */
export interface ParsedLineData {
  time: number;
  text: string;
  words: LyricWord[];
  tagCount: number; // Priority indicator: higher = more precise timing data
  originalIndex: number; // For stable sorting
  isMetadata?: boolean; // Whether this line is metadata (artist info, etc.)
}

/**
 * Result from parsing a single lyrics format (before translation merge).
 */
export interface ParsedLyricsResult {
  lines: LyricLine[];
  hasWordTiming: boolean; // Whether the lyrics contain word-level timing
}

/**
 * Metadata indicators for filtering out non-lyric content.
 */
export const METADATA_INDICATORS = [
  "by:", // Common LRC metadata
  "offset:",
];

/**
 * Chinese metadata indicators (NetEase style).
 */
export const CHINESE_METADATA_INDICATORS = [
  "歌词贡献者",
  "翻译贡献者",
  "作词",
  "作曲",
  "编曲",
  "制作",
  "词曲",
];

/**
 * Check if the given text is a metadata line.
 */
export const isMetadataLine = (text: string): boolean => {
  if (!text) return false;

  // Check for NetEase JSON metadata lines
  if (text.trim().startsWith("{") && text.trim().endsWith("}")) return true;

  const normalized = text.replace(/\s+/g, "").toLowerCase();

  // Check English metadata
  if (
    METADATA_INDICATORS.some((indicator) =>
      normalized.includes(indicator.toLowerCase()),
    )
  ) {
    return true;
  }

  // Check Chinese metadata
  return CHINESE_METADATA_INDICATORS.some((indicator) =>
    normalized.includes(indicator),
  );
};
