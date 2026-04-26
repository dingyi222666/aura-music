import React, { useState, useRef, useEffect } from "react";
import { useSpring, animated, useTransition, to } from "@react-spring/web";
import { formatTime } from "../services/utils";
import { useI18n } from "../hooks/useI18n";
import Visualizer from "./visualizer/Visualizer";
import SmartImage from "./SmartImage";
import {
  LoopIcon,
  LoopOneIcon,
  ShuffleIcon,
  VolumeHighFilledIcon,
  VolumeHighIcon,
  VolumeLowFilledIcon,
  VolumeLowIcon,
  VolumeMuteFilledIcon,
  VolumeMuteIcon,
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  SettingsIcon,
  QueueIcon,
} from "./Icons";
import { PlayMode } from "../types";

interface ControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  trackId: string;
  onSeek: (time: number, playImmediately?: boolean, defer?: boolean) => void;
  title: string;
  artist: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  onNext: () => void;
  onPrev: () => void;
  playMode: PlayMode;
  onToggleMode: () => void;
  onTogglePlaylist: () => void;
  accentColor: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  speed: number;
  preservesPitch: boolean;
  onSpeedChange: (speed: number) => void;
  onTogglePreservesPitch: () => void;
  coverUrl?: string;
  showVolumePopup: boolean;
  setShowVolumePopup: (show: boolean) => void;
  showSettingsPopup: boolean;
  setShowSettingsPopup: (show: boolean) => void;
  isBuffering: boolean;
  playlistPanel?: React.ReactNode;
}

const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  trackId,
  onSeek,
  title,
  artist,
  audioRef,
  onNext,
  onPrev,
  playMode,
  onToggleMode,
  onTogglePlaylist,
  accentColor,
  volume,
  onVolumeChange,
  speed,
  preservesPitch,
  onSpeedChange,
  onTogglePreservesPitch,
  coverUrl,
  showVolumePopup,
  setShowVolumePopup,
  showSettingsPopup,
  setShowSettingsPopup,
  isBuffering,
  playlistPanel,
}) => {
  const { dict } = useI18n();
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);

  const volumeTransitions = useTransition(showVolumePopup, {
    from: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    enter: { opacity: 1, transform: "translate(-50%, 0px) scale(1)" },
    leave: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    config: { tension: 300, friction: 20 },
  });

  const settingsTransitions = useTransition(showSettingsPopup, {
    from: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    enter: { opacity: 1, transform: "translate(-50%, 0px) scale(1)" },
    leave: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    config: { tension: 300, friction: 20 },
  });

  // Progress bar seeking state
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Optimistic seek state
  const [isWaitingForSeek, setIsWaitingForSeek] = useState(false);
  const seekTargetRef = useRef(0);
  const seekTimerRef = useRef<number | null>(null);

  // Interpolated time for smooth progress bar
  const [interpolatedTime, setInterpolatedTime] = useState(currentTime);
  const progressLastTimeRef = useRef(Date.now());

  // Buffered time range from audio element
  const [bufferedEnd, setBufferedEnd] = useState(0);

  const clearSeekTimer = () => {
    if (seekTimerRef.current === null) return;
    window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
  };

  const startSeek = () => {
    clearSeekTimer();
    setIsWaitingForSeek(false);
    setSeekTime(interpolatedTime);
    setIsSeeking(true);
  };

  const dragSeek = (time: number) => {
    setSeekTime(time);
    onSeek(time, false, true);
  };

  const doneSeek = (time: number) => {
    clearSeekTimer();
    onSeek(time, false, false);
    setIsSeeking(false);
    setSeekTime(time);
    setInterpolatedTime(time);
    seekTargetRef.current = time;
    setIsWaitingForSeek(true);
    seekTimerRef.current = window.setTimeout(() => {
      setIsWaitingForSeek(false);
      seekTimerRef.current = null;
    }, 1000);
  };

  useEffect(() => {
    clearSeekTimer();
    setIsSeeking(false);
    setSeekTime(0);
    setIsWaitingForSeek(false);
    seekTargetRef.current = 0;
    setInterpolatedTime(0);
    progressLastTimeRef.current = Date.now();
    setBufferedEnd(0);
  }, [trackId]);

  useEffect(() => {
    return () => clearSeekTimer();
  }, []);

  useEffect(() => {
    if (isSeeking) return;

    // If we are waiting for a seek to complete, check if we've reached the target
    if (isWaitingForSeek) {
      const diff = Math.abs(currentTime - seekTargetRef.current);
      // If we are close enough (within 0.5s), or if enough time has passed (handled by timeout elsewhere),
      // we consider the seek 'done' and resume normal syncing.
      // But for now, we ONLY sync if close, otherwise we keep the optimistic value.
      if (diff < 0.5) {
        setIsWaitingForSeek(false);
        setInterpolatedTime(currentTime);
      }
      // Else: do nothing, keep interpolatedTime as is (the seek target)
    } else {
      // Normal operation: sync with prop
      setInterpolatedTime(currentTime);
    }

    if (!isPlaying) return;

    let animationFrameId: number;

    const animate = () => {
      const now = Date.now();
      const dt = (now - progressLastTimeRef.current) / 1000;
      progressLastTimeRef.current = now;

      if (isPlaying && !isSeeking && !isWaitingForSeek) {
        setInterpolatedTime((prev) => {
          // Simple linear extrapolation
          const next = prev + dt * speed;
          // Clamp to duration
          return Math.min(next, duration);
        });
      } else if (isPlaying && isWaitingForSeek) {
        // If waiting for seek, we can still extrapolate from the target
        // to make it feel responsive immediately
        setInterpolatedTime((prev) => {
          const next = prev + dt * speed;
          return Math.min(next, duration);
        });
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    progressLastTimeRef.current = Date.now();
    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [currentTime, isPlaying, isSeeking, speed, duration, isWaitingForSeek]);

  // Update buffered time range from audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateBuffered = () => {
      // Get the audio's actual duration (may differ from prop during loading)
      const audioDuration = audio.duration;

      if (audio.buffered.length > 0 && Number.isFinite(audioDuration) && audioDuration > 0) {
        // Find the maximum buffered end time
        let maxEnd = 0;
        for (let i = 0; i < audio.buffered.length; i++) {
          const end = audio.buffered.end(i);
          if (end > maxEnd) {
            maxEnd = end;
          }
        }
        // Clamp to duration to prevent exceeding 100%
        setBufferedEnd(Math.min(maxEnd, audioDuration));
      } else {
        setBufferedEnd(0);
      }
    };

    // Reset buffered state when audio source changes
    const handleEmptied = () => {
      setBufferedEnd(0);
    };

    // Initial update
    updateBuffered();

    // Listen to various events for buffer updates
    audio.addEventListener("progress", updateBuffered);
    audio.addEventListener("loadeddata", updateBuffered);
    audio.addEventListener("canplaythrough", updateBuffered);
    audio.addEventListener("durationchange", updateBuffered);
    audio.addEventListener("emptied", handleEmptied);
    audio.addEventListener("loadstart", handleEmptied);

    return () => {
      audio.removeEventListener("progress", updateBuffered);
      audio.removeEventListener("loadeddata", updateBuffered);
      audio.removeEventListener("canplaythrough", updateBuffered);
      audio.removeEventListener("durationchange", updateBuffered);
      audio.removeEventListener("emptied", handleEmptied);
      audio.removeEventListener("loadstart", handleEmptied);
    };
  }, [audioRef]);

  const displayTime = isSeeking ? seekTime : interpolatedTime;

  const [coverSpring, coverApi] = useSpring(() => ({
    scale: 1,
    boxShadow: isPlaying
      ? "0 12px 24px rgba(0,0,0,0.32)"
      : "0 6px 14px rgba(0,0,0,0.18)",
    config: { tension: 300, friction: 30 },
  }));

  useEffect(() => {
    coverApi.start({
      scale: 1,
      boxShadow: isPlaying
        ? "0 12px 24px rgba(0,0,0,0.32)"
        : "0 6px 14px rgba(0,0,0,0.18)",
      config: { tension: 300, friction: 30 },
    });
  }, [isPlaying, coverApi]);

  useEffect(() => {
    if (!coverUrl) return;
    coverApi.start({
      scale: 0.95,
      config: { tension: 320, friction: 24 },
    });
    const timeout = window.setTimeout(() => {
      coverApi.start({
        scale: 1,
        boxShadow: isPlaying
          ? "0 12px 24px rgba(0,0,0,0.32)"
          : "0 6px 14px rgba(0,0,0,0.18)",
        config: { tension: 260, friction: 32 },
      });
    }, 180);
    return () => clearTimeout(timeout);
  }, [coverUrl, isPlaying, coverApi]);

  // Close popups when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        volumeContainerRef.current &&
        !volumeContainerRef.current.contains(event.target as Node)
      ) {
        setShowVolumePopup(false);
      }
      if (
        settingsContainerRef.current &&
        !settingsContainerRef.current.contains(event.target as Node)
      ) {
        setShowSettingsPopup(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowVolumePopup, setShowSettingsPopup]);

  // Scroll to adjust volume/speed
  useEffect(() => {
    if (!showVolumePopup && !showSettingsPopup) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;

      if (showVolumePopup) {
        const step = 0.05;
        const newVolume = Math.min(Math.max(volume + delta * step, 0), 1);
        onVolumeChange(Number(newVolume.toFixed(2)));
      } else if (showSettingsPopup) {
        const step = 0.01;
        const newSpeed = Math.min(Math.max(speed + delta * step, 0.5), 2);
        onSpeedChange(Number(newSpeed.toFixed(2)));
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [showVolumePopup, showSettingsPopup, volume, speed, onVolumeChange, onSpeedChange]);

  const getModeIcon = () => {
    // Standard white colors, simplified hover
    const iconClass =
      "w-5 h-5 text-white/60 hover:text-white transition-colors";

    switch (playMode) {
      case PlayMode.LOOP_ONE:
        return (
          <div className="relative">
            <LoopOneIcon className={iconClass} />
            <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-black rounded-[2px] px-0.5 leading-none">
              1
            </span>
          </div>
        );
      case PlayMode.SHUFFLE:
        return <ShuffleIcon className={iconClass} />;
      default: // LOOP_ALL
        return <LoopIcon className={iconClass} />;
    }
  };

  const getVolumeButtonIcon = () => {
    if (volume === 0) {
      return <VolumeMuteIcon className="w-5 h-5" />;
    }
    if (volume < 0.5) {
      return <VolumeLowIcon className="w-5 h-5" />;
    }
    return <VolumeHighIcon className="w-5 h-5" />;
  };

  const getVolumePopupIcon = () => {
    if (volume === 0) {
      return <VolumeMuteFilledIcon className="w-4 h-4" />;
    }
    if (volume < 0.5) {
      return <VolumeLowFilledIcon className="w-4 h-4" />;
    }
    return <VolumeHighFilledIcon className="w-4 h-4" />;
  };

  const controlsScaleSpring = useSpring({
    scale: isPlaying ? 1.02 : 0.97,
    config: {
      tension: isPlaying ? 320 : 260,
      friction: isPlaying ? 22 : 30,
    },
    immediate: false,
  });

  // Calculate buffered percentage from actual audio buffered time
  const bufferedWidthPercent = duration > 0
    ? Math.min(100, Math.max(0, (bufferedEnd / duration) * 100))
    : 0;

  return (
    <div className="w-full max-w-[480px] flex flex-col items-center justify-center text-white select-none mx-auto p-4 sm:p-6 font-sans">
      {/* Cover Section */}
      <animated.div
        style={{
          boxShadow: coverSpring.boxShadow,
          transform: coverSpring.scale.to((s) => `scale(${s})`),
        }}
        className="relative aspect-square w-full rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 overflow-hidden mb-10"
      >
        {coverUrl ? (
          <SmartImage
            src={coverUrl}
            alt={dict.controls.albumArt}
            containerClassName="absolute inset-0 overflow-hidden"
            imgClassName="absolute inset-0 block w-full h-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
            <div className="text-8xl mb-4">♪</div>
            <p className="text-sm">{dict.controls.noMusic}</p>
          </div>
        )}
      </animated.div>

      {/* Song Info */}
      <div className="w-full flex items-center justify-between mb-8 px-1">
        <div className="flex flex-col items-start overflow-hidden pr-4 max-w-[85%] select-text">
          <h2 className="text-[1.4rem] leading-tight font-bold tracking-tight drop-shadow-md truncate text-left w-full text-white select-text">
            {title}
          </h2>
          <p className="text-white/60 text-[1.1rem] leading-tight font-medium truncate text-left w-full mt-0.5 select-text">
            {artist}
          </p>
        </div>
        <div className="relative" ref={settingsContainerRef}>
          <button
            onClick={() => setShowSettingsPopup(!showSettingsPopup)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all outline-none flex-shrink-0"
            title={dict.controls.settings}
          >
            <div className="flex gap-[3px]">
              <div className="w-1 h-1 bg-white rounded-full opacity-90"></div>
              <div className="w-1 h-1 bg-white rounded-full opacity-90"></div>
              <div className="w-1 h-1 bg-white rounded-full opacity-90"></div>
            </div>
          </button>

          {/* Settings Popup */}
          {settingsTransitions((style, item) =>
            item ? (
              <SettingsPopup
                style={style}
                speed={speed}
                preservesPitch={preservesPitch}
                onTogglePreservesPitch={onTogglePreservesPitch}
                onSpeedChange={onSpeedChange}
              />
            ) : null
          )}
        </div>
      </div>

      {/* Visualizer */}
      <div className="w-full flex justify-center h-10 mb-4 opacity-40 px-1">
        <Visualizer audioRef={audioRef} isPlaying={isPlaying} />
      </div>

      {/* Progress Bar */}
      <div className="w-full flex flex-col group/bar relative mb-8 px-1">
        <div className="relative w-full h-3 flex items-center cursor-pointer group">
          {/* Background Track */}
          <div className="absolute inset-x-0 h-1.5 bg-white/20 rounded-full group-hover:h-3 transition-[height] duration-200"></div>

          {/* Buffer Progress */}
          <div
            className="absolute left-0 h-1.5 rounded-full group-hover:h-3 transition-[height] duration-200 bg-white/30"
            style={{ width: bufferedWidthPercent + "%" }}
          ></div>

          {/* Active Progress */}
          <div
            className="absolute left-0 h-1.5 rounded-full group-hover:h-3 transition-[height] duration-200 bg-white"
            style={{ width: `${(displayTime / (duration || 1)) * 100}%` }}
          ></div>

          {/* Input Range */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={displayTime}
            onPointerDown={startSeek}
            onInput={(e) => {
              const time = parseFloat(e.target.value);
              dragSeek(time);
            }}
            onChange={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              dragSeek(time);
            }}
            onPointerUp={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              doneSeek(time);
            }}
            onPointerCancel={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              doneSeek(time);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 touch-none"
          />
        </div>

        <div className="flex justify-between w-full mt-1.5 text-[10px] font-semibold text-white/50 tracking-widest uppercase">
          <span>{formatTime(displayTime)}</span>
          <span>{duration > 0 ? `-${formatTime(duration - displayTime)}` : "0:00"}</span>
        </div>
      </div>

      {/* Main Controls Row */}
      <div className="w-full flex items-center justify-between mb-8 px-0">
        <button
          onClick={onToggleMode}
          className="text-white/70 hover:bg-white/10 hover:text-white rounded-full p-2.5 transition-colors active:bg-white/20 outline-none"
          title={dict.controls.playback}
        >
          {getModeIcon()}
        </button>

        <button
          onClick={onPrev}
          className="text-white hover:bg-white/10 rounded-full p-2.5 transition-colors active:bg-white/20 outline-none flex items-center justify-center transform active:scale-95"
          aria-label={dict.controls.previous}
        >
          <PrevIcon className="w-8 h-8 fill-current" />
        </button>

        <button
          onClick={onPlayPause}
          className="relative flex items-center justify-center p-3 hover:bg-white/10 rounded-full active:bg-white/20 transition-all outline-none transform active:scale-95 text-white"
        >
          <div className="relative w-10 h-10 flex items-center justify-center">
            <PauseIcon
              className={`absolute w-full h-full fill-current transition-all duration-300 ${isPlaying ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90"
                }`}
            />
            <PlayIcon
              className={`absolute w-full h-full fill-current transition-all duration-300 ${!isPlaying ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"
                }`}
            />
          </div>
        </button>

        <button
          onClick={onNext}
          className="text-white hover:bg-white/10 rounded-full p-2.5 transition-colors active:bg-white/20 outline-none flex items-center justify-center transform active:scale-95"
          aria-label={dict.controls.next}
        >
          <NextIcon className="w-8 h-8 fill-current" />
        </button>

        <div className="relative flex items-center justify-center">
          <button
            onClick={onTogglePlaylist}
            className="text-white/70 hover:bg-white/10 hover:text-white rounded-full p-2.5 transition-colors active:bg-white/20 outline-none"
            title={dict.controls.queue}
          >
            <QueueIcon className="w-6 h-6 fill-current" />
          </button>
          {playlistPanel}
        </div>
      </div>

      {/* Inline Volume Slider */}
      <div className="w-full flex items-center gap-3 group/vol mb-2 px-1 mt-2">
        <VolumeLowIcon className="w-3.5 h-3.5 text-white/60 fill-current" />
        <div className="relative flex-1 h-2 flex items-center cursor-pointer">
          <div className="absolute inset-x-0 h-1 bg-white/20 rounded-full group-hover/vol:h-2 transition-[height] duration-200"></div>
          <div
            className="absolute left-0 h-1 bg-white rounded-full group-hover/vol:h-2 transition-[height] duration-200 pointer-events-none"
            style={{ width: `${volume * 100}%` }}
          ></div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onInput={(e) => onVolumeChange(parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 touch-none"
          />
        </div>
        <VolumeHighIcon className="w-3.5 h-3.5 text-white/60 fill-current" />
      </div>
    </div>
  );
};

export default Controls;

interface VolumePopupProps {
  style: any;
  volume: number;
  onVolumeChange: (volume: number) => void;
  getVolumePopupIcon: () => React.ReactNode;
}

const VolumePopup: React.FC<VolumePopupProps> = ({
  style,
  volume,
  onVolumeChange,
  getVolumePopupIcon,
}) => {
  const { height } = useSpring({
    height: volume * 100,
    config: { tension: 210, friction: 20, clamp: true },
  });

  return (
    <animated.div
      style={style}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-8 z-50 w-[52px] h-[150px] rounded-[26px] p-1.5 bg-black/10 backdrop-blur-[100px] saturate-150 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/5 flex flex-col cursor-auto"
    >
      <div className="relative w-full flex-1 rounded-[20px] bg-white/20 overflow-hidden backdrop-blur-[28px]">
        {/* Fill */}
        <animated.div
          className="absolute bottom-0 w-full bg-white"
          style={{ height: height.to((h) => `${h}%`) }}
        />

        {/* Input Overlay */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
          style={
            {
              WebkitAppearance: "slider-vertical",
              appearance: "slider-vertical",
            } as any
          }
        />

        {/* Icon Overlay (Mix Blend Mode) */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none text-white mix-blend-difference">
          {getVolumePopupIcon()}
        </div>
      </div>
    </animated.div>
  );
};

interface SettingsPopupProps {
  style: any;
  speed: number;
  preservesPitch: boolean;
  onTogglePreservesPitch: () => void;
  onSpeedChange: (speed: number) => void;
}

const SettingsPopup: React.FC<SettingsPopupProps> = ({
  style,
  preservesPitch,
  onTogglePreservesPitch,
  speed,
  onSpeedChange,
}) => {
  const { dict } = useI18n();
  const { speedH } = useSpring({
    speedH: ((speed - 0.5) / 1.5) * 100,
    config: { tension: 210, friction: 20 },
  });

  return (
    <animated.div
      style={style}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-8 z-50 p-4 rounded-[26px] bg-black/10 backdrop-blur-[100px] saturate-150 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/5 flex gap-4 cursor-auto"
    >
      {/* Speed Control */}
      <div className="flex flex-col items-center gap-2 w-12">
        <div className="h-[150px] w-full relative rounded-[20px] bg-white/20 overflow-hidden backdrop-blur-[28px]">
          <animated.div
            className="absolute bottom-0 w-full bg-white"
            style={{
              height: speedH.to((h) => `${h}%`),
            }}
          />
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.01"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
            style={{
              WebkitAppearance: "slider-vertical",
              appearance: "slider-vertical",
            } as any}
          />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none text-[10px] font-bold text-white mix-blend-difference">
            {speed.toFixed(2)}x
          </div>
        </div>
        <span className="text-[10px] font-medium text-white/60">{dict.controls.speed}</span>
      </div>

      {/* Toggle Preserves Pitch */}
      <div className="flex flex-col items-center justify-end gap-2 w-[68px] pb-6">
        <button
          onClick={onTogglePreservesPitch}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-200 ${preservesPitch ? "bg-white/20 text-white" : "bg-white text-black"
            }`}
          title={preservesPitch ? dict.controls.original : dict.controls.nightcore}
        >
          <span className="text-[11px] font-bold tracking-[0.04em]">
            {preservesPitch ? dict.controls.originalShort : dict.controls.nightcoreShort}
          </span>
        </button>
        <span className="text-[10px] font-medium text-white/60 text-center leading-tight">
          {preservesPitch ? dict.controls.original : dict.controls.nightcore}
        </span>
      </div>
    </animated.div>
  );
};
