import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Song, PlayState, PlayMode } from "../types";
import { extractColors, shuffleArray } from "../services/utils";
import { parseLyrics } from "../services/lyrics";
import { useLyricOverlay } from "./useLyricOverlay";
import {
  loadPlaybackSnapshot,
  savePlaybackSnapshot,
} from "../services/libraryStore";
import {
  fetchLyricsById,
  searchAndMatchLyrics,
  MatchedLyricsResult,
} from "../services/lyricsService";
import { audioResourceCache } from "../services/cache";

type MatchStatus = "idle" | "matching" | "success" | "failed";

interface UsePlayerParams {
  isReady: boolean;
  queue: Song[];
  updateSongInQueue: (id: string, updates: Partial<Song>) => void;
  setQueue: Dispatch<SetStateAction<Song[]>>;
}

const MATCH_TIMEOUT_MS = 8000;
const PRELOAD_TIMEOUT_MS = 6000; // 预载阶段用稍短的超时
const PRELOAD_RETRY_DELAY_MS = 500; // 首次失败后等 500ms 再重试一次

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Lyrics request timed out"));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

export const usePlayer = ({
  isReady,
  queue,
  updateSongInQueue,
  setQueue,
}: UsePlayerParams) => {
  const savedRef = useRef(loadPlaybackSnapshot());
  const restoredRef = useRef(false);
  const songRef = useRef<string | null>(savedRef.current.songId);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playState, setPlayState] = useState<PlayState>(PlayState.PAUSED);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playMode, setPlayMode] = useState<PlayMode>(savedRef.current.playMode);
  const [matchStatus, setMatchStatus] = useState<MatchStatus>("idle");
  const [speed, setSpeed] = useState(1);
  const [preservesPitch, setPreservesPitch] = useState(true);
  const [resolvedAudioSrc, setResolvedAudioSrc] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferProgress, setBufferProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isSeekingRef = useRef(false);
  const poolRef = useRef<string[]>([]);
  const pastRef = useRef<string[]>([]);

  const applyAudio = useCallback(() => {
    const audio = audioRef.current as (HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
      mozPreservesPitch?: boolean;
    }) | null;
    if (!audio) return;

    audio.preservesPitch = preservesPitch;
    audio.webkitPreservesPitch = preservesPitch;
    audio.mozPreservesPitch = preservesPitch;
    audio.playbackRate = speed;
  }, [preservesPitch, speed]);

  const pauseAndResetCurrentAudio = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, []);

  const setIndex = useCallback(
    (index: number, list: Song[] = queue) => {
      songRef.current = index >= 0 ? list[index]?.id ?? null : null;
      setCurrentIndex(index);
    },
    [queue],
  );

  const currentSong =
    (songRef.current
      ? queue.find((song) => song.id === songRef.current)
      : null) ??
    queue[currentIndex] ??
    null;
  const accentColor = currentSong?.colors?.[0] || "#a855f7";
  const idsKey = queue.map((song) => song.id).join("\n");

  const pickShuffle = useCallback(() => {
    if (queue.length === 0) {
      return null;
    }

    const currId = currentSong?.id ?? null;
    const ids = new Set(queue.map((song) => song.id));
    const seen = new Set<string>();

    poolRef.current = poolRef.current.filter((id) => {
      if (!ids.has(id) || id === currId || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });

    if (poolRef.current.length === 0) {
      poolRef.current = shuffleArray(
        queue.map((song) => song.id).filter((id) => id !== currId),
      );
    }

    return poolRef.current.shift() ?? currId ?? queue[0]?.id ?? null;
  }, [currentSong?.id, queue]);

  const toggleMode = useCallback(() => {
    let nextMode: PlayMode;
    if (playMode === PlayMode.LOOP_ALL) nextMode = PlayMode.LOOP_ONE;
    else if (playMode === PlayMode.LOOP_ONE) nextMode = PlayMode.SHUFFLE;
    else nextMode = PlayMode.LOOP_ALL;

    setPlayMode(nextMode);
    setMatchStatus("idle");

    if (nextMode === PlayMode.SHUFFLE) {
      const currId = currentSong?.id ?? null;
      poolRef.current = shuffleArray(
        queue.map((song) => song.id).filter((id) => id !== currId),
      );
      pastRef.current = [];
    } else {
      poolRef.current = [];
      pastRef.current = [];
    }
  }, [playMode, currentSong?.id, queue]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playState === PlayState.PLAYING) {
      audioRef.current.pause();
      setPlayState(PlayState.PAUSED);
    } else {
      const duration = audioRef.current.duration || 0;
      const isAtEnd =
        duration > 0 && audioRef.current.currentTime >= duration - 0.01;
      if (isAtEnd) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
      }
      applyAudio();
      audioRef.current.play().catch((err) => console.error("Play failed", err));
      setPlayState(PlayState.PLAYING);
    }
  }, [applyAudio, playState]);

  const play = useCallback(() => {
    if (!audioRef.current) return;
    applyAudio();
    audioRef.current
      .play()
      .catch((err) => console.error("Play failed", err));
    setPlayState(PlayState.PLAYING);
  }, [applyAudio]);

  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setPlayState(PlayState.PAUSED);
  }, []);

  const handleSeek = useCallback(
    (
      time: number,
      playImmediately: boolean = false,
      defer: boolean = false,
    ) => {
      if (!audioRef.current) return;

      if (defer) {
        // Only update visual state during drag, don't actually seek
        isSeekingRef.current = true;
        setCurrentTime(time);
      } else {
        // Actually perform the seek
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        isSeekingRef.current = false;
        if (playImmediately) {
          applyAudio();
          audioRef.current
            .play()
            .catch((err) => console.error("Play failed", err));
          setPlayState(PlayState.PLAYING);
        }
      }
    },
    [applyAudio],
  );

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || isSeekingRef.current) return;
    const value = audioRef.current.currentTime;
    setCurrentTime(Number.isFinite(value) ? value : 0);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    applyAudio();
    const value = audioRef.current.duration;
    setDuration(Number.isFinite(value) ? value : 0);
    if (playState === PlayState.PLAYING) {
      audioRef.current
        .play()
        .catch((err) => console.error("Auto-play failed", err));
    }
  }, [applyAudio, playState]);

  useEffect(() => {
    isSeekingRef.current = false;
    setCurrentTime(0);
    setDuration(0);
  }, [currentSong?.id]);

  useEffect(() => {
    if (playMode !== PlayMode.SHUFFLE) {
      poolRef.current = [];
      pastRef.current = [];
      return;
    }

    const currId = currentSong?.id ?? null;
    const ids = new Set(queue.map((song) => song.id));
    const seen = new Set<string>();

    poolRef.current = poolRef.current.filter((id) => {
      if (!ids.has(id) || id === currId || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });

    pastRef.current = pastRef.current.filter((id) => ids.has(id));

    const extra = queue
      .map((song) => song.id)
      .filter(
        (id) =>
          id !== currId &&
          !poolRef.current.includes(id) &&
          !pastRef.current.includes(id),
      );

    if (extra.length > 0) {
      poolRef.current = [...poolRef.current, ...shuffleArray(extra)];
    }
  }, [idsKey, playMode, currentSong?.id, queue]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;

    if (playMode === PlayMode.LOOP_ONE) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
      return;
    }

    pauseAndResetCurrentAudio();

    if (playMode === PlayMode.SHUFFLE) {
      const nextId = pickShuffle();
      const currId = currentSong?.id ?? null;

      if (!nextId) {
        return;
      }

      if (currId && currId !== nextId) {
        pastRef.current.push(currId);
      }

      const idx = queue.findIndex((song) => song.id === nextId);
      if (idx === -1) {
        return;
      }

      setIndex(idx);
      setMatchStatus("idle");
      setPlayState(PlayState.PLAYING);
      return;
    }

    const next = (currentIndex + 1) % queue.length;
    setIndex(next);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [
    queue,
    playMode,
    currentIndex,
    pauseAndResetCurrentAudio,
    setIndex,
    pickShuffle,
    currentSong?.id,
  ]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    pauseAndResetCurrentAudio();

    if (playMode === PlayMode.SHUFFLE) {
      const prevId = pastRef.current.pop();
      const currId = currentSong?.id ?? null;

      if (!prevId) {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
        }
        setMatchStatus("idle");
        setPlayState(PlayState.PLAYING);
        return;
      }

      if (currId && currId !== prevId) {
        poolRef.current = [
          currId,
          ...poolRef.current.filter((id) => id !== currId),
        ];
      }

      const idx = queue.findIndex((song) => song.id === prevId);
      if (idx === -1) {
        return;
      }

      setIndex(idx);
      setMatchStatus("idle");
      setPlayState(PlayState.PLAYING);
      return;
    }

    const prev = (currentIndex - 1 + queue.length) % queue.length;
    setIndex(prev);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [
    queue,
    playMode,
    currentIndex,
    pauseAndResetCurrentAudio,
    setIndex,
    currentSong?.id,
  ]);

  const playIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      pauseAndResetCurrentAudio();

      if (playMode === PlayMode.SHUFFLE) {
        const nextId = queue[index]?.id;
        const currId = currentSong?.id ?? null;

        if (nextId) {
          poolRef.current = poolRef.current.filter((id) => id !== nextId);
        }

        if (currId && nextId && currId !== nextId) {
          pastRef.current.push(currId);
        }
      }

      setIndex(index);
      setPlayState(PlayState.PLAYING);
      setMatchStatus("idle");
    },
    [queue, playMode, pauseAndResetCurrentAudio, setIndex, currentSong?.id],
  );

  const handleAudioEnded = useCallback(() => {
    if (playMode === PlayMode.LOOP_ONE) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .catch((err) => console.error("Play failed", err));
      }
      setPlayState(PlayState.PLAYING);
      return;
    }

    if (queue.length === 1) {
      setPlayState(PlayState.PAUSED);
      return;
    }

    playNext();
  }, [playMode, queue.length, playNext]);

  const addSongAndPlay = useCallback(
    (song: Song) => {
      if (playMode === PlayMode.SHUFFLE && currentSong?.id && currentSong.id !== song.id) {
        pastRef.current.push(currentSong.id);
      }

      setQueue((prev) => {
        const next = [...prev, song];
        poolRef.current = poolRef.current.filter((id) => id !== song.id);
        setIndex(next.length - 1, next);
        setPlayState(PlayState.PLAYING);
        setMatchStatus("idle");
        return next;
      });
    },
    [playMode, currentSong?.id, setIndex, setQueue],
  );

  const handlePlaylistAddition = useCallback(
    (added: Song[], wasEmpty: boolean) => {
      if (added.length === 0) return;
      setMatchStatus("idle");
      if (wasEmpty || currentIndex === -1) {
        setIndex(0);
        setPlayState(PlayState.PLAYING);
      }
    },
    [currentIndex, setIndex],
  );

  const mergeLyricsWithMetadata = useCallback(
    (result: MatchedLyricsResult) => {
      const hasTtml = Boolean(result.ttml && result.ttml.trim());

      const parsed = hasTtml
        ? parseLyrics(result.ttml!)
        : parseLyrics(result.lrc ?? "", result.tLrc, {
            yrcContent: result.yrc,
          });

      const metadataCount = result.metadata.length;
      const metadataLines = result.metadata.map((text, idx) => ({
        time: -0.1 * (metadataCount - idx),
        text,
        isMetadata: true,
      }));

      return [...metadataLines, ...parsed].sort((a, b) => a.time - b.time);
    },
    [],
  );

  const loadLyricsFile = useCallback(
    (file?: File) => {
      if (!file || !currentSong) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          const parsedLyrics = parseLyrics(text);
          updateSongInQueue(currentSong.id, { lyrics: parsedLyrics });
          setMatchStatus("success");
        }
      };
      reader.readAsText(file);
    },
    [currentSong, updateSongInQueue],
  );

  /**
   * 预测下一首要播放的歌曲（基于 playMode）。
   * - LOOP_ONE: 无下一首，返回 null
   * - SHUFFLE:  peek poolRef 头部（不消费），保证预载的就是真随机的下一首
   * - LOOP_ALL: 顺序模式 queue[(currentIndex + 1) % length]
   */
  const predictNextSong = useCallback((): Song | null => {
    if (queue.length === 0) return null;
    if (playMode === PlayMode.LOOP_ONE) return null;

    if (playMode === PlayMode.SHUFFLE) {
      const currId = currentSong?.id ?? null;
      // 过滤已失效的 id 与当前 id（与 pickShuffle 同样的清理逻辑）
      const ids = new Set(queue.map((s) => s.id));
      const seen = new Set<string>();
      const pool = poolRef.current.filter((id) => {
        if (!ids.has(id) || id === currId || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      poolRef.current = pool;
      const nextId = pool[0];
      return nextId ? queue.find((s) => s.id === nextId) ?? null : null;
    }

    // LOOP_ALL
    if (currentIndex < 0) return null;
    const nextIdx = (currentIndex + 1) % queue.length;
    return queue[nextIdx] ?? null;
  }, [queue, playMode, currentIndex, currentSong?.id]);

  /**
   * 单首歌词预载：带 1 次重试。
   * 返回 'success' | 'failed' | 'skip'。
   * - 'success': 在线匹配成功（已写入 lyrics，覆盖本地兜底），或无需匹配
   * - 'failed': 在线 API 不可用（两次都失败），已标记 skipOnlineLyrics；
   *             若该歌曲已有本地歌词，本地歌词继续兜底
   * - 'skip': 该歌曲不需要在线匹配（needsLyricsMatch=false 或已标记 skipOnlineLyrics）
   *
   * 关键：已有本地歌词时仍尝试预载，让在线歌词（含翻译/TTML）覆盖本地。
   */
  const preloadLyricsForSong = useCallback(
    async (song: Song): Promise<"success" | "failed" | "skip"> => {
      // 不需要在线匹配（已被前次升级成功或本来就无此标记）
      if (!song.needsLyricsMatch) return "skip";
      // 已被预载标记跳过
      if (song.skipOnlineLyrics) return "skip";
      // 已有本地歌词时仍继续：在线歌词优先级更高
      // 已被前次预载标记跳过
      if (song.skipOnlineLyrics) return "skip";

      const fetchOnce = async (): Promise<MatchedLyricsResult | null> => {
        if (song.isNetease && song.neteaseId) {
          return await withTimeout(
            fetchLyricsById(song.neteaseId),
            PRELOAD_TIMEOUT_MS,
          );
        }
        return await withTimeout(
          searchAndMatchLyrics(song.title, song.artist),
          PRELOAD_TIMEOUT_MS,
        );
      };

      let result: MatchedLyricsResult | null = null;
      let lastErr: unknown = null;

      // 第一次尝试
      try {
        result = await fetchOnce();
      } catch (err) {
        lastErr = err;
        console.warn(
          `[preload] 首次失败 (${song.title}):`,
          err instanceof Error ? err.message : err,
        );
      }

      // 第二次重试（首次失败或返回 null 时）
      if (!result) {
        await new Promise((r) => setTimeout(r, PRELOAD_RETRY_DELAY_MS));
        try {
          result = await fetchOnce();
        } catch (err) {
          lastErr = err;
          console.warn(
            `[preload] 重试失败 (${song.title}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (result) {
        // 预载成功：写入歌词，清掉 needsLyricsMatch
        updateSongInQueue(song.id, {
          lyrics: mergeLyricsWithMetadata(result),
          needsLyricsMatch: false,
          skipOnlineLyrics: false,
        });
        console.log(`[preload] 成功 (${song.title})`);
        return "success";
      }

      // 两次都失败：标记跳过，切歌时不再等超时
      updateSongInQueue(song.id, { skipOnlineLyrics: true });
      console.warn(
        `[preload] 标记跳过 (${song.title}):`,
        lastErr instanceof Error ? lastErr.message : "no result",
      );
      return "failed";
    },
    [mergeLyricsWithMetadata, updateSongInQueue],
  );

  // 预载 useEffect：每次切歌完成后，立即为下一首预载歌词。
  // 这样上一首歌剩余的播放时间都用上了，API 挂掉时切歌后不会干等超时。
  useEffect(() => {
    if (!isReady || !currentSong) return;

    const nextSong = predictNextSong();
    // 没有下一首（LOOP_ONE 或单元素队列）就不预载
    if (!nextSong || nextSong.id === currentSong.id) return;

    let cancelled = false;
    const run = async () => {
      // 短延迟，让切歌动画/音频加载先处理完
      await new Promise((r) => setTimeout(r, 300));
      if (cancelled) return;
      await preloadLyricsForSong(nextSong);
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [
    isReady,
    currentSong?.id,
    predictNextSong,
    preloadLyricsForSong,
  ]);

  useEffect(() => {
    if (!currentSong) {
      if (matchStatus !== "idle") {
        setMatchStatus("idle");
      }
      return;
    }

    const songId = currentSong.id;
    const songTitle = currentSong.title;
    const songArtist = currentSong.artist;
    const needsLyricsMatch = currentSong.needsLyricsMatch;
    const skipOnlineLyrics = currentSong.skipOnlineLyrics;
    const existingLyrics = currentSong.lyrics ?? [];
    const isNeteaseSong = currentSong.isNetease;
    const songNeteaseId = currentSong.neteaseId;

    let cancelled = false;

    const markMatchFailed = () => {
      if (cancelled) return;
      updateSongInQueue(songId, {
        needsLyricsMatch: false,
      });
      // 注意：不在这里清空 lyrics。已有本地歌词时 markMatchFailed 仅表示
      // "在线升级失败"，本地歌词继续作为兜底显示。
      setMatchStatus(existingLyrics.length > 0 ? "success" : "failed");
    };

    const markMatchSuccess = () => {
      if (cancelled) return;
      setMatchStatus("success");
    };

    // 已有歌词 + 不需要在线升级 → 直接成功
    if (existingLyrics.length > 0 && !needsLyricsMatch) {
      markMatchSuccess();
      return;
    }

    // 没有歌词 + 不需要匹配 → 失败
    if (existingLyrics.length === 0 && !needsLyricsMatch) {
      markMatchFailed();
      return;
    }

    // 已有本地歌词 + 需要在线升级：继续走在线匹配流程（成功则覆盖，失败保留本地）
    // 没有歌词 + 需要匹配：同样走在线匹配

    // 预载阶段已探测在线 API 不可用 → 直接走本地兜底，不再等超时
    if (skipOnlineLyrics) {
      console.info(
        `[lyrics] skipOnlineLyrics 已标记，跳过在线匹配: ${songTitle}` +
          (existingLyrics.length > 0 ? "（保留本地歌词）" : "（无本地歌词）"),
      );
      markMatchFailed();
      return;
    }

    const fetchLyrics = async () => {
      setMatchStatus("matching");
      try {
        if (isNeteaseSong && songNeteaseId) {
          const raw = await withTimeout(
            fetchLyricsById(songNeteaseId),
            MATCH_TIMEOUT_MS,
          );
          if (cancelled) return;
          if (raw) {
            updateSongInQueue(songId, {
              lyrics: mergeLyricsWithMetadata(raw),
              needsLyricsMatch: false,
            });
            markMatchSuccess();
          } else {
            markMatchFailed();
          }
        } else {
          const result = await withTimeout(
            searchAndMatchLyrics(songTitle, songArtist),
            MATCH_TIMEOUT_MS,
          );
          if (cancelled) return;
          if (result) {
            updateSongInQueue(songId, {
              lyrics: mergeLyricsWithMetadata(result),
              needsLyricsMatch: false,
            });
            markMatchSuccess();
          } else {
            markMatchFailed();
          }
        }
      } catch (error) {
        console.warn("Lyrics matching failed:", error);
        markMatchFailed();
      }
    };

    fetchLyrics();

    return () => {
      cancelled = true;
    };
  }, [currentSong?.id, mergeLyricsWithMetadata, updateSongInQueue]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioError = () => {
      console.warn("Audio playback error detected");
      audio.pause();
      audio.currentTime = 0;
      setPlayState(PlayState.PAUSED);
      setCurrentTime(0);
    };

    audio.addEventListener("error", handleAudioError);
    return () => {
      audio.removeEventListener("error", handleAudioError);
    };
  }, [audioRef]);

  // Provide high-precision time updates directly from the native audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleNativeTimeUpdate = () => {
      if (isSeekingRef.current) return;
      const value = audio.currentTime;
      setCurrentTime(Number.isFinite(value) ? value : 0);
    };

    audio.addEventListener("timeupdate", handleNativeTimeUpdate);
    return () => {
      audio.removeEventListener("timeupdate", handleNativeTimeUpdate);
    };
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleDurationChange = () => {
      const value = audio.duration;
      setDuration(Number.isFinite(value) ? value : 0);
    };

    audio.addEventListener("durationchange", handleDurationChange);
    return () => {
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, [audioRef]);

  useEffect(() => {
    if (
      !currentSong ||
      !currentSong.isNetease ||
      !currentSong.coverUrl ||
      currentSong.themeColor &&
      currentSong.colors &&
      currentSong.colors.length > 0
    ) {
      return;
    }

    extractColors(currentSong.coverUrl)
      .then((colors) => {
        if (colors.length > 0) {
          updateSongInQueue(currentSong.id, {
            colors,
            themeColor: colors.themeColor,
          });
        }
      })
      .catch((err) => console.warn("Color extraction failed", err));
  }, [currentSong, updateSongInQueue]);

  useEffect(() => {
    if (!isReady || restoredRef.current) return;

    restoredRef.current = true;

    if (queue.length === 0) return;

    const idx = savedRef.current.songId
      ? queue.findIndex((song) => song.id === savedRef.current.songId)
      : -1;

    setIndex(idx !== -1 ? idx : 0);
    setMatchStatus("idle");
  }, [isReady, queue, setIndex]);

  useEffect(() => {
    if (!isReady || !restoredRef.current) return;

    savePlaybackSnapshot({
      songId: currentSong?.id ?? null,
      playMode,
    });
  }, [isReady, currentSong?.id, playMode]);

  useEffect(() => {
    if (queue.length === 0) {
      if (currentIndex === -1) return;
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlayState(PlayState.PAUSED);
      setIndex(-1, []);
      setCurrentTime(0);
      setDuration(0);
      setMatchStatus("idle");
      return;
    }

    const id = songRef.current;
    if (id && queue[currentIndex]?.id !== id) {
      const idx = queue.findIndex((song) => song.id === id);
      if (idx !== -1) {
        setCurrentIndex(idx);
        return;
      }

      songRef.current = queue[currentIndex]?.id ?? null;
    }

    if (currentIndex >= queue.length || !queue[currentIndex]) {
      const nextIndex = Math.max(0, Math.min(queue.length - 1, currentIndex));
      setIndex(nextIndex);
      setMatchStatus("idle");
    }
  }, [queue, currentIndex, setIndex]);

  const handleSetSpeed = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
  }, []);

  const handleTogglePreservesPitch = useCallback(() => {
    setPreservesPitch((prev) => !prev);
  }, []);

  // Re-apply playback settings whenever state or source changes.
  useEffect(() => {
    applyAudio();
  }, [applyAudio, currentSong?.id, playState, resolvedAudioSrc]);

  useEffect(() => {
    let canceled = false;
    let currentObjectUrl: string | null = null;
    let controller: AbortController | null = null;

    const releaseObjectUrl = () => {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
    };

    if (!currentSong?.fileUrl) {
      releaseObjectUrl();
      setResolvedAudioSrc(null);
      setIsBuffering(false);
      setBufferProgress(0);
      return () => {
        canceled = true;
        controller?.abort();
        releaseObjectUrl();
      };
    }

    const fileUrl = currentSong.fileUrl;

    // Already a blob or data URL - use directly
    if (fileUrl.startsWith("blob:") || fileUrl.startsWith("data:")) {
      releaseObjectUrl();
      setResolvedAudioSrc(fileUrl);
      setIsBuffering(false);
      setBufferProgress(1);
      return () => {
        canceled = true;
      };
    }

    // Check cache first
    const cachedBlob = audioResourceCache.get(fileUrl);
    if (cachedBlob) {
      releaseObjectUrl();
      currentObjectUrl = URL.createObjectURL(cachedBlob);
      setResolvedAudioSrc(currentObjectUrl);
      setIsBuffering(false);
      setBufferProgress(1);
      return () => {
        canceled = true;
        releaseObjectUrl();
      };
    }

    // Use the original URL directly - let browser handle native buffering
    // This is the most reliable approach and works for any file size
    releaseObjectUrl();
    setResolvedAudioSrc(null); // Use original fileUrl via fallback in audio element
    setIsBuffering(true);
    setBufferProgress(0);

    // Download in background for caching (does not affect playback)
    const cacheInBackground = async () => {
      if (typeof fetch !== "function") return;

      controller = new AbortController();
      try {
        const response = await fetch(fileUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Failed to load audio: " + response.status);
        }

        const totalBytes = Number(response.headers.get("content-length")) || 0;

        if (!response.body) {
          const fallbackBlob = await response.blob();
          if (canceled) return;
          audioResourceCache.set(fileUrl, fallbackBlob);
          setBufferProgress(1);
          // Don't switch - will be used next time
          return;
        }

        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;

        while (!canceled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.byteLength;
            if (totalBytes > 0) {
              setBufferProgress(Math.min(loaded / totalBytes, 0.99));
            } else {
              setBufferProgress((prev) => {
                const increment = value.byteLength / (5 * 1024 * 1024);
                return Math.min(0.95, prev + increment);
              });
            }
          }
        }

        if (canceled) return;

        const blob = new Blob(chunks, {
          type: response.headers.get("content-type") || "audio/mpeg",
        });
        audioResourceCache.set(fileUrl, blob);
        setBufferProgress(1);
        // Don't switch to blob URL during playback - it would restart the audio
        // The cached blob will be used automatically next time this song is played
      } catch (error) {
        if (!canceled) {
          // Not critical - browser is still playing via native buffering
          console.warn("Background audio caching failed:", error);
        }
      } finally {
        if (!canceled) {
          setIsBuffering(false);
        }
      }
    };

    cacheInBackground();

    return () => {
      canceled = true;
      controller?.abort();
      releaseObjectUrl();
    };
  }, [currentSong?.fileUrl]);

  // 桌面歌词开关状态（由 App.tsx 传入或在此管理）
  const [desktopLyricsEnabled, setDesktopLyricsEnabled] = useState(false);

  // 推送当前播放状态到桌面歌词窗口（WebSocket :8787）
  useLyricOverlay({
    currentSong,
    playState,
    currentTime,
    duration,
    enabled: desktopLyricsEnabled,
    onControl: (action) => {
      switch (action) {
        case "play":
        case "pause":
          togglePlay();
          break;
        case "prev":
          playPrev();
          break;
        case "next":
          playNext();
          break;
        case "quit":
          // 桌面歌词窗口被关闭，同步状态
          setDesktopLyricsEnabled(false);
          break;
      }
    },
  });

  return {
    audioRef,
    currentSong,
    currentIndex,
    playState,
    currentTime,
    duration,
    playMode,
    matchStatus,
    accentColor,
    speed,
    preservesPitch,
    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    playIndex,
    handleTimeUpdate,
    handleLoadedMetadata,
    handlePlaylistAddition,
    loadLyricsFile,
    addSongAndPlay,
    handleAudioEnded,
    setSpeed: handleSetSpeed,
    togglePreservesPitch: handleTogglePreservesPitch,
    desktopLyricsEnabled,
    setDesktopLyricsEnabled,
    pitch: 0, // Default pitch
    setPitch: (pitch: number) => { }, // Placeholder
    play,
    pause,
    resolvedAudioSrc,
    isBuffering,
    bufferProgress,
  };
};
