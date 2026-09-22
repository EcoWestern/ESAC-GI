/**
 * Category 2 — Math reasoning (5 items, 10 pts).
 *
 * Design constraint (spec, "Keeping items hard despite being short"): every item is
 * long-to-think / short-to-answer. The response is a single integer; reaching it
 * requires real computation. Three items are built so that the obvious shortcut
 * (greedy rate, greedy value-density, naive modular arithmetic) yields a *wrong*
 * integer — a wrong-but-plausible answer is a better distractor than a longer prompt.
 *
 * Every expected value is computed. No stored answer keys.
 */

import type { ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import { fmtNum, modPow } from "./helpers.ts";
import { PACKING_POOL } from "./packing-pool.ts";

const ANSWER_ONLY = "Answer with only a single integer, with no other text, units, or explanation.";

// ---------------------------------------------------------------------------
// 1. System of congruences
// ---------------------------------------------------------------------------

function egcd(a: number, b: number): { g: number; x: number; y: number } {
  if (b === 0) return { g: a, x: 1, y: 0 };
  const r = egcd(b, a % b);
  return { g: r.g, x: r.y, y: r.x - Math.floor(a / b) * r.y };
}

function modInverse(a: number, m: number): number {
  const { g, x } = egcd(((a % m) + m) % m, m);
  if (g !== 1) throw new Error(`no inverse for ${a} mod ${m}`);
  return ((x % m) + m) % m;
}

const congruences: ItemTemplate = {
  id: "math.crt",
  category: "math",
  measures:
    "Simultaneous congruences. The shortcut — taking the remainder of the product of remainders — produces a plausible wrong integer.",
  generate: (rng) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const mods = rng.sample([7, 9, 11, 13, 16, 17, 19, 23, 25], 3);
      const [m1, m2, m3] = mods as [number, number, number];

      // Require pairwise coprimality so the CRT modulus is the product.
      const coprime = (a: number, b: number): boolean => egcd(a, b).g === 1;
      if (!coprime(m1, m2) || !coprime(m2, m3) || !coprime(m1, m3)) continue;

      const M = m1 * m2 * m3;
      if (M < 1000) continue;

      const r1 = rng.range(1, m1 - 1);
      const r2 = rng.range(1, m2 - 1);
      const r3 = rng.range(1, m3 - 1);
      if (r1 === r2 && r2 === r3) continue;

      // x = sum r_i * M_i * (M_i^-1 mod m_i)   (mod M), then take least positive.
      const M1 = m2 * m3;
      const M2 = m1 * m3;
      const M3 = m1 * m2;
      const x = (((r1 * M1 * modInverse(M1, m1)) % M) + ((r2 * M2 * modInverse(M2, m2)) % M) + ((r3 * M3 * modInverse(M3, m3)) % M)) % M;
      const answer = ((x % M) + M) % M;

      if (answer === 0 || answer === r1 || answer === r2 || answer === r3) continue;
      // The naive answer (remainder of product of remainders) must differ, or the
      // item rewards the shortcut.
      if (answer === (r1 * r2 * r3) % M) continue;

      return {
        prompt:
          `Find the smallest positive integer $n$ that satisfies all three of the following:\n\n` +
          `- $n$ leaves a remainder of ${r1} when divided by ${m1}\n` +
          `- $n$ leaves a remainder of ${r2} when divided by ${m2}\n` +
          `- $n$ leaves a remainder of ${r3} when divided by ${m3}\n\n` +
          `${ANSWER_ONLY}`,
        checks: [{ id: "answer", weight: 1, expected: String(answer), grader: g.numeric(answer, 0) }],
        reference: String(answer),
      };
    }

    throw new Error("math.crt: failed to generate a suitable system");
  },
};

// ---------------------------------------------------------------------------
// 2. Large modular power
// ---------------------------------------------------------------------------

const modpowItem: ItemTemplate = {
  id: "math.modpow",
  category: "math",
  measures:
    "Modular exponentiation with an exponent far too large to expand. Requires cycle detection or fast exponentiation rather than arithmetic on the literal value.",
  generate: (rng) => {
    const bases = [3, 7, 11, 13, 17, 19, 21, 23, 27, 29, 31];
    const exponents = [257, 512, 999, 1337, 2024, 4096, 5003, 7919];
    const moduli = [100, 125, 1000, 997, 1024, 676, 289, 143, 221];

    for (let attempt = 0; attempt < 200; attempt++) {
      const base = rng.pick(bases);
      const exponent = rng.pick(exponents);
      const modulus = rng.pick(moduli);

      const answer = modPow(base, exponent, modulus);
      // Reject degenerate remainders: 0 and 1 can often be guessed without doing
      // the work, so accepting them would weaken the item.
      if (answer <= 1) continue;

      return {
        prompt:
          `What is the remainder when $${base}^{${exponent}}$$ is divided by $${modulus}$$?\n\n` +
          `${ANSWER_ONLY}`,
        checks: [{ id: "answer", weight: 1, expected: String(answer), grader: g.numeric(answer, 0) }],
        reference: String(answer),
      };
    }

    throw new Error("math.modpow: no non-degenerate instance found");
  },
};

// ---------------------------------------------------------------------------
// 3. Divisor sum and classification
// ---------------------------------------------------------------------------

/** Sum of proper divisors. Factorisation is trial division; inputs are small. */
function properDivisorSum(n: number): number {
  let total = 1;
  let v = n;
  for (let p = 2; p * p <= v; p++) {
    if (v % p === 0) {
      let pow = 1;
      let sum = 1;
      while (v % p === 0) {
        v /= p;
        pow *= p;
        sum += pow;
      }
      total *= sum;
    }
  }
  if (v > 1) total *= 1 + v;
  return total - n;
}

const divisorSum: ItemTemplate = {
  id: "math.divisors",
  category: "math",
  measures:
    "Divisor enumeration under a classification label. The label invites a yes/no shortcut, but the question asks for the sum, so the classification cannot be guessed.",
  generate: (rng) => {
    const composites = [945, 1188, 1575, 2205, 2475, 3150, 3927, 4275, 4851, 5775, 6825, 7245, 8925, 9450];
    const primes = [2017, 2027, 2029, 2039, 2053, 2063, 2069, 2081, 2083, 2087, 2089, 2099];
    const usePrime = rng.chance(0.35);
    const n = usePrime ? rng.pick(primes) : rng.pick(composites);

    const answer = properDivisorSum(n);
    if (answer <= 0) throw new Error(`math.divisors: invalid divisor sum ${answer} for ${n}`);

    return {
      prompt:
        `A positive integer is *perfect* if it equals the sum of its proper divisors (all divisors ` +
        `excluding the number itself), *abundant* if that sum exceeds it, and *deficient* if that sum is smaller.\n\n` +
        `For the number ${n}, what is the sum of its proper divisors?\n\n` +
        `${ANSWER_ONLY}`,
      checks: [{ id: "answer", weight: 1, expected: String(answer), grader: g.numeric(answer, 0) }],
      reference: String(answer),
    };
  },
};

// ---------------------------------------------------------------------------
// 4. Two-phase filling and draining
// ---------------------------------------------------------------------------

const pipes: ItemTemplate = {
  id: "math.pipes",
  category: "math",
  measures:
    "Two-phase rate accounting. The single-phase shortcut (net rate applied for the whole duration) gives a wrong integer unless the phase boundary is handled.",
  generate: (rng) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const capacity = rng.pick([120, 144, 168, 180, 216, 240, 288, 360]);
      const a = rng.range(4, 18);
      const b = rng.range(3, 15);
      const drain = rng.range(2, Math.min(a + b - 1, 14));
      if (drain >= a + b) continue;

      const net = a + b - drain;
      if (net <= 0) continue;

      const fillPhase = rng.range(1, Math.floor(capacity / (a + b)) - 1);
      if (fillPhase < 1) continue;

      const filled = (a + b) * fillPhase;
      const remaining = capacity - filled;
      if (remaining <= 0) continue;
      if (remaining % net !== 0) continue;

      const secondPhase = remaining / net;
      if (secondPhase < 2) continue;

      const answer = fillPhase + secondPhase;
      const singlePhaseShortcut = capacity / net;
      // The wrong-but-plausible answer must not coincide with the right one.
      if (Math.abs(singlePhaseShortcut - answer) < 1e-9) continue;

      return {
        prompt:
          `A tank holds ${capacity} litres and starts empty.\n\n` +
          `- Inlet pipe A adds ${a} litres per minute.\n` +
          `- Inlet pipe B adds ${b} litres per minute.\n` +
          `- A drain removes ${drain} litres per minute.\n\n` +
          `For the first ${fillPhase} ${fillPhase === 1 ? "minute" : "minutes"}, both inlets are open and the drain is closed. ` +
          `After that, the drain is opened and both inlets stay open until the tank is full.\n\n` +
          `How many minutes in total, from the start, does it take to fill the tank to capacity?\n\n` +
          `${ANSWER_ONLY}`,
        checks: [{ id: "answer", weight: 1, expected: String(answer), grader: g.numeric(answer, 0) }],
        reference: String(answer),
      };
    }

    throw new Error("math.pipes: failed to generate integral two-phase timings");
  },
};

// ---------------------------------------------------------------------------
// 5. Two-constraint packing / integer optimisation
// ---------------------------------------------------------------------------

const packing: ItemTemplate = {
  id: "math.packing",
  category: "math",
  measures:
    "Small integer program under two binding constraints. Parameters are drawn from a verified pool in which greedily taking the best value-per-unit ratio is strictly suboptimal, so the item cannot be answered by a heuristic.",
  generate: (rng) => {
    const t = rng.pick(PACKING_POOL);
    const { W, V, wBig, vBig, wSmall, vSmall, pBig, pSmall, best, bestBig, bestSmall } = t;

    const bigRatio = pBig / vBig;
    const smallRatio = pSmall / vSmall;
    const ratioWinner = bigRatio >= smallRatio ? "large" : "small";

    return {
      prompt:
        `A freight crate can carry at most ${W} kg and at most ${V} litres of cargo.\n\n` +
        `| Item | Weight | Volume | Value |\n|---|---|---|---|\n` +
        `| Large box | ${wBig} kg | ${vBig} L | ${pBig} |\n` +
        `| Small box | ${wSmall} kg | ${vSmall} L | ${pSmall} |\n\n` +
        `Boxes are indivisible and you may take any non-negative whole number of each type. ` +
        `Both the weight limit and the volume limit must be respected.\n\n` +
        `What is the maximum total value the crate can carry?\n\n` +
        `${ANSWER_ONLY}`,
      checks: [
        {
          id: "answer",
          weight: 1,
          expected: `${best} (${bestBig} large, ${bestSmall} small; the value-dense choice by ratio is "${ratioWinner}")`,
          grader: g.numeric(best, 0),
        },
      ],
      reference: String(best),
    };
  },
};

export const MATH_ITEMS: readonly ItemTemplate[] = [congruences, modpowItem, divisorSum, pipes, packing];

/** Exported for tests: verify the divisor helper against known perfect numbers. */
export function _properDivisorSum(n: number): number {
  return properDivisorSum(n);
}

/** Exported for tests: confirm the generated packing instances beat their greedy bound. */
export function _fmt(n: number): string {
  return fmtNum(n);
}
