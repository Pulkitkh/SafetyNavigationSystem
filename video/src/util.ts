/** Deterministic pseudo-random in [0, 1) from an integer seed (mulberry32). */
export function rand(seed: number): number {
  let t = (seed * 2654435761 + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
