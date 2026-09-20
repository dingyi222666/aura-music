import { expect, test } from "bun:test";
import { compose, compositions, crease, fold, bend, strength, PERIOD } from "@aura-music/background/renderer/composition";
import { Mesh, points, sample, palette, blur, prepare, SIZE, SIDE, DURATION, layouts } from "@aura-music/background/renderer/mesh";

test("tiled indices cover every cell once with the original diagonal and winding", () => {
  const mesh = new Mesh();
  const cells = new Uint8Array((SIDE - 1) ** 2);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = Array.from(mesh.indices.subarray(i, i + 3));
    const x = triangle.map((p) => p % SIDE);
    const y = triangle.map((p) => Math.floor(p / SIDE));
    const left = Math.min(...x), top = Math.min(...y);
    expect(Math.max(...x) - left).toBe(1);
    expect(Math.max(...y) - top).toBe(1);
    expect((x[1] - x[0]) * (y[2] - y[0]) - (y[1] - y[0]) * (x[2] - x[0])).toBe(1);
    const sum = x.reduce((a, b) => a + b, 0) + y.reduce((a, b) => a + b, 0) - 3 * (left + top);
    expect([2, 4]).toContain(sum);
    const bit = sum === 2 ? 1 : 2;
    const cell = top * (SIDE - 1) + left;
    expect(cells[cell] & bit).toBe(0);
    cells[cell] |= bit;
  }
  expect(cells.every((value) => value === 3)).toBe(true);
});

test("adjacent cubic patches agree in value and first derivative", () => {
  const data = points(7.2, 0.8);
  const epsilon = 0.00001;
  for (const axis of [0, 1]) {
    for (let seam = 1; seam < SIZE - 1; seam++) {
      for (let t = 0; t <= SIZE - 1; t += 0.125) {
        const coords = axis ? [t, seam] : [seam, t];
        const before = [...coords]; before[axis] -= epsilon;
        const after = [...coords]; after[axis] += epsilon;
        const a = sample(data, before[0], before[1]);
        const b = sample(data, coords[0], coords[1]);
        const c = sample(data, after[0], after[1]);
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
  // The geometry repeats every authored cycle; sample that whole cycle densely.
  for (let t = 0; t < DURATION * layouts.length; t += 0.125) {
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

test("separable interpolation matches the cubic surface at boundaries and interiors", () => {
  const mesh = new Mesh();
  const positions = points(37.5, 0.65);
  const colors = Float32Array.from({ length: SIZE * SIZE * 3 }, (_, i) => (Math.sin(i * 1.7) + 1) / 2);
  mesh.update(positions, colors);
  for (const y of [0, 1, 7, 8, 19, SIDE - 2, SIDE - 1]) {
    for (const x of [0, 1, 7, 8, 23, SIDE - 2, SIDE - 1]) {
      const u = x / (SIDE - 1) * (SIZE - 1);
      const v = y / (SIDE - 1) * (SIZE - 1);
      const p = sample(positions, u, v);
      const i = (y * SIDE + x) * 7;
      expect(mesh.vertices[i]).toBeCloseTo(p[0] * 2 - 1, 6);
      expect(mesh.vertices[i + 1]).toBeCloseTo(1 - p[1] * 2, 6);
      for (let k = 0; k < 3; k++) {
        expect(mesh.vertices[i + 2 + k]).toBeGreaterThanOrEqual(0);
        expect(mesh.vertices[i + 2 + k]).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("reusing control storage never accumulates deformation or changes the playback phase", () => {
  const data = points(0);
  for (const t of [0, 3.4, 60, 720, 0, 3.4]) {
    expect(points(t, 0.4, data)).toBe(data);
    expect(data).toEqual(points(t, 0.4));
    const next = points(t + 1 / 60, 0.4);
    for (let i = 0; i < data.length; i++) expect(Math.abs(next[i] - data[i])).toBeLessThan(0.002);
  }
});

test("authored layouts repeat seamlessly and visit each preset", () => {
  const duration = DURATION * layouts.length;
  for (let i = 0; i < layouts.length; i++) {
    const data = points(i * DURATION);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        const offset = (y * SIZE + x) * 8;
        expect(data[offset]).toBeCloseTo(layouts[i][(y - 1) * 2 + x - 1][0], 6);
        expect(data[offset + 1]).toBeCloseTo(layouts[i][(y - 1) * 2 + x - 1][1], 6);
      }
    }
    const before = points(i * DURATION - 0.001);
    const after = points(i * DURATION + 0.001);
    for (let j = 0; j < before.length; j++) expect(before[j]).toBeCloseTo(after[j], 6);
  }
  expect(points(0)).toEqual(points(duration));
  expect(points(13.25)).toEqual(points(duration + 13.25));
});

test("cover enhancement preserves hue and expands chroma without palette substitution", () => {
  for (const color of [[24, 120, 220], [240, 160, 45], [18, 40, 70], [244, 224, 180], [128, 128, 128]]) {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...color, 255], i);
    const output = Array.from(prepare(pixels, 32).slice(0, 3));
    const before = Math.max(...color) - Math.min(...color);
    const after = Math.max(...output) - Math.min(...output);
    expect(after).toBeGreaterThanOrEqual(before);
    if (!before) {
      expect(after).toBe(0);
      continue;
    }
    // Normalized RGB channel positions measure hue independently of tone/chroma.
    for (let c = 0; c < 3; c++) {
      expect((output[c] - Math.min(...output)) / after).toBeCloseTo((color[c] - Math.min(...color)) / before, 2);
    }
  }
});

test("texture compositions wrap continuously and preserve positive twist radii", () => {
  const before = new Float32Array(8), after = new Float32Array(8);
  for (let i = 0; i <= compositions.length; i++) {
    compose(i * PERIOD - 0.001, before);
    compose(i * PERIOD + 0.001, after);
    for (let j = 0; j < before.length; j++) expect(before[j]).toBeCloseTo(after[j], 6);
  }
  for (let t = 0; t < PERIOD * compositions.length; t += 0.1) {
    compose(t, before);
    expect(before[2]).toBeGreaterThan(0);
    expect(before[6]).toBeGreaterThan(0);
    compose(t + PERIOD * compositions.length, after);
    for (let j = 0; j < before.length; j++) expect(before[j]).toBeCloseTo(after[j], 5);
  }
});


test("fold events hold, unfold completely, and vary between cycles without jumps", () => {
  for (const seed of [17, 812, 912731]) {
    const centers = new Set<number>();
    for (let cycle = 0; cycle < 6; cycle++) {
      let active = 0;
      for (let t = 0; t < 24; t += 0.1) {
        const time = cycle * 24 + t;
        const a = crease(time, undefined, seed);
        const b = crease(time + 1 / 60, undefined, seed);
        if (a[2] > a[3] * 1.5) active++;
        for (let y = 0; y <= 1; y += 0.25) {
          expect(fold(0, y, a)).toBeCloseTo(0, 6);
          expect(fold(1, y, a)).toBeCloseTo(1, 6);
          for (let x = 0; x <= 1; x += 0.05) {
            const value = fold(x, y, a);
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(-0.000001);
            expect(value).toBeLessThanOrEqual(1.000001);
            expect(Math.abs(value - fold(x, y, b))).toBeLessThan(0.008);
          }
        }
      }
      expect(active).toBeGreaterThan(35);
      expect(crease(cycle * 24 + 20, undefined, seed)[2]).toBe(0);
      centers.add(crease(cycle * 24 + 8, undefined, seed)[0]);
    }
    expect(centers.size).toBe(6);
  }
});

test("folded artwork follows the moving surface, then returns to the original mesh", () => {
  const mesh = new Mesh();
  const colors = palette([]);
  for (const time of [7, 8, 9, 10, 32, 56]) {
    const controls = points(time);
    const curve = crease(time);
    mesh.update(controls, colors, curve);
    let reversed = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 7, b = mesh.indices[i + 1] * 7, c = mesh.indices[i + 2] * 7;
      const data = mesh.vertices;
      const area = (data[b] - data[a]) * (data[c + 1] - data[a + 1]) - (data[b + 1] - data[a + 1]) * (data[c] - data[a]);
      if (area > 0) reversed++;
    }
    expect(reversed).toBeGreaterThan(0);
    for (let y = 0; y < SIDE; y += 8) {
      for (let x = 0; x < SIDE; x += 8) {
        const u = fold(x / (SIDE - 1), y / (SIDE - 1), curve);
        const value = sample(controls, u * (SIZE - 1), y / (SIDE - 1) * (SIZE - 1));
        const i = (y * SIDE + x) * 7;
        // Most of the unfolding mesh displacement is restrained while a fold
        // is visible, preserving the random arc's curvature and a moving surface.
        const amount = Math.min(1, strength(y / (SIDE - 1), curve) / curve[3]);
        const flat = amount * amount * (3 - 2 * amount) * 0.90;
        expect(Math.abs(mesh.vertices[i] - ((value[0] * 2 - 1) * (1 - flat) + (u * 2 - 1) * flat))).toBeLessThan(0.001);
        expect(Math.abs(mesh.vertices[i + 1] - ((1 - value[1] * 2) * (1 - flat) + (1 - y / (SIDE - 1) * 2) * flat))).toBeLessThan(0.001);
        expect(mesh.vertices[i + 5]).toBeCloseTo(x / (SIDE - 1), 6);
        expect(mesh.vertices[i + 6]).toBeCloseTo(y / (SIDE - 1), 6);
      }
    }
  }
  mesh.update(points(20), colors, crease(20));
  const data = mesh.vertices.slice();
  mesh.update(points(20), colors);
  expect(mesh.vertices).toEqual(data);
});

test("random folds stay localized, single and connected while moving", () => {
  const mesh = new Mesh();
  const colors = palette([]);
  for (const seed of [17, 812, 912731, 42, 18428]) {
    for (let time = 0; time < 144; time += 4.1) {
      const curve = crease(time, undefined, seed);
      if (curve[2] <= curve[3] * 1.01) continue;
      mesh.update(points(time), colors, curve);
      let start = -1, end = -1, blocks = 0, previous = false;
      for (let row = 0; row <= 48; row++) {
        let runs = 0, reversed = false;
        for (let i = 0; i < SIDE - 1; i++) {
          const offset = (row * (SIDE - 1) / 48 * SIDE + i) * 7;
          const next = mesh.vertices[offset + 7] < mesh.vertices[offset];
          if (next && !reversed) runs++;
          reversed = next;
        }
        expect(runs).toBeLessThanOrEqual(1);
        if (runs) {
          if (!previous) blocks++;
          if (start === -1) start = row;
          end = row;
        }
        previous = runs > 0;
        if (Math.abs(row / 48 - curve[4]) >= curve[5]) {
          expect(runs).toBe(0);
          expect(fold(0.5, row / 48, curve)).toBe(0.5);
        }
      }
      expect(blocks).toBeLessThanOrEqual(1);
      if (start >= 0) {
        expect(start).toBeGreaterThan(0);
        expect(end).toBeLessThan(48);
        expect((end - start) / 48).toBeLessThan(0.5);
      }
    }
    const a = crease(7, undefined, seed), b = crease(11, undefined, seed);
    expect(Math.hypot(a[0] - b[0], a[4] - b[4])).toBeGreaterThan(0.015);
  }
});
