/**
 * Translation merging for lyrics.
 * 
 * Simplified approach: translations are just standard LRC format.
 * Parse them with the LRC parser and map by timestamp.
 */

import { LyricLine } from "./types";
import { parseLrc } from "./lrc";

/**
 * Normalize time to consistent precision for lookups.
 */
const normalizeTime = (time: number): number => {
  return Math.round(time * 100) / 100;
};

/**
 * Build translation map from LRC content.
 * Translations follow standard LRC format, so we can reuse the parser.
 */
export const buildTranslationMap = (content?: string): Map<number, string> => {
  if (!content?.trim()) return new Map();

  // Parse as standard LRC
  const lines = parseLrc(content);
  const map = new Map<number, string>();

  for (const line of lines) {
    if (line.isInterlude || !line.text?.trim()) continue;

    const key = normalizeTime(line.time);
    const existing = map.get(key);

    if (existing) {
      map.set(key, `${existing}\n${line.text.trim()}`);
    } else {
      map.set(key, line.text.trim());
    }
  }

  return map;
};

/**
 * Find translation for a line with tolerance.
 */
const findTranslation = (
  map: Map<number, string>,
  line: LyricLine
): string | undefined => {
  const key = normalizeTime(line.time);

  // Try exact match first
  const exact = map.get(key);
  if (exact) {
    map.delete(key);
    return exact;
  }

  // Try nearby matches with directional tolerance
  const isPrecise = Boolean(line.isPreciseTiming);
  const forwardTolerance = isPrecise ? 1.0 : 0.35;
  const backwardTolerance = isPrecise ? 0.35 : 0.2;

  let bestKey: number | null = null;
  let bestDiff = Infinity;

  for (const [mapKey, value] of map.entries()) {
    const delta = mapKey - key;

    // Check tolerance direction
    if (delta >= 0 && delta <= forwardTolerance) {
      // Forward match
      if (delta < bestDiff) {
        bestDiff = delta;
        bestKey = mapKey;
      }
    } else if (delta < 0 && -delta <= backwardTolerance) {
      // Backward match
      if (-delta < bestDiff) {
        bestDiff = -delta;
        bestKey = mapKey;
      }
    }
  }

  if (bestKey !== null) {
    const value = map.get(bestKey)!;
    map.delete(bestKey);
    return value;
  }

  return undefined;
};

/**
 * Merge translations into lyrics.
 * 
 * Translations are parsed as standard LRC and matched by timestamp.
 * Matching uses tolerance to handle timing drift.
 */
export const mergeTranslations = (
  lines: LyricLine[],
  translationContent?: string
): LyricLine[] => {
  if (!translationContent?.trim()) return lines;

  const map = buildTranslationMap(translationContent);
  if (map.size === 0) return lines;

  return lines.map(line => {
    if (line.isInterlude) return line;

    const translation = findTranslation(map, line);

    if (!translation) return line;

    const trimmed = translation.trim();
    if (!trimmed) return line;

    // Don't override existing translation
    if (line.translation) return line;

    return {
      ...line,
      translation: trimmed,
    };
  });
};
