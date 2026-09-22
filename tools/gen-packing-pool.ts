/**
 * Offline generator for the packing item's parameter pool.
 *
 * Run with: node --experimental-strip-types tools/gen-packing-pool.ts
 *
 * The packing item needs parameters where greedy-by-value-density is strictly
 * suboptimal, which is what makes it require actual optimisation rather than a
 * heuristic. Searching for such parameters at instantiation time is slow and can
 * fail to converge, so the search is done once here and the verified results are
 * embedded in the item file. `tests/all.test.ts` re-verifies every embedded tuple,
 * so a hand-edit that breaks the property fails the suite rather than shipping.
 */

interface Tuple {
  readonly W: number;
  readonly V: number;
  readonly wBig: number;
  readonly vBig: number;
  readonly wSmall: number;
  readonly vSmall: number;
  readonly pBig: number;
  readonly pSmall: number;
  readonly best: number;
  readonly bestBig: number;
  readonly bestSmall: number;
  readonly greedy: number;
}

function solve(t: Omit<Tuple, "best" | "bestBig" | "bestSmall" | "greedy">): Tuple | null {
  let best = -1;
  let bestBig = 0;
  let bestSmall = 0;

  for (let nBig = 0; nBig * t.wBig <= t.W; nBig++) {
    for (let nSmall = 0; nBig * t.wBig + nSmall * t.wSmall <= t.W; nSmall++) {
      if (nBig * t.vBig + nSmall * t.vSmall > t.V) continue;
      const value = nBig * t.pBig + nSmall * t.pSmall;
      if (value > best) {
        best = value;
        bestBig = nBig;
        bestSmall = nSmall;
      }
    }
  }
  if (best <= 0) return null;

  // Both greedy orderings: fill the better ratio first, then the other.
  const greedyFor = (first: "big" | "small"): number => {
    const [a, b] = first === "big"
      ? [{ w: t.wBig, v: t.vBig, p: t.pBig }, { w: t.wSmall, v: t.vSmall, p: t.pSmall }]
      : [{ w: t.wSmall, v: t.vSmall, p: t.pSmall }, { w: t.wBig, v: t.vBig, p: t.pBig }];
    const nA = Math.min(Math.floor(t.W / a.w), Math.floor(t.V / a.v));
    const remW = t.W - nA * a.w;
    const remV = t.V - nA * a.v;
    const nB = Math.min(Math.floor(remW / b.w), Math.floor(remV / b.v));
    return nA * a.p + nB * b.p;
  };

  const greedy = Math.max(greedyFor("big"), greedyFor("small"));
  return { ...t, best, bestBig, bestSmall, greedy };
}

const valid: Tuple[] = [];

for (let W = 30; W <= 70; W += 2) {
  for (let V = 30; V <= 70; V += 2) {
    for (let wBig = 6; wBig <= 11; wBig++) {
      for (let vBig = 6; vBig <= 11; vBig++) {
        for (let wSmall = 3; wSmall <= 6; wSmall++) {
          for (let vSmall = 3; vSmall <= 6; vSmall++) {
            if (wBig <= wSmall || vBig <= vSmall) continue;
            for (let pBig = 12; pBig <= 25; pBig++) {
              for (let pSmall = 4; pSmall <= 11; pSmall++) {
                const solved = solve({ W, V, wBig, vBig, wSmall, vSmall, pBig, pSmall });
                if (!solved) continue;

                // Require: greedy strictly worse, both types used, uniquely optimal.
                if (solved.greedy >= solved.best) continue;
                if (solved.bestBig === 0 || solved.bestSmall === 0) continue;

                let optimalCount = 0;
                for (let nBig = 0; nBig * wBig <= W; nBig++) {
                  for (let nSmall = 0; nBig * wBig + nSmall * wSmall <= W; nSmall++) {
                    if (nBig * vBig + nSmall * vSmall > V) continue;
                    if (nBig * pBig + nSmall * pSmall === solved.best) optimalCount++;
                  }
                }
                if (optimalCount !== 1) continue;

                // Keep the gap meaningful so the wrong answer is not adjacent.
                if (solved.best - solved.greedy < 2) continue;

                valid.push(solved);
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Sample evenly across the whole space rather than taking the first N found.
 * Ordered search clusters on the lowest weight/volume pair, which would make every
 * instance of the item look the same.
 */
const TARGET = 200;
const stride = Math.max(1, Math.floor(valid.length / TARGET));
const sampled: Tuple[] = [];
for (let i = 0; i < valid.length && sampled.length < TARGET; i += stride) {
  sampled.push(valid[i]!);
}

console.error(`// scanned space: ${valid.length} valid tuples, sampled ${sampled.length} at stride ${stride}`);
console.log(`// ${sampled.length} verified tuples (greedy strictly suboptimal, unique optimum)`);
console.log("export const PACKING_POOL = [");
for (const t of sampled) {
  console.log(
    `  { W: ${t.W}, V: ${t.V}, wBig: ${t.wBig}, vBig: ${t.vBig}, wSmall: ${t.wSmall}, ` +
      `vSmall: ${t.vSmall}, pBig: ${t.pBig}, pSmall: ${t.pSmall}, ` +
      `best: ${t.best}, bestBig: ${t.bestBig}, bestSmall: ${t.bestSmall}, greedy: ${t.greedy} },`,
  );
}
console.log("] as const;");
