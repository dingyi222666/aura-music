import { expect, test } from "bun:test";
import { Envelope, type AudioEnvelope } from "@aura-music/core/audioEnvelope";
import { Motion } from "@aura-music/background/renderer/motion";
import { publishAudioLevel, subscribeAudioLevel, subscribeAudioDemand } from "@aura-music/core/audioLevelBridge";

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
  expect(motion.time).toBeCloseTo(2, 6);
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

test("ordinary bass pulses respond promptly, decay smoothly and do not accelerate flow", () => {
  const motion = new Motion();
  const input = tone(80, 48000, 0.15).at(-1)!;
  for (let i = 0; i < 6; i++) motion.step(1 / 60, true, input);
  expect(motion.pulse).toBeGreaterThan(0.25);
  expect(motion.climax).toBe(0);
  expect(motion.time).toBeCloseTo(0.04, 6);
  const peak = motion.pulse;
  motion.step(1 / 60, true, { level: 0, bass: 0, onset: 0 });
  expect(motion.pulse).toBeLessThan(peak);
  expect(motion.pulse).toBeGreaterThan(peak * 0.9);
  for (let i = 0; i < 120; i++) motion.step(1 / 60, true, { level: 0, bass: 0, onset: 0 });
  expect(motion.pulse).toBeLessThan(0.005);
});

test("envelope demand stops after the last consumer and restarts without a stale beat", () => {
  const states: boolean[] = [];
  const cleanup = subscribeAudioDemand((enabled) => states.push(enabled));
  const first = subscribeAudioLevel(() => {});
  const second = subscribeAudioLevel(() => {});
  publishAudioLevel(1, 1, 1);
  first();
  first();
  expect(states).toEqual([false, true]);
  second();
  expect(states).toEqual([false, true, false]);
  const values: AudioEnvelope[] = [];
  const stop = subscribeAudioLevel((value) => values.push(value));
  expect(values[0]).toEqual({ level: 0, bass: 0, onset: 0 });
  stop();
  cleanup();
});

const detect = (rate: number, sample: (time: number) => number, stereo = false) => {
  const envelope = new Envelope(rate);
  const data = new Float32Array(128);
  const silence = new Float32Array(128);
  const samples: (AudioEnvelope & { time: number })[] = [];
  for (let i = 0; i < rate * 3; i += 128) {
    for (let j = 0; j < 128; j++) data[j] = sample((i + j) / rate);
    const value = stereo ? envelope.push(silence, data) : envelope.push(data);
    if (value) samples.push({ ...value, time: (i + 128) / rate });
  }
  return samples;
};

test("quiet and loud kicks trigger promptly without double hits at either sample rate", () => {
  for (const rate of [44100, 48000]) for (const amplitude of [0.03, 0.2]) {
    const hits = detect(rate, (time) => {
      const phase = time % 0.5;
      return phase < 0.16 ? amplitude * Math.exp(-phase * 20) * Math.sin(time * 2 * Math.PI * 80) : 0;
    }).filter((value) => value.onset > 0);
    expect(hits).toHaveLength(6);
    for (let i = 0; i < hits.length; i++) {
      expect(hits[i].time - i * 0.5).toBeLessThan(0.05);
      expect(hits[i].onset).toBeGreaterThan(0.3);
    }
  }
});

test("bass detection rejects rumble, treble and settled DC", () => {
  for (const rate of [44100, 48000]) {
    for (const hz of [5, 3000]) {
      const samples = detect(rate, (time) => 0.2 * Math.sin(time * 2 * Math.PI * hz));
      expect(Math.max(...samples.map((value) => value.bass))).toBeLessThan(0.045);
      expect(samples.filter((value) => value.onset > 0)).toHaveLength(0);
    }
    const dc = detect(rate, () => 0.2).filter((value) => value.time > 0.3);
    expect(dc.every((value) => value.bass === 0 && value.onset === 0)).toBe(true);
  }
});

test("right-channel bass is detected and opposite-phase stereo cannot cancel it", () => {
  const right = detect(48000, (time) => 0.2 * Math.sin(time * 2 * Math.PI * 80), true);
  expect(right[0].onset).toBeGreaterThan(0.8);
  expect(right.at(-1)!.bass).toBeGreaterThan(0.4);
  const mono = new Envelope(48000);
  const stereo = new Envelope(48000);
  const left = new Float32Array(128);
  const other = new Float32Array(128);
  for (let i = 0; i < 48000; i += 128) {
    for (let j = 0; j < 128; j++) {
      left[j] = 0.2 * Math.sin((i + j) * 2 * Math.PI * 80 / 48000);
      other[j] = -left[j];
    }
    expect(stereo.push(left, other)).toEqual(mono.push(left));
  }
});

test("corner selection holds through bass and release, and renews after settling", () => {
  const motion = new Motion();
  const silence = { level: 0, bass: 0, onset: 0 };
  for (let i = 0; i < 600; i++) {
    motion.step(1 / 60, true, { level: 0.8, bass: 0.6, onset: i % 30 === 0 ? 1 : 0 });
    expect(motion.episode).toBe(1);
  }
  for (let i = 0; i < 120; i++) {
    motion.step(1 / 60, true, silence);
    expect(motion.episode).toBe(1);
  }
  motion.step(1 / 60, true, { level: 0.8, bass: 0.6, onset: 1 });
  expect(motion.episode).toBe(2);
  motion.step(10, false, silence);
  expect(motion.episode).toBe(2);
});

test("quiet bass onsets remain detectable under louder treble", () => {
  for (const rate of [44100, 48000]) {
    const samples = detect(rate, (time) => {
      const phase = time % 0.5;
      return 0.2 * Math.sin(time * 2 * Math.PI * 3000) +
        (phase < 0.16 ? 0.03 * Math.exp(-phase * 20) * Math.sin(time * 2 * Math.PI * 80) : 0);
    });
    expect(samples.filter((value) => value.onset > 0)).toHaveLength(6);
  }
});
