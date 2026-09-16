// Tensor-product cubic patches. Neighboring patches share positions and tangents,
// equivalent to converting each Catmull–Rom span into a cubic Bezier span.
// Apple documents this patch model, but does not publish Music's renderer:
// https://developer.apple.com/documentation/swiftui/meshgradient
export const SIZE = 6;
const STEPS = 16;
export const SIDE = (SIZE - 1) * STEPS + 1;

export const basis = (t: number): number[] => [
  -0.5 * t + t * t - 0.5 * t * t * t,
  1 - 2.5 * t * t + 1.5 * t * t * t,
  0.5 * t + 2 * t * t - 1.5 * t * t * t,
  -0.5 * t * t + 0.5 * t * t * t,
];

export const points = (time: number, audio = 0): Float32Array => {
  // Geometry changes much more slowly than the artwork travelling through it.
  const phase = 4.8 + time * 0.18;
  const data = new Float32Array(SIZE * SIZE * 2);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Each shear fixes its perpendicular boundary and slides the other pair.
      // The complete cover remains visible, without overscan cropping its edges.
      let u = x / (SIZE - 1);
      let v = y / (SIZE - 1);
      u += (0.22 + audio * 0.012) * Math.sin(Math.PI * u) * Math.sin(v * 5.0 + phase * 0.62);
      v += (0.19 + audio * 0.010) * Math.sin(Math.PI * v) * Math.sin(u * 4.5 - phase * 0.53 + 1.2);
      const i = (y * SIZE + x) * 2;
      data[i] = u;
      data[i + 1] = v;
    }
  }
  return data;
};

const weights = (cell: number, t: number): Float32Array => {
  const data = new Float32Array(SIZE);
  const b = basis(t);
  for (let i = 0; i < 4; i++) {
    const p = cell + i - 1;
    // Linear extrapolation preserves boundary derivatives.
    if (p < 0) {
      data[0] += b[i] * 2;
      data[1] -= b[i];
    } else if (p >= SIZE) {
      data[SIZE - 1] += b[i] * 2;
      data[SIZE - 2] -= b[i];
    } else {
      data[p] += b[i];
    }
  }
  return data;
};

export const sample = (
  data: Float32Array, channels: number, u: number, v: number,
): number[] => {
  const x = Math.min(SIZE - 2, Math.max(0, Math.floor(u)));
  const y = Math.min(SIZE - 2, Math.max(0, Math.floor(v)));
  const a = weights(x, u - x);
  const b = weights(y, v - y);
  return Array.from({ length: channels }, (_, c) => {
    let value = 0;
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) value += data[(j * SIZE + i) * channels + c] * a[i] * b[j];
    }
    return value;
  });
};

export class Mesh {
  readonly vertices = new Float32Array(SIDE * SIDE * 7);
  readonly indices = new Uint16Array((SIDE - 1) * (SIDE - 1) * 6);
  private readonly weights = new Float32Array(SIDE * SIDE * SIZE * SIZE);

  constructor() {
    for (let y = 0; y < SIDE; y++) {
      const v = y / STEPS;
      const cy = Math.min(SIZE - 2, Math.floor(v));
      const b = weights(cy, v - cy);
      for (let x = 0; x < SIDE; x++) {
        const u = x / STEPS;
        const cx = Math.min(SIZE - 2, Math.floor(u));
        const a = weights(cx, u - cx);
        const p = y * SIDE + x;
        this.vertices[p * 7 + 5] = x / (SIDE - 1);
        this.vertices[p * 7 + 6] = y / (SIDE - 1);
        for (let j = 0; j < SIZE; j++) {
          for (let i = 0; i < SIZE; i++) this.weights[p * SIZE * SIZE + j * SIZE + i] = a[i] * b[j];
        }
        if (x < SIDE - 1 && y < SIDE - 1) {
          this.indices.set([p, p + 1, p + SIDE, p + 1, p + SIDE + 1, p + SIDE], (y * (SIDE - 1) + x) * 6);
        }
      }
    }
  }

  update(positions: Float32Array, colors: Float32Array) {
    for (let p = 0; p < SIDE * SIDE; p++) {
      let x = 0, y = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const w = this.weights[p * SIZE * SIZE + i];
        x += positions[i * 2] * w;
        y += positions[i * 2 + 1] * w;
        r += colors[i * 3] * w;
        g += colors[i * 3 + 1] * w;
        b += colors[i * 3 + 2] * w;
      }
      const i = p * 7;
      this.vertices[i] = x * 2 - 1;
      this.vertices[i + 1] = 1 - y * 2;
      this.vertices[i + 2] = Math.max(0, r);
      this.vertices[i + 3] = Math.max(0, g);
      this.vertices[i + 4] = Math.max(0, b);
    }
  }
}

export type Color = [number, number, number];

export const palette = (input: Color[]): Float32Array => {
  const colors = input.length ? input : [[0.10, 0.08, 0.14], [0.05, 0.08, 0.12]] as Color[];
  return new Float32Array(Array.from({ length: SIZE * SIZE }, (_, i) => colors[i % colors.length]).flat());
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

// Process the complete cover before spatial filtering. Keeping out-of-gamut
// values in float storage until after blur avoids clipped, flat color islands.
export const prepare = (pixels: Uint8ClampedArray, size: number): Uint8ClampedArray => {
  const data = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const luma = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    for (let c = 0; c < 3; c++) {
      const value = luma + (pixels[i + c] - luma) * 2.3;
      data[i + c] = ((value - 127.5) * 0.74 + 127.5) * 0.72 * alpha;
    }
    data[i + 3] = 255;
  }
  return blur(data, size, size * 0.088);
};
