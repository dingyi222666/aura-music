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
    const existingLyrics = currentSong.lyrics ?? [];
    const isNeteaseSong = currentSong.isNetease;
    const songNeteaseId = currentSong.neteaseId;

    let cancelled = false;

    const markMatchFailed = () => {
      if (cancelled) return;
      updateSongInQueue(songId, {
        needsLyricsMatch: false,
      });
      setMatchStatus("failed");
    };

    const markMatchSuccess = () => {
      if (cancelled) return;
      setMatchStatus("success");
    };

    if (existingLyrics.length > 0) {
      markMatchSuccess();
      return;
    }

    if (!needsLyricsMatch) {
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
      (currentSong.colors && currentSong.colors.length > 0)
    ) {
      return;
    }

    extractColors(currentSong.coverUrl)
      .then((colors) => {
        if (colors.length > 0) {
          updateSongInQueue(currentSong.id, { colors });
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
    pitch: 0, // Default pitch
    setPitch: (pitch: number) => { }, // Placeholder
    play,
    pause,
    resolvedAudioSrc,
    isBuffering,
    bufferProgress,
  };
};
