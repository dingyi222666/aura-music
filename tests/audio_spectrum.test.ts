import { expect, test } from "bun:test";
import { Spectrum } from "@aura-music/core/audioSpectrum";

const tone = (frequency: number, amplitude = 0.2, rate = 48000) =>
  Float32Array.from({ length: 4096 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));

const peak = (spectrum: Spectrum) => {
  const values = spectrum.update(1);
  return values.indexOf(Math.max(...values));
};

test("perceptual bands distinguish bass, voice and high percussion at both sample rates", () => {
  for (const rate of [44100, 48000]) {
    for (const frequency of [100, 1000, 6000]) {
      const spectrum = new Spectrum(rate);
      spectrum.push(tone(frequency, 0.2, rate));
      const index = peak(spectrum);
      expect(spectrum.frequencies[index]).toBeLessThan(frequency * 1.2);
      expect(spectrum.frequencies[index + 1]).toBeGreaterThan(frequency * 0.8);
      expect(spectrum.values[index]).toBeGreaterThan(0.5);
      expect(spectrum.values.filter((value) => value > 0.4).length).toBeLessThan(15);
    }
  }
});

test("quiet details remain visible without normalizing every sound to full height", () => {
  const quiet = new Spectrum(), loud = new Spectrum();
  quiet.push(tone(1000, 0.008));
  loud.push(tone(1000, 0.4));
  const a = Math.max(...quiet.update(1)), b = Math.max(...loud.update(1));
  expect(a).toBeGreaterThan(0.12);
  expect(b - a).toBeGreaterThan(0.35);
  expect(b).toBeLessThanOrEqual(1);
});

test("attack stays responsive, silence decays smoothly and stalled audio clears", () => {
  const spectrum = new Spectrum();
  spectrum.push(tone(120));
  const attack = Math.max(...spectrum.update(1 / 60));
  expect(attack).toBeGreaterThan(0.3);
  const release = Math.max(...spectrum.update(1 / 60, true));
  expect(release).toBeLessThan(attack);
  expect(release).toBeGreaterThan(attack * 0.75);
  for (let i = 0; i < 90; i++) spectrum.update(1 / 60, true);
  expect(Math.max(...spectrum.values)).toBeLessThan(0.001);
});

test("temporal smoothing follows elapsed time rather than display refresh rate", () => {
  const a = new Spectrum(), b = new Spectrum();
  a.push(tone(2000));
  b.push(tone(2000));
  for (let i = 0; i < 30; i++) a.update(1 / 30);
  for (let i = 0; i < 120; i++) b.update(1 / 120);
  for (let i = 0; i < a.values.length; i++) expect(a.values[i]).toBeCloseTo(b.values[i], 5);
});


test("isolated spectral peaks have a continuous wave shoulder instead of needle bars", () => {
  const spectrum = new Spectrum();
  spectrum.push(tone(2000));
  const index = peak(spectrum);
  const values = spectrum.values;
  expect(values[index - 2]).toBeGreaterThan(values[index] * 0.5);
  expect(values[index + 2]).toBeGreaterThan(values[index] * 0.5);
  expect(values[index - 4]).toBeGreaterThan(values[index] * 0.1);
  expect(values[index + 4]).toBeGreaterThan(values[index] * 0.1);
  for (let i = 2; i <= 6; i++) {
    expect(values[index - i]).toBeLessThanOrEqual(values[index - i + 1]);
    expect(values[index + i]).toBeLessThanOrEqual(values[index + i - 1]);
  }
});
