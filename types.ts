export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricLine {
  key?: string; // Source lyric key (e.g. TTML itunes:key)
  time: number; // Start time in seconds
  endTime?: number; // End time in seconds (from TTML <p> end or last word)
  text: string; // Main text (e.g. Original Language)
  translation?: string; // Secondary text (e.g. Translation)
  romanization?: string; // Optional romanized lyric line
  words?: LyricWord[]; // For enhanced LRC animation of the main text
  isPreciseTiming?: boolean; // If true, end times are exact (from YRC) and shouldn't be auto-extended
  isInterlude?: boolean; // If true, this is an instrumental interlude line ("...")
  isMetadata?: boolean; // If true, line represents metadata and shouldn't drive playback
  isBackground?: boolean; // If true, this line is background vocal
  isDuet?: boolean; // If true, this line belongs to a multi-performer song
  agent?: string; // Performer ID from ttm:agent (e.g. "v1", "v2")
  align?: "left" | "right"; // Alignment for duet lines
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  fileUrl: string;
  source?: "local" | "remote";
  origin?: string;
  coverUrl?: string;
  lyrics?: LyricLine[];
  colors?: string[]; // Array of dominant colors
  needsLyricsMatch?: boolean; // Flag indicating song needs cloud lyrics matching
  // Netease specific fields
  isNetease?: boolean;
  neteaseId?: string;
  album?: string;
}

export enum PlayState {
  PAUSED,
  PLAYING,
}

export enum PlayMode {
  LOOP_ALL,
  LOOP_ONE,
  SHUFFLE,
}
