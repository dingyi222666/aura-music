import { expect, test } from "bun:test";
import { LyricsMotion } from "../components/lyrics/LyricsMotion";
import { LineAnimation } from "../components/lyrics/LineAnimation";
import { LyricsTimeline } from "../services/lyrics/timeline";

const fixture = () => {
  const timeline = new LyricsTimeline(Array.from({ length: 80 }, (_, i) => ({ time: i * 4, endTime: i * 4 + 3, text: `Line ${i}` })));
  const motion = new LyricsMotion(timeline);
  const heights = new Array(80).fill(100);
  const focuses = new Array(80).fill(35);
  const tick = (time: number, now: number, dt = 1 / 60) => motion.update(dt, time, heights, focuses, 800, now);
  tick(40, 0);
  return { motion, heights, focuses, tick };
};

test("hide/resume and translation reflow retain row identities and follow the live playhead", () => {
  const { motion, heights, tick } = fixture();
  const rows = [...motion.rows];
  motion.resume();
  tick(220, 5000);
  expect(motion.anchor).toBe(55);
  expect(motion.rows[55].posY.current).toBe(-35);
  heights.fill(70);
  tick(220, 5016);
  expect(motion.rows.every((row, i) => row === rows[i])).toBe(true);
  for (let i = 1; i <= 120; i++) tick(220, 5016 + i * 16.667);
  expect(motion.rows[55].posY.current).toBeCloseTo(-35, 1);
  expect(motion.rows[56].posY.current - motion.rows[55].posY.current).toBeCloseTo(70, 1);
});

test("hover exit does not interrupt following and a stationary release has no stale momentum", () => {
  const { motion, tick } = fixture();
  motion.end(100);
  expect(motion.mode).toBe("auto");
  motion.begin(300, 200);
  motion.move(240, 216);
  tick(40, 216);
  motion.end(500);
  expect(motion.mode).toBe("manual");
  tick(40, 2400);
  expect(motion.mode).toBe("auto");
});

test("drag momentum, cancellation, edge rebound and wheel return to following", () => {
  const { motion, tick } = fixture();
  motion.begin(300, 10);
  motion.move(200, 30);
  motion.end(35);
  expect(motion.mode).toBe("momentum");
  for (let i = 1; i <= 360; i++) tick(40, 35 + i * 16.667);
  expect(motion.mode).toBe("auto");
  motion.begin(200, 6100);
  motion.move(250, 6116);
  motion.end(6120, true);
  expect(motion.mode).toBe("manual");
  motion.wheel(80, 1, 6200);
  tick(40, 6216);
  expect(motion.mode).toBe("wheel");
  for (let i = 1; i <= 300; i++) tick(40, 6216 + i * 16.667);
  expect(motion.mode).toBe("auto");
  motion.resume();
  tick(0, 12000);
  motion.begin(100, 12001);
  motion.move(1000, 12017);
  motion.end(12018);
  expect(motion.mode).toBe("rebound");
  for (let i = 1; i <= 360; i++) tick(0, 12018 + i * 16.667);
  expect(motion.mode).toBe("auto");
  expect(motion.rows[0].posY.current).toBeCloseTo(-35, 1);
});

test("normal progression anticipates the boundary and trails rows as one spring", () => {
  const { motion, tick } = fixture();
  motion.resume();
  tick(43, 0);
  for (let i = 1; i <= 50; i++) tick(43 + i / 60, i * 1000 / 60);
  const before = motion.rows[11].posY.current;
  tick(43.92, 920);
  expect(motion.anchor).toBe(11);
  expect(motion.rows[11].posY.current).toBeLessThan(before);
  expect(motion.rows[11].posY.current).toBeGreaterThan(-35);
  expect(motion.rows[12].delay).toBeGreaterThan(0);
  for (let i = 1; i <= 120; i++) tick(43.92 + i / 60, 920 + i * 1000 / 60);
  expect(motion.rows[11].posY.current).toBeCloseTo(-35, 1);
});

test("seek enters near its destination and settles without recreating or flinging rows", () => {
  const { motion, tick } = fixture();
  const row = motion.rows[70];
  tick(280, 16);
  expect(motion.anchor).toBe(70);
  expect(row.posY.current).toBeGreaterThan(-35);
  expect(row.posY.current).toBeLessThan(520);
  for (let i = 1; i <= 240; i++) tick(280, 16 + i * 16.667);
  expect(row.posY.current).toBeCloseTo(-35, 1);
  tick(4, 4100);
  for (let i = 1; i <= 240; i++) tick(4, 4100 + i * 16.667);
  expect(motion.anchor).toBe(1);
  expect(motion.rows[1].posY.current).toBeCloseTo(-35, 1);
  expect(motion.rows[70]).toBe(row);
});

test("line press can reverse without a positional discontinuity and settles after release", () => {
  const animation = new LineAnimation();
  const pressed = animation.update(0.06, true, true, 0, 1, 0).press;
  expect(pressed).toBeLessThan(1);
  expect(animation.update(0, false, false, 4, 0.2, 60).press).toBe(pressed);
  for (let i = 0; i < 360; i++) animation.update(1 / 120, false, false, 4, 0.2, 60 + i * 1000 / 120);
  const settled = animation.update(0, false, false, 4, 0.2, 4000);
  expect(settled.press).toBe(1);
  expect(settled.blur).toBe(4);
  expect(settled.opacity).toBe(0.2);
});

test("secondary text and interlude reveal continue at a paused playhead and reverse without jumping", async () => {
  const { LyricReveal } = await import("../components/lyrics/LyricReveal");
  const reveal = new LyricReveal();
  for (let i = 0; i < 20; i++) reveal.update(true, 1 / 60);
  const height = reveal.height;
  const opacity = reveal.opacity;
  reveal.update(false, 0);
  expect(reveal.height).toBe(height);
  expect(reveal.opacity).toBe(opacity);
  reveal.update(false, 0.1);
  expect(reveal.opacity).toBeGreaterThan(0.4);
  expect(reveal.opacity).toBeLessThan(opacity);
  for (let i = 0; i < 300; i++) reveal.update(false, 1 / 60);
  expect(reveal.height).toBe(0);
  expect(reveal.opacity).toBe(0);
  for (let i = 0; i < 180; i++) reveal.update(true, 1 / 60);
  expect(reveal.height).toBe(1);
  expect(reveal.opacity).toBe(1);
});
