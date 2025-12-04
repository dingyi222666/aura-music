/**
 * Netease YRC format parser.
 * 
 * Supports:
 * - YRC format: [startMs,duration](wordStartMs,wordDuration,flag)word
 * - JSON metadata: {"t":0,"c":[{"tx":"text"}]}
 * - Fallback LRC: [mm:ss.xx]text
 * 
 * Features:
 * - Single-pass YRC parsing
 * - Word timing enrichment for LRC content
 * - Inline duplicate detection
 * - Automatic word duration fixing
 */

import { LyricLine, LyricWord, isMetadataLine } from "./types";
import { parseLrc } from "./lrc";
import {
  createWord,
  createLine,
  mergePunctuation,
  normalizeText,
  insertInterludes,
  addDurations,
  INTERLUDE_TEXT,
} from "./parser";

const MAX_WORD_DURATION = 10.0; // Max duration per word in seconds

/**
 * Token types for Netease YRC parsing.
 */
type NeteaseToken =
  | { type: "yrc"; time: number; duration: number; words: LyricWord[]; text: string }
  | { type: "json"; time: number; text: string }
  | { type: "lrc"; time: number; text: string };

/**
 * Parse JSON metadata line.
 */
const parseJsonLine = (line: string): NeteaseToken | null => {
  try {
    const json = JSON.parse(line);
    if (json.c && Array.isArray(json.c)) {
      const text = json.c.map((item: { tx: string }) => item.tx).join("");
      return {
        type: "json",
        time: (json.t || 0) / 1000,
        text,
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
};

/**
 * Parse YRC line with word timing.
 */
const parseYrcLine = (line: string): NeteaseToken | null => {
  const match = line.match(/^\[(\d+),(\d+)\](.*)/);
  if (!match) return null;

  const startTime = parseInt(match[1], 10) / 1000;
  const duration = parseInt(match[2], 10) / 1000;
  const content = match[3];

  const words: LyricWord[] = [];
  let text = "";

  // Parse word timing: (startMs,durationMs,flag)wordText
  const wordRegex = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;
  const matches = [...content.matchAll(wordRegex)];

  if (matches.length > 0) {
    for (const m of matches) {
      const wordStart = parseInt(m[1], 10) / 1000;
      const wordDuration = parseInt(m[2], 10) / 1000;
      const wordText = m[4];

      text += wordText;
      words.push(createWord(wordText, wordStart, wordStart + wordDuration));
    }
  } else {
    text = content;
  }

  return {
    type: "yrc",
    time: startTime,
    duration,
    words: mergePunctuation(words),
    text,
  };
};

/**
 * Tokenize Netease content into structured tokens.
 */
const tokenizeNetease = (content: string): NeteaseToken[] => {
  const lines = content.split("\n");
  const tokens: NeteaseToken[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try JSON format
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const jsonToken = parseJsonLine(trimmed);
      if (jsonToken) {
        tokens.push(jsonToken);
        continue;
      }
    }

    // Try YRC format
    const yrcToken = parseYrcLine(trimmed);
    if (yrcToken) {
      tokens.push(yrcToken);
      continue;
    }

    // Fallback to LRC format
    const lrcMatch = trimmed.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (lrcMatch) {
      const minutes = parseInt(lrcMatch[1], 10);
      const seconds = parseInt(lrcMatch[2], 10);
      const msStr = lrcMatch[3];
      const ms = parseInt(msStr, 10);
      const msValue = msStr.length === 3 ? ms / 1000 : ms / 100;
      const time = minutes * 60 + seconds + msValue;

      tokens.push({
        type: "lrc",
        time,
        text: lrcMatch[4].trim(),
      });
    }
  }

  // Sort by time
  tokens.sort((a, b) => a.time - b.time);

  return tokens;
};

/**
 * Fix abnormal word durations in YRC tokens.
 */
const fixWordDurations = (tokens: NeteaseToken[]): void => {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "yrc" || !token.words.length) continue;

    const nextToken = tokens[i + 1];

    for (let j = 0; j < token.words.length; j++) {
      const word = token.words[j];
      const nextWord = token.words[j + 1];

      // Calculate max end time
      const maxEnd = nextWord
        ? nextWord.startTime
        : nextToken
          ? nextToken.time
          : word.startTime + MAX_WORD_DURATION;

      // Fix duration if too long
      const duration = word.endTime - word.startTime;
      if (duration > MAX_WORD_DURATION) {
        word.endTime = Math.min(word.startTime + MAX_WORD_DURATION, maxEnd);
      }

      // Ensure doesn't exceed max
      if (word.endTime > maxEnd) {
        word.endTime = maxEnd;
      }

      // Ensure end > start
      if (word.endTime <= word.startTime) {
        word.endTime = word.startTime + 0.1;
      }
    }
  }
};

/**
 * Convert tokens to lyric lines, merging translations.
 */
const tokensToLines = (tokens: NeteaseToken[]): LyricLine[] => {
  const yrcTokens = tokens.filter(t => t.type === "yrc");
  const otherTokens = tokens.filter(t => t.type !== "yrc");
  const hasYrcWordAt = (time: number): boolean => {
    return yrcTokens.some(t => {
      if (t.type !== "yrc" || !t.words.length) return false;
      return t.words.some(word => word.startTime <= time && word.endTime > time);
    });
  };

  if (yrcTokens.length === 0) {
    // No YRC data, convert all to plain lines
    return tokens
      .filter(t => !isMetadataLine(t.text))
      .map(t => {
        if (!t.text.trim()) {
          return createLine(t.time, INTERLUDE_TEXT, { isInterlude: true });
        }
        return createLine(t.time, t.text, {
          words: t.type === "yrc" && t.words.length > 0 ? t.words : undefined,
          isPreciseTiming: t.type === "yrc",
        });
      });
  }

  // Use YRC as main lines, others as translations
  const lines: LyricLine[] = [];
  const usedIndices = new Set<number>();

  for (const yrcToken of yrcTokens) {
    const translations: string[] = [];

    // Find translations within 3s tolerance
    for (let i = 0; i < otherTokens.length; i++) {
      if (usedIndices.has(i)) continue;
      const other = otherTokens[i];
      if (isMetadataLine(other.text)) continue;

      const timeDiff = Math.abs(other.time - yrcToken.time);
      if (timeDiff < 3.0) {
        const normalized = normalizeText(other.text);
        const yrcNormalized = normalizeText(yrcToken.text);

        if (normalized && normalized !== yrcNormalized) {
          translations.push(other.text.trim());
          usedIndices.add(i);
        }
      }
    }

    if (!yrcToken.text.trim()) {
      lines.push(createLine(yrcToken.time, INTERLUDE_TEXT, { isInterlude: true }));
    } else {
      lines.push(
        createLine(yrcToken.time, yrcToken.text, {
          words: yrcToken.words.length > 0 ? yrcToken.words : undefined,
          translation: translations.length > 0 ? translations.join("\n") : undefined,
          isPreciseTiming: true,
        })
      );
    }
  }

  // Add orphan lines not matched as translations
  for (let i = 0; i < otherTokens.length; i++) {
    if (usedIndices.has(i)) continue;
    const token = otherTokens[i];
    if (isMetadataLine(token.text)) continue;

    if (!token.text.trim()) {
      if (hasYrcWordAt(token.time)) {
        continue;
      }
      lines.push(createLine(token.time, INTERLUDE_TEXT, { isInterlude: true }));
    } else {
      lines.push(createLine(token.time, token.text, { isPreciseTiming: false }));
    }
  }

  // Re-sort by time
  lines.sort((a, b) => a.time - b.time);

  return lines;
};

/**
 * Deduplicate lines with same normalized text within time window.
 */
const deduplicate = (lines: LyricLine[]): LyricLine[] => {
  const result: LyricLine[] = [];

  for (const line of lines) {
    const prev = result[result.length - 1];

    if (
      prev &&
      normalizeText(prev.text) === normalizeText(line.text) &&
      Math.abs(line.time - prev.time) <= 1.5
    ) {
      // Merge: keep line with more words
      if ((line.words?.length ?? 0) > (prev.words?.length ?? 0)) {
        prev.words = line.words;
      }
      // Merge translations
      if (!prev.translation && line.translation) {
        prev.translation = line.translation;
      }
    } else {
      result.push(line);
    }
  }

  return result;
};

/**
 * Enrich LRC lines with YRC word timing.
 */
const enrichWithWordTiming = (lrcLines: LyricLine[], yrcTokens: NeteaseToken[]): LyricLine[] => {
  const yrcData = yrcTokens
    .filter(t => t.type === "yrc" && t.words.length > 0 && !isMetadataLine(t.text))
    .map(t => ({
      token: t,
      normalized: normalizeText(t.text),
      used: false,
    }))
    .filter(d => d.normalized);

  return lrcLines.map(line => {
    if (!line.text || line.isInterlude) return line;

    const targetNormalized = normalizeText(line.text);
    if (!targetNormalized) return line;

    // Find matching YRC segments
    let bestMatch: { indexes: number[]; score: number } | null = null;

    for (let start = 0; start < yrcData.length; start++) {
      if (yrcData[start].used) continue;

      const timeDiff = Math.abs(yrcData[start].token.time - line.time);
      if (timeDiff > 2.5) continue;

      if (!targetNormalized.startsWith(yrcData[start].normalized)) continue;

      // Try to match consecutive segments
      let combined = yrcData[start].normalized;
      const indexes = [start];

      while (
        combined.length < targetNormalized.length &&
        indexes[indexes.length - 1] + 1 < yrcData.length &&
        !yrcData[indexes[indexes.length - 1] + 1].used
      ) {
        const next = yrcData[indexes[indexes.length - 1] + 1];
        const prospective = combined + next.normalized;

        if (!targetNormalized.startsWith(prospective)) break;

        combined = prospective;
        indexes.push(indexes[indexes.length - 1] + 1);
      }

      if (combined === targetNormalized) {
        const score = timeDiff;
        if (!bestMatch || score < bestMatch.score) {
          bestMatch = { indexes, score };
        }
      }
    }

    // Apply best match
    if (bestMatch) {
      const words: LyricWord[] = [];

      for (const idx of bestMatch.indexes) {
        yrcData[idx].used = true;
        const token = yrcData[idx].token as Extract<NeteaseToken, { type: "yrc" }>;
        words.push(...token.words.map(w => ({ ...w })));
      }

      const adjustedWords = alignWordsWithText(line.text, words);

      return {
        ...line,
        words: adjustedWords,
        isPreciseTiming: true,
      };
    }

    return line;
  });
};

const alignWordsWithText = (text: string, words: LyricWord[]): LyricWord[] => {
  if (!text || !words.length) return words;

  const chars = Array.from(text);
  let pointer = 0;

  const adjusted = words.map(word => {
    const normalizedTarget = normalizeText(word.text);
    if (!normalizedTarget) {
      return { ...word };
    }

    let chunk = "";
    let matched = "";

    while (pointer < chars.length && matched.length < normalizedTarget.length) {
      const char = chars[pointer];
      chunk += char;
      const normalizedChar = normalizeText(char);
      if (normalizedChar) {
        matched += normalizedChar;
      }
      pointer++;
    }

    while (pointer < chars.length) {
      const lookahead = chars[pointer];
      if (normalizeText(lookahead)) {
        break;
      }
      chunk += lookahead;
      pointer++;
    }

    return chunk
      ? {
        ...word,
        text: chunk,
      }
      : { ...word };
  });

  if (pointer < chars.length && adjusted.length) {
    adjusted[adjusted.length - 1] = {
      ...adjusted[adjusted.length - 1],
      text: `${adjusted[adjusted.length - 1].text}${chars.slice(pointer).join("")}`,
    };
  }

  return adjusted;
};

/**
 * Check if content is Netease format.
 */
export const isNeteaseFormat = (content: string): boolean => {
  return content.split("\n").some(line => {
    const trimmed = line.trim();
    return (
      /^\[\d+,\d+\]/.test(trimmed) ||
      (trimmed.startsWith("{") && trimmed.includes('"c":['))
    );
  });
};

/**
 * Parse Netease YRC format lyrics.
 * 
 * If LRC content is provided, use it as the base and enrich with YRC word timing.
 * Otherwise, parse YRC directly and merge with other formats as translations.
 */
export const parseNeteaseLyrics = (
  yrcContent: string,
  lrcContent?: string
): LyricLine[] => {
  if (!yrcContent?.trim()) return [];

  const tokens = tokenizeNetease(yrcContent);
  fixWordDurations(tokens);

  // If LRC content provided, use as base and enrich
  if (lrcContent?.trim()) {
    const baseLines = parseLrc(lrcContent);
    return addDurations(enrichWithWordTiming(baseLines, tokens));
  }

  // Otherwise parse YRC directly
  const lines = tokensToLines(tokens);
  const deduped = deduplicate(lines);
  const withInterludes = insertInterludes(deduped);

  return addDurations(withInterludes);
};
