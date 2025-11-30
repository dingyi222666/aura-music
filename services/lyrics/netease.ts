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
  mergePunctuationWords,
} from "./utils";

/**
 * NetEase YRC line regex: [startMs,duration]content
 * Example: [12340,2500](12340,500,0)Hello(12840,600,0)World
 */
const YRC_LINE_REGEX = /^\[(\d+),(\d+)\](.*)/;

/**
 * NetEase YRC word regex: (startMs,duration,flag)text
 * The flag is typically 0 but can vary.
 */
const YRC_WORD_REGEX = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;

/**
 * Parse NetEase JSON metadata line.
 * Format: {"t":0,"c":[{"tx":"作词: "},{"tx":"name"}]}
 */
const parseJsonLine = (
  line: string,
  originalIndex: number,
): ParsedLineData | null => {
  try {
    const json = JSON.parse(line);
    if (json.c && Array.isArray(json.c)) {
      const text = json.c.map((item: { tx: string }) => item.tx).join("");
      const time = (json.t || 0) / 1000;
      return {
        time,
        text,
        words: [],
        tagCount: 0, // Low priority
        originalIndex,
        isMetadata: true, // JSON lines are typically metadata
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
};

/**
 * Parse a NetEase YRC format line.
 * Format: [startMs,duration](startMs,duration,0)word1(startMs,duration,0)word2...
 *
 * Note: The line start time (in brackets) indicates when the line becomes active.
 * Individual word times may start at or after the line start time.
 */
const parseYrcLine = (
  line: string,
  originalIndex: number,
): ParsedLineData | null => {
  const match = line.match(YRC_LINE_REGEX);
  if (!match) return null;

  const startTimeMs = parseInt(match[1], 10);
  const content = match[3];

  const words: LyricWord[] = [];
  let fullText = "";

  const wordMatches = [...content.matchAll(YRC_WORD_REGEX)];

  if (wordMatches.length > 0) {
    wordMatches.forEach((m) => {
      const wordStart = parseInt(m[1], 10) / 1000;
      const wordDuration = parseInt(m[2], 10) / 1000;
      const wordText = m[4];

      fullText += wordText;

      words.push(
        createWord(wordText, wordStart, wordStart + wordDuration),
      );
    });
  } else {
    // No word timing, just use the content as text
    fullText = content;
  }

  // Merge punctuation-only words with the previous word
  const mergedWords = mergePunctuationWords(words);

  return {
    time: startTimeMs / 1000,
    text: fullText,
    words: mergedWords,
    tagCount: mergedWords.length + 1000, // High priority for YRC (1000 base to distinguish from LRC)
    originalIndex,
    isMetadata: isMetadataLine(fullText),
  };
};

/**
 * Parse a standard LRC line (fallback for non-YRC lines in NetEase content).
 */
const parseFallbackLrcLine = (
  line: string,
  originalIndex: number,
): ParsedLineData | null => {
  const match = line.match(LRC_LINE_REGEX);
  if (!match) return null;

  const time = parseTimeTag(`${match[1]}:${match[2]}.${match[3]}`);
  const text = match[4].trim();

  return {
    time,
    text,
    words: [],
    tagCount: 0,
    originalIndex,
    isMetadata: isMetadataLine(text),
  };
};

/**
 * Fix abnormally long word durations in parsed entries.
 * Limits word duration to a maximum threshold and adjusts based on next word/line timing.
 */
const fixAbnormalWordDurations = (entries: ParsedLineData[]): void => {
  const MAX_WORD_DURATION = 2.0; // Max 2 seconds per word

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.words || entry.words.length === 0) continue;

    const nextEntry = entries[i + 1];

    for (let j = 0; j < entry.words.length; j++) {
      const word = entry.words[j];
      const nextWord = entry.words[j + 1];

      // Calculate reasonable end time
      let maxEndTime: number;

      if (nextWord) {
        // Next word exists, use its start time as upper bound
        maxEndTime = nextWord.startTime;
      } else if (nextEntry) {
        // Last word in line, use next line's start time
        maxEndTime = nextEntry.time;
      } else {
        // Last word in last line, use max duration
        maxEndTime = word.startTime + MAX_WORD_DURATION;
      }

      // Apply duration limit
      const currentDuration = word.endTime - word.startTime;
      if (currentDuration > MAX_WORD_DURATION) {
        word.endTime = Math.min(word.startTime + MAX_WORD_DURATION, maxEndTime);
      }

      // Ensure word doesn't exceed the calculated max end time
      if (word.endTime > maxEndTime) {
        word.endTime = maxEndTime;
      }

      // Ensure end time is after start time
      if (word.endTime <= word.startTime) {
        word.endTime = word.startTime + 0.1;
      }
    }
  }
};

/**
 * Merge YRC lines with translation lines.
 * YRC lines are the main lyrics, other lines at similar times are translations.
 */
const mergeYrcWithTranslations = (entries: ParsedLineData[]): LyricLine[] => {
  const result: (LyricLine & { _originalIndex: number })[] = [];

  // Separate YRC lines from others
  const yrcLines = entries.filter((e) => e.tagCount >= 1000);
  const otherLines = entries.filter((e) => e.tagCount < 1000);

  // Create buckets for each YRC line
  const buckets = yrcLines.map((yrc) => ({
    main: yrc,
    translations: [] as string[],
  }));

  const orphans: ParsedLineData[] = [];

  // Assign translation lines to the closest YRC line within threshold
  otherLines.forEach((line) => {
    // Skip metadata lines
    if (line.isMetadata) return;

    let closestIndex = -1;
    let minDiff = Infinity;

    buckets.forEach((bucket, idx) => {
      const diff = Math.abs(bucket.main.time - line.time);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    // Tolerance: 3.0s (relaxed for NetEase timing drifts)
    if (closestIndex !== -1 && minDiff < 3.0) {
      const translationText = getEntryDisplayText(line);
      if (translationText.length > 0) {
        buckets[closestIndex].translations.push(translationText);
        return;
      }
    }

    // Not matched as translation, keep as orphan
    orphans.push(line);
  });

  // Convert buckets to result
  buckets.forEach((bucket) => {
    const mainText = getEntryDisplayText(bucket.main);
    const normalizedMain = mainText.toLowerCase();

    // Filter out translations that are identical to main text
    const translations = bucket.translations
      .map((t) => t.trim())
      .filter(
        (t) =>
          t.length > 0 &&
          (!normalizedMain || t.toLowerCase() !== normalizedMain),
      );

    if (!bucket.main.isMetadata) {
      result.push({
        time: bucket.main.time,
        text: mainText || bucket.main.text,
        ...(bucket.main.words &&
          bucket.main.words.length > 0 && { words: bucket.main.words }),
        ...(translations.length > 0 && { translation: translations.join("\n") }),
        isPreciseTiming: true,
        _originalIndex: bucket.main.originalIndex,
      });
    }
  });

  // Append orphans (non-metadata)
  orphans.forEach((orphan) => {
    if (orphan.isMetadata) return;

    const orphanText = getEntryDisplayText(orphan);
    result.push({
      time: orphan.time,
      text: orphanText || orphan.text,
      ...(orphan.words &&
        orphan.words.length > 0 && { words: orphan.words }),
      isPreciseTiming: false,
      _originalIndex: orphan.originalIndex,
    });
  });

  // Final sort by time, using originalIndex for stability
  result.sort((a, b) => {
    const diff = a.time - b.time;
    if (Math.abs(diff) > 0.001) return diff;
    return a._originalIndex - b._originalIndex;
  });

  return result.map(({ _originalIndex, ...rest }) => rest);
};

/**
 * Parse NetEase YRC format lyrics.
 *
 * Supports:
 * - YRC format: [startMs,duration](wordStartMs,wordDuration,0)word...
 * - JSON metadata: {"t":0,"c":[{"tx":"text"}]}
 * - Fallback to standard LRC for non-YRC lines
 *
 * Note: Line time (first value in brackets) indicates when the line becomes active.
 * Word times may start at or after the line time.
 */
export const parseNeteaseLyrics = (content: string): LyricLine[] => {
  const lines = content.split("\n");
  const entries: ParsedLineData[] = [];

  // First pass: parse all lines
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Try JSON format first
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = parseJsonLine(trimmed, index);
      if (parsed) {
        entries.push(parsed);
        return;
      }
    }

    // Try YRC format
    const yrcParsed = parseYrcLine(trimmed, index);
    if (yrcParsed) {
      entries.push(yrcParsed);
      return;
    }

    // Fallback to standard LRC
    const lrcParsed = parseFallbackLrcLine(trimmed, index);
    if (lrcParsed) {
      entries.push(lrcParsed);
    }
  });

  // Sort by time
  entries.sort((a, b) => {
    const diff = a.time - b.time;
    if (Math.abs(diff) > 0.01) return diff;
    return a.originalIndex - b.originalIndex;
  });

  // Check if we have YRC content
  const hasYrc = entries.some((e) => e.tagCount >= 1000);

  if (hasYrc) {
    return mergeYrcWithTranslations(entries);
  }

  // No YRC, use standard grouping (import from lrc.ts would cause circular dep)
  // For simplicity, just return basic lines
  return entries
    .filter((e) => !e.isMetadata && hasMeaningfulContent(e))
    .map((e) => ({
      time: e.time,
      text: getEntryDisplayText(e) || e.text,
      ...(e.words && e.words.length > 0 && { words: e.words }),
      isPreciseTiming: false,
    }));
};

/**
 * Check if content appears to be NetEase YRC format.
 */
export const isNeteaseFormat = (content: string): boolean => {
  const lines = content.split("\n");
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      YRC_LINE_REGEX.test(trimmed) ||
      (trimmed.startsWith("{") && trimmed.includes('"c":['))
    );
  });
};
