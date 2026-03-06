import { useRef, useEffect, useCallback, useMemo } from "react";
import { LyricLine } from "../types";
import { SpringSystem, SpringConfig } from "../services/springSystem";

const getNow = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

interface UseLyricsPhysicsProps {
  lyrics: LyricLine[];
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  isMobile: boolean;
  containerHeight: number; // Passed from canvas
  linePositions: number[]; // Absolute Y positions of lines (packed, no margins)
  lineHeights: number[]; // Heights of lines for centering logic
  marginY: number; // Base margin between lines
}

interface SpringState {
  current: number;
  velocity: number;
  target: number;
}

export interface LinePhysicsState {
  posY: SpringState;
  scale: SpringState;
}

const AUTO_SCROLL_SPRING: SpringConfig = {
  mass: 1.05,
  stiffness: 205,
  damping: 24,
  precision: 0.08,
};

const getLinePosSpring = (relativeIndex: number): SpringConfig => {
  if (relativeIndex <= 0) {
    return { mass: 1, stiffness: 450, damping: 31, precision: 0.1 };
  }

  if (relativeIndex === 1) {
    return { mass: 1, stiffness: 410, damping: 29, precision: 0.1 };
  }

  return { mass: 1.02, stiffness: 370, damping: 28, precision: 0.1 };
};

const SCALE_SPRING: SpringConfig = {
  mass: 1,
  stiffness: 140,
  damping: 30,
  precision: 0.001,
};

const USER_SCROLL_SPRING: SpringConfig = {
  mass: 0.9,
  stiffness: 185,
  damping: 34,
  precision: 0.01,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const RUBBER_BAND_CONSTANT = 1.2;
const MOMENTUM_DECEL = 8000; // px/s^2 friction applied to inertial scroll
const MIN_SCROLL_VELOCITY = 8;
const MAX_SCROLL_VELOCITY = 2000;
const WHEEL_VELOCITY_GAIN = 12;
const WHEEL_SCROLL_GAIN = 0.5;
const BG_LEAD = 0.9;
const BG_TRAIL = 0.45;
const MERGE_EPS = 1e-3;

const rubberBand = (overdrag: number, dimension: number) => {
  const abs = Math.abs(overdrag);
  const cappedDimension = Math.max(dimension, 1);
  const result =
    (1 - 1 / ((abs * RUBBER_BAND_CONSTANT) / cappedDimension + 1)) *
    cappedDimension;
  return result * Math.sign(overdrag);
};

const getLineEnd = (line: LyricLine) => {
  if (line.endTime && line.endTime > line.time) {
    return line.endTime;
  }

  if (line.words?.length) {
    const word = line.words[line.words.length - 1];
    if (word.endTime > line.time) {
      return word.endTime;
    }
  }

  return line.time + 4;
};

const nextOf = (lyrics: LyricLine[], index: number) => {
  for (let i = index + 1; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (line.isMetadata || line.isBackground) continue;
    return line;
  }

  return undefined;
};

const activeEndOf = (lyrics: LyricLine[], index: number) => {
  const line = lyrics[index];
  if (!line) return 0;

  const end = getLineEnd(line);
  if (line.isInterlude) {
    return end;
  }

  const next = nextOf(lyrics, index);
  if (!next) {
    return end;
  }

  return Math.max(end, next.time);
};

const isMain = (line?: LyricLine) => {
  if (!line) return false;
  return !line.isMetadata && !line.isBackground && !line.isInterlude;
};

export interface ActiveState {
  activeIndexes: number[];
  anchorIndex: number;
}

export const getActiveState = (
  lyrics: LyricLine[],
  currentTime: number,
): ActiveState => {
  if (!lyrics.length) {
    return { activeIndexes: [], anchorIndex: -1 };
  }

  const activeIndexes: number[] = [];
  const mains: number[] = [];
  let latest = -1;

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (line.isMetadata || line.isBackground) continue;

    if (currentTime < line.time) break;
    latest = i;

    if (currentTime >= activeEndOf(lyrics, i)) continue;

    activeIndexes.push(i);
    if (isMain(line)) {
      mains.push(i);
    }
  }

  return {
    activeIndexes,
    anchorIndex: mains[0] ?? activeIndexes[0] ?? latest,
  };
};

export const getAnchors = (lyrics: LyricLine[]) => {
  let last = -1;

  return lyrics.map((line, index) => {
    if (!line.isBackground) {
      if (!line.isMetadata && !line.isInterlude) {
        last = index;
      }
      return index;
    }

    const anchor = last >= 0 ? last : index;
    for (let i = index - 1; i >= 0; i--) {
      const prev = lyrics[i];
      if (prev.isMetadata || prev.isBackground || prev.isInterlude) {
        continue;
      }

      if (getLineEnd(prev) > line.time + 1e-3) {
        return i;
      }
    }

    return anchor;
  });
};

export interface ScrollGroup {
  start: number;
  end: number;
  items: number[];
}

const windowOf = (line: LyricLine) => {
  const end = getLineEnd(line);
  if (line.isBackground) {
    return {
      start: line.time - BG_LEAD,
      end: end + BG_TRAIL,
    };
  }

  return {
    start: line.time,
    end,
  };
};

export const getScrollGroups = (
  lyrics: LyricLine[],
  anchors: number[] = getAnchors(lyrics),
): ScrollGroup[] => {
  const items = lyrics.flatMap((line, index) =>
    line.isMetadata || line.isBackground ? [] : [index],
  );
  const groups: ScrollGroup[] = [];

  for (let i = 0; i < items.length;) {
    const start = items[i];
    const block = [start];
    // Only lines that start while the anchor line itself is alive
    // belong to the same scroll round.
    const limit = getLineEnd(lyrics[start]);
    let tail = limit;
    let next = i + 1;

    if (!lyrics[start].isInterlude) {
      while (next < items.length) {
        const index = items[next];
        if (lyrics[index].isInterlude) {
          break;
        }
        if (lyrics[index].time > limit + MERGE_EPS) {
          break;
        }

        block.push(index);
        tail = Math.max(tail, getLineEnd(lyrics[index]));
        next += 1;
      }
    }

    const seen = new Set(block);
    let prev = -1;

    while (tail > prev + MERGE_EPS) {
      prev = tail;

      lyrics.forEach((line, index) => {
        if (!line.isBackground) return;
        if (anchors[index] === index) return;
        if (!seen.has(anchors[index])) return;

        const span = windowOf(line);
        if (span.start > tail + MERGE_EPS) {
          return;
        }

        tail = Math.max(tail, span.end);
      });
    }

    groups.push({
      start,
      end: tail,
      items: block,
    });

    i = next;
  }

  return groups;
};

export const getScrollAnchor = (
  lyrics: LyricLine[],
  currentTime: number,
  groups: ScrollGroup[] = getScrollGroups(lyrics),
) => {
  let latest = -1;

  for (const group of groups) {
    if (currentTime < lyrics[group.start].time) {
      break;
    }

    latest = group.start;
    if (currentTime < group.end) {
      return group.start;
    }
  }

  return latest;
};

export const useLyricsPhysics = ({
  lyrics,
  audioRef,
  currentTime,
  isMobile,
  containerHeight,
  linePositions,
  lineHeights,
  marginY,
}: UseLyricsPhysicsProps) => {
  const anchors = useMemo(() => getAnchors(lyrics), [lyrics]);
  const groups = useMemo(() => getScrollGroups(lyrics, anchors), [anchors, lyrics]);
  const homes = useMemo(() => {
    const list = new Array(lyrics.length).fill(-1);

    groups.forEach((group) => {
      group.items.forEach((index) => {
        list[index] = group.start;
      });
    });

    anchors.forEach((anchor, index) => {
      if (!lyrics[index]?.isBackground) return;
      list[index] = anchor >= 0 && list[anchor] >= 0 ? list[anchor] : anchor;
    });

    return list;
  }, [anchors, groups, lyrics]);

  const buildLayout = useCallback(
    (heights: number[]) => {
      const groups = new Map<number, number[]>();
      anchors.forEach((anchor, index) => {
        if (!lyrics[index]?.isBackground || anchor === index) {
          return;
        }

        const list = groups.get(anchor) ?? [];
        list.push(index);
        groups.set(anchor, list);
      });

      const positions = new Array(lyrics.length).fill(0);
      const done = new Set<number>();
      let y = 0;
      let hasVisible = false;

      const place = (index: number) => {
        positions[index] = y;
        const h = heights[index] ?? 0;
        if (h <= 0.001) {
          return;
        }

        hasVisible = true;
        y += h + marginY;
      };

      for (let index = 0; index < lyrics.length; index++) {
        if (done.has(index)) {
          continue;
        }

        if (lyrics[index]?.isBackground && anchors[index] !== index) {
          continue;
        }

        place(index);
        done.add(index);

        const group = groups.get(index);
        if (!group) {
          continue;
        }

        for (const child of group) {
          place(child);
          done.add(child);
        }
      }

      return {
        positions,
        bottom: hasVisible ? Math.max(0, y - marginY) : 0,
      };
    },
    [anchors, lyrics, marginY],
  );

  // Physics State
  const linesState = useRef<Map<number, LinePhysicsState>>(new Map());

  // Main Scroll Spring (The "Camera")
  const springSystem = useRef(new SpringSystem({ scrollY: 0 }));
  const scrollLimitsRef = useRef({ min: 0, max: 0 });

  // Track anchor changes to detect seek jumps
  const prevAnchorRef = useRef(-1);
  const RESUME_DELAY_MS = 3000;
  const FOCAL_POINT_RATIO = 0.65; // 65% from top (matched to LyricsView)

  // Scroll Interaction State
  const scrollState = useRef({
    isDragging: false,
    lastInteractionTime: getNow() - RESUME_DELAY_MS - 10,
    touchStartY: 0,
    touchLastY: 0,
    touchVelocity: 0,
    targetScrollY: 0,
  });

  const clampScrollValue = useCallback(
    (value: number, allowRubber = false) => {
      const { min, max } = scrollLimitsRef.current;
      if (allowRubber) {
        if (value < min) {
          return min - rubberBand(min - value, containerHeight || 1);
        }
        if (value > max) {
          return max + rubberBand(value - max, containerHeight || 1);
        }
        return value;
      }
      if (max <= min) {
        return min;
      }
      return clamp(value, min, max);
    },
    [containerHeight],
  );

  const markScrollIdle = useCallback(() => {
    scrollState.current.lastInteractionTime = getNow() - RESUME_DELAY_MS - 10;
    scrollState.current.isDragging = false;
    scrollState.current.touchVelocity = 0;
    const currentScroll = springSystem.current.getCurrent("scrollY");
    const clamped = clampScrollValue(currentScroll, false);
    scrollState.current.targetScrollY = clamped;
    springSystem.current.setValue("scrollY", clamped);
  }, [clampScrollValue]);

  // Initialize line states
  useEffect(() => {
    const newState = new Map<number, LinePhysicsState>();
    const layout = buildLayout(lineHeights);
    lyrics.forEach((_, i) => {
      const initialPos = layout.positions[i] || 0;
      newState.set(i, {
        posY: { current: initialPos, velocity: 0, target: initialPos },
        scale: { current: 1, velocity: 0, target: 1 },
      });
    });
    linesState.current = newState;
  }, [buildLayout, lyrics, lineHeights]);

  useEffect(() => {
    springSystem.current.setValue("scrollY", 0);
    scrollState.current.targetScrollY = 0;
    prevAnchorRef.current = -1;
    markScrollIdle();
  }, [lyrics, lineHeights, markScrollIdle]);

  // Helper: Update a single spring value
  const updateSpring = (
    state: SpringState,
    config: SpringConfig,
    dt: number,
  ) => {
    const displacement = state.current - state.target;
    const springForce = -config.stiffness * displacement;
    const dampingForce = -config.damping * state.velocity;
    const acceleration = (springForce + dampingForce) / config.mass;

    state.velocity += acceleration * dt;
    state.current += state.velocity * dt;

    if (
      Math.abs(state.velocity) < (config.precision || 0.01) &&
      Math.abs(displacement) < (config.precision || 0.01)
    ) {
      state.current = state.target;
      state.velocity = 0;
    }
  };

  // Main Physics Loop - Exposed as update function
  const updatePhysics = useCallback(
    (dt: number, layoutHeights?: number[], time: number = currentTime) => {
      const now = performance.now();
      const sState = scrollState.current;
      const system = springSystem.current;
      const active = getActiveState(lyrics, time);
      const anchor = getScrollAnchor(lyrics, time, groups);
      const activeSet = new Set(active.activeIndexes);

      const activeHeights = (
        layoutHeights && layoutHeights.length > 0
          ? layoutHeights
          : lineHeights
      ).slice();

      if (anchor >= 0) {
        activeHeights.forEach((_, index) => {
          if (!lyrics[index]?.isBackground) return;
          if (homes[index] < 0 || homes[index] >= anchor) return;
          activeHeights[index] = 0;
        });
      }

      const layout = buildLayout(activeHeights);
      const currentPositions = layout.positions;
      const contentBottom = layout.bottom;

      // Detect anchor jumps (seek operations)
      const prevAnchorIndex = prevAnchorRef.current;
      let anchorJump = 0;
      if (prevAnchorIndex !== -1 && anchor !== -1) {
        anchorJump = Math.abs(anchor - prevAnchorIndex);
      } else if (prevAnchorIndex !== -1 && anchor === -1) {
        // Seeking to a position before any lyrics - treat as large jump
        anchorJump = prevAnchorIndex + 1;
      }

      prevAnchorRef.current = anchor;

      // Determine if we need to snap due to a large seek jump
      const shouldSnap = anchorJump > 5;

      // 1. Handle Global Scroll Physics
      const timeSinceInteraction = now - sState.lastInteractionTime;
      const userScrollActive =
        sState.isDragging || timeSinceInteraction < RESUME_DELAY_MS;
      const { min: minScroll, max: maxScroll } = scrollLimitsRef.current;

      // Calculate target scroll based on the current anchor line
      const computeActiveScrollTarget = () => {
        if (anchor === -1) return 0;

        const lineY = currentPositions[anchor] || 0;
        const lineHeight = activeHeights[anchor] || 0;
        return lineY + lineHeight / 2;
      };

      const currentScrollY = system.getCurrent("scrollY");
      const hasMomentum = Math.abs(sState.touchVelocity) > MIN_SCROLL_VELOCITY;
      const isDirectManipulation = sState.isDragging || hasMomentum;

      if (userScrollActive) {
        if (sState.isDragging) {
          const clampedCurrent = clampScrollValue(currentScrollY, true);
          system.setValue("scrollY", clampedCurrent);
          sState.targetScrollY = clampedCurrent;
        } else if (hasMomentum) {
          // Inertia scrolling with hard bounds
          const proposedY = currentScrollY + sState.touchVelocity * dt;
          const boundedY = clampScrollValue(proposedY, true);
          system.setValue("scrollY", boundedY);
          if (boundedY !== proposedY) {
            sState.touchVelocity = 0;
          } else {
            const decel = MOMENTUM_DECEL * dt;
            if (Math.abs(sState.touchVelocity) <= decel) {
              sState.touchVelocity = 0;
            } else {
              sState.touchVelocity -= Math.sign(sState.touchVelocity) * decel;
            }
          }
          sState.targetScrollY = system.getCurrent("scrollY");
        } else {
          const reboundTarget = clampScrollValue(currentScrollY, false);
          sState.targetScrollY = reboundTarget;
          system.setTarget("scrollY", reboundTarget, USER_SCROLL_SPRING);
        }
      } else {
        const autoTarget = clampScrollValue(computeActiveScrollTarget(), false);
        system.setTarget("scrollY", autoTarget, AUTO_SCROLL_SPRING);
        sState.targetScrollY = autoTarget;
      }

      // Update the system to apply the spring forces to scrollY
      system.update(dt);

      // Use the current interpolated value as the actual scroll position
      const currentGlobalScrollY = system.getCurrent("scrollY");
      const isUserInteracting = userScrollActive;

      // 2. Update All Lines
      const springVelocity = system.getVelocity("scrollY");
      const scrollVelocity = isDirectManipulation
        ? sState.touchVelocity
        : springVelocity;

      // Elastic margin effect
      // Disable elastic effect when overshooting to prevent "lyrics distortion"
      const isOvershooting =
        currentGlobalScrollY < minScroll || currentGlobalScrollY > maxScroll;
      const elasticFactor =
        !isDirectManipulation && !isOvershooting
          ? Math.min(Math.max(scrollVelocity * 0.001, -0.3), 0.3)
          : 0;

      // Adjusted maxScrollY to allow last line to be scrolled higher (up to ~10% from bottom)
      const maxScrollY = Math.max(0, contentBottom - containerHeight * 0.1);
      scrollLimitsRef.current = {
        min: 0,
        max: Number.isFinite(maxScrollY) ? maxScrollY : 0,
      };

      linesState.current.forEach((state, index) => {
        // --- A. Position Physics ---
        const relativeIndex = index - (anchor === -1 ? 0 : anchor);

        // Apply elasticity relative to the center of the screen or active item
        const elasticMarginOffset = relativeIndex * (marginY * elasticFactor);

        // Use recalculated position
        const targetPos = currentPositions[index];

        // Guard against undefined targetPos (e.g. during initialization)
        if (typeof targetPos === "number") {
          state.posY.target =
            -currentGlobalScrollY +
            targetPos +
            elasticMarginOffset;
        }

        const displacement = state.posY.current - state.posY.target;

        // When a seek jump is detected, snap line positions to follow scrollY directly
        // This prevents lines from animating independently and causing visual chaos
        // Also snap if displacement is very large
        if (isDirectManipulation) {
          state.posY.current = state.posY.target;
          state.posY.velocity = 0;
        } else if (
          shouldSnap ||
          Math.abs(displacement) > containerHeight * 0.5
        ) {
          state.posY.current = state.posY.target;
          state.posY.velocity = 0;
        } else {
          const posConfig = isUserInteracting
            ? { mass: 1, stiffness: 320, damping: 32, precision: 0.1 }
            : getLinePosSpring(relativeIndex);
          updateSpring(state.posY, posConfig, dt);
        }

        // --- B. Scale Physics ---
        const targetScale = activeSet.has(index) ? 1.03 : 1;
        state.scale.target = targetScale;
        if (isDirectManipulation || shouldSnap) {
          state.scale.current = targetScale;
          state.scale.velocity = 0;
        } else {
          updateSpring(state.scale, SCALE_SPRING, dt);
        }
      });
    },
    [
      clampScrollValue,
      containerHeight,
      currentTime,
      groups,
      homes,
      linePositions,
      lineHeights,
      buildLayout,
      lyrics,
    ],
  );

  // Interaction Handlers
  const handlers = {
    onTouchStart: (e: React.TouchEvent | React.MouseEvent) => {
      scrollState.current.isDragging = true;
      scrollState.current.lastInteractionTime = performance.now();
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      scrollState.current.touchStartY = clientY;
      scrollState.current.touchLastY = clientY;
      scrollState.current.touchVelocity = 0;
      const currentScroll = springSystem.current.getCurrent("scrollY");
      scrollState.current.targetScrollY = currentScroll;
      springSystem.current.setValue("scrollY", currentScroll);
    },
    onTouchMove: (e: React.TouchEvent | React.MouseEvent) => {
      if (!scrollState.current.isDragging) return;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const dy = scrollState.current.touchLastY - clientY;
      const system = springSystem.current;
      const proposed = system.getCurrent("scrollY") + dy;
      const bounded = clampScrollValue(proposed, true);
      system.setValue("scrollY", bounded);
      scrollState.current.touchLastY = clientY;
      scrollState.current.touchVelocity = dy * 60;
      scrollState.current.lastInteractionTime = performance.now();
      scrollState.current.targetScrollY = bounded;
    },
    onTouchEnd: () => {
      scrollState.current.isDragging = false;
      scrollState.current.lastInteractionTime = performance.now();
      scrollState.current.targetScrollY =
        springSystem.current.getCurrent("scrollY");
    },
    onWheel: (e: React.WheelEvent) => {
      e.preventDefault();
      const system = springSystem.current;
      const now = performance.now();
      const delta = e.deltaY * WHEEL_SCROLL_GAIN;
      const nextTarget = scrollState.current.targetScrollY + delta;
      const manualTarget = clampScrollValue(nextTarget, true);
      scrollState.current.targetScrollY = manualTarget;
      system.setTarget("scrollY", manualTarget, USER_SCROLL_SPRING);
      scrollState.current.lastInteractionTime = now;
      scrollState.current.isDragging = false;
      const velocityBoost = clamp(
        delta * WHEEL_VELOCITY_GAIN,
        -MAX_SCROLL_VELOCITY,
        MAX_SCROLL_VELOCITY,
      );
      const nextVelocity = clamp(
        scrollState.current.touchVelocity + velocityBoost,
        -MAX_SCROLL_VELOCITY,
        MAX_SCROLL_VELOCITY,
      );
      scrollState.current.touchVelocity = nextVelocity;
    },
    onClick: () => {
      markScrollIdle();
    },
  };

  return {
    handlers,
    linesState,
    updatePhysics,
  };
};
