import React, { useRef, useEffect, useState, useMemo } from "react";
import { LyricLine as LyricLineType } from "../types";
import { getActiveState, useLyricsPhysics } from "../hooks/useLyricsPhysics";
import { useCanvasRenderer } from "../hooks/useCanvasRenderer";
import { LyricLine } from "./lyrics/LyricLine";
import { InterludeDots } from "./lyrics/InterludeDots";
import { ILyricLine } from "./lyrics/ILyricLine";
import { LineAnimationState } from "../hooks/useAnimationInterpolator";
import { useI18n } from "../hooks/useI18n";

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
  const { dict } = useI18n();
  const [isMobile, setIsMobile] = useState(false);
  const [lyricLines, setLyricLines] = useState<ILyricLine[]>([]);
  const [mobileHoverIndex, setMobileHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
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
      const next = lyrics.slice(index + 1).find((item) => {
        return !item.isMetadata && !item.isBackground && !item.isInterlude;
      });

      let duration = 0;
      if (isInterlude) {
        if (next) {
          duration = next.time - line.time;
        }
      }

      const lyricLine = isInterlude
        ? new InterludeDots(line, index, isMobile, duration, next?.align ?? "left")
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
    // Clear stale animation states when lyrics are re-measured
    lineAnimStatesRef.current.clear();
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

  const marginY = 18;

  // Physics Hook
  const { anchorRef, handlers, linesState, updatePhysics } = useLyricsPhysics(
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
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

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
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    moved: false,
    suppress: false,
  });

  // Per-line animation state (hover fade, press scale, blur transition)
  const lineAnimStatesRef = useRef<Map<number, LineAnimationState>>(new Map());
  // Track which line index is currently being pressed
  const pressedLineRef = useRef<number | null>(null);
  // Track pointer-down state for press animation
  const downRef = useRef(false);

  const pick = (clientY: number, rect: DOMRect) => {
    const hitY = clientY - rect.top;
    const focal = rect.height * 0.35;

    for (let i = 0; i < lyricLines.length; i++) {
      if (lyrics[i]?.isMetadata) continue;
      const physics = linesState.current.get(i);
      if (!physics) continue;
      const y = physics.posY.current + focal;
      const h = lyricLines[i].getCurrentHeight(visualTimeRef.current);
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
    handlers.onTouchMove(e);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    downRef.current = true;
    gestureRef.current.startX = e.clientX;
    gestureRef.current.startY = e.clientY;
    gestureRef.current.moved = false;
    gestureRef.current.suppress = false;
    pressedLineRef.current = pick(e.clientY, e.currentTarget.getBoundingClientRect());
    handlers.onTouchStart(e);
  };

  const handleMouseUp = () => {
    if (gestureRef.current.moved) {
      gestureRef.current.suppress = true;
    }
    downRef.current = false;
    pressedLineRef.current = null;
    handlers.onTouchEnd();
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
      handlers.onTouchStart(e);
      return;
    }

    downRef.current = false;
    pressedLineRef.current = null;
    handlers.onTouchStart(e);
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
    handlers.onTouchMove(e);
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
    handlers.onTouchEnd();
    resetTouchIntent();
  };

  const handleTouchCancel = (e: React.TouchEvent<HTMLDivElement>) => {
    const intent = updateTouchIntent(e);
    if (gestureRef.current.moved) {
      gestureRef.current.suppress = true;
    }
    if (intent.lockedToLyrics) {
      e.stopPropagation();
    }
    downRef.current = false;
    pressedLineRef.current = null;
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
      const nextTime = visualTime + drift * smoothing;
      const canRewind = drift < -0.25 || Boolean(audioRef.current?.seeking);
      visualTime = canRewind ? nextTime : Math.max(visualTime, nextTime);
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

    const active = getActiveState(lyrics, visualTime);
    const activeSet = new Set(active.activeIndexes);

    const currentLineHeights = lyricLines.map((line) => line.getCurrentHeight(visualTime));
    const layoutHeights = lyricLines.map((line, index) => {
      if (line.isInterlude()) {
        return currentLineHeights[index];
      }
      return line.getTargetHeight(visualTime);
    });

    updatePhysics(dt, layoutHeights, visualTime);

    const anchor = anchorRef.current >= 0 ? anchorRef.current : active.anchorIndex;

    const paddingX = isMobile ? 24 : 56;
    const focalPointOffset = height * 0.35;

    const queue: Array<{
      index: number;
      line: ILyricLine;
      visualY: number;
      lineHeight: number;
      opacity: number;
      blur: number;
      scale: number;
      pressScale: number;
      isActive: boolean;
      isHovering: boolean;
      hoverProgress: number;
      isPressed: boolean;
    }> = [];

    lyricLines.forEach((line, index) => {
      const physics = linesState.current.get(index);
      if (!physics) return;

      const visualY = physics.posY.current + focalPointOffset;
      const lineHeight = currentLineHeights[index];

      // Lines with zero current height are considered non-visible (e.g. background vocals far from playhead)
      if (lineHeight <= 0.001) {
        return;
      }

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
      const hover = pressedLineRef.current ?? mobileHoverIndex;

      const isActive = activeSet.has(index);
      const scale = physics.scale.current;
      const isHovering = isMobile
        ? hover === index
        : pointerHover;

      // Is this line currently being pressed?
      const isPressed = downRef.current && pressedLineRef.current === index;

      // --- Per-line animation state (smooth hover / press / blur) ---
      let animState = lineAnimStatesRef.current.get(index);
      if (!animState) {
        animState = new LineAnimationState();
        lineAnimStatesRef.current.set(index, animState);
      }

      // Opacity & Blur — compute raw target values
      const gap = anchor >= 0 ? Math.abs(index - anchor) : 0;

      let targetOpacity = 1;
      let targetBlur = 0;
      const isBg = line.isBackgroundLine();

      if (!isActive) {
        const floor = isMobile ? 0.4 : isBg ? 0.34 : 0.18;
        const fade = isMobile ? 0.18 : isBg ? 0.18 : 0.22;
        targetOpacity = Math.max(floor, 1 - gap * fade);

        if (!isMobile && !isBg && gap > 0) {
          targetBlur = Math.min(5, 1 + gap);
        }
      }

      // Update animation state (hover, press, blur) — all smooth transitions
      const { hoverProgress, pressScale, blurAmount } = animState.update(
        dt,
        isHovering,
        isPressed,
        targetBlur,
      );

      // Apply hover influence on opacity (interpolated smoothly)
      let opacity = targetOpacity;
      if (hoverProgress > 0) {
        opacity = targetOpacity + (Math.max(0.8, targetOpacity) - targetOpacity) * hoverProgress;
      }

      // Blur: use the smoothly interpolated value, reduced by hover progress
      const blur = isBg ? 0 : blurAmount * (1 - hoverProgress);

      queue.push({
        index,
        line,
        visualY,
        lineHeight,
        opacity,
        blur,
        scale,
        pressScale,
        isActive,
        isHovering,
        hoverProgress,
        isPressed,
      });
    });

    queue
      .sort((a, b) => {
        if (Math.abs(a.visualY - b.visualY) > 0.5) {
          return a.visualY - b.visualY;
        }
        if (a.line.isBackgroundLine() !== b.line.isBackgroundLine()) {
          return a.line.isBackgroundLine() ? 1 : -1;
        }
        return a.index - b.index;
      })
      .forEach((item) => {
        const useVisualTime = item.isActive || item.line.isBackgroundLine();
        item.line.draw(
          useVisualTime ? visualTime : currentTime,
          item.isActive,
          item.isHovering,
          item.hoverProgress,
        );

        ctx.save();

        const cy = item.visualY + item.lineHeight / 2;
        const pivotX = item.line.getScalePivot();
        const effectiveScale = item.line.isInterlude() ? 1 : item.scale;
        ctx.translate(pivotX, cy);
        ctx.scale(effectiveScale, effectiveScale);
        ctx.translate(-pivotX, -item.lineHeight / 2);

        if (Math.abs(item.pressScale - 1) > 0.001) {
          const pressX = item.line.getPressPivot();
          ctx.translate(pressX, item.lineHeight / 2);
          ctx.scale(item.pressScale, item.pressScale);
          ctx.translate(-pressX, -item.lineHeight / 2);
        }

        ctx.globalAlpha = item.opacity;
        ctx.filter = item.blur > 0.5 ? `blur(${item.blur}px)` : "none";
        ctx.drawImage(
          item.line.getCanvas(),
          0,
          0,
          item.line.getLogicalWidth(),
          item.line.getLogicalHeight(),
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
    if (gestureRef.current.suppress) {
      gestureRef.current.suppress = false;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const height = rect.height;
    const focalPointOffset = height * 0.35;

    let matched = false;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyrics[i]?.isMetadata) {
        continue;
      }
      const physics = linesState.current.get(i);
      if (!physics) continue;

      const visualY = physics.posY.current + focalPointOffset;
      const h = lyricLines[i].getCurrentHeight(visualTimeRef.current);

      if (clickY >= visualY && clickY <= visualY + h) {
        // Trigger press "pop" animation on the clicked line
        const animState = lineAnimStatesRef.current.get(i);
        if (animState) {
          animState.triggerPress();
        }

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

  // Manual wheel event attachment to fix passive listener warning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      handlersRef.current.onWheel(e as unknown as React.WheelEvent);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-[85vh] lg:h-[75vh] w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={(e) => {
        mouseRef.current = { x: -1000, y: -1000 };
        if (gestureRef.current.moved) {
          gestureRef.current.suppress = true;
        }
        downRef.current = false;
        pressedLineRef.current = null;
        handlers.onTouchEnd();
      }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      {!lyrics.length && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 select-none pointer-events-none">
          {matchStatus === "matching" ? (
            <div className="animate-pulse">{dict.lyrics.syncing}</div>
          ) : (
            <>
              <div className="text-4xl mb-4 opacity-50">♪</div>
              <div>{dict.lyrics.empty}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default LyricsView;
