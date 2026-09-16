import { LyricLine as Source } from "../../types";
import { LyricsTimeline } from "../../services/lyrics/timeline";
import { ILyricLine } from "./ILyricLine";
import { InterludeDots } from "./InterludeDots";
import { LyricLine } from "./LyricLine";
import { LyricsMotion } from "./LyricsMotion";

export interface Layout {
  width: number;
  mobile: boolean;
  lines: ILyricLine[];
  heights: number[];
  focuses: number[];
}

const empty: Layout = { width: 0, mobile: false, lines: [], heights: [], focuses: [] };

export class LyricsEngine {
  readonly timeline: LyricsTimeline;
  readonly motion: LyricsMotion;
  private readonly next: Array<Source | undefined>;
  // At most four variants: desktop/mobile, with/without secondary text.
  private readonly layouts = new Map<string, { width: number; layout: Layout }>();

  constructor(private readonly source: Source[]) {
    this.timeline = new LyricsTimeline(source);
    this.motion = new LyricsMotion(this.timeline);
    this.next = new Array(source.length);
    let next: Source | undefined;
    for (let i = source.length - 1; i >= 0; i--) {
      this.next[i] = next;
      const line = source[i];
      if (!line.isMetadata && !line.isBackground && !line.isInterlude && line.text !== "...") {
        next = line;
      }
    }
  }

  layout(width: number, mobile: boolean, translated: boolean): Layout {
    if (width <= 0 || !this.source.length) return empty;
    const key = `${mobile}:${translated}`;
    const cached = this.layouts.get(key);
    if (cached?.width === width) return cached.layout;

    const lines = cached?.layout.lines ?? this.source.map((line, i) => {
      const next = this.next[i];
      return line.isInterlude || line.text === "..."
        ? new InterludeDots(line, mobile, next ? next.time - line.time : 0, next?.align ?? "left")
        : new LyricLine(
            translated ? line : { ...line, translation: undefined, romanization: undefined },
            mobile,
          );
    });
    const widths: number[] = [];
    const layout: Layout = { width, mobile, lines, heights: [], focuses: [] };
    for (const line of lines) {
      line.measure(width, widths.length ? Math.max(...widths) : 0);
      widths.push(line.getTextWidth());
      if (widths.length > 5) widths.shift();
      layout.heights.push(line.getHeight());
      layout.focuses.push(line.getFocusOffset());
    }
    this.layouts.set(key, { width, layout });
    return layout;
  }
}
