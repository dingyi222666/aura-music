export const PERIOD = 8;
// Two spatial twists per composition: center x/y, radius and angle (radians).
// These steer the complete artwork, never colors sampled from it.
export const compositions = [
  { name: "Ribbon", twists: [0.32, 0.42, 0.82, 2.4, 0.76, 0.68, 0.76, -2.1] },
  { name: "Cove", twists: [0.56, 0.26, 0.76, 1.8, 0.34, 0.72, 0.84, -2.7] },
  { name: "Wave", twists: [0.72, 0.46, 0.86, 2.7, 0.24, 0.56, 0.74, -1.9] },
  { name: "Fold", twists: [0.40, 0.72, 0.80, 2.0, 0.68, 0.26, 0.82, -2.5] },
] as const;

export const compose = (time: number, twists: Float32Array) => {
  const phase = ((time / PERIOD) % compositions.length + compositions.length) % compositions.length;
  const index = Math.floor(phase), t = phase - index;
  const blend = t * t * t * (t * (t * 6 - 15) + 10);
  const a = compositions[index], b = compositions[(index + 1) % compositions.length];
  for (let i = 0; i < twists.length; i++) twists[i] = a.twists[i] + (b.twists[i] - a.twists[i]) * blend;
};

// Seeded events vary their location and hold time, with quiet gaps between them.
// Playback time owns the envelope, so pausing also freezes the fold.
const random = (seed: number) => {
  let n = Math.imul(seed ^ 0x9e3779b9, 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 16), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
};

const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Center x, slope, strength, width, center y, vertical radius and bend.
export const crease = (time: number, data = new Float32Array(7), seed = 17) => {
  const cycle = Math.floor(time / 24);
  const phase = time - cycle * 24;
  const key = seed + cycle * 9;
  const start = 2 + random(key) * 3;
  const hold = 4 + random(key + 1) * 4;
  const envelope = ease((phase - start) / 2.4) * (1 - ease((phase - start - 2.4 - hold) / 3.2));
  // A single local arc with a compact footprint. Its center moves while the
  // event holds; the surrounding surface stays unfolded.
  const drift = random(key + 2) * Math.PI * 2;
  data[0] = 0.48 + random(key + 2) * 0.04 +
    Math.sin(time * 0.30 + drift) * 0.065 + Math.sin(time * 0.17 + drift) * 0.025;
  data[1] = (random(key + 3) - 0.5) * 0.04;
  data[2] = (0.14 + random(key + 4) * 0.035) * envelope;
  data[3] = 0.065 + random(key + 5) * 0.015;
  data[4] = 0.47 + random(key + 6) * 0.06 + Math.sin(time * 0.22 + drift) * 0.07;
  data[5] = 0.31 + random(key + 7) * 0.045;
  data[6] = 0.055 + random(key + 8) * 0.03;
  return data;
};

// Non-injective parameterization creates an occlusion contour, not a stroke.
// Deform before evaluating the surface so its contour follows the moving mesh.
export const bend = (y: number, data: Float32Array) =>
  data[0] + data[1] * (y - data[4]) + data[6] * ((y - data[4]) / data[5]) ** 2;

export const strength = (y: number, data: Float32Array) => {
  const distance = (y - data[4]) / data[5];
  const weight = Math.max(0, 1 - distance * distance);
  return data[2] * weight * weight;
};

export const fold = (x: number, y: number, data: Float32Array) => {
  const amount = strength(y, data);
  if (amount === 0) return x;
  const center = bend(y, data);
  const left = amount * Math.tanh(center / data[3]);
  const right = 1 - amount * Math.tanh((1 - center) / data[3]);
  return (x - amount * Math.tanh((x - center) / data[3]) - left) / (right - left);
};
