import { expect, test } from "bun:test";
import { Envelope, type AudioEnvelope } from "../services/audioEnvelope";
import { Motion } from "../components/background/renderer/motion";
import { publishAudioLevel, subscribeAudioLevel } from "../services/audioLevelBridge";

const tone = (hz: number, rate: number, duration = 1) => {
  const envelope = new Envelope(rate);
  const samples: AudioEnvelope[] = [];
  const block = new Float32Array(128);
  for (let i = 0; i < rate * duration; i += block.length) {
    for (let j = 0; j < block.length; j++) block[j] = 0.2 * Math.sin((i + j) * 2 * Math.PI * hz / rate);
    const value = envelope.push(block);
    if (value) samples.push({ ...value });
  }
  return samples;
};

test("PCM envelope separates low-frequency energy from equally loud treble at both sample rates", () => {
  for (const rate of [44100, 48000]) {
    const bass = tone(80, rate).at(-1)!;
    const treble = tone(3000, rate).at(-1)!;
    expect(bass.bass).toBeGreaterThan(treble.bass * 8);
    expect(bass.level).toBeCloseTo(treble.level, 1);
    expect(bass.bass).toBeGreaterThan(0.3);
  }
});

test("an onset decays under a sustained note and silence carries no fabricated beat", () => {
  const samples = tone(80, 48000, 2);
  expect(samples[0].onset).toBeGreaterThan(0.8);
  expect(samples.at(-1)!.onset).toBeLessThan(0.02);
  const envelope = new Envelope(48000);
  expect(envelope.push(new Float32Array(2048))).toEqual({ level: 0, bass: 0, onset: 0 });
});

test("beats affect exposure envelopes without changing the fluid path, and pause freezes both", () => {
  const motion = new Motion();
  const silent = new Motion();
  const input = { level: 1, bass: 1, onset: 1 };
  for (let i = 0; i < 300; i++) {
    const before = motion.angle;
    motion.step(1 / 60, true, i % 60 < 10 ? input : { level: 0, bass: 0, onset: 0 });
    silent.step(1 / 60, true, { level: 0, bass: 0, onset: 0 });
    expect(motion.angle).toBe(silent.angle);
    expect(Math.abs(motion.angle - before)).toBeLessThan(0.06 / 60);
  }
  const frozen = { ...motion };
  motion.step(10, false, input);
  expect({ ...motion }).toEqual(frozen);
  expect(motion.time).toBeCloseTo(4, 6);
  expect(motion.bass).toBeGreaterThan(silent.bass);
  expect(motion.onset).toBeGreaterThan(silent.onset);
  expect(motion.climax).toBeLessThan(0.3);
  for (let i = 0; i < 240; i++) motion.step(1 / 60, true, input);
  expect(motion.climax).toBeGreaterThan(0.9);
});

test("short beats do not open the climax gate", () => {
  const motion = new Motion();
  for (let i = 0; i < 8; i++) motion.step(1 / 60, true, { level: 0.95, bass: 0.8, onset: 1 });
  expect(motion.climax).toBeLessThan(0.1);
  for (let i = 0; i < 60; i++) motion.step(1 / 60, true, { level: 0.76, bass: 0.6, onset: 0 });
  expect(motion.climax).toBeGreaterThan(0.5);
  for (let i = 0; i < 120; i++) motion.step(1 / 60, true, { level: 0.3, bass: 0.2, onset: 0 });
  expect(motion.climax).toBeLessThan(0.2);
});

test("brightness envelopes remain consistent across refresh rates", () => {
  const result = [30, 60, 120].map((fps) => {
    const motion = new Motion();
    for (let i = 0; i < fps * 4; i++) {
      motion.step(1 / fps, true, i < fps * 2
        ? { level: 0.8, bass: 0.7, onset: 0.4 }
        : { level: 0, bass: 0, onset: 0 });
    }
    return motion;
  });
  for (const motion of result) {
    expect(motion.angle).toBeCloseTo(result[0].angle, 3);
    expect(motion.bass).toBeCloseTo(result[0].bass, 6);
    expect(motion.onset).toBeCloseTo(result[0].onset, 6);
  }
});

test("fluid orientation remains bounded through long playback", () => {
  const motion = new Motion();
  for (let t = 0; t < 3600; t += 0.5) {
    motion.time = t;
    expect(Math.abs(motion.angle - 0.32)).toBeLessThanOrEqual(0.43);
  }
});

test("audio bridge delivers all features and rejects nonfinite input", () => {
  const received: AudioEnvelope[] = [];
  const stop = subscribeAudioLevel((value) => received.push(value));
  publishAudioLevel(0.7, 0.6, 0.4);
  expect(received.at(-1)).toEqual({ level: 0.7, bass: 0.6, onset: 0.4 });
  publishAudioLevel(NaN, Infinity, -1);
  expect(received.at(-1)).toEqual({ level: 0, bass: 0, onset: 0 });
  stop();
  const count = received.length;
  publishAudioLevel(0);
  expect(received).toHaveLength(count);
});
