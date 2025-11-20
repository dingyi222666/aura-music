import React, { useRef, useEffect } from "react";
import { LyricLine as LyricLineType } from "../types";

const containsNonAscii = (text: string) => /[^\x00-\x7f]/.test(text);
const isPunctuation = (text: string) => /^[\p{P}\p{S}]+$/u.test(text);
const spacingClassForWord = (text: string, isMobile = false) => {
  if (isPunctuation(text)) return "mr-0.5";
  if (containsNonAscii(text)) return isMobile ? "mr-1" : "mr-1.5";
  return isMobile ? "mr-2" : "mr-2.5";
};

interface LyricLineProps {
  index: number;
  line: LyricLineType;
  isActive: boolean;
  isUserScrolling: boolean;
  distance: number;
  onLineClick: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  setLineRef: (el: HTMLDivElement | null) => void;
  isMobile: boolean;
}

const LyricLine = React.memo(
  ({
    index,
    line,
    isActive,
    distance,
    isUserScrolling,
    onLineClick,
    audioRef,
    setLineRef,
    isMobile,
  }: LyricLineProps) => {
    const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);
    const rafRef = useRef<number>(0);

    // Reset refs array
    wordsRef.current = wordsRef.current.slice(0, line.words?.length || 0);

    // ------------------------------------------------------------
    // Animation Loop (Highlights & Rise)
    // ------------------------------------------------------------
    useEffect(() => {
      const updateWordStyles = () => {
        if (!audioRef.current) return;
        const currentTime = audioRef.current.currentTime;

        // Mode A: Word-by-word lyrics
        if (line.words && line.words.length > 0) {
          line.words.forEach((word, i) => {
            const span = wordsRef.current[i];
            if (!span) return;

            const spacing = spacingClassForWord(word.text, isMobile);
            const baseClass = `word-base ${spacing} whitespace-pre`;

            const isCurrent =
              currentTime >= word.startTime && currentTime <= word.endTime;
            const isPast = currentTime > word.endTime;

            // Reset classes first to ensure clean state transitions
            if (isCurrent) {
              const duration = word.endTime - word.startTime;
              // User Condition: length < 7 AND duration >= 1s
              if (word.text.length < 7 && duration >= 1.0) {
                span.className = `${baseClass} word-active`;
              } else {
                span.className = `${baseClass} word-current`;
              }
            } else if (isPast) {
              span.className = `${baseClass} word-past`;
            } else {
              span.className = `${baseClass} word-future`;
            }

            span.dataset.spacing = spacing;
          });
        }
      };

      if (isActive) {
        const loop = () => {
          updateWordStyles();
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } else {
        // If not active, run once to ensure words settle into correct state
        updateWordStyles();
      }

      return () => cancelAnimationFrame(rafRef.current);
    }, [isActive, line, audioRef, isMobile]);

    // ------------------------------------------------------------
    // Render Logic
    // ------------------------------------------------------------

    const textSizeClass = isMobile
      ? "text-2xl md:text-3xl lg:text-4xl"
      : "text-3xl md:text-4xl lg:text-5xl";

    return (
      <div
        ref={setLineRef}
        onClick={() => onLineClick(line.time)}
        className={`
                py-4 px-6 md:px-8 rounded-2xl cursor-pointer w-fit max-w-5xl
                origin-left
                hover:bg-white/10
                ${isActive ? "line-active" : "line-inactive"}
            `}
        style={{
          // Transforms (Scale/Translate) and Opacity are managed by LyricsView's loop
          // using matrix3d to eliminate jitter and conflict.
          willChange: "transform, opacity, filter",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      >
        {/* Styles for word states */}
        <style>{`
                .word-base {
                    display: inline-block;
                    transition: all 1.5s cubic-bezier(0.2, 0, 0, 1);
                    will-change: transform, text-shadow, opacity, color;
                }

                /* ACTIVE LINE STYLES */
                .line-active .word-active {
                    transform: translateY(-8px);
                    text-shadow: 0 0 20px rgba(255,255,255,0.9), 0 0 40px rgba(255,255,255,0.5);
                    opacity: 1;
                    color: #fff;
                }

                .line-active .word-current {
                    transform: translateY(-4px);
                    text-shadow: 0 0 10px rgba(255,255,255,0.5);
                    opacity: 1;
                    color: #fff;
                }

                .line-active .word-past {
                    transform: translateY(-5px);
                    text-shadow: 0 0 10px rgba(255,255,255,0.3);
                    opacity: 1;
                    color: #fff;
                }

                .line-active .word-future {
                    transform: translateY(0);
                    text-shadow: none;
                    opacity: 0.6;
                    color: rgba(255,255,255,0.5);
                }

                /* INACTIVE LINE STYLES */
                .line-inactive .word-active,
                .line-inactive .word-current,
                .line-inactive .word-past,
                .line-inactive .word-future {
                    transform: translateY(0) scale(1);
                    text-shadow: none;
                    color: inherit;
                }

            `}</style>

        <div
          className={`${textSizeClass} font-bold leading-tight tracking-tight text-white`}
        >
          {line.words && line.words.length > 0 ? (
            line.words.map((word, i) => {
              const spacingClass = spacingClassForWord(word.text, isMobile);
              return (
                <span
                  key={i}
                  ref={(el) => {
                    wordsRef.current[i] = el;
                  }}
                  data-spacing={spacingClass}
                  className={`word-base word-future ${spacingClass} whitespace-pre`}
                >
                  {word.text}
                </span>
              );
            })
          ) : (
            <span className="transition-all whitespace-pre-wrap break-words duration-[500ms] mr-2.5 tracking-wide">
              {line.text}
            </span>
          )}
        </div>
        {line.translation && (
          <div className="mt-2 text-lg md:text-xl font-medium text-white/60">
            {line.translation}
          </div>
        )}
      </div>
    );
  },
);

export default LyricLine;
