import { expect, test } from "bun:test";
import { Mesh, points, sample, palette, blur, prepare, SIZE, SIDE } from "../components/background/renderer/mesh";

test("adjacent cubic patches agree in value and first derivative", () => {
  const data = points(7.2, 0.8);
  const epsilon = 0.00001;
  for (const axis of [0, 1]) {
    for (let seam = 1; seam < SIZE - 1; seam++) {
      for (let t = 0; t <= SIZE - 1; t += 0.125) {
        const coords = axis ? [t, seam] : [seam, t];
        const before = [...coords]; before[axis] -= epsilon;
        const after = [...coords]; after[axis] += epsilon;
        const a = sample(data, 2, before[0], before[1]);
        const b = sample(data, 2, coords[0], coords[1]);
        const c = sample(data, 2, after[0], after[1]);
        for (let i = 0; i < 2; i++) {
          expect(Math.abs(a[i] - c[i])).toBeLessThan(0.0001);
          expect(Math.abs((b[i] - a[i]) / epsilon - (c[i] - b[i]) / epsilon)).toBeLessThan(0.006);
        }
      }
    }
  }
});

test("animated patches do not fold or expose the canvas edges", () => {
  const mesh = new Mesh();
  const colors = palette([[0.8, 0.05, 0.02], [0.1, 0.3, 0.12]]);
  for (let t = 0; t < 180; t += 0.73) {
    mesh.update(points(t, 1), colors);
    const data = mesh.vertices;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 7;
      const b = mesh.indices[i + 1] * 7;
      const c = mesh.indices[i + 2] * 7;
      const area = (data[b] - data[a]) * (data[c + 1] - data[a + 1]) - (data[b + 1] - data[a + 1]) * (data[c] - data[a]);
      if (area >= 0) throw new Error(`Folded triangle at t=${t}, triangle=${i / 3}`);
    }
    for (let i = 0; i < SIDE; i++) {
      expect(data[(i * SIDE) * 7]).toBeCloseTo(-1, 5);
      expect(data[(i * SIDE + SIDE - 1) * 7]).toBeCloseTo(1, 5);
      expect(data[i * 7 + 1]).toBeCloseTo(1, 5);
      expect(data[((SIDE - 1) * SIDE + i) * 7 + 1]).toBeCloseTo(-1, 5);
    }
  }
});

test("artwork blur preserves constant colors including at the edges", () => {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([30, 90, 150, 255], i);
  expect(blur(pixels, 64)).toEqual(pixels);
});

test("artwork blur retains spatial color area and does not invent new hues", () => {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) pixels.set(x < 32 ? [200, 0, 0, 255] : [0, 100, 0, 255], (y * 64 + x) * 4);
  }
  const result = blur(pixels, 64);
  expect(result[0]).toBe(200);
  expect(result[63 * 4 + 1]).toBe(100);
  let red = 0, green = 0;
  for (let i = 0; i < result.length; i += 4) {
    red += result[i]; green += result[i + 1];
    expect(result[i + 2]).toBe(0);
  }
  expect(red / green).toBeCloseTo(2, 1);
});

test("cover processing preserves neutral hues and handles transparent artwork", () => {
  for (const color of [0, 64, 128, 255]) {
    const input = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < input.length; i += 4) input.set([color, color, color, 255], i);
    const output = prepare(input, 32);
    for (let i = 0; i < output.length; i += 4) {
      expect(output[i]).toBe(output[i + 1]);
      expect(output[i]).toBe(output[i + 2]);
      expect(output[i + 3]).toBe(255);
    }
  }
  const input = new Uint8ClampedArray(32 * 32 * 4).fill(0);
  const output = prepare(input, 32);
  expect(output[0]).toBe(0);
  expect(output[3]).toBe(255);
});
