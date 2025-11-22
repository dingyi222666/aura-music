import React, { useState, useRef, useEffect } from "react";
import { useSpring, useTransition, animated, config } from "@react-spring/web";
import { formatTime } from "../services/utils";
import Visualizer from "./Visualizer";
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
  PauseIcon,
  PlayIcon,
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
}

const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
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
}) => {
  const [showVolume, setShowVolume] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);

  const volumeTransitions = useTransition(showVolume, {
    from: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    enter: { opacity: 1, transform: "translate(-50%, 0px) scale(1)" },
    leave: { opacity: 0, transform: "translate(-50%, 10px) scale(0.9)" },
    config: { tension: 300, friction: 20 },
  });

  const settingsTransitions = useTransition(showSettings, {
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

  // Interpolated time for smooth progress bar
  const [interpolatedTime, setInterpolatedTime] = useState(currentTime);
  const progressLastTimeRef = useRef(Date.now());

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

  // Use interpolated time for display, but sync to currentTime when it jumps significantly
  // (handled by the useEffect above resetting on currentTime change)
  const displayTime = isSeeking ? seekTime : interpolatedTime;

  // Cover transition animation (vinyl record style)
  const coverTransitions = useTransition(coverUrl, {
    keys: (url) => url || "empty",
    from: { opacity: 0, transform: "translateX(100%) scale(0.9)" },
    enter: { opacity: 1, transform: "translateX(0%) scale(1)" },
    leave: { opacity: 0, transform: "translateX(-100%) scale(0.9)" },
    config: { tension: 280, friction: 35 },
  });

  // Close popups when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        volumeContainerRef.current &&
        !volumeContainerRef.current.contains(event.target as Node)
      ) {
        setShowVolume(false);
      }
      if (
        settingsContainerRef.current &&
        !settingsContainerRef.current.contains(event.target as Node)
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  return (
    <div className="w-full flex flex-col items-center justify-center gap-2 text-white select-none">
      {/* Cover Section */}
      <div className="relative aspect-square w-64 md:w-72 lg:w-[300px] rounded-3xl bg-gradient-to-br from-gray-800 to-gray-900 shadow-2xl shadow-black/50 ring-1 ring-white/10 overflow-hidden mb-6">
        {coverTransitions((style, url) => (
          <animated.div style={style} className="absolute inset-0">
            {url ? (
              <img
                src={url}
                alt="Album Art"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full text-white/20">
                <div className="text-8xl mb-4">♪</div>
                <p className="text-sm">No Music Loaded</p>
              </div>
            )}
          </animated.div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
      </div>
      {/* Song Info */}
      <div className="text-center mb-1 px-4">
        <h2 className="text-2xl font-bold tracking-tight drop-shadow-md line-clamp-1">
          {title}
        </h2>
        <p className="text-white/60 text-lg font-medium line-clamp-1">
          {artist}
        </p>
      </div>

      {/* Spectrum Visualizer */}
      <div className="w-full flex justify-center h-8 mb-2">
        <Visualizer audioRef={audioRef} isPlaying={isPlaying} />
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-xl flex items-center gap-3 text-xs font-medium text-white/50 group/bar relative">
        <span className="w-10 text-right font-mono tracking-widest">
          {formatTime(displayTime)}
        </span>

        <div className="relative flex-1 h-8 flex items-center cursor-pointer group">
          {/* Background Track */}
          <div className="absolute inset-x-0 h-[3px] bg-white/20 rounded-full group-hover:h-[6px] transition-[height] duration-200 ease-out"></div>

          {/* Active Progress */}
          <div
            className="absolute left-0 h-[3px] rounded-full group-hover:h-[6px] transition-[height] duration-200 ease-out"
            style={{
              width: `${(displayTime / (duration || 1)) * 100}%`,
              backgroundColor: "rgba(255,255,255,0.9)",
            }}
          ></div>

          {/* Input Range */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={displayTime}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={(e) => {
              const time = parseFloat(e.target.value);
              setSeekTime(time);
              onSeek(time, false, true); // Deferred seek
            }}
            onMouseUp={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              onSeek(time, false, false); // Actual seek
              setIsSeeking(false);

              // Optimistic update
              setInterpolatedTime(time);
              seekTargetRef.current = time;
              setIsWaitingForSeek(true);

              // Safety timeout: if seek doesn't happen within 1s, give up waiting
              setTimeout(() => setIsWaitingForSeek(false), 1000);
            }}
            onTouchEnd={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              onSeek(time, false, false); // Actual seek
              setIsSeeking(false);

              // Optimistic update
              setInterpolatedTime(time);
              seekTargetRef.current = time;
              setIsWaitingForSeek(true);

              // Safety timeout
              setTimeout(() => setIsWaitingForSeek(false), 1000);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          />
        </div>

        <span className="w-10 font-mono tracking-widest">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls Row - Flattened for Equal Spacing */}
      {/* Layout: [Mode] [Vol] [Prev] [Play] [Next] [Settings] [List] */}
      <div className="w-full max-w-[380px] mt-6 px-2">
        <div className="flex items-center justify-between w-full">
          {/* 1. Play Mode */}
          <button
            onClick={onToggleMode}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            title="Playback Mode"
          >
            {getModeIcon()}
          </button>

          {/* 2. Volume */}
          <div className="relative" ref={volumeContainerRef}>
            <button
              onClick={() => setShowVolume(!showVolume)}
              className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showVolume ? "text-white" : "text-white/60 hover:text-white"
                }`}
              title="Volume"
            >
              {getVolumeButtonIcon()}
            </button>

            {/* Volume Popup */}
            {volumeTransitions((style, item) =>
              item ? (
                <VolumePopup
                  style={style}
                  volume={volume}
                  onVolumeChange={onVolumeChange}
                  getVolumePopupIcon={getVolumePopupIcon}
                />
              ) : null
            )}
          </div>

          {/* 3. Previous */}
          <button
            onClick={onPrev}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Previous"
          >
            <PrevIcon className="w-9 h-9" />
          </button>

          {/* 4. Play/Pause (Center) */}
          <button
            onClick={onPlayPause}
            className="w-14 h-14 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform duration-200 shadow-lg shadow-white/10"
          >
            <div className="relative w-6 h-6">
              {/* Pause Icon */}
              <PauseIcon
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isPlaying
                  ? "opacity-100 scale-100 rotate-0"
                  : "opacity-0 scale-50 -rotate-90"
                  }`}
              />

              <PlayIcon
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${!isPlaying
                  ? "opacity-100 scale-100 rotate-0"
                  : "opacity-0 scale-50 rotate-90"
                  }`}
              />
            </div>
          </button>

          {/* 5. Next */}
          <button
            onClick={onNext}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Next"
          >
            <NextIcon className="w-9 h-9" />
          </button>

          {/* 6. Settings (Replaces Like) */}
          <div className="relative" ref={settingsContainerRef}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showSettings ? "text-white" : "text-white/60 hover:text-white"
                }`}
              title="Settings"
            >
              <SettingsIcon className="w-5 h-5" />
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

          {/* 7. Playlist/Queue */}
          <button
            onClick={onTogglePlaylist}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Queue"
          >
            <QueueIcon className="w-5 h-5" />
          </button>
        </div>
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
            step="0.1"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
            style={{
              WebkitAppearance: "slider-vertical",
              appearance: "slider-vertical",
            } as any}
          />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none text-[10px] font-bold text-white mix-blend-difference">
            {speed.toFixed(1)}x
          </div>
        </div>
        <span className="text-[10px] font-medium text-white/60">Speed</span>
      </div>

      {/* Toggle Preserves Pitch */}
      <div className="flex flex-col items-center justify-end gap-2 w-12 pb-6">
        <button
          onClick={onTogglePreservesPitch}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200 ${
            preservesPitch ? "bg-white/20 text-white" : "bg-white text-black"
          }`}
          title={preservesPitch ? "Tone Preserved" : "Vinyl Mode"}
        >
          <span className="text-xs font-bold">
            {preservesPitch ? "Dig" : "Vin"}
          </span>
        </button>
        <span className="text-[10px] font-medium text-white/60 text-center leading-tight">
          {preservesPitch ? "Digital" : "Vinyl"}
        </span>
      </div>
    </animated.div>
  );
};
