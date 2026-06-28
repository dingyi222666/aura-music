import { useCallback, useEffect, useRef, useState } from "react";
import { Song } from "../types";
import type { ExtractedColors } from "../services/utils";
import {
  deleteLocalFiles,
  hydrateLibrarySnapshot,
  loadLibrarySnapshot,
  revokeLocalUrls,
  saveLibrarySnapshot,
  saveLocalFiles,
} from "../services/libraryStore";
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
import { audioResourceCache } from "../services/cache";
import { useI18n } from "./useI18n";

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
  const { dict } = useI18n();
  const [queue, setQueue] = useState<Song[]>([]);
  const [isReady, setIsReady] = useState(false);
  const urlsRef = useRef(new Map<string, string>());

  const storeUrl = useCallback((id: string, url: string) => {
    const prev = urlsRef.current.get(id);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
    }
    urlsRef.current.set(id, url);
  }, []);

  const dropUrls = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      const url = urlsRef.current.get(id);
      if (!url) {
        return;
      }

      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    });
  }, []);

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      try {
        const snap = await loadLibrarySnapshot();
        if (!snap || canceled) {
          return;
        }

        const data = await hydrateLibrarySnapshot(snap);
        if (canceled) {
          revokeLocalUrls(data.queue);
          return;
        }

        data.queue.forEach((song) => {
          if (song.source === "local" && song.fileUrl.startsWith("blob:")) {
            storeUrl(song.id, song.fileUrl);
          }
        });

        setQueue(data.queue);
      } catch (err) {
        console.warn("Failed to restore library", err);
      } finally {
        if (!canceled) {
          setIsReady(true);
        }
      }
    };

    load();

    return () => {
      canceled = true;
      dropUrls(Array.from(urlsRef.current.keys()));
    };
  }, [dropUrls, storeUrl]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    saveLibrarySnapshot(queue).catch((err) => {
      console.warn("Failed to save library", err);
    });
  }, [isReady, queue]);

  const updateSongInQueue = useCallback(
    (id: string, updates: Partial<Song>) => {
      setQueue((prev) =>
        prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
      );
    },
    [],
  );

  const appendSongs = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    setQueue((prev) => [...prev, ...songs]);
  }, []);

  const addSongs = useCallback((songs: Song[]) => {
    appendSongs(songs);
  }, [appendSongs]);

  /**
   * 从一批 .lrc 文件中匹配歌词到当前队列中已有歌曲。
   * 用于「加载歌词文件夹」功能：用户单独选一个 .lrc 目录，
   * 系统按多策略匹配给已导入的歌曲补上歌词。
   * 返回成功匹配的歌曲数量。
   */
  const matchLyricsFromFiles = useCallback(
    async (files: FileList | File[]): Promise<number> => {
      const fileList =
        files instanceof FileList ? Array.from(files) : Array.from(files);

      // 仅保留歌词文件
      const lyricsFiles = fileList.filter((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        return ext === "lrc" || ext === "txt" || ext === "json";
      });

      if (lyricsFiles.length === 0) return 0;

      // 提取 .lrc 文件的 basename（不含扩展名，保留全名）
      const lrcBasenameList = lyricsFiles.map((file) => ({
        file,
        basename: file.name.replace(/\.[^/.]+$/, ""),
      }));

      // 提前缓存已读取的 .lrc 文本
      const lrcTextCache = new Map<File, string>();
      const readLrc = async (file: File): Promise<string> => {
        if (lrcTextCache.has(file)) return lrcTextCache.get(file)!;
        const text = await file.text();
        lrcTextCache.set(file, text);
        return text;
      };

      // 提取 lrc basename 的 title 部分（"-" 后的部分，去掉网易云 ID）
      const extractTitlePart = (basename: string): string => {
        const firstDashIndex = basename.indexOf("-");
        let title =
          firstDashIndex > 0 && firstDashIndex < basename.length - 1
            ? basename.substring(firstDashIndex + 1).trim()
            : basename;
        title = title.replace(/[\(\[]?\d{7,9}[\)\]]?/g, "").trim();
        return title;
      };

      let matchCount = 0;

      // 在 setQueue 之外异步读取并匹配，最后一次性更新
      const currentQueue = queue; // 闭包捕获当前快照
      const next: Song[] = [];
      for (const song of currentQueue) {
        // 已有歌词且非空，跳过
        if (song.lyrics && song.lyrics.length > 0) {
          next.push(song);
          continue;
        }

        // 多策略匹配，找到最佳 .lrc 文件
        let matchedFile: File | undefined;
        let matchedScore = -1;

        const songTitleLower = song.title.toLowerCase().trim();
        const songArtistLower = song.artist.toLowerCase().trim();
        const songOriginalName = (song.originalFileName ?? "").toLowerCase().trim();

        for (const { file, basename } of lrcBasenameList) {
          const basenameLower = basename.toLowerCase();
          const lrcTitlePart = extractTitlePart(basename).toLowerCase();
          let score = -1;

          // 策略 1: 音频原始文件名 == lrc 原始 basename（最高优先级，95 分）
          if (songOriginalName && songOriginalName === basenameLower) {
            score = 95;
          }
          // 策略 2: song.artist + " - " + song.title == lrc basename（90 分）
          else if (
            songArtistLower &&
            songTitleLower &&
            `${songArtistLower} - ${songTitleLower}` === basenameLower
          ) {
            score = 90;
          }
          // 策略 3: song.title == lrc title 部分（85 分）
          else if (songTitleLower && songTitleLower === lrcTitlePart) {
            score = 85;
          }
          // 策略 4: fuzzy 匹配 song.originalFileName 与 lrc basename（80 分阈值）
          else if (songOriginalName) {
            const similarity = calculateSimilarity(songOriginalName, basenameLower);
            if (similarity >= 0.9) score = 80 * similarity;
          }
          // 策略 5: fuzzy 匹配 song.title 与 lrc title 部分
          else if (songTitleLower) {
            const similarity = calculateSimilarity(songTitleLower, lrcTitlePart);
            if (similarity >= 0.9) score = 75 * similarity;
          }

          if (score > matchedScore) {
            matchedScore = score;
            matchedFile = file;
          }
        }

        // 阈值 70 分以上才接受
        if (matchedFile && matchedScore >= 70) {
          try {
            const text = await readLrc(matchedFile);
            if (text && text.trim()) {
              const parsed = parseLyrics(text);
              if (parsed.length > 0) {
                next.push({
                  ...song,
                  lyrics: parsed,
                  // 保留 needsLyricsMatch: true，让在线 API 有机会覆盖本地歌词
                  // （本地歌词作为兜底，在线歌词优先级更高，含翻译/TTML 等）
                  needsLyricsMatch: song.needsLyricsMatch ?? true,
                });
                matchCount++;
                continue;
              }
            }
          } catch (err) {
            console.warn(`Failed to read lyrics for ${song.title}:`, err);
          }
        }

        next.push(song);
      }

      if (matchCount > 0) {
        setQueue(next);
      }

      return matchCount;
    },
    [queue],
  );

  const reorder = useCallback((ids: string[]) => {
    if (ids.length === 0) return;

    const order = new Map(ids.map((id, idx) => [id, idx]));
    setQueue((prev) => {
      if (
        prev.length !== ids.length ||
        order.size !== ids.length ||
        prev.some((song) => !order.has(song.id))
      ) {
        return prev;
      }

      return [...prev].sort(
        (a, b) =>
          (order.get(a.id) ?? ids.length) - (order.get(b.id) ?? ids.length),
      );
    });
  }, []);

  const removeSongs = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const locals = new Set<string>();

    setQueue((prev) => {
      prev.forEach((song) => {
        if (ids.includes(song.id) && song.fileUrl && !song.fileUrl.startsWith("blob:")) {
          audioResourceCache.delete(song.fileUrl);
        }
        if (ids.includes(song.id) && song.source === "local") {
          locals.add(song.id);
        }
      });
      return prev.filter((song) => !ids.includes(song.id));
    });
    if (locals.size > 0) {
      const list = Array.from(locals);
      dropUrls(list);
      deleteLocalFiles(list).catch((err) => {
        console.warn("Failed to delete local files", err);
      });
    }
  }, [dropUrls]);

  const addLocalFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileList =
        files instanceof FileList ? Array.from(files) : Array.from(files);

      // Separate audio and lyrics files
      const audioFiles: File[] = [];
      const lyricsFiles: File[] = [];

      fileList.forEach((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "lrc" || ext === "txt" || ext === "json") {
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
        const basename = file.name.replace(/\.[^/.]+$/, "");
        let title = basename;
        let artist = dict.playlist.unknownArtist;
        let coverUrl: string | undefined;
        let colors: ExtractedColors | undefined;
        let themeColor: string | undefined;
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
            themeColor = colors.themeColor;
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
          fileUrl: "",
          source: "local",
          coverUrl,
          lyrics,
          colors: colors && colors.length > 0 ? colors : undefined,
          themeColor,
          needsLyricsMatch: lyrics.length === 0, // Flag for cloud matching
          originalFileName: basename, // 保存原始文件名（不含扩展名）供歌词匹配
        });
      }

      newSongs.forEach((song, idx) => {
        const url = URL.createObjectURL(audioFiles[idx]);
        song.fileUrl = url;
        storeUrl(song.id, url);
      });

      try {
        await saveLocalFiles(
          newSongs.map((song, idx) => ({
            id: song.id,
            file: audioFiles[idx],
          })),
        );
      } catch (err) {
        console.warn("Failed to persist local files", err);
      }

      appendSongs(newSongs);
      return newSongs;
    },
    [appendSongs, dict.playlist.unknownArtist, storeUrl],
  );

  const importFromUrl = useCallback(
    async (input: string): Promise<ImportResult> => {
      const parsed = parseNeteaseLink(input);
      if (!parsed) {
        return {
          success: false,
          message: dict.playlist.invalidUrl,
          songs: [],
        };
      }

      const newSongs: Song[] = [];
      try {
        if (parsed.type === "playlist") {
          const songs = await fetchNeteasePlaylist(parsed.id);
          songs.forEach((song) => {
            const origin = getNeteaseAudioUrl(song.id);
            newSongs.push({
              ...song,
              fileUrl: origin,
              source: "remote",
              origin,
              lyrics: [],
              colors: [],
              needsLyricsMatch: true,
            });
          });
        } else {
          const song = await fetchNeteaseSong(parsed.id);
          if (song) {
            const origin = getNeteaseAudioUrl(song.id);
            newSongs.push({
              ...song,
              fileUrl: origin,
              source: "remote",
              origin,
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
          message: dict.app.importFail,
          songs: [],
        };
      }

      appendSongs(newSongs);
      if (newSongs.length === 0) {
        return {
          success: false,
          message: dict.app.importFail,
          songs: [],
        };
      }

      return { success: true, songs: newSongs };
    },
    [appendSongs, dict.app.importFail, dict.playlist.invalidUrl],
  );

  return {
    queue,
    isReady,
    updateSongInQueue,
    addSongs,
    reorder,
    removeSongs,
    addLocalFiles,
    matchLyricsFromFiles,
    importFromUrl,
    setQueue,
  };
};
