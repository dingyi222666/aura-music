import { LyricLine, LyricWord } from "@aura-music/core/types";

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
  "制谱",
  "制作",
  "指挥",
  "乐队",
  "人声",
  "合唱",
  "录音棚",
  "录音师",
  "音频编辑",
  "混音",
  "母带",
  "出品",
  "词曲",
];

const ENGLISH_CREDIT_INDICATORS = [
  "lyricist",
  "composer",
  "arranger",
  "music copyist",
  "conductor",
  "orchestra",
  "voice",
  "vocals",
  "tin whistle",
  "irish flute",
  "nyckelharpa",
  "hurdy-gurdy",
  "lute",
  "kantele",
  "cimbalom",
  "choir",
  "recording studio",
  "recording engineer",
  "editing engineer",
  "mixing engineer",
  "mastering engineer",
  "produced by",
  "producer",
  "lyrics by",
  "music by",
];

const compact = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

/**
 * Check if the given text is a metadata line.
 */
export const isMetadataLine = (text: string): boolean => {
  if (!text) return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  // Check for NetEase JSON metadata lines
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;

  const normalized = compact(trimmed);

  // Check English metadata
  if (
    METADATA_INDICATORS.some((indicator) =>
      normalized.includes(compact(indicator)),
    )
  ) {
    return true;
  }

  // Credits usually follow "<role>: <name>"; support bilingual role labels.
  const separatorIndex = trimmed.search(/[:：]/);
  if (separatorIndex > 0) {
    const label = compact(trimmed.slice(0, separatorIndex));

    if (
      CHINESE_METADATA_INDICATORS.some((indicator) => label.includes(indicator)) ||
      ENGLISH_CREDIT_INDICATORS.some((indicator) =>
        label.includes(compact(indicator)),
      )
    ) {
      return true;
    }
  }

  // Legacy fallback: metadata snippets without ':'
  return CHINESE_METADATA_INDICATORS.some((indicator) => normalized.includes(indicator));
};
