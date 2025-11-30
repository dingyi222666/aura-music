import { LyricLine, isMetadataLine } from "./types";
import { LRC_LINE_REGEX, parseTimeTag, normalizeTimeKey } from "./utils";

/**
 * NetEase YRC format regex (for translation parsing)
 */
const YRC_LINE_REGEX = /^\[(\d+),(\d+)\](.*)/;
const YRC_WORD_REGEX = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;

/**
 * Build a map of translations indexed by normalized time.
 * Supports multiple formats:
 * - Standard LRC: [mm:ss.xx]text
 * - NetEase YRC: [startMs,duration](wordTiming)text
 * - NetEase JSON: {"t":0,"c":[{"tx":"text"}]}
 */
export const buildTranslationMap = (
  translationContent?: string,
): Map<number, string[]> => {
  const map = new Map<number, string[]>();
  if (!translationContent) return map;

  const lines = translationContent.split("\n");

  const addEntry = (time: number, text: string) => {
    const cleaned = text.trim();
    if (!cleaned || isMetadataLine(cleaned)) return;

    const key = normalizeTimeKey(time);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(cleaned);
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    // Try NetEase JSON format
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const json = JSON.parse(line);
        if (json.c && Array.isArray(json.c)) {
          const text = json.c.map((item: { tx: string }) => item.tx).join("");
          const time = (json.t || 0) / 1000;
          addEntry(time, text);
          return;
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Try NetEase YRC format
    const yrcMatch = line.match(YRC_LINE_REGEX);
    if (yrcMatch) {
      const startTimeMs = parseInt(yrcMatch[1], 10);
      const content = yrcMatch[3];
      const matches = [...content.matchAll(YRC_WORD_REGEX)];
      let fullText = "";
      if (matches.length > 0) {
        fullText = matches.map((m) => m[4]).join("");
      } else {
        fullText = content;
      }
      addEntry(startTimeMs / 1000, fullText);
      return;
    }

    // Try standard LRC format
    const lrcMatch = line.match(LRC_LINE_REGEX);
    if (lrcMatch) {
      const time = parseTimeTag(`${lrcMatch[1]}:${lrcMatch[2]}.${lrcMatch[3]}`);
      const text = lrcMatch[4].trim();
      addEntry(time, text);
    }
  });

  return map;
};

/**
 * Merge translation content into parsed lyrics.
 * Matches translations to lyrics lines by timestamp,
 * with tolerance for timing drifts.
 */
export const mergeTranslations = (
  lines: LyricLine[],
  translationContent?: string,
): LyricLine[] => {
  if (!translationContent || translationContent.trim().length === 0) {
    return lines;
  }

  const translationMap = buildTranslationMap(translationContent);
  if (translationMap.size === 0) {
    return lines;
  }

  /**
   * Take translation for a line, consuming from the map.
   * Uses exact match first, then falls back to closest match within tolerance.
   */
  const takeTranslationForLine = (line: LyricLine): string | undefined => {
    const key = normalizeTimeKey(line.time);

    // Try exact match
    const direct = translationMap.get(key);
    if (direct && direct.length > 0) {
      const value = direct.shift();
      if (direct.length === 0) {
        translationMap.delete(key);
      }
      return value;
    }

    // Fall back to closest match within tolerance
    let fallbackKey: number | null = null;
    let minDiff = Infinity;
    // Use larger tolerance for precise timing (YRC), smaller for standard LRC
    const tolerance = line.isPreciseTiming ? 3.0 : 0.25;

    translationMap.forEach((values, mapKey) => {
      if (values.length === 0) return;
      const diff = Math.abs(mapKey - key);
      if (diff <= tolerance && diff < minDiff) {
        minDiff = diff;
        fallbackKey = mapKey;
      }
    });

    if (fallbackKey !== null) {
      const list = translationMap.get(fallbackKey);
      if (list && list.length > 0) {
        const value = list.shift();
        if (list.length === 0) {
          translationMap.delete(fallbackKey);
        }
        return value;
      }
    }

    return undefined;
  };

  return lines.map((line) => {
    const external = takeTranslationForLine(line);
    const trimmedExternal = external?.trim();

    // Use external translation if available, otherwise keep existing
    const finalTranslation =
      trimmedExternal && trimmedExternal.length > 0
        ? trimmedExternal
        : line.translation;

    // Skip update if no change
    if (finalTranslation === line.translation) {
      return line;
    }

    return {
      ...line,
      translation: finalTranslation,
    };
  });
};
