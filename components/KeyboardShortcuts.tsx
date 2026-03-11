import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../hooks/useI18n";
import { useKeyboardScope } from "../hooks/useKeyboardScope";

interface KeyboardShortcutsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  currentTime: number;
  duration: number;
  volume: number;
  onVolumeChange: (vol: number) => void;
  onToggleMode: () => void;
  onTogglePlaylist: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onToggleVolumeDialog: () => void;
  onToggleSpeedDialog: () => void;
}

const KeyboardShortcuts: React.FC<KeyboardShortcutsProps> = ({
  isPlaying,
  onPlayPause,
  onNext,
  onPrev,
  onSeek,
  currentTime,
  duration,
  volume,
  onVolumeChange,
  onToggleMode,
  onTogglePlaylist,
  speed,
  onSpeedChange,
  onToggleVolumeDialog,
  onToggleSpeedDialog,
}) => {
  const { dict } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Use keyboard scope with lower priority (50) for global shortcuts
  useKeyboardScope(
    (e) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return false;

      // Ctrl + /
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return true;
      }

      // Ctrl + P
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        onTogglePlaylist();
        return true;
      }

      if (e.key === "Escape") {
        if (isOpen) {
          e.preventDefault();
          setIsOpen(false);
          return true;
        }
        return false;
      }

      switch (e.key) {
        case " ": // Space
          e.preventDefault();
          onPlayPause();
          return true;
        case "ArrowRight":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            onNext();
          } else {
            onSeek(Math.min(currentTime + 5, duration));
          }
          return true;
        case "ArrowLeft":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            onPrev();
          } else {
            onSeek(Math.max(currentTime - 5, 0));
          }
          return true;
        case "ArrowUp":
          e.preventDefault();
          onVolumeChange(Math.min(volume + 0.1, 1));
          return true;
        case "ArrowDown":
          e.preventDefault();
          onVolumeChange(Math.max(volume - 0.1, 0));
          return true;
        case "l":
        case "L":
          e.preventDefault();
          onToggleMode();
          return true;
        case "v":
        case "V":
          e.preventDefault();
          onToggleVolumeDialog();
          return true;
        case "s":
        case "S":
          e.preventDefault();
          onToggleSpeedDialog();
          return true;
      }

      return false;
    },
    50, // Lower priority than SearchModal (100)
    true,
  );

if (!isVisible) return null;

return createPortal(
  <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 select-none font-sans pointer-events-none">
    <style>{`
      @keyframes ios-in {
          0% { opacity: 0; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
      }
      @keyframes ios-out {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.95); }
      }
      .animate-in { animation: ios-in 0.2s cubic-bezier(0.32, 0.72, 0, 1) forwards; will-change: transform, opacity; }
      .animate-out { animation: ios-out 0.15s cubic-bezier(0.32, 0.72, 0, 1) forwards; will-change: transform, opacity; }
    `}</style>

    {/* Shared backdrop */}
    <div
      className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 pointer-events-auto ${isOpen ? "opacity-100" : "opacity-0"}`}
      onClick={() => setIsOpen(false)}
    />

    {/* Help Dialog */}
    {isOpen && (
      <div
        className={`
            relative w-full max-w-2xl pointer-events-auto
            bg-black/40 backdrop-blur-2xl saturate-150
            border border-white/10
            rounded-[32px]
            shadow-[0_30px_80px_rgba(0,0,0,0.45)]
            overflow-hidden
            text-white
            ${isOpen ? "animate-in" : "animate-out"}
        `}
      >
        {/* Content Container */}
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1">
              <h2 className="text-2xl font-bold tracking-tight">
                {dict.keys.title}
              </h2>
              <p className="text-white/50 font-medium">
                {dict.keys.subtitle}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M1 1L11 11M1 11L11 1"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
            <ShortcutItem keys={["Space"]} label={dict.keys.playPause} />
            <ShortcutItem keys={["L"]} label={dict.keys.loop} />
            <ShortcutItem keys={["←", "→"]} label={dict.keys.seek} />
            <ShortcutItem keys={["Ctrl", "←/→"]} label={dict.keys.prevNext} />
            <ShortcutItem keys={["↑", "↓"]} label={dict.keys.volume} />
            <ShortcutItem keys={["V"]} label={dict.keys.volumeDialog} />
            <ShortcutItem keys={["S"]} label={dict.keys.speedDialog} />
            <ShortcutItem keys={["Ctrl", "K"]} label={dict.keys.search} />
            <ShortcutItem keys={["Ctrl", "P"]} label={dict.keys.playlist} />
            <ShortcutItem keys={["Ctrl", "/"]} label={dict.keys.toggle} />
          </div>

          {/* Footer Hint */}
          <div className="mt-8 pt-6 border-t border-white/5 text-center text-white/30 text-xs font-medium tracking-wider uppercase">
            {dict.keys.press}{" "}
            <kbd className="font-sans bg-white/10 px-1.5 py-0.5 rounded mx-1 text-white/60">
              Esc
            </kbd>{" "}
            {dict.keys.close}
          </div>
        </div>
      </div>
    )}
  </div>,
  document.body,
);
};

const ShortcutItem = ({ keys, label }: { keys: string[]; label: string }) => (
  <div className="flex items-center justify-between group p-2 rounded-xl hover:bg-white/5 transition-colors">
    <span className="text-white/70 font-medium group-hover:text-white transition-colors">
      {label}
    </span>
    <div className="flex gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="min-w-[28px] h-7 px-2 flex items-center justify-center bg-white/10 border border-white/5 rounded-[8px] text-sm font-semibold text-white/90 shadow-sm"
        >
          {k}
        </kbd>
      ))}
    </div>
  </div>
);

export default KeyboardShortcuts;
