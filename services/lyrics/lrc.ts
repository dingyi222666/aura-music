import {
  LyricLine,
  LyricWord,
  ParsedLineData,
  isMetadataLine,
} from "./types";
import {
  LRC_LINE_REGEX,
  parseTimeTag,
  createWord,
  getEntryDisplayText,
  hasMeaningfulContent,
  fixWordEndTimes,
  mergePunctuationWords,
  processLyricsDurations,
  insertInterludes,
} from "./utils";

/**
 * Enhanced word tag regex for standard LRC: <mm:ss.xx>word
 * Example: <00:12.34>Hello<00:12.56>World
 */
const WORD_TAG_REGEX = /<(\d{2}):(\d{2})\.(\d{2,3})>([^<]*)/g;

/**
 * Parse inline word timing tags from LRC content.
 * Returns parsed words and the full text without tags.
 *
 * Note: Word start time may differ from line start time.
 * The line time indicates when the line should be highlighted,
 * while word times indicate individual word timing within the line.
 */
const parseWordTags = (
  content: string,
): { text: string; words: LyricWord[]; tagCount: number } => {
  const words: LyricWord[] = [];
  const matches = [...content.matchAll(WORD_TAG_REGEX)];

  if (matches.length > 0) {
    matches.forEach((match, index) => {
      const wordTime = parseTimeTag(`${match[1]}:${match[2]}.${match[3]}`);
      const wordText = match[4];

      // Calculate end time from next word or estimate
      let endTime: number;
      if (index < matches.length - 1) {
        const nextMatch = matches[index + 1];
        endTime = parseTimeTag(`${nextMatch[1]}:${nextMatch[2]}.${nextMatch[3]}`);
      } else {
        // Last word: estimate 1 second duration
        endTime = wordTime + 1.0;
      }

      if (wordText) {
        words.push(createWord(wordText, wordTime, endTime));
      }
    });
  }

  // Extract full text by removing all tags
  const fullText = content.replace(/<[^>]+>/g, "").trim();

  // Merge punctuation-only words with the previous word
  const mergedWords = mergePunctuationWords(words);

  return { text: fullText, words: mergedWords, tagCount: matches.length };
};

/**
 * Parse a single standard LRC line.
 * Format: [mm:ss.xx]text or [mm:ss.xx][mm:ss.xx]text
 */
const parseLrcLine = (
  line: string,
  originalIndex: number,
): ParsedLineData[] => {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Match all timestamps: [mm:ss.xx]
  const timeMatches = [...trimmed.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g)];
  if (timeMatches.length === 0) return [];

  // The content is everything after the last timestamp
  const lastMatch = timeMatches[timeMatches.length - 1];
  const contentStartIndex = lastMatch.index! + lastMatch[0].length;
  const content = trimmed.slice(contentStartIndex).trim();

  const { text, words, tagCount } = parseWordTags(content);
  const isMetadata = isMetadataLine(text);

  return timeMatches.map((match) => {
    const time = parseTimeTag(`${match[1]}:${match[2]}.${match[3]}`);
    return {
      time,
      text,
      words: words.map(w => ({ ...w })), // Clone words to avoid reference issues if needed
      tagCount,
      originalIndex,
      isMetadata,
    };
  });
};

/**
 * Group lines by similar timestamps and merge duplicates.
 * Returns the main line with translation from grouped lines.
 */
const groupAndMergeLines = (entries: ParsedLineData[]): LyricLine[] => {
  const result: (LyricLine & { _originalIndex: number })[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];
    const group = [current];
    let j = i + 1;

    // Group lines within 0.1s threshold (strict for standard LRC)
    while (
      j < entries.length &&
      Math.abs(entries[j].time - current.time) < 0.1
    ) {
      group.push(entries[j]);
      j++;
    }

    // Sort group: more word tags = higher priority, then by original index
    group.sort((a, b) => {
      if (a.tagCount !== b.tagCount) return b.tagCount - a.tagCount;
      return a.originalIndex - b.originalIndex;
    });

    // Find main line (non-metadata with content)
    const main =
      group.find((entry) => !entry.isMetadata && hasMeaningfulContent(entry)) ??
      group.find((entry) => hasMeaningfulContent(entry)) ??
      group[0];

    // Skip pure metadata lines
    if (main.isMetadata) {
      i = j;
      continue;
    }

    const mainText = getEntryDisplayText(main) || main.text || "";
    const normalizedMain = mainText.toLowerCase();

    // Extract translations from other lines in the group
    const translationParts = group
      .filter((entry) => entry !== main)
      .filter((entry) => !entry.isMetadata && hasMeaningfulContent(entry))
      .map((entry) => getEntryDisplayText(entry))
      .filter(
        (text) =>
          text.length > 0 &&
          (!normalizedMain || text.toLowerCase() !== normalizedMain),
      );

    const translation =
      translationParts.length > 0 ? translationParts.join("\n") : undefined;

    result.push({
      time: main.time,
      text: mainText,
      ...(main.words && main.words.length > 0 && { words: main.words }),
      ...(translation && { translation }),
      isPreciseTiming: false,
      _originalIndex: main.originalIndex,
    });

    i = j;
  }

  return result.map(({ _originalIndex, ...rest }) => rest);
};

/**
 * Parse standard LRC format lyrics.
 *
 * Supports:
 * - Basic LRC: [mm:ss.xx]lyrics text
 * - Enhanced LRC with word timing: [mm:ss.xx]<mm:ss.xx>word1<mm:ss.xx>word2
 *
 * Note: Line time represents when the line becomes active.
 * Word times (if present) indicate individual word highlighting,
 * which may start slightly after the line time.
 */
export const parseLrc = (content: string): LyricLine[] => {
  const lines = content.split("\n");
  const entries: ParsedLineData[] = [];

  // First pass: parse all lines
  lines.forEach((line, index) => {
    const parsed = parseLrcLine(line, index);
    if (parsed.length > 0) {
      entries.push(...parsed);
    }
  });

  // Sort by time, using originalIndex for stability
  entries.sort((a, b) => {
    const diff = a.time - b.time;
    if (Math.abs(diff) > 0.01) return diff;
    return a.originalIndex - b.originalIndex;
  });

  // Group and merge lines with same timestamp
  const result = groupAndMergeLines(entries);

  // Fix word end times for non-precise timing
  fixWordEndTimes(result);

  // Calculate durations first
  const withDurations = processLyricsDurations(result);

  // Insert interludes
  return withDurations;
};
