import React, { useId } from "react";
import { useI18n } from "../hooks/useI18n";

interface LyricTogglesProps {
  focused: boolean;
  onFocus: () => void;
  visible: boolean;
  translated: boolean;
  onLyrics: () => void;
  onTranslation: () => void;
}

const LyricToggles: React.FC<LyricTogglesProps> = ({
  focused,
  onFocus,
  visible,
  translated,
  onLyrics,
  onTranslation,
}) => {
  const { dict } = useI18n();
  const mask = useId();
  const style = (active: boolean) =>
    `flex h-11 w-11 items-center justify-center rounded-lg bg-transparent transition-colors duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/70 active:text-white ${active
      ? "text-white/80 hover:text-white"
      : "text-white/35 hover:text-white/60"}`;

  return (
    <div
      className="absolute right-4 lg:right-7 z-40 flex items-center gap-3"
      style={{ bottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      <button
        type="button"
        aria-label={dict.lyrics.focus}
        aria-pressed={focused}
        title={focused ? dict.lyrics.showControls : dict.lyrics.hideControls}
        onClick={onFocus}
        className={style(focused)}
      >
        <svg aria-hidden="true" viewBox="0 0 28 28" className="h-8 w-8" fill="currentColor">
          <path fillRule="evenodd" d="M8 1.5h12A6.5 6.5 0 0 1 26.5 8v12a6.5 6.5 0 0 1-6.5 6.5H8A6.5 6.5 0 0 1 1.5 20V8A6.5 6.5 0 0 1 8 1.5ZM16 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM6 19.5c0 1.4 1 2.5 2.5 2.5h11c1.5 0 2.5-1.1 2.5-2.5v-1l-4.2-4.2a1.2 1.2 0 0 0-1.7 0l-2.2 2.2-3.6-4.1a1.2 1.2 0 0 0-1.8 0L6 15.3Z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={dict.lyrics.translation}
        aria-pressed={translated}
        title={translated ? dict.lyrics.hideTranslation : dict.lyrics.showTranslation}
        onClick={onTranslation}
        className={style(translated)}
      >
        <svg aria-hidden="true" viewBox="0 0 28 24" className="h-[25px] w-7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 3H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1v4l4-4h3M15 5V4a1 1 0 0 0-1-1" />
          <path d="m5.5 11 2.2-6 2.3 6M6.3 9h2.8" strokeWidth="1.2" />
          <defs>
            <mask id={mask}>
              <rect width="28" height="24" fill="white" />
              <path d="M18.5 10v1.5M15.5 11.5h7M21 11.5c-.5 2.5-2.3 4.3-4.8 5.5M17 13c1 1.9 2.7 3.2 5 4" stroke="black" strokeWidth="1.1" />
            </mask>
          </defs>
          <path d="M15 7h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v4l-4-4h-3a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z" fill="currentColor" stroke="none" mask={`url(#${mask})`} />
        </svg>
      </button>
      <button
        type="button"
        aria-label={dict.lyrics.visibility}
        aria-pressed={visible}
        title={visible ? dict.lyrics.hideLyrics : dict.lyrics.showLyrics}
        onClick={onLyrics}
        className={style(visible)}
      >
        <svg aria-hidden="true" viewBox="0 0 28 28" className="h-8 w-8" fill="currentColor">
          <path fillRule="evenodd" d="M8 1.5h12A6.5 6.5 0 0 1 26.5 8v12a6.5 6.5 0 0 1-6.5 6.5H8A6.5 6.5 0 0 1 1.5 20V8A6.5 6.5 0 0 1 8 1.5Zm2 5A3.5 3.5 0 0 0 6.5 10v7a3.5 3.5 0 0 0 3.5 3.5h.5V24l4-3.5H18a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 18 6.5Z" />
          <path d="M9.5 10.5h3.7v3c0 2-1.2 3.2-3.3 3.8v-1.5c1-.4 1.4-.9 1.4-1.6H9.5Zm5.4 0h3.7v3c0 2-1.2 3.2-3.3 3.8v-1.5c1-.4 1.4-.9 1.4-1.6h-1.8Z" />
        </svg>
      </button>
    </div>
  );
};

export default LyricToggles;
