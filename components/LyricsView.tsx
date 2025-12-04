import React, { useRef, useEffect, useState, useMemo } from "react";
import { LyricLine as LyricLineType } from "../types";
import { useLyricsPhysics } from "../hooks/useLyricsPhysics";
import { useCanvasRenderer } from "../hooks/useCanvasRenderer";
import { LyricLine } from "./lyrics/LyricLine";
import { InterludeDots } from "./lyrics/InterludeDots";
import { ILyricLine } from "./lyrics/ILyricLine";

interface LyricsViewProps {
  lyrics: LyricLineType[];
  audioRef: React.RefObject<HTMLAudioElement>;
  isPlaying: boolean;
  currentTime: number;
  onSeekRequest: (time: number, immediate?: boolean) => void;
  matchStatus: "idle" | "matching" | "success" | "failed";
}

const LyricsView: React.FC<LyricsViewProps> = ({
  lyrics,
  audioRef,
  isPlaying,
  currentTime,
  onSeekRequest,
  matchStatus,
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [lyricLines, setLyricLines] = useState<ILyricLine[]>([]);
  const [mobileHoverIndex, setMobileHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const mobileHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!isMobile) {
      if (mobileHoverTimeoutRef.current) {
        clearTimeout(mobileHoverTimeoutRef.current);
        mobileHoverTimeoutRef.current = null;
      }
      return;
    }

    if (mobileHoverTimeoutRef.current) {
      clearTimeout(mobileHoverTimeoutRef.current);
      mobileHoverTimeoutRef.current = null;
    }

    if (mobileHoverIndex !== null) {
      mobileHoverTimeoutRef.current = setTimeout(() => {
        setMobileHoverIndex(null);
        mobileHoverTimeoutRef.current = null;
      }, 5000);
    }

    return () => {
      if (mobileHoverTimeoutRef.current) {
        clearTimeout(mobileHoverTimeoutRef.current);
        mobileHoverTimeoutRef.current = null;
      }
    };
  }, [mobileHoverIndex, isMobile]);

  // Measure Container Width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Initialize and Measure LyricLines
  useEffect(() => {
    if (!lyrics.length || containerWidth <= 0) {
      setLyricLines([]);
      return;
    }

    // Create LyricLine instances
    const lines: ILyricLine[] = [];
    const previousWidths: number[] = [];
    const WINDOW_SIZE = 5;

    lyrics.forEach((line, index) => {
      const isInterlude = line.isInterlude || line.text === "...";

      let duration = 0;
      if (isInterlude) {
        const nextLine = lyrics[index + 1];
        if (nextLine) {
          duration = nextLine.time - line.time;
        }
      }

      const lyricLine = isInterlude
        ? new InterludeDots(line, index, isMobile, duration)
        : new LyricLine(line, index, isMobile);

      // Calculate max width from previous n lines
      let suggestedWidth = 0;
      if (previousWidths.length > 0) {
        suggestedWidth = Math.max(...previousWidths);
      }

      lyricLine.measure(containerWidth, suggestedWidth);

      // Update sliding window
      const textWidth = lyricLine.getTextWidth();
      previousWidths.push(textWidth);
      if (previousWidths.length > WINDOW_SIZE) {
        previousWidths.shift();
      }

      lines.push(lyricLine);
    });

    setLyricLines(lines);
  }, [lyrics, containerWidth, isMobile]);

  // Calculate layout properties for physics
  const { linePositions, lineHeights } = useMemo(() => {
    const positions: number[] = [];
    const heights: number[] = [];
    let currentY = 0;

    lyricLines.forEach((line) => {
      const h = line.getHeight();
      positions.push(currentY);
      heights.push(h);
      currentY += h; // Don't add marginY here anymore
    });

    return { linePositions: positions, lineHeights: heights };
  }, [lyricLines]);

  const marginY = 18; // Define marginY here

  // Physics Hook
  const { activeIndex, handlers, linesState, updatePhysics } = useLyricsPhysics(
    {
      lyrics,
      audioRef,
      currentTime,
      isMobile,
      containerHeight: containerHeight > 0 ? containerHeight : 800,
      linePositions,
      lineHeights,
      marginY,
    },
  );

  // Mouse Interaction State
  const mouseRef = useRef({ x: 0, y: 0 });
  const visualTimeRef = useRef(currentTime);
  const touchIntentRef = useRef({
    id: null as number | null,
    startX: 0,
    startY: 0,
    lockedToLyrics: false,
    lockDecided: false,
  });

  // Mouse Tracking
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    handlers.onTouchMove(e);
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
      touchIntentRef.current.id = first.identifier;
      touchIntentRef.current.startX = first.clientX;
      touchIntentRef.current.startY = first.clientY;
      touchIntentRef.current.lockDecided = false;
      touchIntentRef.current.lockedToLyrics = false;
    }
    handlers.onTouchStart(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    handlers.onTouchMove(e);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    handlers.onTouchEnd();
    resetTouchIntent();
  };

  const handleTouchCancel = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    handlers.onTouchEnd();
    resetTouchIntent();
  };

  // Render Function
  const render = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    deltaTime: number,
  ) => {
    // Update Physics
    const dt = Math.min(deltaTime, 64) / 1000;

    // Calculate current dynamic heights
    const currentLineHeights = lyricLines.map(l => l.getCurrentHeight());

    updatePhysics(dt, currentLineHeights);

    // Smooth visual time interpolation
    // currentTime updates infrequently (every 50-200ms), but we render at high fps
    // We need to interpolate between frames while catching up to the real time
    let visualTime = visualTimeRef.current;
    const targetTime = currentTime;

    if (isPlaying) {
      const playbackRate = audioRef.current?.playbackRate || 1;
      // Advance time based on dt and playback rate
      visualTime += dt * playbackRate;

      const drift = targetTime - visualTime;

      // Adaptive smoothing strategy
      // 1. If drift is small (< 0.1s), trust our predicted time (very weak correction)
      // 2. If drift is moderate (< 0.5s), gentle correction
      // 3. If drift is large, stronger correction
      // This prevents "micro-stuttering" caused by the visual time being pulled back 
      // to a stale targetTime between updates.

      let tau = 0.5;
      if (Math.abs(drift) < 0.0001) {
        tau = 1.5; // Very stable, trust prediction
      } else if (Math.abs(drift) < 0.05) {
        tau = 0.4; // Gentle sync
      } else {
        tau = 0.2; // Fast catch-up
      }

      const smoothing = 1 - Math.exp(-dt / tau);
      visualTime += drift * smoothing;
    } else {
      // When paused or scrubbing, snap quickly to real time
      const easeFactor = Math.min(1, dt * 10);
      visualTime += (targetTime - visualTime) * easeFactor;
    }

    // Detect large jumps (seek operations or anomalies)
    if (!Number.isFinite(visualTime) || Math.abs(targetTime - visualTime) > 1) {
      visualTime = targetTime;
      handlers.onClick();
    }

    visualTimeRef.current = visualTime;

    if (!lyricLines.length) return;

    const paddingX = isMobile ? 24 : 56;
    const focalPointOffset = height * 0.25;

    // First pass: Determine hover and visibility
    // We can optimize this if needed, but for now iterating is fine.
    // Actually, we need to iterate to draw anyway.
    lyricLines.forEach((line, index) => {
      const physics = linesState.current.get(index);
      if (!physics) return;

      const visualY = physics.posY.current + focalPointOffset;
      const lineHeight = currentLineHeights[index];

      // Culling
      if (visualY + lineHeight < -100 || visualY > height + 100) {
        return;
      }

      // Hit Test for Hover (pointer devices)
      const pointerHover =
        mouseRef.current.x >= paddingX - 20 &&
        mouseRef.current.x <= width - paddingX + 20 &&
        mouseRef.current.y >= visualY &&
        mouseRef.current.y <= visualY + lineHeight;

      const isActive = index === activeIndex;
      const scale = physics.scale.current;
      const isHovering = isMobile
        ? mobileHoverIndex === index
        : pointerHover;

      // Opacity & Blur
      const lineCenter = visualY + lineHeight / 2;
      const focusY = height * 0.35;
      const dist = Math.abs(lineCenter - focusY);

      let opacity = 1;
      let blur = 0;

      if (!isActive) {
        const normDist = Math.min(dist, 600) / 600;
        const minOpacity = isMobile ? 0.4 : 0.25;
        opacity = minOpacity + (1 - minOpacity) * (1 - Math.pow(normDist, 0.5));

        if (!isMobile) {
          blur = normDist * 3;
        }
      }

      if (isHovering) {
        opacity = Math.max(opacity, 0.8);
        blur = 0;
      }

      // Update the line's internal state (draws to its own canvas)
      // We only need to redraw if something changed (time, active state, hover)
      // For now, we draw every frame because of the karaoke animation.
      // Optimization: Only draw active line every frame? Or check if time is within line range?
      // The LyricLine.draw method handles word animations.
      line.draw(
        isActive ? visualTime : currentTime,
        isActive,
        isHovering,
      );

      // Draw the line's canvas onto the main canvas
      ctx.save();

      // Apply transformations
      const cy = visualY + lineHeight / 2;
      ctx.translate(0, cy); // Translate to vertical center of the line position
      // Don't apply physics scale to interlude lines - they have their own expansion animation
      const effectiveScale = line.isInterlude() ? 1 : scale;
      ctx.scale(effectiveScale, effectiveScale);
      ctx.translate(0, -lineHeight / 2); // Translate back to top-left relative to center

      ctx.globalAlpha = opacity;
      if (blur > 0.5) {
        ctx.filter = `blur(${blur}px)`;
      } else {
        ctx.filter = "none";
      }

      // The line canvas is already sized to containerWidth, so we draw it at (0, 0) relative to the translation
      // But wait, our translation logic above assumes we are at the correct Y.
      // We translated to (0, cy) then back up.
      // So we draw at (0, 0).
      // Use logical dimensions for HiDPI support
      ctx.drawImage(
        line.getCanvas(),
        0,
        0,
        line.getLogicalWidth(),
        line.getLogicalHeight(),
      );

      ctx.restore();
    });

    // Draw Mask
    ctx.globalCompositeOperation = "destination-in";
    const maskGradient = ctx.createLinearGradient(0, 0, 0, height);
    maskGradient.addColorStop(0, "rgba(0,0,0,0)");
    maskGradient.addColorStop(0.15, "rgba(0,0,0,1)");
    maskGradient.addColorStop(0.85, "rgba(0,0,0,1)");
    maskGradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = maskGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "source-over";
  };

  const canvasRef = useCanvasRenderer({ onRender: render });

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const height = rect.height;
    const focalPointOffset = height * 0.25;

    let matched = false;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyrics[i]?.isMetadata) {
        continue;
      }
      const physics = linesState.current.get(i);
      if (!physics) continue;

      const visualY = physics.posY.current + focalPointOffset;
      const h = lyricLines[i].getCurrentHeight();

      if (clickY >= visualY && clickY <= visualY + h) {
        onSeekRequest(lyrics[i].time, true);
        if (isMobile) {
          setMobileHoverIndex(i);
        }
        handlers.onClick();
        matched = true;
        break;
      }
    }

    if (isMobile && !matched) {
      setMobileHoverIndex(null);
    }
  };

  if (!lyrics.length) {
    return (
      <div className="h-[85vh] lg:h-[65vh] flex flex-col items-center justify-center text-white/40 select-none">
        {matchStatus === "matching" ? (
          <div className="animate-pulse">Syncing Lyrics...</div>
        ) : (
          <>
            <div className="text-4xl mb-4 opacity-50">♪</div>
            <div>Play music to view lyrics</div>
          </>
        )}
      </div>
    );
  }

  // Manual wheel event attachment to fix passive listener warning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // We need to call the handler from useLyricsPhysics
      // But handlers is recreated on render? No, it depends on refs mostly but returned new object
      // We can use a ref to the latest handler or just disable the warning if we can't preventDefault?
      // Actually, to prevent default, we MUST attach with passive: false.
      handlers.onWheel(e as unknown as React.WheelEvent);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [handlers]); // handlers needs to be stable or we re-attach often. 
  // If handlers changes every render, this effect runs every render.
  // Let's check useLyricsPhysics. It returns a new object { ... } every render.
  // This is suboptimal for useEffect deps.
  // However, fixing the "unable to preventDefault" is the priority.

  return (
    <div
      ref={containerRef}
      className="relative h-[85vh] lg:h-[65vh] w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
      // onWheel removed here
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handlers.onTouchStart}
      onMouseMove={handleMouseMove}
      onMouseUp={handlers.onTouchEnd}
      onMouseLeave={(e) => {
        mouseRef.current = { x: -1000, y: -1000 };
        handlers.onTouchEnd();
      }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

export default LyricsView;
