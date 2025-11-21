import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Song, PlayState, PlayMode } from "../types";
import { parseLrc, extractColors, shuffleArray } from "../services/utils";
import {
  fetchLyricsById,
  searchAndMatchLyrics,
} from "../services/lyricsService";

type MatchStatus = "idle" | "matching" | "success" | "failed";

interface UsePlayerParams {
  queue: Song[];
  originalQueue: Song[];
  updateSongInQueue: (id: string, updates: Partial<Song>) => void;
  setQueue: Dispatch<SetStateAction<Song[]>>;
  setOriginalQueue: Dispatch<SetStateAction<Song[]>>;
}

export const usePlayer = ({
  queue,
  originalQueue,
  updateSongInQueue,
  setQueue,
  setOriginalQueue,
}: UsePlayerParams) => {
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playState, setPlayState] = useState<PlayState>(PlayState.PAUSED);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.LOOP_ALL);
  const [matchStatus, setMatchStatus] = useState<MatchStatus>("idle");
  const audioRef = useRef<HTMLAudioElement>(null);

  const currentSong = queue[currentIndex] ?? null;
  const accentColor = currentSong?.colors?.[0] || "#a855f7";

  const reorderForShuffle = useCallback(() => {
    if (originalQueue.length === 0) return;
    const currentId = currentSong?.id;
    const pool = originalQueue.filter((song) => song.id !== currentId);
    const shuffled = shuffleArray([...pool]);
    if (currentId) {
      const current = originalQueue.find((song) => song.id === currentId);
      if (current) {
        setQueue([current, ...shuffled]);
        setCurrentIndex(0);
        return;
      }
    }
    setQueue(shuffled);
    setCurrentIndex(0);
  }, [currentSong, originalQueue, setQueue]);

  const toggleMode = useCallback(() => {
    let nextMode: PlayMode;
    if (playMode === PlayMode.LOOP_ALL) nextMode = PlayMode.LOOP_ONE;
    else if (playMode === PlayMode.LOOP_ONE) nextMode = PlayMode.SHUFFLE;
    else nextMode = PlayMode.LOOP_ALL;

    setPlayMode(nextMode);
    setMatchStatus("idle");

    if (nextMode === PlayMode.SHUFFLE) {
      reorderForShuffle();
    } else {
      setQueue(originalQueue);
      if (currentSong) {
        const idx = originalQueue.findIndex(
          (song) => song.id === currentSong.id,
        );
        setCurrentIndex(idx !== -1 ? idx : 0);
      } else {
        setCurrentIndex(originalQueue.length > 0 ? 0 : -1);
      }
    }
  }, [playMode, reorderForShuffle, originalQueue, currentSong, setQueue]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playState === PlayState.PLAYING) {
      audioRef.current.pause();
      setPlayState(PlayState.PAUSED);
    } else {
      audioRef.current.play().catch((err) => console.error("Play failed", err));
      setPlayState(PlayState.PLAYING);
    }
  }, [playState]);

  const handleSeek = useCallback(
    (time: number, playImmediately: boolean = false) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      if (playImmediately) {
        audioRef.current
          .play()
          .catch((err) => console.error("Play failed", err));
        setPlayState(PlayState.PLAYING);
      }
    },
    [],
  );

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
    if (playState === PlayState.PLAYING) {
      audioRef.current
        .play()
        .catch((err) => console.error("Auto-play failed", err));
    }
  }, [playState]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;

    if (playMode === PlayMode.LOOP_ONE) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
      return;
    }

    const next = (currentIndex + 1) % queue.length;
    setCurrentIndex(next);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [queue.length, playMode, currentIndex]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    const prev = (currentIndex - 1 + queue.length) % queue.length;
    setCurrentIndex(prev);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [queue.length, currentIndex]);

  const playIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      setCurrentIndex(index);
      setPlayState(PlayState.PLAYING);
      setMatchStatus("idle");
    },
    [queue.length],
  );

  const addSongAndPlay = useCallback(
    (song: Song) => {
      // Update both queues atomically
      setQueue((prev) => {
        const newQueue = [...prev, song];
        const newIndex = newQueue.length - 1;

        // Set index and play state immediately in the same update cycle
        setCurrentIndex(newIndex);
        setPlayState(PlayState.PLAYING);
        setMatchStatus("idle");

        return newQueue;
      });

      setOriginalQueue((prev) => [...prev, song]);
    },
    [setQueue, setOriginalQueue]
  );

  const handlePlaylistAddition = useCallback(
    (added: Song[], wasEmpty: boolean) => {
      if (added.length === 0) return;
      setMatchStatus("idle");
      if (wasEmpty || currentIndex === -1) {
        setCurrentIndex(0);
        setPlayState(PlayState.PLAYING);
      }
      if (playMode === PlayMode.SHUFFLE) {
        reorderForShuffle();
      }
    },
    [currentIndex, playMode, reorderForShuffle],
  );

  const mergeLyricsWithMetadata = useCallback(
    (result: { lrc: string; tLrc?: string; metadata: string[] }) => {
      const parsed = parseLrc(result.lrc, result.tLrc);
      const metadataCount = result.metadata.length;
      const metadataLines = result.metadata.map((text, idx) => ({
        time: -0.01 * (metadataCount - idx),
        text,
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
          const parsedLyrics = parseLrc(text);
          updateSongInQueue(currentSong.id, { lyrics: parsedLyrics });
          setMatchStatus("success");
        }
      };
      reader.readAsText(file);
    },
    [currentSong, updateSongInQueue],
  );

  useEffect(() => {
    if (!currentSong) return;
    if (matchStatus !== "idle") return;

    const fetchLyrics = async () => {
      // If song already has lyrics, mark as success
      if (currentSong.lyrics != null && currentSong.lyrics.length > 0) {
        setMatchStatus("success");
        return;
      }

      // Only fetch if explicitly marked as needing lyrics match
      if (!currentSong.needsLyricsMatch) {
        setMatchStatus("failed");
        return;
      }

      setMatchStatus("matching");

      if (currentSong.isNetease && currentSong.neteaseId) {
        const raw = await fetchLyricsById(currentSong.neteaseId);
        if (raw) {
          updateSongInQueue(currentSong.id, {
            lyrics: mergeLyricsWithMetadata(raw),
            needsLyricsMatch: false,
          });
          setMatchStatus("success");
        } else {
          updateSongInQueue(currentSong.id, {
            needsLyricsMatch: false,
          });
          setMatchStatus("failed");
        }
      } else {
        // Cloud matching for local files
        const result = await searchAndMatchLyrics(
          currentSong.title,
          currentSong.artist,
        );
        if (result) {
          updateSongInQueue(currentSong.id, {
            lyrics: mergeLyricsWithMetadata(result),
            needsLyricsMatch: false,
          });
          setMatchStatus("success");
        } else {
          updateSongInQueue(currentSong.id, {
            needsLyricsMatch: false,
          });
          setMatchStatus("failed");
        }
      }
    };

    fetchLyrics();
  }, [currentSong, matchStatus, updateSongInQueue, mergeLyricsWithMetadata]);

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
    if (queue.length === 0) {
      if (currentIndex === -1) return;
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlayState(PlayState.PAUSED);
      setCurrentIndex(-1);
      setCurrentTime(0);
      setDuration(0);
      setMatchStatus("idle");
      return;
    }

    if (currentIndex >= queue.length || !queue[currentIndex]) {
      const nextIndex = Math.max(0, Math.min(queue.length - 1, currentIndex));
      setCurrentIndex(nextIndex);
      setMatchStatus("idle");
    }
  }, [queue, currentIndex]);

  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);

  const handleSetSpeed = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
    setPitch(0);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
      audioRef.current.preservesPitch = true;
    }
  }, []);

  const handleSetPitch = useCallback((newPitch: number) => {
    setPitch(newPitch);
    // Do not update speed state here to avoid UI coupling
    if (audioRef.current) {
      const newRate = Math.pow(2, newPitch);
      audioRef.current.playbackRate = newRate;
      audioRef.current.preservesPitch = false;
    }
  }, []);

  // Ensure playback rate is applied when song changes or play state changes
  useEffect(() => {
    if (audioRef.current) {
      // If pitch is non-zero, we are in pitch mode (preservesPitch = false)
      // Otherwise we are in speed mode (preservesPitch = true)
      const isPitchMode = pitch !== 0;
      audioRef.current.preservesPitch = !isPitchMode;

      if (isPitchMode) {
        audioRef.current.playbackRate = Math.pow(2, pitch);
      } else {
        audioRef.current.playbackRate = speed;
      }
    }
  }, [currentSong, playState, speed, pitch]);

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
    pitch,
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
    setSpeed: handleSetSpeed,
    setPitch: handleSetPitch,
  };
};
