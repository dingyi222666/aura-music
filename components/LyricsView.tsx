import React, { useRef, useEffect, useState, useLayoutEffect } from "react";
import { LyricLine as LyricLineType } from "../types";
import LyricLine from "./LyricLine";
import { SpringSystem } from "../services/springSystem";

// -------------------------------------------------------------------------
// Main Lyrics View (No Virtualization for smoothness)
// -------------------------------------------------------------------------

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
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // -------------------------------------------------------------------------
  // Physics State
  // -------------------------------------------------------------------------
  const springSystem = useRef(new SpringSystem({ y: 0 }));
  const animationRef = useRef(0);
  const lastTimeRef = useRef(0);

  const scrollState = useRef({
    isDragging: false,
    lastInteractionTime: 0,
    touchStartY: 0,
    touchLastY: 0,
    touchVelocity: 0,
    visualState: false,
  });

  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);

  const RESUME_DELAY_MS = 3000;

  // Detect mobile layout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  // -------------------------------------------------------------------------
  // Active Index Logic
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lyrics.length) return;
    let idx = -1;

    // Simple linear search suitable for song lengths
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        const nextTime = lyrics[i + 1]?.time ?? Infinity;
        if (currentTime < nextTime) {
          idx = i;
          break;
        }
      }
    }

    if (idx !== -1 && idx !== activeIndex) {
      setActiveIndex(idx);
    }
  }, [currentTime, lyrics]);

  // -------------------------------------------------------------------------
  // Animation & Physics Loop
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
    const loop = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      const sState = scrollState.current;
      const system = springSystem.current;

      // User Interaction Check
      const timeSinceInteraction = now - sState.lastInteractionTime;
      const isUserInteracting =
        sState.isDragging || timeSinceInteraction < RESUME_DELAY_MS;

      if (isUserInteracting !== sState.visualState) {
        sState.visualState = isUserInteracting;
        setIsUserScrolling(isUserInteracting);
      }

      // --- Physics Step ---
      if (isUserInteracting) {
        // Momentum (Friction)
        if (!sState.isDragging) {
          if (Math.abs(sState.touchVelocity) > 10) {
            const newY = system.getCurrent("y") + sState.touchVelocity * dt;
            system.setValue("y", newY);
            sState.touchVelocity *= 0.92; // Friction
          }
        }
      } else {
        // Auto Scroll Logic
        let targetY = system.getCurrent("y");

        if (activeIndex !== -1) {
          // Get exact position from DOM
          const activeEl = lineRefs.current.get(activeIndex);
          const containerH =
            containerRef.current?.clientHeight || window.innerHeight * 0.6;

          if (activeEl) {
            // Target Position: We want the active element to be at 30% of container height
            const desiredPos = containerH * 0.3;
            targetY = activeEl.offsetTop - desiredPos;
          }
        }

        // Smooth Spring to Target
        system.setTarget("y", targetY, {
          mass: 1,
          stiffness: 80,
          damping: 20,
          precision: 0.1,
        });
      }

      // Update Physics
      system.update(dt);
      const currentY = system.getCurrent("y");

      // --- Render Updates ---

      // We no longer transform the container `contentRef`.
      // Instead, we apply the scroll translation (-currentY) directly to each LyricLine via matrix3d.
      // This prevents jitter caused by nested transforms (container translate + child scale).

      if (containerRef.current) {
        const viewportHeight = containerRef.current.clientHeight;
        // Focus point is where the active line should visually appear (30% down the screen)
        // Since we translate lines by -currentY, the line at visual position Y corresponds to lineTop - currentY.
        // We want lineTop - currentY = viewportHeight * 0.3
        // So, activePoint in "content space" is currentY + viewportHeight * 0.3
        const activePoint = currentY + viewportHeight * 0.3;

        const range = 500; // Increased range for smoother falloff

        lineRefs.current.forEach((lineEl, index) => {
          if (!lineEl) return;

          const lineTop = lineEl.offsetTop;
          const lineHeight = lineEl.offsetHeight;
          const lineCenter = lineTop + lineHeight / 2;

          // Distance from the "active focus point"
          const dist = Math.abs(lineCenter - activePoint);

          // Normalize distance (0 = center, 1 = far)
          const normDist = Math.min(dist, range) / range;

          // Calculate visual properties based on distance (Continuous Fluid Animation)
          // Scale: 1.05 at center, 0.95 at edges
          const scale = 1.05 - 0.1 * normDist;

          // Opacity: deepen the fade on inactive lines, especially when not interacting
          const minOpacity = sState.visualState ? 0.35 : 0.28;
          const baseOpacity =
            1.0 - Math.pow(normDist, 0.5) * (1.0 - minOpacity);
          const fadeMultiplier =
            index === activeIndex ? 1 : sState.visualState ? 0.55 : 0.25;
          const opacity = Math.min(1, baseOpacity * fadeMultiplier);

          // Blur: 0 at center, increasing at edges (disabled on mobile for readability)
          const blur = isMobile
            ? 0
            : sState.visualState
              ? 0
              : 4 * Math.pow(normDist, 1.5);

          // Unified Matrix3D Application
          // Combines Scaling (sx, sy) and Translation (ty = -currentY)
          // matrix3d(sx, 0, 0, 0,  0, sy, 0, 0,  0, 0, 1, 0,  0, ty, 0, 1)

          lineEl.style.transform = `matrix3d(${scale},0,0,0,0,${scale},0,0,0,0,1,0,0,${-currentY},0,1)`;
          lineEl.style.opacity = opacity.toFixed(3);
          lineEl.style.filter =
            blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : "none";
        });
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [lyrics, activeIndex, isMobile]);

  // -------------------------------------------------------------------------
  // Interaction Handlers
  // -------------------------------------------------------------------------

  const handleTouchStart = (e: React.TouchEvent) => {
    scrollState.current.isDragging = true;
    scrollState.current.lastInteractionTime = performance.now();
    scrollState.current.touchStartY = e.touches[0].clientY;
    scrollState.current.touchLastY = e.touches[0].clientY;
    scrollState.current.touchVelocity = 0;

    // Reset spring to current position to take control
    const cur = springSystem.current.getCurrent("y");
    springSystem.current.setValue("y", cur);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    const dy = scrollState.current.touchLastY - y;
    scrollState.current.touchLastY = y;

    const newY = springSystem.current.getCurrent("y") + dy;
    springSystem.current.setValue("y", newY);

    scrollState.current.touchVelocity = dy * 60; // Simple velocity calc
    scrollState.current.lastInteractionTime = performance.now();
  };

  const handleTouchEnd = () => {
    scrollState.current.isDragging = false;
    scrollState.current.lastInteractionTime = performance.now();
  };

  const handleWheel = (e: React.WheelEvent) => {
    scrollState.current.lastInteractionTime = performance.now();
    const dy = e.deltaY;
    const newY = springSystem.current.getCurrent("y") + dy;
    springSystem.current.setValue("y", newY);

    if (!scrollState.current.visualState) setIsUserScrolling(true);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!lyrics.length) {
    return (
      <div className="h-[85vh] lg:h-[60vh] flex flex-col items-center justify-center text-white/40 select-none">
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

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative h-[95vh] lg:h-[60vh] w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
      }}
    >
      <div
        ref={contentRef}
        className="absolute top-0 left-0 w-full px-4 md:pl-12 will-change-transform"
        style={{ paddingTop: "30vh", paddingBottom: "40vh" }}
      >
        {lyrics.map((line, i) => {
          return (
            <LyricLine
              key={i}
              index={i}
              line={line}
              isActive={i === activeIndex}
              isUserScrolling={isUserScrolling}
              distance={Math.abs(i - activeIndex)}
              onLineClick={(t) => onSeekRequest(t, true)}
              audioRef={audioRef}
              isMobile={isMobile}
              setLineRef={(el) => {
                if (el) lineRefs.current.set(i, el);
                else lineRefs.current.delete(i);
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default LyricsView;
