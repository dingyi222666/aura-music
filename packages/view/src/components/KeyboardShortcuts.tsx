import React, { useState } from "react";
import GlassDialog from "../glass/GlassDialog";
import { useI18n } from "../hooks/useI18n";
import { useKeyboardScope } from "@aura-music/core/react/useKeyboardScope";

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

const isMacPlatform = () => {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
};

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

  const modKey = isMacPlatform() ? "⌘" : "Ctrl";

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

return <GlassDialog open={isOpen} onClose={() => setIsOpen(false)} title={dict.keys.title} wide>
  <div className="glass-dialog-body">
    <h2>{dict.keys.title}</h2>
    <p className="glass-description mt-2 mb-6">{dict.keys.subtitle}</p>
          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
            <ShortcutItem keys={["Space"]} label={dict.keys.playPause} />
            <ShortcutItem keys={["L"]} label={dict.keys.loop} />
            <ShortcutItem keys={["←", "→"]} label={dict.keys.seek} />
            <ShortcutItem keys={[modKey, "←/→"]} label={dict.keys.prevNext} />
            <ShortcutItem keys={["↑", "↓"]} label={dict.keys.volume} />
            <ShortcutItem keys={["V"]} label={dict.keys.volumeDialog} />
            <ShortcutItem keys={["S"]} label={dict.keys.speedDialog} />
            <ShortcutItem keys={[modKey, "K"]} label={dict.keys.search} />
            <ShortcutItem keys={[modKey, "P"]} label={dict.keys.playlist} />
            <ShortcutItem keys={[modKey, "/"]} label={dict.keys.toggle} />
          </div>

  </div>
  <div className="glass-dialog-actions"><button className="glass-button glass-primary" onClick={() => setIsOpen(false)}>{dict.about.done}</button></div>
</GlassDialog>;
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
          className="min-w-[28px] h-7 px-2 flex items-center justify-center bg-white/10 border border-white/5 rounded-[8px] text-sm font-semibold text-white/90 shadow-xs"
        >
          {k}
        </kbd>
      ))}
    </div>
  </div>
);

export default KeyboardShortcuts;
