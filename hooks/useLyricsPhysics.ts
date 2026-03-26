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
  focusOffsets: number[]; // Anchor point within each rendered line
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

const FOCAL_RATIO = 0.25;
const CASCADE_STEP_MS = 50;
const CASCADE_DECAY = 1.05;
const CASCADE_CLEAR_MS = 400;

const getLinePosSpring = (relativeIndex: number): SpringConfig => {
  if (relativeIndex <= 0) {
    return { mass: 1.15, stiffness: 100, damping: 16, precision: 0.1 };
  }

  if (relativeIndex === 1) {
    return { mass: 1.18, stiffness: 95, damping: 16, precision: 0.1 };
  }

  return { mass: 1.2, stiffness: 90, damping: 15, precision: 0.1 };
};

const getDragPosSpring = (relativeIndex: number): SpringConfig => {
  if (relativeIndex <= 0) {
    return { mass: 1, stiffness: 260, damping: 24, precision: 0.15 };
  }

  if (relativeIndex === 1) {
    return { mass: 1.02, stiffness: 230, damping: 23, precision: 0.15 };
  }

  return { mass: 1.05, stiffness: 200, damping: 22, precision: 0.15 };
};

const getHoldPosSpring = (relativeIndex: number): SpringConfig => {
  if (relativeIndex <= 0) {
    return { mass: 1.08, stiffness: 160, damping: 21, precision: 0.1 };
  }

  if (relativeIndex === 1) {
    return { mass: 1.1, stiffness: 140, damping: 19, precision: 0.1 };
  }

  return { mass: 1.12, stiffness: 120, damping: 18, precision: 0.1 };
};

const SCALE_SPRING: SpringConfig = {
  mass: 2,
  stiffness: 100,
  damping: 25,
  precision: 0.001,
};

const SEEK_POS_SPRING: SpringConfig = {
  mass: 1.08,
  stiffness: 124,
  damping: 20,
  precision: 0.1,
};

const USER_SCROLL_SPRING: SpringConfig = {
  mass: 0.9,
  stiffness: 200,
  damping: 30,
  precision: 0.01,
};

const REBOUND_SPRING: SpringConfig = {
  mass: 0.9,
  stiffness: 280,
  damping: 24,
  precision: 0.01,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clampAbs = (value: number, max: number) => {
  if (max <= 0) return 0;
  return clamp(value, -max, max);
};

const seekSpeedOf = (view: number) => {
  return clamp(Math.max(1, view) * 1.6, 1100, 1600);
};

const RUBBER_BAND_CONSTANT = 1.2;
const MOMENTUM_FRICTION = 0.955;
const EDGE_FRICTION = 0.87;
const MIN_SCROLL_VELOCITY = 50;
const MAX_SCROLL_VELOCITY = 3600;
const WHEEL_SCROLL_GAIN = 0.95;
const SAMPLE_WINDOW_MS = 120;
const SAMPLE_LIMIT = 8;
const SEEK_GAP = 0.2;
const BG_LEAD = 0.9;
const BG_TRAIL = 0.45;
const MERGE_EPS = 1e-3;
const GROUP_TAIL = 0.75;

type ScrollMode = "auto" | "drag" | "momentum" | "wheel" | "manual" | "rebound";

interface ScrollSample {
  y: number;
  time: number;
}

interface CascadeState {
  anchor: number;
  started: number;
  expires: number;
  delays: Map<number, number>;
}

const blankCascade = (): CascadeState => ({
  anchor: -1,
  started: 0,
  expires: 0,
  delays: new Map(),
});

export const lineTargetOf = (
  nextTarget: number,
  waiting: boolean,
  prevTarget: number,
) => {
  if (waiting) {
    return prevTarget;
  }

  return nextTarget;
};

export const isJumping = (
  anchorJump: number,
  time: number,
  audioTime?: number,
  seeking = false,
) => {
  if (seeking) return true;
  if (anchorJump > 5) return true;
  if (!Number.isFinite(audioTime)) return false;
  return Math.abs(audioTime - time) > SEEK_GAP;
};

const cascadeOf = (
  lyrics: LyricLine[],
  anchors: number[],
  positions: number[],
  heights: number[],
  scrollY: number,
  view: number,
  anchor: number,
) => {
  const top = scrollY - view * FOCAL_RATIO;
  const bottom = top + view;
  const delays = new Map<number, number>();
  let delay = 0;
  let step = CASCADE_STEP_MS;

  positions
    .map((y, index) => ({ index, y }))
    .filter(({ index, y }) => {
      const h = heights[index] ?? 0;
      if (h <= 0.001) {
        return false;
      }

      return y + h >= top && y <= bottom;
    })
    .sort((a, b) => a.y - b.y)
    .forEach(({ index }) => {
      if (lyrics[index]?.isBackground && anchors[index] !== index) {
        delays.set(index, delays.get(anchors[index]) ?? delay);
        return;
      }

      delays.set(index, delay);
      delay += step;

      if (index >= anchor) {
        step /= CASCADE_DECAY;
      }
    });

  return delays;
};

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
  anchors: number[] = getAnchors(lyrics),
): ActiveState => {
  if (!lyrics.length) {
    return { activeIndexes: [], anchorIndex: -1 };
  }

  const activeSet = new Set<number>();
  const mains: number[] = [];
  let latest = -1;

  const add = (index: number) => {
    if (index < 0 || activeSet.has(index)) return;
    activeSet.add(index);
    if (isMain(lyrics[index])) {
      mains.push(index);
    }
  };

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (line.isMetadata) continue;

    if (!line.isBackground && currentTime >= line.time) {
      latest = i;
    }

    if (line.isBackground) {
      const span = windowOf(line);
      if (currentTime < span.start || currentTime >= span.end) {
        continue;
      }

      add(i);
      add(anchors[i] ?? -1);
      continue;
    }

    if (currentTime < line.time) continue;

    if (currentTime >= activeEndOf(lyrics, i)) continue;

    add(i);
  }

  const activeIndexes = Array.from(activeSet).sort((a, b) => a - b);

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

    if (line.key) {
      const match = lyrics.findIndex((item, idx) => {
        if (idx === index) return false;
        if (item.isMetadata || item.isBackground || item.isInterlude) {
          return false;
        }
        return item.key === line.key;
      });
      if (match >= 0) {
        return match;
      }
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

const groupedWith = (head: LyricLine, line: LyricLine) => {
  return getLineEnd(line) <= getLineEnd(head) + GROUP_TAIL;
};

export const getScrollGroups = (
  lyrics: LyricLine[],
  anchors: number[] = getAnchors(lyrics),
): ScrollGroup[] => {
  const items = lyrics.flatMap((line, index) =>
    line.isMetadata || line.isBackground ? [] : [index],
  );
  const groups: ScrollGroup[] = [];

  for (let i = 0; i < items.length; ) {
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
        if (lyrics[index].time >= limit - MERGE_EPS) {
          break;
        }
        if (!groupedWith(lyrics[start], lyrics[index])) {
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
  focusOffsets,
  marginY,
}: UseLyricsPhysicsProps) => {
  const anchors = useMemo(() => getAnchors(lyrics), [lyrics]);
  const groups = useMemo(
    () => getScrollGroups(lyrics, anchors),
    [anchors, lyrics],
  );

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
  const cascadeRef = useRef<CascadeState>(blankCascade());
  const anchorRef = useRef(-1);
  const modeRef = useRef<ScrollMode>("auto");

  // Track anchor changes to detect seek jumps
  const prevAnchorRef = useRef(-1);
  const RESUME_DELAY_MS = 1800;

  // Scroll Interaction State
  const scrollState = useRef({
    mode: "auto" as ScrollMode,
    isDragging: false,
    lastInteractionTime: getNow() - RESUME_DELAY_MS - 10,
    touchLastY: 0,
    touchLastTime: 0,
    touchVelocity: 0,
    targetScrollY: 0,
    samples: [] as ScrollSample[],
  });

  const trimSamples = useCallback((time: number) => {
    const list = scrollState.current.samples;
    while (list.length > 0 && time - list[0].time > SAMPLE_WINDOW_MS) {
      list.shift();
    }
    while (list.length > SAMPLE_LIMIT) {
      list.shift();
    }
  }, []);

  const pushSample = useCallback(
    (y: number, time: number) => {
      const list = scrollState.current.samples;
      list.push({ y, time });
      trimSamples(time);
    },
    [trimSamples],
  );

  const clearSamples = useCallback(() => {
    scrollState.current.samples = [];
  }, []);

  const getReleaseVelocity = useCallback(() => {
    const list = scrollState.current.samples;
    if (list.length < 2) {
      return clamp(
        scrollState.current.touchVelocity,
        -MAX_SCROLL_VELOCITY,
        MAX_SCROLL_VELOCITY,
      );
    }

    const last = list[list.length - 1];
    let sum = 0;
    let weight = 0;

    for (let i = list.length - 1; i > 0; i--) {
      const cur = list[i];
      const prev = list[i - 1];
      const dt = (cur.time - prev.time) / 1000;
      if (dt <= 0) continue;

      const vel = (prev.y - cur.y) / dt;
      const age = last.time - cur.time;
      const gain = Math.max(0.2, 1 - age / SAMPLE_WINDOW_MS);
      sum += vel * gain;
      weight += gain;
    }

    if (weight <= 0) {
      return clamp(
        scrollState.current.touchVelocity,
        -MAX_SCROLL_VELOCITY,
        MAX_SCROLL_VELOCITY,
      );
    }

    return clamp(sum / weight, -MAX_SCROLL_VELOCITY, MAX_SCROLL_VELOCITY);
  }, []);

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
    scrollState.current.mode = "auto";
    modeRef.current = "auto";
    scrollState.current.touchVelocity = 0;
    clearSamples();
    cascadeRef.current = blankCascade();
    const currentScroll = springSystem.current.getCurrent("scrollY");
    const clamped = clampScrollValue(currentScroll, false);
    scrollState.current.targetScrollY = clamped;
    springSystem.current.setValue("scrollY", clamped);
  }, [clampScrollValue, clearSamples]);

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
    scrollState.current.mode = "auto";
    scrollState.current.targetScrollY = 0;
    scrollState.current.touchVelocity = 0;
    clearSamples();
    cascadeRef.current = blankCascade();
    anchorRef.current = -1;
    prevAnchorRef.current = -1;
    markScrollIdle();
  }, [clearSamples, lyrics, lineHeights, markScrollIdle]);

  // Helper: Update a single spring value
  const updateSpring = (
    state: SpringState,
    config: SpringConfig,
    dt: number,
    maxVelocity = Number.POSITIVE_INFINITY,
  ) => {
    const displacement = state.current - state.target;
    const springForce = -config.stiffness * displacement;
    const dampingForce = -config.damping * state.velocity;
    const acceleration = (springForce + dampingForce) / config.mass;

    state.velocity = clampAbs(state.velocity + acceleration * dt, maxVelocity);
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
      const active = getActiveState(lyrics, time, anchors);
      const anchor = getScrollAnchor(lyrics, time, groups);
      const activeSet = new Set(active.activeIndexes);
      anchorRef.current = anchor;

      const activeHeights = (
        layoutHeights && layoutHeights.length > 0 ? layoutHeights : lineHeights
      ).slice();

      const layout = buildLayout(activeHeights);
      const currentPositions = layout.positions;
      const contentBottom = layout.bottom;
      const maxScrollY = Math.max(0, contentBottom - containerHeight * 0.1);

      scrollLimitsRef.current = {
        min: 0,
        max: Number.isFinite(maxScrollY) ? maxScrollY : 0,
      };

      const { min: minScroll, max: maxScroll } = scrollLimitsRef.current;

      const prevAnchorIndex = prevAnchorRef.current;
      let anchorJump = 0;
      if (prevAnchorIndex !== -1 && anchor !== -1) {
        anchorJump = Math.abs(anchor - prevAnchorIndex);
      } else if (prevAnchorIndex !== -1 && anchor === -1) {
        anchorJump = prevAnchorIndex + 1;
      }

      prevAnchorRef.current = anchor;
      const seek = Boolean(audioRef.current?.seeking);
      const audioTime = audioRef.current?.currentTime;
      const jumping = isJumping(anchorJump, time, audioTime, seek);
      const shouldSnap = !jumping && anchorJump > 12;

      const computeActiveScrollTarget = () => {
        if (anchor === -1) return 0;

        const lineY = currentPositions[anchor] || 0;
        const focus = focusOffsets[anchor] ?? (activeHeights[anchor] || 0) * 0.5;
        return lineY + focus;
      };

      const hold = now - sState.lastInteractionTime < RESUME_DELAY_MS;
      let spring = false;

      if (sState.isDragging) {
        sState.mode = "drag";
        const next = clampScrollValue(system.getCurrent("scrollY"), true);
        system.setValue("scrollY", next);
        sState.targetScrollY = next;
      } else if (sState.mode === "momentum") {
        const next = system.getCurrent("scrollY") + sState.touchVelocity * dt;
        const bounded = clampScrollValue(next, true);
        const edge = bounded < minScroll || bounded > maxScroll;
        system.setValue("scrollY", bounded);
        sState.targetScrollY = bounded;

        const decay = Math.pow(
          edge ? EDGE_FRICTION : MOMENTUM_FRICTION,
          (dt * 1000) / 16.6667,
        );
        sState.touchVelocity *= decay;

        if (edge) {
          const limit = clampScrollValue(bounded, false);
          const gap = Math.abs(bounded - limit);
          const drag = Math.max(0.4, 1 - gap / Math.max(1, containerHeight));
          sState.touchVelocity *= drag;
        }

        if (Math.abs(sState.touchVelocity) < MIN_SCROLL_VELOCITY) {
          sState.touchVelocity = 0;
          const limit = clampScrollValue(system.getCurrent("scrollY"), false);
          sState.targetScrollY = limit;

          if (Math.abs(limit - system.getCurrent("scrollY")) > 0.01) {
            sState.mode = "rebound";
            system.setTarget("scrollY", limit, REBOUND_SPRING);
            spring = true;
          } else {
            sState.mode = "manual";
          }
        }
      } else if (sState.mode === "rebound") {
        const limit = clampScrollValue(sState.targetScrollY, false);
        sState.targetScrollY = limit;
        system.setTarget("scrollY", limit, REBOUND_SPRING);
        spring = true;
      } else if (sState.mode === "wheel") {
        const limit = clampScrollValue(sState.targetScrollY, false);
        sState.targetScrollY = limit;
        system.setTarget("scrollY", limit, USER_SCROLL_SPRING);
        spring = true;
      } else if (sState.mode === "manual" && hold) {
        const limit = clampScrollValue(system.getCurrent("scrollY"), false);
        if (Math.abs(limit - system.getCurrent("scrollY")) > 0.01) {
          sState.mode = "rebound";
          sState.targetScrollY = limit;
          system.setTarget("scrollY", limit, REBOUND_SPRING);
          spring = true;
        }
      } else {
        const autoTarget = clampScrollValue(computeActiveScrollTarget(), false);
        sState.mode = "auto";
        sState.targetScrollY = autoTarget;
        system.setValue("scrollY", autoTarget);
      }

      modeRef.current = sState.mode;

      if (spring) {
        system.update(dt);
      }

      if (
        sState.mode === "rebound" &&
        system.isSettled("scrollY")
      ) {
        sState.mode = "manual";
        sState.targetScrollY = system.getCurrent("scrollY");
        sState.lastInteractionTime = now;
      }

      if (
        sState.mode === "wheel" &&
        system.isSettled("scrollY")
      ) {
        sState.mode = "manual";
        sState.targetScrollY = system.getCurrent("scrollY");
      }

      const currentGlobalScrollY = system.getCurrent("scrollY");
      const isDirectManipulation =
        sState.isDragging || sState.mode === "momentum";
      const isUserInteracting =
        isDirectManipulation ||
        sState.mode === "wheel" ||
        sState.mode === "rebound" ||
        (sState.mode === "manual" && hold);

      const shifted = prevAnchorIndex !== -1 && anchor !== prevAnchorIndex;
      if (shouldSnap || isUserInteracting || anchor < 0 || jumping) {
        if (cascadeRef.current.delays.size > 0) {
          cascadeRef.current = blankCascade();
        }
      } else if (shifted) {
        const delays = cascadeOf(
          lyrics,
          anchors,
          currentPositions,
          activeHeights,
          currentGlobalScrollY,
          containerHeight,
          anchor,
        );
        const tail = Array.from(delays.values()).reduce(
          (max, value) => Math.max(max, value),
          0,
        );
        cascadeRef.current = {
          anchor,
          started: now,
          expires: now + Math.max(CASCADE_CLEAR_MS, tail + 260),
          delays,
        };
      } else if (
        cascadeRef.current.expires > 0 &&
        now >= cascadeRef.current.expires
      ) {
        cascadeRef.current = blankCascade();
      }

      const elapsed = now - cascadeRef.current.started;

      linesState.current.forEach((state, index) => {
        const relativeIndex = index - (anchor === -1 ? 0 : anchor);
        const targetPos = currentPositions[index];
        const delay = cascadeRef.current.delays.get(index) ?? -1;
        const waiting = delay > elapsed;

        if (typeof targetPos === "number") {
          const nextTarget = -currentGlobalScrollY + targetPos;
          if (jumping) {
            state.posY.target = nextTarget;
          } else {
            state.posY.target = lineTargetOf(
              nextTarget,
              waiting,
              state.posY.target,
            );
          }
        }

        const displacement = state.posY.current - state.posY.target;

        if (
          shouldSnap ||
          (!jumping && Math.abs(displacement) > containerHeight * 0.75)
        ) {
          state.posY.current = state.posY.target;
          state.posY.velocity = 0;
        } else {
          const posConfig =
            jumping
              ? SEEK_POS_SPRING
              : isDirectManipulation
              ? getDragPosSpring(relativeIndex)
              : isUserInteracting
                ? getHoldPosSpring(relativeIndex)
                : getLinePosSpring(relativeIndex);
          updateSpring(
            state.posY,
            posConfig,
            dt,
            jumping ? seekSpeedOf(containerHeight) : Number.POSITIVE_INFINITY,
          );
        }

        const targetScale = activeSet.has(index)
          ? 1
          : lyrics[index]?.isBackground
            ? 0.85
            : 0.97;
        state.scale.target = targetScale;
        if (shouldSnap) {
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
      anchors,
      lineHeights,
      buildLayout,
      focusOffsets,
      audioRef,
      lyrics,
    ],
  );

  // Interaction Handlers
  const handlers = {
    onTouchStart: (e: React.TouchEvent | React.MouseEvent) => {
      const now = performance.now();
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      scrollState.current.isDragging = true;
      scrollState.current.mode = "drag";
      modeRef.current = "drag";
      scrollState.current.lastInteractionTime = now;
      scrollState.current.touchLastY = clientY;
      scrollState.current.touchLastTime = now;
      scrollState.current.touchVelocity = 0;
      clearSamples();
      pushSample(clientY, now);
      const currentScroll = springSystem.current.getCurrent("scrollY");
      scrollState.current.targetScrollY = currentScroll;
      springSystem.current.setValue("scrollY", currentScroll);
    },
    onTouchMove: (e: React.TouchEvent | React.MouseEvent) => {
      if (!scrollState.current.isDragging) return;
      const now = performance.now();
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const dy = scrollState.current.touchLastY - clientY;
      const dt = Math.max(
        0.001,
        (now - scrollState.current.touchLastTime) / 1000,
      );
      const system = springSystem.current;
      const proposed = system.getCurrent("scrollY") + dy;
      const bounded = clampScrollValue(proposed, true);
      system.setValue("scrollY", bounded);
      scrollState.current.touchLastY = clientY;
      scrollState.current.touchLastTime = now;
      const vel = clamp(dy / dt, -MAX_SCROLL_VELOCITY, MAX_SCROLL_VELOCITY);
      scrollState.current.touchVelocity =
        scrollState.current.touchVelocity * 0.35 + vel * 0.65;
      scrollState.current.lastInteractionTime = now;
      scrollState.current.targetScrollY = bounded;
      pushSample(clientY, now);
    },
    onTouchEnd: () => {
      const now = performance.now();
      const system = springSystem.current;
      const currentScroll = system.getCurrent("scrollY");
      const limit = clampScrollValue(currentScroll, false);
      const vel = getReleaseVelocity();

      scrollState.current.isDragging = false;
      scrollState.current.lastInteractionTime = now;
      scrollState.current.targetScrollY = currentScroll;

      if (Math.abs(currentScroll - limit) > 0.01) {
        scrollState.current.mode = "rebound";
        modeRef.current = "rebound";
        scrollState.current.touchVelocity = 0;
        scrollState.current.targetScrollY = limit;
        system.setTarget("scrollY", limit, REBOUND_SPRING);
      } else if (Math.abs(vel) >= MIN_SCROLL_VELOCITY) {
        scrollState.current.mode = "momentum";
        modeRef.current = "momentum";
        scrollState.current.touchVelocity = vel;
      } else {
        scrollState.current.mode = "manual";
        modeRef.current = "manual";
        scrollState.current.touchVelocity = 0;
      }

      clearSamples();
    },
    onWheel: (e: React.WheelEvent) => {
      e.preventDefault();
      const system = springSystem.current;
      const now = performance.now();
      const unit =
        e.deltaMode === 1
          ? 32
          : e.deltaMode === 2
            ? containerHeight || 1
            : 1;
      const delta = e.deltaY * unit * WHEEL_SCROLL_GAIN;
      const base =
        scrollState.current.mode === "wheel"
          ? scrollState.current.targetScrollY
          : system.getCurrent("scrollY");
      const manualTarget = clampScrollValue(base + delta, false);
      scrollState.current.mode = "wheel";
      modeRef.current = "wheel";
      scrollState.current.isDragging = false;
      scrollState.current.targetScrollY = manualTarget;
      scrollState.current.touchVelocity = 0;
      system.setTarget("scrollY", manualTarget, USER_SCROLL_SPRING);
      scrollState.current.lastInteractionTime = now;
    },
    onClick: () => {
      markScrollIdle();
    },
  };

  return {
    anchorRef,
    handlers,
    linesState,
    modeRef,
    updatePhysics,
  };
};
