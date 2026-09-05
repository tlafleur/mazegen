/**
 * Seeded pseudo-random source.
 *
 * Every maze is a pure function of (settings, seed), so generation must never
 * touch Math.random. See docs/DESIGN.md §3.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [0, n). */
  int(n: number): number
  /** Fisher-Yates, in place. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[]
}

/** FNV-1a, so a human-readable seed string maps to a 32-bit state. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and good enough for maze carving. */
export function makeRng(seed: string | number): Rng {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number): number => Math.floor(next() * n)
  return {
    next,
    int,
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1)
        const a = items[i] as T
        const b = items[j] as T
        items[i] = b
        items[j] = a
      }
      return items
    },
  }
}
