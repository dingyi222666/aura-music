// Bicubic Hermite patches: positions, two tangents and their mixed derivative
// are shared by adjacent patches. The control field is generated analytically;
// no hand-authored layouts or external control-point presets are used.
export const SIZE = 20;
const STEPS = 8;
export const SIDE = (SIZE - 1) * STEPS + 1;
const STRIDE = 8;

export const basis = (t: number): number[] => [
  2 * t * t * t - 3 * t * t + 1,
  -2 * t * t * t + 3 * t * t,
  t * t * t - 2 * t * t + t,
  t * t * t - t * t,
];

// Two nonuniform shears form an orientation-preserving map. The secondary
// waves create narrower shoulders within the large color regions. Tangents
// come from its Jacobian, not averages of the neighboring point positions.
export const points = (
  time: number, audio = 0, data: Float32Array = new Float32Array(SIZE * SIZE * STRIDE),
): Float32Array => {
  const phase = time * 0.18;
  const squeeze = 0.58 + 0.14 * Math.sin(phase * 0.73 + 1.4);
  const spread = 0.45 + 0.12 * Math.sin(phase * 0.51 - 0.8);
  const gain = 1 + Math.max(0, Math.min(1, audio)) * 0.04;
  const step = 1 / (SIZE - 1);
  for (let y = 0; y < SIZE; y++) {
    const sy = y * step;
    const ay = Math.PI * 2 * sy - 0.9 - phase * 0.27;
    const v = sy + squeeze / (Math.PI * 2) * (Math.sin(ay) - Math.sin(-0.9 - phase * 0.27));
    const dy = 1 + squeeze * Math.cos(ay);
    const wave = gain * (0.19 * Math.sin(v * 5.4 + phase + 0.8) +
      0.05 * Math.sin(v * 10.8 - phase * 0.63 + 2.1));
    const slope = gain * (0.19 * 5.4 * Math.cos(v * 5.4 + phase + 0.8) +
      0.05 * 10.8 * Math.cos(v * 10.8 - phase * 0.63 + 2.1));
    for (let x = 0; x < SIZE; x++) {
      const sx = x * step;
      const ax = Math.PI * 2 * sx + 0.7 + phase * 0.31;
      const u = sx + spread / (Math.PI * 2) * (Math.sin(ax) - Math.sin(0.7 + phase * 0.31));
      const dx = 1 + spread * Math.cos(ax);
      const su = Math.sin(Math.PI * u);
      const cu = Math.PI * Math.cos(Math.PI * u);
      const px = u + su * wave;
      const xu = 1 + cu * wave;
      const xv = su * slope;
      const xuv = cu * slope;
      const flow = gain * (0.17 * Math.sin(px * 5.8 - phase * 0.81 + 1.9) +
        0.045 * Math.sin(px * 11.6 + phase * 0.57 + 0.4));
      const first = gain * (0.17 * 5.8 * Math.cos(px * 5.8 - phase * 0.81 + 1.9) +
        0.045 * 11.6 * Math.cos(px * 11.6 + phase * 0.57 + 0.4));
      const second = -gain * (0.17 * 5.8 ** 2 * Math.sin(px * 5.8 - phase * 0.81 + 1.9) +
        0.045 * 11.6 ** 2 * Math.sin(px * 11.6 + phase * 0.57 + 0.4));
      const sv = Math.sin(Math.PI * v);
      const cv = Math.PI * Math.cos(Math.PI * v);
      const py = v + sv * flow;
      const yu = sv * first * xu;
      const yv = 1 + cv * flow + sv * first * xv;
      const yuv = cv * first * xu + sv * (second * xv * xu + first * xuv);
      // Compress parameter bands before bending them, so the narrow color
      // boundaries follow the flow instead of forming straight screen axes.
      const i = (y * SIZE + x) * STRIDE;
      data[i] = px;
      data[i + 1] = py;
      data[i + 2] = xu * dx * step;
      data[i + 3] = yu * dx * step;
      data[i + 4] = xv * dy * step;
      data[i + 5] = yv * dy * step;
      data[i + 6] = xuv * dx * dy * step * step;
      data[i + 7] = yuv * dx * dy * step * step;
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

  update(controls: Float32Array, colors: Float32Array) {
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
  }
}

export type Color = [number, number, number];

export const palette = (input: Color[]): Float32Array => {
  const colors = input.length ? input : [[0.10, 0.08, 0.14], [0.05, 0.08, 0.12]] as Color[];
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

// Process the complete cover before spatial filtering. Keeping out-of-gamut
// values in float storage until after blur avoids clipped, flat color islands.
export const prepare = (pixels: Uint8ClampedArray, size: number): Uint8ClampedArray => {
  const data = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const luma = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    for (let c = 0; c < 3; c++) {
      const value = luma + (pixels[i + c] - luma) * 2.8;
      data[i + c] = ((value - 127.5) * 0.72 + 127.5) * 0.76 * alpha;
    }
    data[i + 3] = 255;
  }
  return blur(data, size, size * 0.075);
};
