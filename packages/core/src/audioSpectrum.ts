// Perceptual spectrum: logarithmic bands retain bass / vocal / percussion
// features instead of averaging unrelated pieces of the waveform together.
export class Spectrum {
  readonly values: Float32Array;
  readonly frequencies: Float32Array;
  private readonly size = 4096;
  private readonly ring = new Float32Array(this.size);
  private readonly real = new Float32Array(this.size);
  private readonly imaginary = new Float32Array(this.size);
  private readonly window = new Float32Array(this.size);
  private readonly reversed = new Uint16Array(this.size);
  private readonly power = new Float32Array(this.size / 2);
  private readonly targets: Float32Array;
  private readonly previous: Float32Array;
  private readonly kernel = Float32Array.from({ length: 13 }, (_, i) => Math.exp(-((i - 6) ** 2) / (2 * 2.1 ** 2)));
  private cursor = 0;
  private pending = 0;

  constructor(private readonly rate = 48000, count = 56) {
    this.values = new Float32Array(count);
    this.targets = new Float32Array(count);
    this.previous = new Float32Array(count);
    this.frequencies = Float32Array.from({ length: count + 1 }, (_, i) =>
      45 * (Math.min(14000, rate * 0.45) / 45) ** (i / count));
    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.size - 1));
      let n = i, reversed = 0;
      for (let bit = 0; bit < 12; bit++) {
        reversed = (reversed << 1) | (n & 1);
        n >>= 1;
      }
      this.reversed[i] = reversed;
    }
  }

  push(data: Float32Array) {
    for (const value of data) {
      this.ring[this.cursor] = Number.isFinite(value) ? value : 0;
      this.cursor = (this.cursor + 1) % this.size;
    }
    this.pending += data.length;
  }

  update(dt: number, stale = false): Float32Array {
    if (stale) {
      this.targets.fill(0);
      this.previous.fill(0);
      this.ring.fill(0);
      this.pending = 0;
    } else if (this.pending >= 512) {
      this.analyze();
      this.pending = 0;
    }
    for (let i = 0; i < this.values.length; i++) {
      // Spread each real peak into a bell-shaped shoulder across neighboring
      // bars. Spatial smoothing makes waves; fast temporal response keeps beats.
      let crest = 0, sum = 0, weight = 0;
      for (let j = -6; j <= 6; j++) {
        const index = i + j;
        if (index < 0 || index >= this.targets.length) continue;
        const influence = this.kernel[j + 6];
        crest = Math.max(crest, this.targets[index] * influence);
        sum += this.targets[index] * influence;
        weight += influence;
      }
      const target = crest * 0.78 + sum / weight * 0.22;
      const tau = target > this.values[i] ? 0.010 : 0.085;
      this.values[i] += (target - this.values[i]) * (1 - Math.exp(-Math.max(0, dt) / tau));
    }
    return this.values;
  }

  private analyze() {
    // Windowed radix-2 FFT. All storage is reused on the render worker.
    for (let i = 0; i < this.size; i++) {
      this.real[this.reversed[i]] = this.ring[(this.cursor + i) % this.size] * this.window[i];
    }
    this.imaginary.fill(0);
    for (let span = 2; span <= this.size; span *= 2) {
      const angle = -2 * Math.PI / span;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      for (let start = 0; start < this.size; start += span) {
        let wr = 1, wi = 0;
        for (let j = 0; j < span / 2; j++) {
          const a = start + j, b = a + span / 2;
          const real = wr * this.real[b] - wi * this.imaginary[b];
          const imaginary = wr * this.imaginary[b] + wi * this.real[b];
          this.real[b] = this.real[a] - real;
          this.imaginary[b] = this.imaginary[a] - imaginary;
          this.real[a] += real;
          this.imaginary[a] += imaginary;
          const next = wr * cosine - wi * sine;
          wi = wr * sine + wi * cosine;
          wr = next;
        }
      }
    }
    for (let i = 0; i < this.power.length; i++) {
      this.power[i] = Math.hypot(this.real[i], this.imaginary[i]) * 4 / this.size;
    }
    for (let i = 0; i < this.targets.length; i++) {
      const start = Math.max(1, Math.floor(this.frequencies[i] * this.size / this.rate));
      const end = Math.min(this.power.length - 1, Math.ceil(this.frequencies[i + 1] * this.size / this.rate));
      let peak = 0, sum = 0;
      for (let bin = start; bin <= end; bin++) {
        peak = Math.max(peak, this.power[bin]);
        sum += this.power[bin] ** 2;
      }
      // Peak + RMS preserves narrow melodic peaks and broad percussion alike.
      const amplitude = peak * 0.72 + Math.sqrt(sum / (end - start + 1)) * 0.28;
      const weight = Math.min(5, Math.max(0, Math.log2(this.frequencies[i] / 180) * 1.2));
      const db = 20 * Math.log10(Math.max(1e-7, amplitude)) + weight;
      const level = Math.max(0, Math.min(1, (db + 66) / 60));
      const onset = Math.max(0, level - this.previous[i]);
      this.targets[i] = Math.min(1, level ** 1.35 + onset * 0.18);
      this.previous[i] = level;
    }
  }
}
