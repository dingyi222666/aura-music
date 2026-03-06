import { XMLParser } from "fast-xml-parser";

import {
  addDurations,
  filterShortInterludes,
  insertInterludes,
  INTERLUDE_TEXT,
} from "./parser";
import { LyricLine, LyricWord } from "./types";

type Mode = "line" | "word";

interface Seg {
  parts: string[];
  words: LyricWord[];
  translation: string[];
  roman: string[];
}

interface Rich {
  main: Seg;
  bg: Seg;
}

interface Aux {
  translation: string[];
  roman: string[];
  bgTranslation: string[];
  bgRoman: string[];
}

interface Entry {
  key?: string;
  kind: "main" | "bg";
  line: LyricLine;
  agent?: string;
}

interface Scope {
  begin?: string;
  end?: string;
  part?: string;
  instrumental?: boolean;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
});

export const isTtmlFormat = (content: string): boolean => {
  if (!content) return false;
  const trimmed = content.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith("<?xml")) return true;
  if (trimmed.startsWith("<tt")) return true;
  return trimmed.includes("http://www.w3.org/ns/ttml");
};

const makeSeg = (): Seg => ({
  parts: [],
  words: [],
  translation: [],
  roman: [],
});

const makeRich = (): Rich => ({
  main: makeSeg(),
  bg: makeSeg(),
});

const makeAux = (): Aux => ({
  translation: [],
  roman: [],
  bgTranslation: [],
  bgRoman: [],
});

const mergeSeg = (dst: Seg, src: Seg): void => {
  dst.parts.push(...src.parts);
  dst.words.push(...src.words);
  dst.translation.push(...src.translation);
  dst.roman.push(...src.roman);
};

const parseFraction = (fraction: string): number => {
  if (!fraction) return 0;
  if (!/^[0-9]+$/.test(fraction)) return 0;
  if (fraction.length === 1) return parseInt(fraction, 10) / 10;
  if (fraction.length === 2) return parseInt(fraction, 10) / 100;
  return parseInt(fraction.slice(0, 3), 10) / 1000;
};

const parseClockTime = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  if (/^[0-9]+(\.[0-9]+)?s$/i.test(trimmed)) {
    const sec = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(sec) ? sec : 0;
  }

  const parts = trimmed.split(":");
  if (parts.length > 3) return 0;

  if (parts.length === 1) {
    const sec = parseFloat(parts[0]);
    return Number.isFinite(sec) ? sec : 0;
  }

  const last = parts[parts.length - 1];
  const [secStr, fracStr] = last.split(".");
  const sec = parseInt(secStr, 10);
  if (!Number.isFinite(sec) || sec < 0 || sec >= 60) return 0;

  const frac = fracStr ? parseFraction(fracStr) : 0;
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10);
    if (!Number.isFinite(min) || min < 0 || min >= 60) return 0;
    return min * 60 + sec + frac;
  }

  const hour = parseInt(parts[0], 10);
  const min = parseInt(parts[1], 10);
  if (!Number.isFinite(hour) || hour < 0) return 0;
  if (!Number.isFinite(min) || min < 0 || min >= 60) return 0;
  return hour * 3600 + min * 60 + sec + frac;
};

const parseTtmlTime = (value?: string): number => {
  if (!value) return 0;
  return parseClockTime(value);
};

const makeWord = (text: string, start: number, end: number): LyricWord => {
  const safeStart = Number.isFinite(start) ? Math.max(start, 0) : 0;
  let safeEnd = Number.isFinite(end) ? end : safeStart;
  if (safeEnd <= safeStart) safeEnd = safeStart + 0.01;
  return {
    text,
    startTime: safeStart,
    endTime: safeEnd,
  };
};

const nameOf = (item: any): string | undefined => {
  for (const key of Object.keys(item ?? {})) {
    if (key !== ":@") return key;
  }
  return undefined;
};

const localOf = (name?: string): string => {
  if (!name) return "";
  const i = name.indexOf(":");
  if (i === -1) return name;
  return name.slice(i + 1);
};

const attrsOf = (item: any): Record<string, string> => {
  const attrs = item?.[":@"];
  if (!attrs || typeof attrs !== "object") return {};
  return attrs as Record<string, string>;
};

const kidsOf = (item: any): any[] => {
  const name = nameOf(item);
  if (!name) return [];
  const kids = item[name];
  return Array.isArray(kids) ? kids : [];
};

const pick = (items: any[], tag: string): any[] => {
  return items.filter((item) => localOf(nameOf(item)) === tag);
};

const first = (items: any[], tag: string): any | undefined => {
  return items.find((item) => localOf(nameOf(item)) === tag);
};

const normalizeNodeText = (value: string): string => {
  if (!value) return "";
  if (!value.trim()) {
    return /[\r\n\t]/.test(value) ? "" : " ";
  }
  return value.replace(/\s+/g, " ");
};

const normalizeJoinedText = (value: string): string => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const rawOfSeg = (seg: Seg): string => {
  return seg.parts.join("") || seg.words.map((word) => word.text).join("");
};

const spanOfSeg = (seg: Seg): string => {
  return rawOfSeg(seg).replace(/\s+/g, " ");
};

const textOfSeg = (seg: Seg): string => {
  return normalizeJoinedText(rawOfSeg(seg));
};

const joinMeta = (parts: string[], sep: string): string | undefined => {
  const list = parts.map((part) => normalizeJoinedText(part)).filter(Boolean);
  if (list.length === 0) return undefined;
  return list.join(sep);
};

const appendMeta = (base: string | undefined, parts: string[], sep: string): string | undefined => {
  const list = [base, ...parts].map((part) => normalizeJoinedText(part ?? "")).filter(Boolean);
  if (list.length === 0) return undefined;
  return list.join(sep);
};

const roleOf = (attrs: Record<string, string>): string | undefined => {
  return attrs["@_ttm:role"] || attrs["@_role"] || attrs["@_ttm_role"];
};

const partOf = (attrs: Record<string, string>): string | undefined => {
  return attrs["@_itunes:song-part"] || attrs["@_song-part"];
};

const modeOf = (value?: string): Mode | undefined => {
  const mode = value?.trim().toLowerCase();
  if (mode === "line") return "line";
  if (mode === "word") return "word";
  return undefined;
};

const hasTime = (attrs: Record<string, string>): boolean => {
  return Boolean(attrs["@_begin"] || attrs["@_end"]);
};

const isInstrumental = (part?: string): boolean => {
  return part?.trim().toLowerCase() === "instrumental";
};

const lineEndOf = (line: LyricLine): number => {
  if (line.endTime && line.endTime > line.time) return line.endTime;
  if (line.words?.length) {
    return line.words[line.words.length - 1].endTime;
  }
  return line.time;
};

const CJK_SCRIPT_REGEX =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

const hasCjkScript = (text: string): boolean => {
  return CJK_SCRIPT_REGEX.test(text);
};

const canMergeWords = (prev: LyricWord, word: LyricWord): boolean => {
  if (/\s$/.test(prev.text) || /^\s/.test(word.text)) return false;
  if (hasCjkScript(prev.text) || hasCjkScript(word.text)) return false;
  return true;
};

const mergeWords = (words: LyricWord[]): LyricWord[] => {
  const list: LyricWord[] = [];

  for (const word of words) {
    const prev = list[list.length - 1];
    if (!prev) {
      list.push({ ...word });
      continue;
    }

    if (canMergeWords(prev, word)) {
      prev.text += word.text;
      prev.endTime = Math.max(prev.endTime, word.endTime);
      continue;
    }

    list.push({ ...word });
  }

  return list;
};

const makeInterlude = (
  time: number,
  endTime: number,
  key?: string,
  agent?: string,
): Entry | undefined => {
  if (!(endTime > time)) return undefined;

  return {
    key,
    kind: "main",
    agent,
    line: {
      time,
      endTime,
      text: INTERLUDE_TEXT,
      isInterlude: true,
    },
  };
};

const textOfItems = (items: any[]): string => {
  let text = "";

  for (const item of items) {
    const name = localOf(nameOf(item));
    if (!name) continue;

    if (name === "#text") {
      text += normalizeNodeText(String(item["#text"] ?? ""));
      continue;
    }

    if (name === "span") {
      const attrs = attrsOf(item);
      if (roleOf(attrs) === "x-bg") continue;
    }

    text += textOfItems(kidsOf(item));
  }

  return normalizeJoinedText(text);
};

const parseRich = (
  items: any[],
  mode: Mode,
  begin?: string,
  end?: string,
): Rich => {
  const rich = makeRich();

  for (const item of items) {
    const name = localOf(nameOf(item));
    if (!name) continue;

    if (name === "#text") {
      const text = normalizeNodeText(String(item["#text"] ?? ""));
      if (text) {
        rich.main.parts.push(text);
        // In word mode, attach whitespace text nodes to the preceding word
        // so inter-word spacing is preserved in layout (spec 4.1.1 space-outside-span).
        if (mode === "word" && !text.trim() && rich.main.words.length > 0) {
          rich.main.words[rich.main.words.length - 1].text += text;
        }
      }
      continue;
    }

    if (name !== "span") {
      const nested = parseRich(kidsOf(item), mode, begin, end);
      mergeSeg(rich.main, nested.main);
      mergeSeg(rich.bg, nested.bg);
      continue;
    }

    const attrs = attrsOf(item);
    const role = roleOf(attrs);
    const spanBegin = attrs["@_begin"] || begin;
    const spanEnd = attrs["@_end"] || end;
    const kids = kidsOf(item);

    if (role === "x-translation") {
      const text = textOfItems(kids);
      if (text) rich.main.translation.push(text);
      continue;
    }

    if (role === "x-roman") {
      const text = textOfItems(kids);
      if (text) rich.main.roman.push(text);
      continue;
    }

    if (role === "x-bg") {
      const nested = parseRich(kids, mode, spanBegin, spanEnd);
      const text = spanOfSeg(nested.main);

      if (text) rich.bg.parts.push(text);

      if (mode === "word") {
        if (nested.main.words.length > 0) {
          rich.bg.words.push(...nested.main.words);
        } else if (hasTime(attrs) && text) {
          rich.bg.words.push(
            makeWord(text, parseTtmlTime(spanBegin), parseTtmlTime(spanEnd)),
          );
        }
      }

      rich.bg.translation.push(...nested.main.translation);
      rich.bg.roman.push(...nested.main.roman);
      mergeSeg(rich.bg, nested.bg);
      continue;
    }

    const nested = parseRich(kids, mode, spanBegin, spanEnd);
    const text = spanOfSeg(nested.main);

    if (text) rich.main.parts.push(text);
    rich.main.translation.push(...nested.main.translation);
    rich.main.roman.push(...nested.main.roman);
    mergeSeg(rich.bg, nested.bg);

    if (mode !== "word") continue;

    if (hasTime(attrs)) {
      if (text) {
        rich.main.words.push(
          makeWord(text, parseTtmlTime(spanBegin), parseTtmlTime(spanEnd)),
        );
      }
      continue;
    }

    if (nested.main.words.length > 0) {
      rich.main.words.push(...nested.main.words);
    }
  }

  return rich;
};

const hasTimedSpan = (items: any[]): boolean => {
  for (const item of items) {
    const name = localOf(nameOf(item));
    if (!name || name === "#text") continue;

    if (name === "span") {
      const attrs = attrsOf(item);
      const role = roleOf(attrs);
      if (role !== "x-translation" && role !== "x-roman" && hasTime(attrs)) {
        return true;
      }
    }

    if (hasTimedSpan(kidsOf(item))) return true;
  }

  return false;
};

const parseP = (item: any, rootMode?: Mode, scope: Scope = {}): Entry[] => {
  const attrs = attrsOf(item);
  const kids = kidsOf(item);
  const begin = attrs["@_begin"] || scope.begin;
  const end = attrs["@_end"] || scope.end;
  const mode = rootMode ?? (hasTimedSpan(kids) ? "word" : "line");
  const rich = parseRich(kids, mode, begin, end);
  const time = parseTtmlTime(begin);
  const pEnd = end ? parseTtmlTime(end) : 0;
  const key = attrs["@_itunes:key"] || attrs["@_key"];
  const agent = attrs["@_ttm:agent"] || attrs["@_agent"];
  const part = partOf(attrs) || scope.part;
  const list: Entry[] = [];

  if (scope.instrumental || isInstrumental(part)) {
    const line = makeInterlude(time, pEnd, key, agent);
    if (line) list.push(line);
    return list;
  }

  const mainWords = mergeWords(rich.main.words);
  const bgWords = mergeWords(rich.bg.words);

  const text = textOfSeg(rich.main);
  const bgText = textOfSeg(rich.bg);
  const hasMain = Boolean(text || mainWords.length > 0);
  const hasBg = Boolean(bgText || bgWords.length > 0);

  if (!hasMain && !hasBg) {
    const line = makeInterlude(time, pEnd, key, agent);
    if (line) list.push(line);
    return list;
  }

  if (hasMain) {
    const line: LyricLine = {
      time,
      text: text || mainWords.map((word) => word.text).join(""),
    };

    if (pEnd > time) line.endTime = pEnd;

    if (mode === "word" && mainWords.length > 0) {
      line.words = mainWords;
      line.isPreciseTiming = true;
    }

    const translation = joinMeta(rich.main.translation, "\n");
    if (translation) line.translation = translation;

    const roman = joinMeta(rich.main.roman, " ");
    if (roman) line.romanization = roman;

    list.push({ key, kind: "main", line, agent });
  }

  if (hasBg) {
    const bgTime = bgWords[0]?.startTime ?? time;
    const line: LyricLine = {
      time: bgTime,
      text: bgText || bgWords.map((word) => word.text).join(""),
      isBackground: true,
    };

    // Background end time: from last bg word, or from <p> end
    const bgEnd = bgWords.length > 0
      ? bgWords[bgWords.length - 1].endTime
      : pEnd;
    if (bgEnd > bgTime) line.endTime = bgEnd;

    if (mode === "word" && bgWords.length > 0) {
      line.words = bgWords;
      line.isPreciseTiming = true;
    }

    const translation = joinMeta(rich.bg.translation, "\n");
    if (translation) line.translation = translation;

    const roman = joinMeta(rich.bg.roman, " ");
    if (roman) line.romanization = roman;

    list.push({ key, kind: "bg", line, agent });
  }

  return list;
};

const parseBody = (items: any[], rootMode?: Mode, scope: Scope = {}): Entry[] => {
  const list: Entry[] = [];

  for (const item of items) {
    const name = localOf(nameOf(item));
    if (!name || name === "#text") continue;

    if (name === "p") {
      list.push(...parseP(item, rootMode, scope));
      continue;
    }

    const attrs = attrsOf(item);
    const begin = attrs["@_begin"] || scope.begin;
    const end = attrs["@_end"] || scope.end;
    const part = partOf(attrs) || scope.part;
    const instrumental = Boolean(scope.instrumental || isInstrumental(part));

    if (name === "div" && instrumental) {
      const line = makeInterlude(parseTtmlTime(begin), parseTtmlTime(end), undefined, undefined);
      if (line) list.push(line);
      continue;
    }

    list.push(
      ...parseBody(kidsOf(item), rootMode, {
        begin,
        end,
        part,
        instrumental,
      }),
    );
  }

  return list;
};

const bodyEndOf = (body: any): number => {
  const attrs = attrsOf(body);
  const begin = parseTtmlTime(attrs["@_begin"]);
  const end = parseTtmlTime(attrs["@_end"]);
  if (end > begin) return end;

  const dur = parseTtmlTime(attrs["@_dur"]);
  return dur > 0 ? begin + dur : 0;
};

const appendTail = (lines: LyricLine[], bodyEnd: number): LyricLine[] => {
  if (!(bodyEnd > 0) || lines.length === 0) return lines;

  const end = lines.reduce((max, line) => Math.max(max, lineEndOf(line)), 0);
  if (bodyEnd <= end + 1e-3) return lines;

  return [
    ...lines,
    {
      time: end,
      endTime: bodyEnd,
      text: INTERLUDE_TEXT,
      isInterlude: true,
    },
  ];
};

const parseAuxText = (item: any): { main: string; bg: string } => {
  const rich = parseRich(kidsOf(item), "line");
  return {
    main: textOfSeg(rich.main),
    bg: textOfSeg(rich.bg),
  };
};

const pushAux = (map: Map<string, Aux>, key: string, field: keyof Aux, text: string): void => {
  const value = normalizeJoinedText(text);
  if (!value) return;
  const aux = map.get(key) ?? makeAux();
  aux[field].push(value);
  map.set(key, aux);
};

const parseTrack = (items: any[], tag: "translation" | "transliteration", field: keyof Aux, bgField: keyof Aux, map: Map<string, Aux>): void => {
  for (const box of items) {
    for (const track of pick(kidsOf(box), tag)) {
      for (const text of pick(kidsOf(track), "text")) {
        const key = attrsOf(text)["@_for"];
        if (!key) continue;
        const value = parseAuxText(text);
        pushAux(map, key, field, value.main);
        pushAux(map, key, bgField, value.bg);
      }
    }
  }
};

const parseHead = (tt: any): Map<string, Aux> => {
  const map = new Map<string, Aux>();
  const head = first(kidsOf(tt), "head");
  if (!head) return map;

  const metadata = first(kidsOf(head), "metadata");
  if (!metadata) return map;

  const meta = first(kidsOf(metadata), "iTunesMetadata");
  if (!meta) return map;

  const kids = kidsOf(meta);
  parseTrack(pick(kids, "translations"), "translation", "translation", "bgTranslation", map);
  parseTrack(pick(kids, "transliterations"), "transliteration", "roman", "bgRoman", map);
  return map;
};

const mergeHead = (list: Entry[], map: Map<string, Aux>): LyricLine[] => {
  return list.map((entry) => {
    const aux = entry.key ? map.get(entry.key) : undefined;
    if (!aux) return entry.line;

    if (entry.kind === "bg") {
      return {
        ...entry.line,
        ...(appendMeta(entry.line.translation, aux.bgTranslation, "\n") && {
          translation: appendMeta(entry.line.translation, aux.bgTranslation, "\n"),
        }),
        ...(appendMeta(entry.line.romanization, aux.bgRoman, "\n") && {
          romanization: appendMeta(entry.line.romanization, aux.bgRoman, "\n"),
        }),
      };
    }

    return {
      ...entry.line,
      ...(appendMeta(entry.line.translation, aux.translation, "\n") && {
        translation: appendMeta(entry.line.translation, aux.translation, "\n"),
      }),
      ...(appendMeta(entry.line.romanization, aux.roman, "\n") && {
        romanization: appendMeta(entry.line.romanization, aux.roman, "\n"),
      }),
    };
  });
};

export const parseTtml = (content: string): LyricLine[] => {
  if (!content?.trim()) return [];

  let doc: any[];
  try {
    doc = xml.parse(content) as any[];
  } catch (err) {
    console.error("TTML XML parse failed", err);
    return [];
  }

  const tt = first(doc, "tt");
  if (!tt) return [];

  const mode = modeOf(attrsOf(tt)["@_itunes:timing"]);
  const body = first(kidsOf(tt), "body");
  if (!body) return [];

  const tracks = parseHead(tt);
  const list = parseBody(kidsOf(body), mode);
  if (list.length === 0) return [];

  // Detect duets from distinct ttm:agent values
  const agents = new Set<string>();
  for (const entry of list) {
    if (entry.agent) agents.add(entry.agent);
  }

  if (agents.size >= 2) {
    const order = Array.from(agents);
    for (const entry of list) {
      entry.line.isDuet = true;
      if (entry.agent) {
        entry.line.agent = entry.agent;
        entry.line.align = entry.agent === order[0] ? "left" : "right";
      }
    }
  }

  const lines = appendTail(mergeHead(list, tracks), bodyEndOf(body));
  lines.sort((a, b) => a.time - b.time);

  const withInterludes = insertInterludes(lines);
  const filtered = filterShortInterludes(withInterludes);
  return addDurations(filtered);
};
