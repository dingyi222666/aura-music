export interface AudioEnvelope {
  level: number;
  bass: number;
  onset: number;
}

// Reuse the worklet's PCM stream. Two low-pass filters isolate the low band
// without another analyser, FFT, or per-sample allocation.
export class Envelope {
  private readonly low: number;
  private readonly high: number;
  private readonly release: number;
  private slow = 0;
  private fast = 0;
  private sum = 0;
  private power = 0;
  private peak = 0;
  private size = 0;
  private baseline = 0;
  private readonly result: AudioEnvelope = { level: 0, bass: 0, onset: 0 };

  constructor(rate: number) {
    this.low = 1 - Math.exp(-2 * Math.PI * 35 / rate);
    this.high = 1 - Math.exp(-2 * Math.PI * 180 / rate);
    this.release = 1 - Math.exp(-2048 / rate / 0.24);
  }

  push(data: Float32Array): AudioEnvelope | null {
    for (const value of data) {
      this.slow += this.low * (value - this.slow);
      this.fast += this.high * (value - this.fast);
      this.power += (this.fast - this.slow) ** 2;
      this.sum += value * value;
      this.peak = Math.max(this.peak, Math.abs(value));
    }
    this.size += data.length;
    if (this.size < 2048) return null;

    const bass = Math.min(1, Math.sqrt(this.power / this.size) * 5);
    this.result.level = Math.min(1, Math.max(Math.sqrt(this.sum / this.size) * 2.8, this.peak * 0.9));
    this.result.bass = bass;
    this.result.onset = Math.min(1, Math.max(0, bass - this.baseline - 0.015) * 5);
    this.baseline += (bass - this.baseline) * this.release;
    this.size = this.sum = this.power = this.peak = 0;
    return this.result;
  }
}
