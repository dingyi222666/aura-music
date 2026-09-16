import { expect, test } from "bun:test";
import { LyricsTimeline } from "../services/lyrics/timeline";

test("timing retains the current lyric across gaps and backwards seeks", () => {
  const timeline = new LyricsTimeline([
    { time: 0, endTime: 2, text: "First" },
    { time: 10, endTime: 12, text: "Second" },
    { time: 20, endTime: 22, text: "Third" },
  ]);
  expect(timeline.active(8).activeIndexes).toEqual([0]);
  expect(timeline.active(15).activeIndexes).toEqual([1]);
  expect(timeline.anchor(21)).toBe(2);
  expect(timeline.active(1).activeIndexes).toEqual([0]);
  expect(timeline.anchor(1)).toBe(0);
  expect(timeline.active(-1).anchorIndex).toBe(-1);
});

test("background harmonies keep their host active through their trailing window", () => {
  const timeline = new LyricsTimeline([
    { key: "a", time: 0, endTime: 4, text: "Lead" },
    { key: "a", time: 3, endTime: 5, text: "Harmony", isBackground: true },
    { time: 5, endTime: 8, text: "Next" },
  ]);
  expect(timeline.anchors).toEqual([0, 0, 2]);
  expect(timeline.active(2.2).activeIndexes).toEqual([0, 1]);
  expect(timeline.active(5.2).activeIndexes).toEqual([0, 1, 2]);
  expect(timeline.anchor(5.2)).toBe(0);
  expect(timeline.active(5.5).activeIndexes).toEqual([2]);
  expect(timeline.anchor(5.5)).toBe(2);
});

test("interludes expire at their own end and metadata never becomes active", () => {
  const timeline = new LyricsTimeline([
    { time: 0, text: "Credits", isMetadata: true },
    { time: 0, endTime: 3, text: "...", isInterlude: true },
    { time: 8, endTime: 10, text: "First" },
  ]);
  expect(timeline.active(1).activeIndexes).toEqual([1]);
  expect(timeline.active(5).activeIndexes).toEqual([]);
  expect(timeline.active(8).activeIndexes).toEqual([2]);
});

test("render and physics share one timing result for the same frame", () => {
  const timeline = new LyricsTimeline([{ time: 0, text: "Line" }]);
  const state = timeline.active(1);
  const anchors = timeline.anchors;
  const groups = timeline.groups;
  expect(timeline.active(1)).toBe(state);
  timeline.active(30);
  expect(timeline.active(1)).toEqual(state);
  expect(timeline.anchors).toBe(anchors);
  expect(timeline.groups).toBe(groups);
});

test("duets and their background vocals share scroll ranks without consuming extra delays", () => {
  const timeline = new LyricsTimeline([
    { time: 0, endTime: 4, text: "Left", key: "a" },
    { time: 0.2, endTime: 4.2, text: "Right", isDuet: true },
    { time: 2, endTime: 6, text: "Background", isBackground: true, key: "a" },
    { time: 5, endTime: 8, text: "Next" },
    { time: 9, endTime: 12, text: "Final" },
  ]);
  expect(timeline.order).toEqual([0, 2, 1, 3, 4]);
  expect(timeline.ranks).toEqual([0, 0, 0, 1, 2]);
  expect(timeline.anchor(6.3)).toBe(0);
  expect(timeline.anchor(6.5)).toBe(3);
  expect(timeline.active(2.5).activeIndexes).toEqual([0, 1, 2]);
});

test("indexed lookup includes long overlaps behind expired intervals and supports nonsequential seeks", () => {
  const timeline = new LyricsTimeline([
    { time: 0, endTime: 100, text: "Sustained" },
    ...Array.from({ length: 30 }, (_, i) => ({ time: i * 3 + 1, endTime: i * 3 + 2, text: `Short ${i}` })),
  ]);
  for (const time of [50, 2, 89, 40, 0, 100, 17]) {
    const expected = time >= 100 ? [] : [0];
    const index = Math.floor((time - 1) / 3) + 1;
    if (index >= 1 && index <= 30 && time < (index === 30 ? 89 : index * 3 + 1)) expected.push(index);
    expect(timeline.active(time).activeIndexes).toEqual(expected);
  }
});
