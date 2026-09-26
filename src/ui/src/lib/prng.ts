/**
 * Deterministic seeded RNG utilities.
 * Used to give placeholder/dev scenes stable, reproducible variation
 * (no Math.random at render time — same seed, same city).
 */

/** mulberry32 — small fast seeded PRNG, returns values in [0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable string hash -> uint32 seed (FNV-1a-flavored, avalanche-mixed) */
export function hashStringToSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

/** Convenience: seed an RNG straight from a string key */
export function rngFromString(key: string): () => number {
  return mulberry32(hashStringToSeed(key))
}

/** Uniform float in [min, max) */
export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** Uniform pick from a readonly array */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
