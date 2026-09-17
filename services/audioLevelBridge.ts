import type { AudioEnvelope } from "./audioEnvelope";

type Listener = (value: AudioEnvelope) => void;

const listeners = new Set<Listener>();

let current: AudioEnvelope = { level: 0, bass: 0, onset: 0 };

const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export const publishAudioLevel = (level: number, bass = 0, onset = 0) => {
  current = { level: clamp(level), bass: clamp(bass), onset: clamp(onset) };
  listeners.forEach((fn) => fn(current));
};

export const subscribeAudioLevel = (fn: Listener) => {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
};
