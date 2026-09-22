/**
 * Judge prompt construction, response parsing, and rubric normalisation.
 *
 * Design constraints from the spec:
 * - Tenet 3: the judge must be open-weight and self-hostable, and version-pinned
 *   per release. A rubric score that silently drifts because the judge model was
 *   updated upstream is a reproducibility failure, so rubrics are versioned by id
 *   and the judge model identity is recorded in every run.
 * - Resolution 5: judge-graded items run the model twice and judge each response
 *   twice, averaging the four observations. Nothing in this file assumes a single
 *   observation.
 *
 * Parsing is deliberately tolerant of formatting but strict about content: a judge
 * that returns prose instead of parseable scores produces an infrastructure error
 * (retried, never scored), rather than a silent zero.
 */

import type { JudgeResponse, Rubric, RubricCriterion } from "./types.ts";
import { clamp01 } from "./graders.ts";

export const JUDGE_SCORE_MAX = 4;

/** Render the full judge prompt. Kept deterministic and free of run-specific data. */
export function renderJudgePrompt(rubric: Rubric, taskPrompt: string, response: string): string {
  const criteria = rubric.criteria
    .map((c, i) => {
      const levels = (c.levels ?? [])
        .map((l) => `    - ${l.score}: ${l.label} — ${l.description}`)
        .join("\n");
      return (
        `${i + 1}. id: ${c.id} (weight ${c.weight}, scored 0-${JUDGE_SCORE_MAX})\n` +
        `   ${c.description}\n` +
        (levels ? `${levels}\n` : "")
      );
    })
    .join("\n");

  return (
    `You are scoring a single response against a fixed rubric. You are not the author of the ` +
    `response and you must not rewrite it.\n\n` +
    `## What the task was asking for\n\n${rubric.context}\n\n` +
    `## The task given to the model\n\n${taskPrompt}\n\n` +
    `## The model's response\n\n<<<RESPONSE\n${response}\nRESPONSE>>>\n\n` +
    `## Rubric\n\n${criteria}\n` +
    `## Output format\n\n` +
    `Return only a JSON object mapping each criterion id to an integer score from 0 to ` +
    `${JUDGE_SCORE_MAX}. Use the exact criterion ids given above. Example shape:\n` +
    `{"${rubric.criteria[0]?.id ?? "criterion"}": 3}\n\n` +
    `Do not include any other text, explanation, or markdown fence.`
  );
}

/**
 * Parse the judge's output into criterion scores.
 *
 * Accepts a bare JSON object, a fenced JSON block, or a JSON object embedded in a
 * sentence, because small open-weight models are inconsistent about this and a
 * formatting quirk should not invalidate an otherwise usable judgment.
 *
 * Returns null when no usable object can be recovered — the caller treats that as an
 * infrastructure failure.
 */
export function parseJudgeResponse(raw: string, rubric: Rubric): JudgeResponse | null {
  const text = raw.trim();
  const candidates: string[] = [];

  // Bare object.
  candidates.push(text);

  // Fenced block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // First balanced-looking brace span.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    const parsed = tryParseObject(candidate);
    if (!parsed) continue;

    const scores = coerceScores(parsed, rubric);
    if (scores) return { scores, raw };
  }

  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function coerceScores(
  parsed: Readonly<Record<string, unknown>>,
  rubric: Rubric,
): Record<string, number> | null {
  const out: Record<string, number> = {};

  for (const criterion of rubric.criteria) {
    const found = findScore(parsed, criterion);
    if (found === null) return null;
    out[criterion.id] = clamp(found, 0, JUDGE_SCORE_MAX);
  }

  return out;
}

/** Tolerate case, separators, and the common `{id: {score: n}}` nesting. */
function findScore(parsed: Readonly<Record<string, unknown>>, criterion: RubricCriterion): number | null {
  const target = criterion.id.toLowerCase();

  const directKeys = Object.keys(parsed);
  const match = directKeys.find((k) => normaliseKey(k) === normaliseKey(criterion.id));
  if (match !== undefined) {
    const n = toNumber(parsed[match]);
    if (n !== null) return n;
  }

  // Nested shape, e.g. {"criterion": {"score": 3}}.
  if (match !== undefined) {
    const nested = parsed[match];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = nested as Record<string, unknown>;
      const n = toNumber(inner["score"] ?? inner["value"] ?? inner["rating"]);
      if (n !== null) return n;
    }
  }

  // Fall back to a substring match, guarded against matching a different criterion.
  const fuzzy = directKeys.filter((k) => normaliseKey(k).includes(target));
  if (fuzzy.length === 1) {
    const n = toNumber(parsed[fuzzy[0]!]);
    if (n !== null) return n;
  }

  return null;
}

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Normalise criterion scores to a fraction in [0, 1].
 *
 * Weights are normalised here rather than by the judge, so a rubric can be edited
 * without the judge needing to reason about relative importance.
 */
export function scoreRubric(scores: Readonly<Record<string, number>>, rubric: Rubric): number {
  const totalWeight = rubric.criteria.reduce((n, c) => n + c.weight, 0);
  if (totalWeight <= 0) throw new Error(`rubric ${rubric.id} has no positive weights`);

  let awarded = 0;
  for (const criterion of rubric.criteria) {
    const raw = scores[criterion.id];
    if (raw === undefined) throw new Error(`rubric ${rubric.id}: missing score for ${criterion.id}`);
    awarded += (clamp(raw, 0, JUDGE_SCORE_MAX) / JUDGE_SCORE_MAX) * criterion.weight;
  }

  return clamp01(awarded / totalWeight);
}

/**
 * Mean of several observations of the same item.
 *
 * Averaging is the correct combiner because every criterion here is on an ordinal
 * 0-4 scale, not pass/fail (resolution 5).
 */
export function meanFraction(fractions: readonly number[]): number {
  if (fractions.length === 0) return 0;
  return fractions.reduce((a, b) => a + b, 0) / fractions.length;
}
