import { fold, strength } from "./composition";

// Four authored 4x4 Hermite layouts. Keep the perimeter fixed, and move the
// interior anchors through broad ribbon, cove, diagonal and fan compositions.
// References and timing: docs/mesh-gradient.md. No runtime randomness.
export const SIZE = 4;
const STEPS = 64;
export const SIDE = (SIZE - 1) * STEPS + 1;
const STRIDE = 8;
export const DURATION = 8;
export const layouts = [
  [[0.22, 0.29], [0.62, 0.20], [0.39, 0.76], [0.78, 0.63]], // Ribbon
  [[0.36, 0.20], [0.76, 0.39], [0.23, 0.62], [0.61, 0.79]], // Cove
  [[0.23, 0.38], [0.60, 0.25], [0.39, 0.73], [0.77, 0.59]], // Diagonal
  [[0.39, 0.28], [0.75, 0.25], [0.23, 0.70], [0.61, 0.76]], // Fan
] as const;

// Interior tangent direction/length controls the bend and width of each ribbon,
// rather than deriving every curve from anchor position alone.
const tangents = [
  [[-0.35, 0.30, 1.20, 0.55], [0.30, -0.40, 0.70, 1.15], [0.40, -0.30, 0.65, 1.10], [-0.30, 0.35, 1.25, 0.60]],
  [[0.30, -0.35, 0.70, 1.20], [-0.40, 0.25, 1.15, 0.60], [-0.25, 0.40, 1.20, 0.65], [0.35, -0.30, 0.60, 1.20]],
  [[-0.30, 0.40, 1.25, 0.65], [0.35, -0.25, 0.65, 1.20], [0.25, -0.35, 0.75, 1.15], [-0.40, 0.30, 1.15, 0.65]],
  [[0.35, -0.30, 0.65, 1.20], [-0.25, 0.35, 1.20, 0.70], [-0.35, 0.25, 1.15, 0.60], [0.30, -0.40, 0.70, 1.25]],
] as const;

export const basis = (t: number): number[] => [
  2 * t * t * t - 3 * t * t + 1,
  -2 * t * t * t + 3 * t * t,
  t * t * t - 2 * t * t + t,
  t * t * t - t * t,
];

export const points = (
  time: number, _audio = 0, data: Float32Array = new Float32Array(SIZE * SIZE * STRIDE),
): Float32Array => {
  const phase = ((time / DURATION) % layouts.length + layouts.length) % layouts.length;
  const index = Math.floor(phase);
  const t = phase - index;
  // Quintic easing makes velocity and acceleration continuous at every preset,
  // including the last-to-first seam. The cover has its own continuous drift.
  const blend = t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * STRIDE;
      const inner = x > 0 && x < SIZE - 1 && y > 0 && y < SIZE - 1;
      for (let c = 0; c < 2; c++) {
        const a = inner ? layouts[index][(y - 1) * 2 + x - 1][c] : (c ? y : x) / (SIZE - 1);
        const b = inner ? layouts[(index + 1) % layouts.length][(y - 1) * 2 + x - 1][c] : a;
        data[i + c] = a + (b - a) * blend;
      }
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const left = Math.max(0, x - 1), right = Math.min(SIZE - 1, x + 1);
      const top = Math.max(0, y - 1), bottom = Math.min(SIZE - 1, y + 1);
      const i = (y * SIZE + x) * STRIDE;
      for (let c = 0; c < 2; c++) {
        data[i + 2 + c] = (data[(y * SIZE + right) * STRIDE + c] - data[(y * SIZE + left) * STRIDE + c]) / (right - left);
        data[i + 4 + c] = (data[(bottom * SIZE + x) * STRIDE + c] - data[(top * SIZE + x) * STRIDE + c]) / (bottom - top);
        data[i + 6 + c] = (data[(bottom * SIZE + right) * STRIDE + c] - data[(bottom * SIZE + left) * STRIDE + c]
          - data[(top * SIZE + right) * STRIDE + c] + data[(top * SIZE + left) * STRIDE + c]) / ((right - left) * (bottom - top));
      }
      if (x > 0 && x < SIZE - 1 && y > 0 && y < SIZE - 1) {
        const a = tangents[index][(y - 1) * 2 + x - 1];
        const b = tangents[(index + 1) % tangents.length][(y - 1) * 2 + x - 1];
        for (let axis = 0; axis < 2; axis++) {
          const angle = a[axis] + (b[axis] - a[axis]) * blend;
          const power = a[axis + 2] + (b[axis + 2] - a[axis + 2]) * blend;
          const offset = i + 2 + axis * 2;
          const u = data[offset], v = data[offset + 1];
          data[offset] = (u * Math.cos(angle) - v * Math.sin(angle)) * power;
          data[offset + 1] = (u * Math.sin(angle) + v * Math.cos(angle)) * power;
        }
      }
    }
  }
  return data;
};

// Direct patch evaluation, also used to check the separable renderer.
export const sample = (data: Float32Array, u: number, v: number): number[] => {
  const x = Math.min(SIZE - 2, Math.max(0, Math.floor(u)));
  const y = Math.min(SIZE - 2, Math.max(0, Math.floor(v)));
  const a = basis(u - x);
  const b = basis(v - y);
  const result = [0, 0];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const p = ((y + j) * SIZE + x + i) * STRIDE;
      for (let c = 0; c < 2; c++) {
        result[c] += data[p + c] * a[i] * b[j] +
          data[p + 2 + c] * a[i + 2] * b[j] +
          data[p + 4 + c] * a[i] * b[j + 2] +
          data[p + 6 + c] * a[i + 2] * b[j + 2];
      }
    }
  }
  return result;
};

export class Mesh {
  readonly vertices = new Float32Array(SIDE * SIDE * 7);
  readonly indices = new Uint16Array((SIDE - 1) * (SIDE - 1) * 6);
  private readonly surface = new Float32Array(SIDE * SIDE * 2);
  private readonly weights = new Float32Array(SIDE * 4);
  private readonly cells = new Uint8Array(SIDE);
  private readonly rows = new Float32Array(SIZE * SIDE * 7);

  constructor() {
    for (let x = 0; x < SIDE; x++) {
      const u = x / STEPS;
      const cell = Math.min(SIZE - 2, Math.floor(u));
      this.cells[x] = cell;
      this.weights.set(basis(u - cell), x * 4);
    }
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const p = y * SIDE + x;
        this.vertices[p * 7 + 5] = x / (SIDE - 1);
        this.vertices[p * 7 + 6] = y / (SIDE - 1);
        if (x < SIDE - 1 && y < SIDE - 1) {
          this.indices.set([p, p + 1, p + SIDE, p + 1, p + SIDE + 1, p + SIDE], (y * (SIDE - 1) + x) * 6);
        }
      }
    }
  }

  update(controls: Float32Array, colors: Float32Array, crease?: Float32Array) {
    // Interpolate rows once, then columns. Work per vertex stays constant as
    // the control grid grows; all frame storage is reused.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const p = y * SIZE + this.cells[x];
        const i = (y * SIDE + x) * 7;
        const w = x * 4;
        for (let c = 0; c < 2; c++) {
          this.rows[i + c] = controls[p * 8 + c] * this.weights[w] +
            controls[(p + 1) * 8 + c] * this.weights[w + 1] +
            controls[p * 8 + 2 + c] * this.weights[w + 2] +
            controls[(p + 1) * 8 + 2 + c] * this.weights[w + 3];
          this.rows[i + 2 + c] = controls[p * 8 + 4 + c] * this.weights[w] +
            controls[(p + 1) * 8 + 4 + c] * this.weights[w + 1] +
            controls[p * 8 + 6 + c] * this.weights[w + 2] +
            controls[(p + 1) * 8 + 6 + c] * this.weights[w + 3];
        }
        for (let c = 0; c < 3; c++) {
          this.rows[i + 4 + c] = colors[p * 3 + c] * this.weights[w] +
            colors[(p + 1) * 3 + c] * this.weights[w + 1];
        }
      }
    }
    for (let y = 0; y < SIDE; y++) {
      const w = y * 4;
      for (let x = 0; x < SIDE; x++) {
        const a = (this.cells[y] * SIDE + x) * 7;
        const b = a + SIDE * 7;
        const i = (y * SIDE + x) * 7;
        for (let c = 0; c < 2; c++) {
          const value = this.rows[a + c] * this.weights[w] +
            this.rows[b + c] * this.weights[w + 1] +
            this.rows[a + 2 + c] * this.weights[w + 2] +
            this.rows[b + 2 + c] * this.weights[w + 3];
          this.vertices[i + c] = c ? 1 - value * 2 : value * 2 - 1;
        }
        for (let c = 0; c < 3; c++) {
          this.vertices[i + 2 + c] = this.rows[a + 4 + c] * this.weights[w] +
            this.rows[b + 4 + c] * this.weights[w + 1];
        }
      }
    }
    if (!crease || crease[2] === 0) return;
    for (let i = 0; i < SIDE * SIDE; i++) {
      this.surface[i * 2] = this.vertices[i * 7];
      this.surface[i * 2 + 1] = this.vertices[i * 7 + 1];
    }
    // Let the curvature constraint lead while a fold is visible. Limit the mesh's
    // influence to keep random bends rounded as the underlying surface moves.
    for (let y = 0; y < SIDE; y++) {
      const amount = Math.min(1, strength(y / (SIDE - 1), crease) / crease[3]);
      const flat = amount * amount * (3 - 2 * amount) * 0.90;
      for (let x = 0; x < SIDE; x++) {
        const u = Math.max(0, Math.min(SIDE - 1, fold(x / (SIDE - 1), y / (SIDE - 1), crease) * (SIDE - 1)));
        const left = Math.min(SIDE - 2, Math.floor(u));
        const t = u - left;
        const a = (y * SIDE + left) * 2;
        const i = (y * SIDE + x) * 7;
        for (let c = 0; c < 2; c++) {
          const curved = this.surface[a + c] * (1 - t) + this.surface[a + 2 + c] * t;
          const plane = c ? 1 - y / (SIDE - 1) * 2 : u / (SIDE - 1) * 2 - 1;
          this.vertices[i + c] = curved * (1 - flat) + plane * flat;
        }
      }
    }
  }
}

export type Color = [number, number, number];

export const palette = (input: Color[]): Float32Array => {
  const colors = input.length ? input : [[0.30, 0.16, 0.43], [0.67, 0.31, 0.40], [0.13, 0.25, 0.40], [0.24, 0.15, 0.35]] as Color[];
  // Keep the no-artwork fallback broad when the geometric grid is refined.
  const data = new Float32Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    const v = y / (SIZE - 1);
    for (let x = 0; x < SIZE; x++) {
      const u = x / (SIZE - 1);
      for (let c = 0; c < 3; c++) {
        const top = colors[0][c] * (1 - u) + colors[1 % colors.length][c] * u;
        const bottom = colors[2 % colors.length][c] * (1 - u) + colors[3 % colors.length][c] * u;
        data[(y * SIZE + x) * 3 + c] = top * (1 - v) + bottom * v;
      }
    }
  }
  return data;
};

// Blur every artwork pixel, preserving its spatial distribution. Mirrored edge
// extension avoids transparent rims; no colors are selected, ranked or replaced.
export const blur = (pixels: Uint8ClampedArray | Float32Array, size: number, sigma = 5.5): Uint8ClampedArray => {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((v) => v / sum);
  const temp = new Float32Array(pixels.length);
  const output = new Uint8ClampedArray(pixels.length);
  const mirror = (v: number) => {
    const n = ((v % (size * 2)) + size * 2) % (size * 2);
    return n < size ? n : size * 2 - n - 1;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        let value = 0;
        for (let i = -radius; i <= radius; i++) value += pixels[(y * size + mirror(x + i)) * 4 + c] * weights[i + radius];
        temp[(y * size + x) * 4 + c] = value;
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        let value = 0;
        for (let i = -radius; i <= radius; i++) value += temp[(mirror(y + i) * size + x) * 4 + c] * weights[i + radius];
        output[(y * size + x) * 4 + c] = value;
      }
      output[(y * size + x) * 4 + 3] = 255;
    }
  }
  return output;
};

// Process the actual cover in place: compress luminance and expand chroma.
// A shared gamut limit preserves hue instead of independently clipping channels.
export const prepare = (pixels: Uint8ClampedArray, size: number): Uint8ClampedArray => {
  const data = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const luma = (pixels[i] * 0.30 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11) / 255;
    const tone = luma * 0.72 + 0.14;
    let gain = 1.9;
    for (let c = 0; c < 3; c++) {
      const delta = pixels[i + c] / 255 - luma;
      if (delta > 0) gain = Math.min(gain, (1 - tone) / delta);
      if (delta < 0) gain = Math.min(gain, -tone / delta);
    }
    for (let c = 0; c < 3; c++) data[i + c] = (tone + (pixels[i + c] / 255 - luma) * gain) * 255 * alpha;
    data[i + 3] = 255;
  }
  // Remove faces and lettering before deformation. A broad source blur keeps
  // the cover's color regions without stretching recognizable subjects; the
  // much lighter final blur preserves boundaries created by the mesh itself.
  return blur(data, size, Math.max(0.5, size * 0.15));
};
