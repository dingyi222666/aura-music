export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricLine {
  time: number; // Start time in seconds
  text: string; // Main text (e.g. Original Language)
  translation?: string; // Secondary text (e.g. Translation)
  words?: LyricWord[]; // For enhanced LRC animation of the main text
  isPreciseTiming?: boolean; // If true, end times are exact (from YRC) and shouldn't be auto-extended
  isInterlude?: boolean; // If true, this is an instrumental interlude line ("...")
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  fileUrl: string;
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
  SHUFFLE
}
