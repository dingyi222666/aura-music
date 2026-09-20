import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from "react";
import { LyricLine as LyricLineType } from "@aura-music/core/types";
import { useCanvasRenderer } from "@aura-music/core/react/useCanvasRenderer";
import { LyricsEngine } from "./renderer/LyricsEngine";
import { usePageActive } from "@aura-music/core/react/usePageActive";
import { LyricsRenderer } from "./renderer/LyricsRenderer";

export interface LyricsViewProps {
  labels?: { syncing: string; empty: string };
  lyrics: LyricLineType[];
  translated?: boolean;
  enabled?: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  onSeekRequest: (time: number, immediate?: boolean) => void;
  matchStatus: "idle" | "matching" | "success" | "failed";
}

const LyricsView: React.FC<LyricsViewProps> = ({
  lyrics,
  translated = true,
  enabled = true,
  audioRef,
  currentTime,
  onSeekRequest,
  matchStatus,
  labels = { syncing: "Finding lyrics…", empty: "No lyrics available" },
}) => {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 1024px)").matches);
  const active = usePageActive();
  const running = enabled && active;
  const engine = useMemo(() => new LyricsEngine(lyrics), [lyrics]);
  const painter = useMemo(() => new LyricsRenderer(engine), [engine]);
  const [mobileHoverIndex, setMobileHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect mobile layout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
      if (!event.matches) {
        setMobileHoverIndex(null);
      }
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (mobileHoverIndex !== null && mobileHoverIndex >= lyrics.length) {
      setMobileHoverIndex(null);
    }
  }, [lyrics.length, mobileHoverIndex]);

  useEffect(() => {
    if (!isMobile) return;
    if (currentTime < 0.1) {
      setMobileHoverIndex(null);
    }
  }, [currentTime, isMobile]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isMobile || mobileHoverIndex === null) {
      return;
    }

    timerRef.current = setTimeout(() => {
      setMobileHoverIndex(null);
      timerRef.current = null;
    }, 5000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [mobileHoverIndex, isMobile]);

  // Measure Container Width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => engine.layout(containerWidth, isMobile, translated),
    [engine, containerWidth, isMobile, translated],
  );
  const lyricLines = layout.lines;

  const motion = engine.motion;

  // Mouse Interaction State
  const mouseRef = useRef({ x: 0, y: 0 });
  const hoverRef = useRef(false);
  const touchIntentRef = useRef({
    id: null as number | null,
    startX: 0,
    startY: 0,
    lockedToLyrics: false,
    lockDecided: false,
  });
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    moved: false,
    suppress: false,
  });

  // Track which line index is currently being pressed
  const pressedLineRef = useRef<number | null>(null);
  // Track pointer-down state for press animation
  const downRef = useRef(false);

  useEffect(() => {
    setMobileHoverIndex(null);
    painter.resume();
  }, [painter]);

  useLayoutEffect(() => {
    painter.resume();
    if (!running) {
      downRef.current = false;
      pressedLineRef.current = null;
      hoverRef.current = false;
      setMobileHoverIndex(null);
    }
  }, [running, painter]);

  const pick = (clientY: number, rect: DOMRect) => {
    const hitY = clientY - rect.top;
    const focal = rect.height * 0.25;

    for (let i = 0; i < lyricLines.length; i++) {
      if (lyrics[i]?.isMetadata) continue;
      const physics = motion.rows[i];
      if (!physics) continue;
      const y = physics.posY.current + focal;
      const h = painter.transition.heights[i] ?? lyricLines[i].getCurrentHeight(painter.time);
      if (hitY >= y && hitY <= y + h) {
        return i;
      }
    }

    return null;
  };

  // Mouse Tracking
  const markGesture = (x: number, y: number, gap: number) => {
    if (gestureRef.current.moved) {
      return;
    }

    if (
      Math.abs(x - gestureRef.current.startX) > gap ||
      Math.abs(y - gestureRef.current.startY) > gap
    ) {
      gestureRef.current.moved = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (downRef.current) {
      markGesture(e.clientX, e.clientY, 6);
    }
    motion.move(e.clientY);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    downRef.current = true;
    gestureRef.current.startX = e.clientX;
    gestureRef.current.startY = e.clientY;
    gestureRef.current.moved = false;
    gestureRef.current.suppress = false;
    pressedLineRef.current = pick(e.clientY, e.currentTarget.getBoundingClientRect());
    motion.begin(e.clientY);
  };

  const handleMouseUp = () => {
    if (gestureRef.current.moved) {
      gestureRef.current.suppress = true;
    }
    downRef.current = false;
    pressedLineRef.current = null;
    motion.end();
  };

  const updateTouchIntent = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = touchIntentRef.current;
    const touches = e.touches.length ? e.touches : e.changedTouches;

    if (intent.id === null && touches.length > 0) {
      const first = touches[0];
      intent.id = first.identifier;
      intent.startX = first.clientX;
      intent.startY = first.clientY;
      intent.lockDecided = false;
      intent.lockedToLyrics = false;
    }

    const match = Array.from(touches).find((t) => t.identifier === intent.id);
    if (!match) {
      return intent;
    }

    if (!intent.lockDecided) {
      const deltaX = Math.abs(match.clientX - intent.startX);
      const deltaY = Math.abs(match.clientY - intent.startY);
      const threshold = 8;
      if (deltaX > threshold || deltaY > threshold) {
        intent.lockDecided = true;
        intent.lockedToLyrics = deltaY > deltaX * 1.15;
      }
    }

    return intent;
  };

  const resetTouchIntent = () => {
    touchIntentRef.current = {
      id: null,
      startX: 0,
      startY: 0,
      lockedToLyrics: false,
      lockDecided: false,
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const first = e.touches[0];
    if (first) {
      downRef.current = true;
      gestureRef.current.startX = first.clientX;
      gestureRef.current.startY = first.clientY;
      gestureRef.current.moved = false;
      gestureRef.current.suppress = false;
      touchIntentRef.current.id = first.identifier;
      touchIntentRef.current.startX = first.clientX;
      touchIntentRef.current.startY = first.clientY;
      touchIntentRef.current.lockDecided = false;
      touchIntentRef.current.lockedToLyrics = false;
      pressedLineRef.current = pick(first.clientY, e.currentTarget.getBoundingClientRect());
      motion.begin(first.clientY);
      return;
    }

    downRef.current = false;
    pressedLineRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    const touch = e.touches[0];
    if (touch) {
      markGesture(touch.clientX, touch.clientY, 8);
      if (gestureRef.current.moved) {
        pressedLineRef.current = null;
      }
    }
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    if (touch && intent.lockedToLyrics) motion.move(touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    if (gestureRef.current.moved) {
      gestureRef.current.suppress = true;
    }
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    downRef.current = false;
    pressedLineRef.current = null;
    motion.end();
    resetTouchIntent();
  };

  const handleTouchCancel = (e: React.TouchEvent<HTMLDivElement>) => {
    motion.end(performance.now(), true);
    gestureRef.current.suppress = true;
    handleTouchEnd(e);
  };

  const render = (ctx: CanvasRenderingContext2D, width: number, height: number, dt: number) => {
    painter.render(ctx, width, height, dt, {
      layout,
      audio: audioRef.current,
      time: currentTime,
      mobile: isMobile,
      hovered: hoverRef.current,
      mouse: mouseRef.current,
      pressed: pressedLineRef.current,
      hover: mobileHoverIndex,
      down: downRef.current,
    });
  };

  const canvasRef = useCanvasRenderer({ onRender: render, enabled: running });

  const handleClick = (e: React.MouseEvent) => {
    if (gestureRef.current.suppress) {
      gestureRef.current.suppress = false;
      return;
    }

    const index = pick(e.clientY, e.currentTarget.getBoundingClientRect());
    if (isMobile) setMobileHoverIndex(index);
    if (index === null) return;
    painter.press(index);
    onSeekRequest(lyrics[index].time, true);
    motion.follow();
  };

  // Manual wheel event attachment to fix passive listener warning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      motion.wheel(e.deltaY, e.deltaMode);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [motion]);

  return (
    <div
      ref={containerRef}
      className="relative h-[88vh] lg:h-[80vh] w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        hoverRef.current = true;
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={(e) => {
        mouseRef.current = { x: -1000, y: -1000 };
        hoverRef.current = false;
        if (gestureRef.current.moved) {
          gestureRef.current.suppress = true;
        }
        downRef.current = false;
        pressedLineRef.current = null;
        motion.end();
      }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      {!lyrics.length && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 select-none pointer-events-none">
          {matchStatus === "matching" ? (
            <div className="animate-pulse">{labels.syncing}</div>
          ) : (
            <>
              <div className="text-4xl mb-4 opacity-50">♪</div>
              <div>{labels.empty}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default LyricsView;
