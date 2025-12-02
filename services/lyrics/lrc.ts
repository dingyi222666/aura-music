/**
 * Standard LRC format parser.
 * 
 * Supports:
 * - Basic LRC: [mm:ss.xx]lyrics
 * - Enhanced LRC: [mm:ss.xx]<mm:ss.xx>word1<mm:ss.xx>word2
 * - Multiple timestamps: [mm:ss.xx][mm:ss.xx]same lyrics
 * 
 * Features:
 * - Single-pass parsing
 * - Inline duplicate merging
 * - Inline interlude insertion
 * - Word-level timing support
 */

import { LyricLine, LyricWord, isMetadataLine } from "./types";
import {
  parseTime,
  createWord,
  createLine,
  mergePunctuation,
  insertInterludes,
  addDurations,
  INTERLUDE_TEXT,
} from "./parser";

/**
 * Token types for LRC parsing.
 */
type LrcToken =
  | { type: "time"; value: number; raw: string }
  | { type: "word_time"; value: number; raw: string }
  | { type: "text"; value: string }
  | { type: "metadata"; key: string; value: string };

/**
 * Tokenize LRC line into structured tokens.
 */
const tokenizeLine = (line: string): LrcToken[] => {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const tokens: LrcToken[] = [];
  let cursor = 0;

  // Extract time tags: [mm:ss.xx]
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  let match: RegExpExecArray | null;

  while ((match = timeRegex.exec(trimmed)) !== null) {
    const timeStr = `${match[1]}:${match[2]}.${match[3]}`;
    tokens.push({
      type: "time",
      value: parseTime(timeStr),
      raw: match[0],
    });
    cursor = match.index + match[0].length;
  }

  if (tokens.length === 0) return [];

  // Extract content after last time tag
  const content = trimmed.slice(cursor).trim();

  // Check if this is metadata (e.g., [ar:artist])
  const metaMatch = trimmed.match(/^\[([a-z]+):(.+)\]$/);
  if (metaMatch && tokens.length === 0) {
    tokens.push({
      type: "metadata",
      key: metaMatch[1],
      value: metaMatch[2],
    });
    return tokens;
  }

  // Parse word timing tags: <mm:ss.xx>word
  const wordRegex = /<(\d{2}):(\d{2})\.(\d{2,3})>([^<]*)/g;
  const wordMatches = [...content.matchAll(wordRegex)];

  if (wordMatches.length > 0) {
    // Has word-level timing
    for (const m of wordMatches) {
      tokens.push({
        type: "word_time",
        value: parseTime(`${m[1]}:${m[2]}.${m[3]}`),
        raw: m[4],
      });
    }
  } else if (content) {
    // No word timing, just text
    tokens.push({
      type: "text",
      value: content,
    });
  }

  return tokens;
};

/**
 * Parse word timing tokens into words with start/end times.
 */
const parseWords = (tokens: LrcToken[]): { words: LyricWord[]; text: string } => {
  const wordTokens = tokens.filter(t => t.type === "word_time");
  if (wordTokens.length === 0) {
    return { words: [], text: "" };
  }

  const words: LyricWord[] = [];
  let fullText = "";

  for (let i = 0; i < wordTokens.length; i++) {
    const token = wordTokens[i] as Extract<LrcToken, { type: "word_time" }>;
    const wordText = token.raw;
    const startTime = token.value;

    // Calculate end time from next word or estimate
    const nextToken = wordTokens[i + 1] as Extract<LrcToken, { type: "word_time" }> | undefined;
    const endTime = nextToken ? nextToken.value : startTime + 1.0;

    fullText += wordText;
    if (wordText) {
      words.push(createWord(wordText, startTime, endTime));
    }
  }

  return {
    words: mergePunctuation(words),
    text: fullText,
  };
};

/**
 * Parsed line data before grouping.
 */
interface ParsedLine {
  time: number;
  text: string;
  words: LyricWord[];
  hasWordTiming: boolean;
  originalIndex: number;
  isMetadata: boolean;
}

/**
 * Parse all lines and group by timestamp.
 */
const parseAndGroup = (content: string): LyricLine[] => {
  const lines = content.split("\n");
  const parsed: ParsedLine[] = [];

  lines.forEach((line, index) => {
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) return;

    // Skip metadata tokens
    if (tokens[0].type === "metadata") return;

    const timeTags = tokens.filter(t => t.type === "time") as Extract<LrcToken, { type: "time" }>[];
    if (timeTags.length === 0) return;

    // Parse words and text
    const { words, text } = parseWords(tokens);
    const textContent = text || (tokens.find(t => t.type === "text") as Extract<LrcToken, { type: "text" }>)?.value || "";

    // Create entry for each timestamp
    for (const timeTag of timeTags) {
      parsed.push({
        time: timeTag.value,
        text: textContent,
        words: words.map(w => ({ ...w })),
        hasWordTiming: words.length > 0,
        originalIndex: index,
        isMetadata: isMetadataLine(textContent),
      });
    }
  });

  // Sort by time, then by original index
  parsed.sort((a, b) => {
    const timeDiff = a.time - b.time;
    return Math.abs(timeDiff) > 0.01 ? timeDiff : a.originalIndex - b.originalIndex;
  });

  return groupDuplicates(parsed);
};

/**
 * Group lines with same timestamp and merge duplicates.
 */
const groupDuplicates = (entries: ParsedLine[]): LyricLine[] => {
  const result: LyricLine[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];
    const group = [current];
    let j = i + 1;

    // Group entries within 0.1s
    while (j < entries.length && Math.abs(entries[j].time - current.time) < 0.1) {
      group.push(entries[j]);
      j++;
    }

    // Sort by priority: word timing > original order
    group.sort((a, b) => {
      if (a.hasWordTiming !== b.hasWordTiming) {
        return a.hasWordTiming ? -1 : 1;
      }
      return a.originalIndex - b.originalIndex;
    });

    // Find main line (non-metadata with content)
    const main = group.find(e => !e.isMetadata && e.text.trim()) ?? group[0];

    // Skip metadata-only lines
    if (main.isMetadata) {
      i = j;
      continue;
    }

    // Handle empty lines as interludes
    if (!main.text.trim()) {
      result.push(createLine(main.time, INTERLUDE_TEXT, { isInterlude: true }));
      i = j;
      continue;
    }

    // Collect translations from other lines in group
    const mainNormalized = main.text.toLowerCase();
    const translations = group
      .filter(e => e !== main && !e.isMetadata && e.text.trim())
      .map(e => e.text.trim())
      .filter(t => t && t.toLowerCase() !== mainNormalized);

    result.push(
      createLine(main.time, main.text, {
        words: main.words.length > 0 ? main.words : undefined,
        translation: translations.length > 0 ? translations.join("\n") : undefined,
        isPreciseTiming: false,
      })
    );

    i = j;
  }

  return result;
};

/**
 * Fix word end times based on next line start.
 */
const fixWordTiming = (lines: LyricLine[]): void => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.isPreciseTiming || !line.words?.length) continue;

    const nextTime = lines[i + 1]?.time ?? line.time + 5;
    const lastWord = line.words[line.words.length - 1];
    const duration = nextTime - lastWord.startTime;
    lastWord.endTime = lastWord.startTime + Math.min(duration, 5);
  }
};

/**
 * Parse standard LRC format lyrics.
 * 
 * Single-pass parser that:
 * 1. Tokenizes and parses all lines
 * 2. Groups and merges duplicates inline
 * 3. Inserts interludes for gaps
 * 4. Adds duration metadata
 */
export const parseLrc = (content: string): LyricLine[] => {
  if (!content?.trim()) return [];

  const lines = parseAndGroup(content);

  fixWordTiming(lines);

  const withInterludes = insertInterludes(lines);

  return addDurations(withInterludes);
};
