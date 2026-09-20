import { LyricLine } from "@aura-music/core/types";

export const BG_LEAD = 0.9;
export const BG_TRAIL = 0.45;
const EPSILON = 1e-3;

export const endOf = (line: LyricLine) => {
  if (line.endTime && line.endTime > line.time) return line.endTime;
  const word = line.words?.[line.words.length - 1];
  return word && word.endTime > line.time ? word.endTime : line.time + 4;
};

const main = (line: LyricLine) => !line.isMetadata && !line.isBackground && !line.isInterlude;

export interface ActiveState {
  activeIndexes: number[];
  anchorIndex: number;
}

interface Span { index: number; start: number; end: number }
interface ScrollGroup { start: number; end: number; items: number[] }

// Prefix maximum ends stop backwards lookup once all earlier intervals expired.
// This supports overlapping vocals and arbitrary seeks without a per-frame scan
// through every lyric. Construction happens once per song.
class Intervals {
  readonly spans: Span[];
  private readonly ends: number[];

  constructor(spans: Span[]) {
    this.spans = spans.sort((a, b) => a.start - b.start || a.index - b.index);
    let end = -Infinity;
    this.ends = this.spans.map((span) => end = Math.max(end, span.end));
  }

  latest(time: number) {
    let low = 0;
    let high = this.spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.spans[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  }

  at(time: number) {
    const matches: number[] = [];
    for (let i = this.latest(time); i >= 0 && this.ends[i] > time; i--) {
      if (this.spans[i].end > time) matches.push(this.spans[i].index);
    }
    return matches.sort((a, b) => a - b);
  }
}

export class LyricsTimeline {
  readonly anchors: number[];
  readonly groups: ScrollGroup[] = [];
  readonly order: number[] = [];
  readonly ranks: number[];
  private readonly intervals: Intervals;
  private readonly scrolling: Intervals;
  private readonly leads: Intervals;
  private time = Number.NaN;
  private state: ActiveState = { activeIndexes: [], anchorIndex: -1 };

  constructor(readonly lyrics: LyricLine[]) {
    const keys = new Map<string, number>();
    lyrics.forEach((line, i) => {
      if (main(line) && line.key && !keys.has(line.key)) keys.set(line.key, i);
    });
    let last = -1;
    this.anchors = lyrics.map((line, index) => {
      if (!line.isBackground) {
        if (main(line)) last = index;
        return index;
      }
      const keyed = line.key ? keys.get(line.key) : undefined;
      if (keyed !== undefined) return keyed;
      for (let i = index - 1; i >= 0; i--) {
        if (main(lyrics[i]) && endOf(lyrics[i]) > line.time + EPSILON) return i;
      }
      return last >= 0 ? last : index;
    });

    const children = new Map<number, number[]>();
    this.anchors.forEach((anchor, i) => {
      if (!lyrics[i].isBackground || anchor === i) return;
      const group = children.get(anchor) ?? [];
      group.push(i);
      children.set(anchor, group);
    });
    lyrics.forEach((line, i) => {
      if (!line.isBackground || this.anchors[i] === i) this.order.push(i, ...(children.get(i) ?? []));
    });

    const spans: Span[] = [];
    let next = Infinity;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      const line = lyrics[i];
      if (line.isMetadata) continue;
      const end = endOf(line);
      spans.push({
        index: i,
        start: line.time - (line.isBackground ? BG_LEAD : 0),
        end: line.isBackground ? end + BG_TRAIL : line.isInterlude || next === Infinity ? end : Math.max(end, next),
      });
      if (!line.isBackground) next = line.time;
    }
    this.intervals = new Intervals(spans);
    this.leads = new Intervals(spans.filter((span) => !lyrics[span.index].isBackground));

    const items = this.leads.spans.map((span) => span.index);
    for (let i = 0; i < items.length;) {
      const start = items[i];
      const limit = endOf(lyrics[start]);
      const block = [start];
      let tail = limit;
      let next = i + 1;
      while (!lyrics[start].isInterlude && next < items.length) {
        const index = items[next];
        if (lyrics[index].isInterlude || lyrics[index].time >= limit - EPSILON || endOf(lyrics[index]) > limit + 0.75) break;
        block.push(index);
        tail = Math.max(tail, endOf(lyrics[index]));
        next++;
      }
      const vocals = block.flatMap((index) => children.get(index) ?? [])
        .sort((a, b) => lyrics[a].time - lyrics[b].time);
      for (const index of vocals) {
        if (lyrics[index].time - BG_LEAD > tail + EPSILON) break;
        tail = Math.max(tail, endOf(lyrics[index]) + BG_TRAIL);
      }
      this.groups.push({ start, end: tail, items: block });
      i = next;
    }
    this.ranks = new Array(lyrics.length).fill(0);
    this.groups.forEach((group, rank) => {
      for (const index of group.items) {
        this.ranks[index] = rank;
        for (const child of children.get(index) ?? []) this.ranks[child] = rank;
      }
    });
    this.scrolling = new Intervals(this.groups.map((group) => ({
      index: group.start, start: lyrics[group.start].time, end: group.end,
    })));
  }

  active(time: number): ActiveState {
    if (time === this.time) return this.state;
    const active = new Set<number>();
    let anchor = -1;
    const add = (index: number) => {
      active.add(index);
      if (anchor < 0 && main(this.lyrics[index])) anchor = index;
    };
    for (const index of this.intervals.at(time)) {
      add(index);
      if (this.lyrics[index].isBackground) add(this.anchors[index]);
    }
    const indexes = [...active].sort((a, b) => a - b);
    this.state = {
      activeIndexes: indexes,
      anchorIndex: anchor >= 0 ? anchor : indexes[0] ?? this.leads.spans[this.leads.latest(time)]?.index ?? -1,
    };
    this.time = time;
    return this.state;
  }

  anchor(time: number) {
    return this.scrolling.at(time)[0] ?? this.scrolling.spans[this.scrolling.latest(time)]?.index ?? -1;
  }
}
