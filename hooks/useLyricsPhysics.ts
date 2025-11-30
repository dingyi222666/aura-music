import { useRef, useEffect, useState, useCallback } from "react";
import { LyricLine } from "../types";
import { SpringSystem, SpringConfig, CAMERA_SPRING } from "../services/springSystem";

const getNow = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

interface UseLyricsPhysicsProps {
    lyrics: LyricLine[];
    audioRef: React.RefObject<HTMLAudioElement>;
    currentTime: number;
    isMobile: boolean;
    containerHeight: number; // Passed from canvas
    linePositions: number[]; // Absolute Y positions of lines (packed, no margins)
    lineHeights: number[];   // Heights of lines for centering logic
    marginY: number;         // Base margin between lines
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

const getLinePosSpring = (relativeIndex: number): SpringConfig => {
    // 1. Past Lines & Active Line: Extremely fast snap (High stiffness)
    if (relativeIndex <= 0) {
        return { mass: 1, stiffness: 1200, damping: 60, precision: 0.1 };
    }

    // 2. Future Lines: "Fast to slow, variation needs to be larger"
    const dist = relativeIndex;

    // If lines are very far down, give them a constant loose speed to prevent floatiness
    if (dist > 8) {
        return { mass: 1, stiffness: 40, damping: 20, precision: 0.1 };
    }

    // Exponential Decay for Large Variation
    // Reduced base stiffness and increased damping to prevent flickering
    const base = 300;
    const stiffness = Math.max(25, base * Math.pow(0.5, dist));
    const damping = Math.sqrt(stiffness) * 1.15; // Over-damped to prevent oscillation

    return {
        mass: 1,
        stiffness: stiffness,
        damping: damping,
        precision: 0.1,
    };
};

const SCALE_SPRING: SpringConfig = {
    mass: 1,
    stiffness: 120,
    damping: 25,
    precision: 0.001,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const RUBBER_BAND_CONSTANT = 0.25;

const rubberBand = (overdrag: number, dimension: number) => {
    const abs = Math.abs(overdrag);
    const cappedDimension = Math.max(dimension, 1);
    const result = (1 - 1 / ((abs * RUBBER_BAND_CONSTANT) / cappedDimension + 1)) * cappedDimension;
    return result * Math.sign(overdrag);
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
    const [activeIndex, setActiveIndex] = useState(-1);

    // Physics State
    const linesState = useRef<Map<number, LinePhysicsState>>(new Map());

    // Main Scroll Spring (The "Camera")
    const springSystem = useRef(new SpringSystem({ scrollY: 0 }));
    const scrollLimitsRef = useRef({ min: 0, max: 0 });

    // Track activeIndex changes to detect seek jumps
    const prevActiveIndexRef = useRef(-1);

    const RESUME_DELAY_MS = 3000;
    const FOCAL_POINT_RATIO = 0.35; // 35% from top (matched to LyricsView)

    // Scroll Interaction State
    const scrollState = useRef({
        isDragging: false,
        lastInteractionTime: getNow() - RESUME_DELAY_MS - 10,
        touchStartY: 0,
        touchLastY: 0,
        touchVelocity: 0,
        targetScrollY: 0,
    });

    const clampScrollValue = useCallback((value: number, allowRubber = false) => {
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
    }, [containerHeight]);

    const markScrollIdle = useCallback(() => {
        scrollState.current.lastInteractionTime = getNow() - RESUME_DELAY_MS - 10;
        scrollState.current.isDragging = false;
        scrollState.current.touchVelocity = 0;
    }, []);

    // Initialize line states
    useEffect(() => {
        const newState = new Map<number, LinePhysicsState>();
        lyrics.forEach((_, i) => {
            const initialPos = linePositions[i] || 0;
            newState.set(i, {
                posY: { current: initialPos, velocity: 0, target: initialPos },
                scale: { current: 1, velocity: 0, target: 1 },
            });
        });
        linesState.current = newState;
    }, [lyrics, linePositions]);

    useEffect(() => {
        markScrollIdle();
        springSystem.current.setValue("scrollY", 0);
    }, [lyrics, linePositions, markScrollIdle]);

    // Calculate Active Index
    useEffect(() => {
        if (!lyrics.length) {
            if (activeIndex !== -1) {
                setActiveIndex(-1);
            }
            return;
        }

        let nextIndex = -1;
        for (let i = 0; i < lyrics.length; i++) {
            const line = lyrics[i];
            if (line.isMetadata) continue;

            if (currentTime >= line.time) {
                nextIndex = i;
            } else {
                break;
            }
        }

        if (nextIndex !== activeIndex) {
            setActiveIndex(nextIndex);
        }
    }, [currentTime, lyrics, activeIndex]);

    // Helper: Update a single spring value
    const updateSpring = (state: SpringState, config: SpringConfig, dt: number) => {
        const displacement = state.current - state.target;
        const springForce = -config.stiffness * displacement;
        const dampingForce = -config.damping * state.velocity;
        const acceleration = (springForce + dampingForce) / config.mass;

        state.velocity += acceleration * dt;
        state.current += state.velocity * dt;

        if (Math.abs(state.velocity) < (config.precision || 0.01) && Math.abs(displacement) < (config.precision || 0.01)) {
            state.current = state.target;
            state.velocity = 0;
        }
    };

    // Main Physics Loop - Exposed as update function
    const updatePhysics = useCallback((dt: number, currentLineHeights?: number[]) => {
        const now = performance.now();
        const sState = scrollState.current;
        const system = springSystem.current;

        // Use dynamic heights if provided, otherwise fallback to static
        const activeHeights = (currentLineHeights && currentLineHeights.length > 0) ? currentLineHeights : lineHeights;

        // Detect activeIndex jumps (seek operations)
        const prevActiveIndex = prevActiveIndexRef.current;
        let activeIndexJump = 0;
        if (prevActiveIndex !== -1 && activeIndex !== -1) {
            activeIndexJump = Math.abs(activeIndex - prevActiveIndex);
        } else if (prevActiveIndex !== -1 && activeIndex === -1) {
            // Seeking to a position before any lyrics - treat as large jump
            activeIndexJump = prevActiveIndex + 1;
        }
        prevActiveIndexRef.current = activeIndex;

        // Determine if we need to snap due to a large seek jump
        const shouldSnap = activeIndexJump > 5;

        // 1. Handle Global Scroll Physics
        const timeSinceInteraction = now - sState.lastInteractionTime;
        const userScrollActive = (sState.isDragging || timeSinceInteraction < RESUME_DELAY_MS);
        const { min: minScroll, max: maxScroll } = scrollLimitsRef.current;

        // Calculate target scroll based on active index
        const computeActiveScrollTarget = () => {
            if (activeIndex === -1) return 0;

            // Use absolute position from layout
            // We need to recalculate position based on dynamic heights if they changed
            let lineY = 0;
            for (let i = 0; i < activeIndex; i++) {
                lineY += activeHeights[i];
            }

            const lineHeight = activeHeights[activeIndex] || 0;

            // Add margin offset
            const marginOffset = activeIndex * marginY;

            // Center the line at the focal point
            const focalPoint = containerHeight * FOCAL_POINT_RATIO;
            const elementCenterOffset = lineHeight / 2;

            return lineY + marginOffset + elementCenterOffset;
        };

        let targetGlobalScrollY = system.getCurrent("scrollY");

        if (userScrollActive) {
            if (!sState.isDragging && Math.abs(sState.touchVelocity) > 10) {
                // Inertia scrolling with hard bounds
                const proposedY = system.getCurrent("scrollY") + sState.touchVelocity * dt;
                const boundedY = clampScrollValue(proposedY, false);
                system.setValue("scrollY", boundedY);
                if (boundedY !== proposedY) {
                    sState.touchVelocity = 0;
                } else {
                    sState.touchVelocity *= 0.92;
                }
            }
            targetGlobalScrollY = system.getCurrent("scrollY");
            const needsRebound = !sState.isDragging && (targetGlobalScrollY < minScroll || targetGlobalScrollY > maxScroll);
            if (needsRebound) {
                targetGlobalScrollY = clampScrollValue(targetGlobalScrollY, false);
            }
            // If user is interacting, we update the target to current to stop spring fighting
            system.setTarget("scrollY", targetGlobalScrollY, CAMERA_SPRING);
        } else {
            targetGlobalScrollY = clampScrollValue(computeActiveScrollTarget(), false);
            // Smoothly interpolate to target using spring
            system.setTarget("scrollY", targetGlobalScrollY, CAMERA_SPRING);
        }

        // Update the system to apply the spring forces to scrollY
        system.update(dt);

        // Use the current interpolated value as the actual scroll position
        const currentGlobalScrollY = system.getCurrent("scrollY");
        const isUserInteracting = userScrollActive;


        // 2. Update All Lines
        const scrollVelocity = system.getVelocity("scrollY");

        // Elastic margin effect
        const elasticFactor = Math.min(Math.max(scrollVelocity * 0.002, -0.5), 0.5);
        const effectiveMargin = marginY * (1 + Math.abs(elasticFactor));

        // Recalculate all positions based on current heights
        let currentY = 0;
        const currentPositions: number[] = [];
        let contentBottom = 0;
        activeHeights.forEach((h, idx) => {
            currentPositions.push(currentY);
            currentY += h;
            const marginOffset = idx * marginY;
            const bottom = currentY + marginOffset;
            if (bottom > contentBottom) {
                contentBottom = bottom;
            }
        });

        const maxScrollY = Math.max(0, contentBottom - containerHeight * (1 - FOCAL_POINT_RATIO));
        scrollLimitsRef.current = { min: 0, max: Number.isFinite(maxScrollY) ? maxScrollY : 0 };

        linesState.current.forEach((state, index) => {
            // --- A. Position Physics ---
            const relativeIndex = index - (activeIndex === -1 ? 0 : activeIndex);

            // Apply elasticity relative to the center of the screen or active item
            const elasticMarginOffset = relativeIndex * (marginY * elasticFactor);

            // Use recalculated position
            const targetPos = currentPositions[index];

            // Guard against undefined targetPos (e.g. during initialization)
            if (typeof targetPos === 'number') {
                state.posY.target = -currentGlobalScrollY + targetPos + (index * marginY) + elasticMarginOffset;
            }

            const displacement = state.posY.current - state.posY.target;

            // When a seek jump is detected, snap line positions to follow scrollY directly
            // This prevents lines from animating independently and causing visual chaos
            // Also snap if displacement is very large
            if (shouldSnap || Math.abs(displacement) > containerHeight * 0.5) {
                state.posY.current = state.posY.target;
                state.posY.velocity = 0;
            } else {
                let posConfig: SpringConfig;
                const isMovingDown = state.posY.target > state.posY.current + 1;

                if (isUserInteracting) {
                    posConfig = { mass: 0.5, stiffness: 400, damping: 35, precision: 0.1 };
                } else if (isMovingDown) {
                    posConfig = { mass: 1, stiffness: 350, damping: 40, precision: 0.1 };
                } else {
                    const relativeIndex = index - activeIndex;
                    posConfig = getLinePosSpring(relativeIndex);
                }

                updateSpring(state.posY, posConfig, dt);
            }

            // --- B. Scale Physics ---
            const lineY = currentPositions[index] || 0;
            const lineHeight = activeHeights[index] || 0;
            const lineCenter = lineY + lineHeight / 2;

            const currentScrollY = -state.posY.current;
            const visualLineCenter = lineCenter - currentScrollY;
            const visualActivePoint = containerHeight * FOCAL_POINT_RATIO;

            let targetScale = 1;
            if (index === activeIndex) {
                targetScale = 1.03;
            }

            state.scale.target = targetScale;
            if (shouldSnap) {
                state.scale.current = targetScale;
                state.scale.velocity = 0;
            } else {
                updateSpring(state.scale, SCALE_SPRING, dt);
            }
        });
    }, [activeIndex, containerHeight, linePositions, lineHeights]);

    // Interaction Handlers
    const handlers = {
        onTouchStart: (e: React.TouchEvent | React.MouseEvent) => {
            scrollState.current.isDragging = true;
            scrollState.current.lastInteractionTime = performance.now();
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            scrollState.current.touchStartY = clientY;
            scrollState.current.touchLastY = clientY;
            scrollState.current.touchVelocity = 0;
            springSystem.current.setValue("scrollY", springSystem.current.getCurrent("scrollY"));
        },
        onTouchMove: (e: React.TouchEvent | React.MouseEvent) => {
            if (!scrollState.current.isDragging) return;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const dy = scrollState.current.touchLastY - clientY;
            const system = springSystem.current;
            const proposed = system.getCurrent("scrollY") + dy;
            const bounded = clampScrollValue(proposed, true);
            system.setValue("scrollY", bounded);
            scrollState.current.touchLastY = clientY;
            scrollState.current.touchVelocity = dy * 60;
            scrollState.current.lastInteractionTime = performance.now();
        },
        onTouchEnd: () => {
            scrollState.current.isDragging = false;
            scrollState.current.lastInteractionTime = performance.now();
        },
        onWheel: (e: React.WheelEvent) => {
            scrollState.current.lastInteractionTime = performance.now();
            const system = springSystem.current;
            const proposed = system.getCurrent("scrollY") + e.deltaY;
            const bounded = clampScrollValue(proposed, true);
            system.setValue("scrollY", bounded);
        },
        onClick: () => {
            markScrollIdle();
        }
    };

    return {
        activeIndex,
        handlers,
        linesState,
        updatePhysics
    };
};
