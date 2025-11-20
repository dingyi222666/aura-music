import { useCallback, useState } from "react";
import { Song } from "../types";
import {
  extractColors,
  parseAudioMetadata,
  parseNeteaseLink,
} from "../services/utils";
import {
  fetchNeteasePlaylist,
  fetchNeteaseSong,
  getNeteaseAudioUrl,
} from "../services/lyricsService";

export interface ImportResult {
  success: boolean;
  message?: string;
  songs: Song[];
}

export const usePlaylist = () => {
  const [queue, setQueue] = useState<Song[]>([]);
  const [originalQueue, setOriginalQueue] = useState<Song[]>([]);

  const updateSongInQueue = useCallback((id: string, updates: Partial<Song>) => {
    setQueue((prev) =>
      prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
    );
    setOriginalQueue((prev) =>
      prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
    );
  }, []);

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
      const newSongs: Song[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const url = URL.createObjectURL(file);
        let title = file.name.replace(/\.[^/.]+$/, "");
        let artist = "Unknown Artist";
        let coverUrl: string | undefined;
        let colors: string[] | undefined;

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
        } catch (err) {
          console.warn("Local metadata extraction failed", err);
        }

        newSongs.push({
          id: `local-${Date.now()}-${i}`,
          title,
          artist,
          fileUrl: url,
          coverUrl,
          lyrics: [],
          colors: colors && colors.length > 0 ? colors : undefined,
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
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch Netease music", err);
        return { success: false, message: "Failed to load songs from URL", songs: [] };
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
