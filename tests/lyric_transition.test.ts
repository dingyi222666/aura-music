import { expect, test } from "bun:test";
import { LyricTransition } from "../components/lyrics/LyricTransition";
import type { Layout } from "../components/lyrics/LyricsEngine";
import type { ILyricLine } from "../components/lyrics/ILyricLine";

const layout = (height: number, width = 600): Layout => ({
  width,
  mobile: false,
  lines: [{
    update: () => {},
    getCurrentHeight: () => height,
  } as unknown as ILyricLine],
  heights: [height],
  focuses: [height / 2],
});

test("translation opacity, line height and focus move together through intermediate values", () => {
  const transition = new LyricTransition();
  transition.select(layout(100));
  transition.update(0, 0);
  transition.select(layout(60));
  transition.update(0.16, 0);
  expect(transition.heights[0]).toBeCloseTo(80);
  expect(transition.focuses[0]).toBeCloseTo(40);
  expect(transition.layers.map((layer) => layer.weight)).toEqual([0.5, 0.5]);
  transition.update(0.16, 0);
  expect(transition.heights[0]).toBe(60);
  expect(transition.layers.length).toBe(1);
});

test("reversing a translation transition preserves the currently displayed geometry", () => {
  const transition = new LyricTransition();
  const translated = layout(100);
  const plain = layout(60);
  transition.select(translated);
  transition.select(plain);
  transition.update(0.1, 0);
  const height = transition.heights[0];
  const weights = transition.layers.map((layer) => layer.weight);
  transition.select(translated);
  transition.update(0, 0);
  expect(transition.heights[0]).toBe(height);
  expect(transition.layers.map((layer) => layer.weight)).toEqual(weights);
  transition.update(0.32, 0);
  expect(transition.heights[0]).toBe(100);
  expect(transition.layers.length).toBe(1);
});

test("viewport reflow replaces old-width layers without retaining stale geometry", () => {
  const transition = new LyricTransition();
  transition.select(layout(100));
  transition.select(layout(160, 300));
  transition.update(0, 0);
  expect(transition.layers.length).toBe(1);
  expect(transition.heights[0]).toBe(160);
});
