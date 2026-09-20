export interface AudioEnvelope {
  level: number;
  bass: number;
  onset: number;
}

/** Two Butterworth sections reject subsonic rumble and treble without an FFT. */
class Band {
  private readonly coefficients: Float64Array;
  private readonly memory = new Float64Array(4);

  constructor(rate: number) {
    this.coefficients = new Float64Array([32, 180].flatMap((hz, i) => {
      const w = 2 * Math.PI * hz / rate;
      const c = Math.cos(w);
      const a = Math.sin(w) / Math.SQRT2;
      const b = (1 + (i === 0 ? c : -c)) / (2 * (1 + a));
      return [b, (i === 0 ? -2 : 2) * b, -2 * c / (1 + a), (1 - a) / (1 + a)];
    }));
  }

  push(value: number) {
    const c = this.coefficients;
    const m = this.memory;
    const high = c[0] * value + m[0];
    m[0] = c[1] * value - c[2] * high + m[1];
    m[1] = c[0] * value - c[3] * high;
    const low = c[4] * high + m[2];
    m[2] = c[5] * high - c[6] * low + m[3];
    m[3] = c[4] * high - c[7] * low;
    return low;
  }
}

// Reuse the worklet PCM stream. Stereo energies are combined after filtering,
// so a right-only kick or opposite-phase bass is not lost to a mono downmix.
export class Envelope {
  private readonly left: Band;
  private readonly right: Band;
  private readonly window: number;
  private sum = 0;
  private power = 0;
  private peak = 0;
  private size = 0;
  private baseline = 0;
  private cooldown = 0;
  private armed = true;
  private readonly result: AudioEnvelope = { level: 0, bass: 0, onset: 0 };

  constructor(private readonly rate: number) {
    this.left = new Band(rate);
    this.right = new Band(rate);
    this.window = Math.round(rate * 0.02 / 128) * 128;
  }

  push(data: Float32Array, right?: Float32Array): AudioEnvelope | null {
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const low = this.left.push(value);
      if (right) {
        const other = right[i] ?? 0;
        const bass = this.right.push(other);
        this.power += (low * low + bass * bass) * 0.5;
        this.sum += (value * value + other * other) * 0.5;
        this.peak = Math.max(this.peak, Math.abs(value), Math.abs(other));
      } else {
        this.power += low * low;
        this.sum += value * value;
        this.peak = Math.max(this.peak, Math.abs(value));
      }
    }
    this.size += data.length;
    if (this.size < this.window) return null;

    const dt = this.size / this.rate;
    const rms = Math.sqrt(this.power / this.size);
    // Relative novelty makes quiet kicks detectable. A small absolute floor,
    // hysteresis and 100 ms refractory period reject noise and double hits.
    const novelty = (rms - this.baseline) / Math.max(0.012, this.baseline);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (novelty < 0.18) this.armed = true;
    const onset = this.armed && this.cooldown === 0 && rms > 0.01 && novelty > 0.4;
    this.result.onset = onset ? Math.min(1, novelty * 0.8) : 0;
    if (onset) {
      this.armed = false;
      this.cooldown = 0.1;
    }
    this.result.level = Math.min(1, Math.max(Math.sqrt(this.sum / this.size) * 2.8, this.peak * 0.9));
    this.result.bass = rms > 0.004 ? Math.min(1, rms * 4.5) : 0;
    this.baseline += (rms - this.baseline) * (1 - Math.exp(-dt / (rms > this.baseline ? 0.12 : 0.25)));
    this.size = this.sum = this.power = this.peak = 0;
    return this.result;
  }
}
