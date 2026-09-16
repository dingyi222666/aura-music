import { expect, test } from "bun:test";
import { advance, Spring, LINE_SPRING, PRESS_SPRING, RELEASE_SPRING } from "../services/springSystem";

test("spring trajectories agree across refresh rates and uneven frames in all damping regimes", () => {
  for (const damping of [7, 18, 20, 50]) {
    const config = { mass: 1, stiffness: 100, damping, precision: 0 };
    const expected = { current: -80, target: 100, velocity: 45 };
    advance(expected, config, 0.8);
    for (const fps of [30, 60, 120, 144]) {
      const state = { current: -80, target: 100, velocity: 45 };
      let time = 0;
      while (time < 0.8 - 1e-12) {
        const dt = Math.min(1 / fps, 0.8 - time);
        advance(state, config, dt);
        time += dt;
      }
      expect(state.current).toBeCloseTo(expected.current, 9);
      expect(state.velocity).toBeCloseTo(expected.velocity, 9);
    }
    const uneven = { current: -80, target: 100, velocity: 45 };
    for (const dt of [0.016, 0.2, 0.008, 0.076, 0.5]) advance(uneven, config, dt);
    expect(uneven.current).toBeCloseTo(expected.current, 9);
    expect(uneven.velocity).toBeCloseTo(expected.velocity, 9);
  }
});

test("retargeting preserves position and velocity, including direction changes", () => {
  const spring = new Spring(0);
  spring.set(100, LINE_SPRING);
  spring.step(0.15);
  const position = spring.current;
  const velocity = spring.velocity;
  spring.set(-20, LINE_SPRING);
  expect(spring.current).toBe(position);
  expect(spring.velocity).toBe(velocity);
  spring.step(4);
  expect(spring.current).toBe(-20);
  expect(spring.velocity).toBe(0);
});

test("line changes settle with only a small rebound", () => {
  const spring = new Spring(0);
  spring.set(100, LINE_SPRING);
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    spring.step(1 / 120);
    peak = Math.max(peak, spring.current);
  }
  expect(peak).toBeGreaterThanOrEqual(100);
  expect(peak).toBeLessThan(100.3);
  expect(spring.settled).toBe(true);
});

test("press and release remain finite across a long frame and settle naturally", () => {
  const spring = new Spring(1);
  spring.set(0.95, PRESS_SPRING);
  spring.step(0.08);
  expect(spring.current).toBeLessThan(1);
  const velocity = spring.velocity;
  spring.set(1, RELEASE_SPRING);
  expect(spring.velocity).toBe(velocity);
  spring.step(0.3);
  expect(spring.current).toBeGreaterThan(0.94);
  expect(spring.current).toBeLessThan(1.01);
  spring.step(10);
  expect(spring.current).toBe(1);
  expect(spring.settled).toBe(true);
});

test("lift uses elapsed media time so seeks and pauses do not accumulate frame error", async () => {
  const { liftAt, LIFT_SPRING } = await import("../services/springSystem");
  expect(liftAt(-1)).toBe(0);
  expect(liftAt(0)).toBe(0);
  expect(liftAt(0.1)).toBeGreaterThan(0);
  expect(liftAt(0.1)).toBeLessThan(liftAt(0.5));
  expect(liftAt(3)).toBeCloseTo(1, 3);
  const spring = new Spring(0, LIFT_SPRING);
  spring.set(1);
  for (let i = 0; i < 60; i++) spring.step(1 / 120);
  expect(liftAt(0.5)).toBeCloseTo(spring.current, 10);
});
