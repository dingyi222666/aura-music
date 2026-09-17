import type { AudioEnvelope } from "@/services/audioEnvelope";

const smooth = (value: number, target: number, dt: number, attack: number, release: number) =>
  value + (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)));

export class Motion {
  time = 0;
  level = 0;
  bass = 0;
  onset = 0;
  climax = 0;

  get angle() {
    // Broad, bounded swing as in the previous cover-fluid renderer. The
    // overlapping periods avoid both a rigid turntable and abrupt reversals.
    return 0.32 + 0.3 * Math.sin(this.time * 0.14) + 0.13 * Math.sin(this.time * 0.087);
  }

  step(dt: number, playing: boolean, input: AudioEnvelope) {
    // Pausing preserves the complete shape and phase, including its tension.
    if (!playing) return;
    this.time += dt * 0.8;
    this.level = smooth(this.level, input.level, dt, 0.12, 0.55);
    this.bass = smooth(this.bass, input.bass, dt, 0.09, 0.45);
    this.onset = smooth(this.onset, input.onset, dt, 0.025, 0.24);
    // Only sustained high energy opens the visual response. Short beats and
    // ordinary bass pulses remain below the gate.
    const high = input.level > 0.72 && input.bass > 0.54;
    this.climax = smooth(this.climax, high ? 1 : 0, dt, 1.4, 0.9);
  }
}
