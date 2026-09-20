import type { AudioEnvelope } from "./audioEnvelope";

type Listener = (value: AudioEnvelope) => void;

const listeners = new Set<Listener>();
const demand = new Set<(enabled: boolean) => void>();

let current: AudioEnvelope = { level: 0, bass: 0, onset: 0 };

const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export const publishAudioLevel = (level: number, bass = 0, onset = 0) => {
  current = { level: clamp(level), bass: clamp(bass), onset: clamp(onset) };
  listeners.forEach((fn) => fn(current));
};

export const subscribeAudioLevel = (fn: Listener) => {
  const idle = listeners.size === 0;
  listeners.add(fn);
  if (idle) demand.forEach((notify) => notify(true));
  fn(current);
  return () => {
    if (!listeners.delete(fn) || listeners.size) return;
    current = { level: 0, bass: 0, onset: 0 };
    demand.forEach((notify) => notify(false));
  };
};

/** Analysis runs only while a background subscribes to its envelope. */
export const subscribeAudioDemand = (fn: (enabled: boolean) => void) => {
  demand.add(fn);
  fn(listeners.size > 0);
  return () => { demand.delete(fn); };
};
