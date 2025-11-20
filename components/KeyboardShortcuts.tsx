import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
}) => {
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;

      // Ctrl + /
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        if (isOpen) {
          e.preventDefault();
          setIsOpen(false);
        }
        return;
      }

      switch (e.key) {
        case " ": // Space
          e.preventDefault();
          onPlayPause();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            onNext();
          } else {
            onSeek(Math.min(currentTime + 5, duration));
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            onPrev();
          } else {
            onSeek(Math.max(currentTime - 5, 0));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          onVolumeChange(Math.min(volume + 0.1, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          onVolumeChange(Math.max(volume - 0.1, 0));
          break;
        case "l":
        case "L":
          e.preventDefault();
          onToggleMode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    isPlaying,
    currentTime,
    duration,
    volume,
    onPlayPause,
    onNext,
    onPrev,
    onSeek,
    onVolumeChange,
    onToggleMode,
  ]);

  if (!isVisible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <style>{`
        @keyframes ios-in {
            0% { opacity: 0; transform: scale(0.95); filter: blur(10px); }
            100% { opacity: 1; transform: scale(1); filter: blur(0px); }
        }
        @keyframes ios-out {
            0% { opacity: 1; transform: scale(1); filter: blur(0px); }
            100% { opacity: 0; transform: scale(0.95); filter: blur(10px); }
        }
        .animate-in { animation: ios-in 0.35s cubic-bezier(0.32, 0.72, 0, 1) forwards; }
        .animate-out { animation: ios-out 0.25s cubic-bezier(0.32, 0.72, 0, 1) forwards; }
      `}</style>

      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={() => setIsOpen(false)}
      />

      {/* Dialog */}
      <div
        className={`
            relative w-full max-w-2xl
            bg-zinc-900/20 backdrop-blur-[80px] saturate-150
            border border-white/10
            rounded-[32px]
            shadow-2xl shadow-black/30
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
                Keyboard Shortcuts
              </h2>
              <p className="text-white/50 font-medium">
                Quick controls for playback
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
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
            <ShortcutItem keys={["Space"]} label="Play / Pause" />
            <ShortcutItem keys={["L"]} label="Loop Mode" />
            <ShortcutItem keys={["←", "→"]} label="Seek ±5s" />
            <ShortcutItem keys={["Ctrl", "←/→"]} label="Prev / Next Song" />
            <ShortcutItem keys={["↑", "↓"]} label="Volume Control" />
            <ShortcutItem keys={["Ctrl", "/"]} label="Toggle Shortcuts" />
          </div>

          {/* Footer Hint */}
          <div className="mt-8 pt-6 border-t border-white/5 text-center text-white/30 text-xs font-medium tracking-wider uppercase">
            Press{" "}
            <kbd className="font-sans bg-white/10 px-1.5 py-0.5 rounded mx-1 text-white/60">
              Esc
            </kbd>{" "}
            to close
          </div>
        </div>
      </div>
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
