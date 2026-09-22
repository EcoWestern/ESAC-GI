/**
 * Deterministic, dependency-free PRNG and hashing.
 *
 * Reproducibility requirement (first-amendment §4): where an item is parametrized,
 * its generation logic must be reproducible. Everything here is pure and stable
 * across platforms and Node versions — no Math.random, no Date, no locale.
 */

/** FNV-1a 32-bit. Used for seed derivation and instance fingerprints. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, in 32-bit space without BigInt
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Derive a per-item seed from a dataset seed. Stable across models and runs. */
export function deriveSeed(datasetSeed: string, itemId: string): number {
  return fnv1a(`${datasetSeed}:${itemId}`);
}

/**
 * Short, stable fingerprint of a concrete instance. Recorded in run output so a
 * third party can prove they generated the same instance, and so the
 * public-vs-held-out overfitting signal is attributable to a specific instantiation.
 */
export function fingerprint(parts: readonly (string | number)[]): string {
  return fnv1a(parts.join("\u0000")).toString(16).padStart(8, "0");
}

export interface Rng {
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly pick one element. Throws on empty input. */
  pick<T>(xs: readonly T[]): T;
  /** Fisher-Yates copy. Does not mutate input. */
  shuffle<T>(xs: readonly T[]): T[];
  /** k distinct elements, in shuffled order. */
  sample<T>(xs: readonly T[], k: number): T[];
  /** Current internal state, for debugging instance generation. */
  state(): number;
}

/** mulberry32 — small, fast, well-distributed, and trivially reproducible. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: next,
    chance: (p) => next() < p,
    pick: (xs) => {
      if (xs.length === 0) throw new Error("rng.pick: empty array");
      return xs[Math.floor(next() * xs.length)]!;
    },
    shuffle: (xs) => {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
      }
      return out;
    },
    sample: (xs, k) => rng.shuffle(xs).slice(0, k),
    state: () => s,
  };

  return rng;
}

/** Deterministic shuffle driver for a fixed set of strings (used for option ordering). */
export function stableShuffle<T>(xs: readonly T[], seed: number): T[] {
  return makeRng(seed).shuffle(xs);
}
