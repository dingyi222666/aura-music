import { useCallback, useState } from "react";
import { Song } from "../types";
import {
  extractColors,
  parseAudioMetadata,
  parseNeteaseLink,
} from "../services/utils";
import { parseLyrics } from "../services/lyrics";
import {
  fetchNeteasePlaylist,
  fetchNeteaseSong,
  getNeteaseAudioUrl,
} from "../services/lyricsService";

// Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1: string, str2: string): number => {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
};

// Calculate similarity score (0-1, higher is better)
const calculateSimilarity = (str1: string, str2: string): number => {
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  return 1 - distance / maxLen;
};

export interface ImportResult {
  success: boolean;
  message?: string;
  songs: Song[];
}

export const usePlaylist = () => {
  const [queue, setQueue] = useState<Song[]>([]);
  const [originalQueue, setOriginalQueue] = useState<Song[]>([]);

  const updateSongInQueue = useCallback(
    (id: string, updates: Partial<Song>) => {
      setQueue((prev) =>
        prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
      );
      setOriginalQueue((prev) =>
        prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
      );
    },
    [],
  );

  const appendSongs = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    setOriginalQueue((prev) => [...prev, ...songs]);
    setQueue((prev) => [...prev, ...songs]);
  }, []);

  const removeSongs = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setQueue((prev) => prev.filter((song) => !ids.includes(song.id)));
    setOriginalQueue((prev) => prev.filter((song) => !ids.includes(song.id)));
  }, []);

  const addLocalFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileList =
        files instanceof FileList ? Array.from(files) : Array.from(files);

      // Separate audio and lyrics files
      const audioFiles: File[] = [];
      const lyricsFiles: File[] = [];

      fileList.forEach((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "lrc" || ext === "txt") {
          lyricsFiles.push(file);
        } else {
          audioFiles.push(file);
        }
      });

      const newSongs: Song[] = [];

      // Build lyrics map: extract song title from filename (part after first "-")
      // Remove Netease IDs like (12345678) from title
      const lyricsMap = new Map<string, File>();
      lyricsFiles.forEach((file) => {
        const basename = file.name.replace(/\.[^/.]+$/, "");
        const firstDashIndex = basename.indexOf("-");

        // If has "-", use part after first dash as title, otherwise use full basename
        let title = firstDashIndex > 0 && firstDashIndex < basename.length - 1
          ? basename.substring(firstDashIndex + 1).trim()
          : basename;

        // Remove Netease ID pattern like (12345678) or [12345678]
        title = title.replace(/[\(\[]?\d{7,9}[\)\]]?/g, "").trim();

        lyricsMap.set(title.toLowerCase(), file);
      });

      // Process audio files
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const url = URL.createObjectURL(file);
        const basename = file.name.replace(/\.[^/.]+$/, "");
        let title = basename;
        let artist = "Unknown Artist";
        let coverUrl: string | undefined;
        let colors: string[] | undefined;
        let lyrics: { time: number; text: string }[] = [];

        const nameParts = title.split("-");
        if (nameParts.length > 1) {
          artist = nameParts[0].trim();
          title = nameParts[1].trim();
        }

        try {
          const metadata = await parseAudioMetadata(file);
          if (metadata.title) title = metadata.title;
          if (metadata.artist) artist = metadata.artist;
          if (metadata.picture) {
            coverUrl = metadata.picture;
            colors = await extractColors(coverUrl);
          }

          // Check for embedded lyrics first (highest priority)
          if (metadata.lyrics && metadata.lyrics.trim().length > 0) {
            try {
              lyrics = parseLyrics(metadata.lyrics);
            } catch (err) {
              console.warn("Failed to parse embedded lyrics", err);
            }
          }

          // If no embedded lyrics, try to match lyrics by fuzzy matching
          if (lyrics.length === 0) {
            // Normalize song title for matching
            const songTitle = title.toLowerCase().trim();

            // Try exact match first
            let matchedLyricsFile = lyricsMap.get(songTitle);

            // If no exact match, try fuzzy matching
            if (!matchedLyricsFile && lyricsMap.size > 0) {
              let bestMatch: { file: File; score: number } | null = null;
              const minSimilarity = 0.75; // Require 75% similarity (allows 1-2 errors for typical song titles)

              for (const [lyricsTitle, lyricsFile] of lyricsMap.entries()) {
                const similarity = calculateSimilarity(songTitle, lyricsTitle);

                if (similarity >= minSimilarity) {
                  if (!bestMatch || similarity > bestMatch.score) {
                    bestMatch = { file: lyricsFile, score: similarity };
                  }
                }
              }

              if (bestMatch) {
                matchedLyricsFile = bestMatch.file;
              }
            }

            // Load matched lyrics file
            if (matchedLyricsFile) {
              const reader = new FileReader();
              const lrcText = await new Promise<string>((resolve) => {
                reader.onload = (e) =>
                  resolve((e.target?.result as string) || "");
                reader.readAsText(matchedLyricsFile!);
              });
              if (lrcText) {
                lyrics = parseLyrics(lrcText);
              }
            }
          }
        } catch (err) {
          console.warn("Local metadata extraction failed", err);
        }

        newSongs.push({
          id: `local-${Date.now()}-${i}`,
          title,
          artist,
          fileUrl: url,
          coverUrl,
          lyrics,
          colors: colors && colors.length > 0 ? colors : undefined,
          needsLyricsMatch: lyrics.length === 0, // Flag for cloud matching
        });
      }

      appendSongs(newSongs);
      return newSongs;
    },
    [appendSongs],
  );

  const importFromUrl = useCallback(
    async (input: string): Promise<ImportResult> => {
      const parsed = parseNeteaseLink(input);
      if (!parsed) {
        return {
          success: false,
          message:
            "Invalid Netease URL. Use https://music.163.com/#/song?id=... or playlist",
          songs: [],
        };
      }

      const newSongs: Song[] = [];
      try {
        if (parsed.type === "playlist") {
          const songs = await fetchNeteasePlaylist(parsed.id);
          songs.forEach((song) => {
            newSongs.push({
              ...song,
              fileUrl: getNeteaseAudioUrl(song.id),
              lyrics: [],
              colors: [],
              needsLyricsMatch: true,
            });
          });
        } else {
          const song = await fetchNeteaseSong(parsed.id);
          if (song) {
            newSongs.push({
              ...song,
              fileUrl: getNeteaseAudioUrl(song.id),
              lyrics: [],
              colors: [],
              needsLyricsMatch: true,
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch Netease music", err);
        return {
          success: false,
          message: "Failed to load songs from URL",
          songs: [],
        };
      }

      appendSongs(newSongs);
      if (newSongs.length === 0) {
        return {
          success: false,
          message: "Failed to load songs from URL",
          songs: [],
        };
      }

      return { success: true, songs: newSongs };
    },
    [appendSongs],
  );

  return {
    queue,
    originalQueue,
    updateSongInQueue,
    removeSongs,
    addLocalFiles,
    importFromUrl,
    setQueue,
    setOriginalQueue,
  };
};
