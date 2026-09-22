/**
 * Shared helpers for ESAC-GI item templates.
 *
 * Every helper here must be pure and deterministic. Item generation is the
 * contamination-resistance mechanism (resolution 4), so nondeterminism in a
 * generator is a correctness bug, not a style issue.
 */

import type { Rng } from "../rng.ts";
import { fingerprint } from "../rng.ts";
import type { Check } from "../types.ts";
import { extractChoice, g } from "../graders.ts";

/** Instance fingerprint. Recorded in run output so instances are provable. */
export function fp(parts: readonly (string | number)[]): string {
  return fingerprint(parts);
}

/** Grade a multiple-choice item by the letter the model settled on. */
export function optionCheck(options: readonly string[], answer: string, id = "choice"): Check {
  return {
    id,
    weight: 1,
    expected: answer,
    grader: g.programmatic(`selects option ${answer}`, (r) => (extractChoice(r, options) === answer ? 1 : 0)),
  };
}

/**
 * Deterministically shuffle a correct answer among distractors and render the block.
 *
 * Duplicate and missing distractors are a correctness problem, not a cosmetic one:
 * two identical options make the item ambiguous, and a distractor equal to the
 * correct answer makes it unanswerable. Distractors are therefore de-duplicated
 * against the correct answer and each other, and the option count is allowed to
 * fall below the requested number rather than being padded with a duplicate.
 */
export function buildOptions(
  rng: Rng,
  correct: string,
  distractors: readonly string[],
  expectedCount = 4,
): { block: string; answer: string; options: string[] } {
  const seen = new Set([correct.trim().toLowerCase()]);
  const unique: string[] = [];

  for (const candidate of distractors) {
    const key = candidate.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  if (unique.length < expectedCount - 1) {
    throw new Error(
      `buildOptions: need ${expectedCount - 1} distinct distractors, got ${unique.length} ` +
        `for correct answer "${correct}"`,
    );
  }

  const options = rng.shuffle([correct, ...unique.slice(0, expectedCount - 1)]);
  const block = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  const answer = String.fromCharCode(65 + options.indexOf(correct));
  return { block, answer, options };
}

/**
 * Same as `buildOptions`, but draws exactly `count - 1` distinct distractors from a
 * pool and returns null when the pool cannot supply them. Use this where the pool is
 * small or randomly sampled, so the generator can retry instead of throwing.
 */
export function tryBuildOptions(
  rng: Rng,
  correct: string,
  pool: readonly string[],
  count = 4,
): { block: string; answer: string; options: string[] } | null {
  const key = (s: string): string => s.trim().toLowerCase();
  const distinct = [...new Set(pool.filter((p) => key(p) !== key(correct)))];
  if (distinct.length < count - 1) return null;
  const options = rng.shuffle([correct, ...rng.sample(distinct, count - 1)]);
  const block = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  return { block, answer: String.fromCharCode(65 + options.indexOf(correct)), options };
}

/** Last non-empty line. Used where the prompt asks for a bare answer line. */
export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 ? lines[lines.length - 1]! : "";
}

/** All pool names appearing in `text`, ordered by first mention. */
export function extractNamesInOrder(text: string, pool: readonly string[]): string[] {
  const hits: { name: string; idx: number }[] = [];
  for (const name of pool) {
    const m = new RegExp(`\\b${escapeRe(name)}\\b`, "gi").exec(text);
    if (m) hits.push({ name, idx: m.index });
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits.map((h) => h.name);
}

/**
 * Names on the final line only. Paired with "answer with only ..." instructions,
 * which makes this robust against explanations that mention every candidate.
 */
export function extractNamesFromLastLine(text: string, pool: readonly string[]): string[] {
  const line = lastLine(text);
  const mentioned = extractNamesInOrder(line, pool);
  if (mentioned.length === 0 && /\bnone\b/i.test(line)) return [];
  return mentioned;
}

/** All permutations. Inputs are kept small; used for exhaustive puzzle verification. */
export function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i++) {
    const rest = xs.slice(0, i).concat(xs.slice(i + 1));
    for (const p of permutations(rest)) out.push([xs[i]!, ...p]);
  }
  return out;
}

export function popcount(n: number): number {
  let c = 0;
  let v = n;
  while (v > 0) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

/** Trim meaningless float noise from numbers printed into prompts. */
export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Modular exponentiation. Required for the last-two-digits item. */
export function modPow(base: number, exp: number, mod: number): number {
  let result = 1;
  let b = base % mod;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>>= 1;
  }
  return result;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
