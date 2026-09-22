/**
 * Deterministic grading.
 *
 * Everything here must satisfy tenet 2: no model judgment, no heuristics that
 * drift, no locale dependence. Graders accept free-form model output, so each one
 * has to be robust to the ways a correct answer commonly arrives wrapped
 * ("**7**", "Answer: 7", "7.") without becoming so lenient that a wrong answer
 * slips through.
 */

import type { Check, CheckResult, Grader, NormMode, ProgrammaticCheck, Rubric } from "./types.ts";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Strip common markdown and label wrappers that are not part of the answer. */
export function stripAnswerDecorations(text: string): string {
  let s = text.normalize("NFKC").trim();
  // Drop a leading "Answer:" / "Final answer:" style label.
  s = s.replace(/^\s*(?:\*\*)?\s*(?:final\s+)?answer\s*(?:\*\*)?\s*[:=—-]\s*/i, "");
  // Drop a trailing parenthetical that merely repeats the working.
  s = s.replace(/\s*\((?:approximately|approx\.?|rounded[^)]*)\)\s*$/i, "");
  // Unwrap bold/italic/code fences around a short answer.
  s = s.replace(/^\*\*(.+)\*\*$/s, "$1");
  s = s.replace(/^\*(.+)\*$/s, "$1");
  s = s.replace(/^`(.+)`$/s, "$1");
  // Trailing sentence punctuation on an otherwise bare answer.
  s = s.replace(/[.\s]+$/, "");
  return s.trim();
}

export function normalize(text: string, mode: NormMode = "answer"): string {
  const s = text.normalize("NFKC");
  if (mode === "strict") return s;
  const t = s.trim().replace(/\s+/g, " ");
  if (mode === "trim") return t;
  return stripAnswerDecorations(t).toLowerCase();
}

/**
 * Extract the last numeric literal from a response, ignoring numbers that are
 * plainly part of the working rather than the conclusion.
 *
 * Deliberately biased toward the *final* number mentioned, because "short-to-answer"
 * items are designed so the answer is the last thing stated. Prefers an explicit
 * `answer:` marker when one is present.
 */
export function extractNumber(text: string): number | null {
  const cleaned = stripAnswerDecorations(text);

  const labelled = /(?:answer|result|total|equals|is)\s*[:=]?\s*(-?[\d,]*\d(?:\.\d+)?)/i.exec(cleaned);
  if (labelled?.[1]) {
    const n = parseNumericLiteral(labelled[1]);
    if (n !== null) return n;
  }

  const bare = cleaned.match(/-?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!bare || bare.length === 0) return null;
  // Walk backwards: the conclusion is nearly always the last number written.
  for (let i = bare.length - 1; i >= 0; i--) {
    const n = parseNumericLiteral(bare[i]!);
    if (n !== null) return n;
  }
  return null;
}

export function parseNumericLiteral(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull a single letter choice (A–J) out of a response, if it clearly contains one.
 *
 * Extraction is deliberately conservative. A speculative "find any standalone A–J
 * letter in the prose" scan is unsafe here for two reasons that both produce points
 * the model did not earn:
 *
 *   - the pronoun "I" and the article "A" appear in ordinary text, and both are
 *     valid option letters; and
 *   - several items have options that literally begin with a letter word
 *     ("A knight", "A knave"), so scanning option text yields a false match.
 *
 * The recognised forms are therefore limited to an explicit answer cue, a response
 * that is nothing but a letter, and a letter terminating a short response.
 */
export function extractChoice(text: string, options: readonly string[]): string | null {
  const letters = options.map((_, i) => String.fromCharCode(65 + i));
  const cleaned = stripAnswerDecorations(text);

  const accept = (candidate: string | undefined): string | null => {
    if (!candidate) return null;
    const letter = candidate.toUpperCase();
    return letters.includes(letter) ? letter : null;
  };

  // 1. Explicit cue: "answer: B", "the correct option is (C)", "Choice D".
  const cued =
    /(?:answer|choice|option|select(?:ed)?)\s*(?:is|was)?\s*[:=\-–—(]*\s*\(?([A-J])\b/i.exec(cleaned) ??
    /\b(?:it'?s|it is)\s*\(?([A-J])\b/i.exec(cleaned);
  const fromCue = accept(cued?.[1]);
  if (fromCue) return fromCue;

  // 2. A response consisting only of a letter, optionally bracketed or punctuated.
  const fromBare = accept(/^\s*\(?([A-J])\)?\s*[.):]?\s*$/.exec(cleaned)?.[1]);
  if (fromBare) return fromBare;

  // 3. A letter terminating a short response: "The answer is B", "I would pick D."
  //    Length-limited so that a long explanation is never mined for a stray letter.
  const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount <= 12) {
    const fromTail = accept(/\b([A-J])[.)]?\s*$/.exec(cleaned)?.[1]);
    if (fromTail) return fromTail;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Graders
// ---------------------------------------------------------------------------

/** Apply one grader to a response, returning a fraction in [0, 1]. */
export function applyGrader(grader: Grader, response: string): { fraction: number; detail: string } {
  switch (grader.type) {
    case "exact": {
      const got = normalize(response, grader.normalize ?? "answer");
      const ok = grader.accept.some((a) => normalize(a, grader.normalize ?? "answer") === got);
      return {
        fraction: ok ? 1 : 0,
        detail: ok
          ? `matched accepted answer`
          : `expected one of [${grader.accept.slice(0, 4).join(" | ")}${grader.accept.length > 4 ? " | …" : ""}], got "${truncate(got, 80)}"`,
      };
    }

    case "numeric": {
      const n = extractNumber(response);
      if (n === null) return { fraction: 0, detail: "no numeric value found in response" };
      const ok = Math.abs(n - grader.value) <= grader.tolerance;
      return {
        fraction: ok ? 1 : 0,
        detail: ok
          ? `${n} within ±${grader.tolerance} of ${grader.value}`
          : `got ${n}, expected ${grader.value} ±${grader.tolerance}`,
      };
    }

    case "regex": {
      const re = new RegExp(grader.pattern, grader.flags ?? "is");
      const ok = re.test(response);
      if (!ok) return { fraction: 0, detail: `no match for /${grader.pattern}/` };
      for (const bad of grader.mustNotMatch ?? []) {
        if (new RegExp(bad, grader.flags ?? "is").test(response)) {
          return { fraction: 0, detail: `matched forbidden pattern /${bad}/` };
        }
      }
      return { fraction: 1, detail: `matched /${grader.pattern}/` };
    }

    case "contains": {
      const body = grader.caseSensitive ? response : response.toLowerCase();
      const to = (s: string): string => (grader.caseSensitive ? s : s.toLowerCase());

      const missing = (grader.all ?? []).filter((s) => !body.includes(to(s)));
      if (missing.length > 0) {
        return { fraction: 0, detail: `missing required text: ${missing.map((m) => JSON.stringify(m)).join(", ")}` };
      }

      const any = grader.any ?? [];
      if (any.length > 0 && !any.some((s) => body.includes(to(s)))) {
        return { fraction: 0, detail: `none of the accepted phrasings present: ${any.map((a) => JSON.stringify(a)).join(", ")}` };
      }

      const forbidden = (grader.none ?? []).filter((s) => body.includes(to(s)));
      if (forbidden.length > 0) {
        return { fraction: 0, detail: `contains forbidden text: ${forbidden.map((f) => JSON.stringify(f)).join(", ")}` };
      }

      return { fraction: 1, detail: "required text present, forbidden text absent" };
    }

    case "programmatic": {
      const fraction = clamp01(grader.check.run(response));
      return { fraction, detail: `${grader.check.description} → ${(fraction * 100).toFixed(0)}%` };
    }

    case "judge": {
      // Judge grading is applied later by the runner; deterministic pass is a no-op.
      throw new Error("judge grader cannot be applied deterministically");
    }
  }
}

// ---------------------------------------------------------------------------
// Check-level scoring
// ---------------------------------------------------------------------------

/**
 * Grade an item's checks. Weights are normalised, so an item's checks may be
 * written in any convenient scale.
 */
export function gradeChecks(checks: readonly Check[], response: string): {
  fraction: number;
  results: CheckResult[];
} {
  const deterministic = checks.filter((c) => c.grader.type !== "judge");
  if (deterministic.length === 0) return { fraction: 0, results: [] };

  const totalWeight = deterministic.reduce((n, c) => n + c.weight, 0);
  if (totalWeight <= 0) throw new Error("check weights must sum to a positive value");

  const results: CheckResult[] = [];
  let awarded = 0;

  for (const check of deterministic) {
    const { fraction, detail } = applyGrader(check.grader, response);
    awarded += fraction * check.weight;
    results.push({ checkId: check.id, graderType: check.grader.type, fraction, detail });
  }

  return { fraction: clamp01(awarded / totalWeight), results };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Convenience constructors, so item files stay readable. */
export const g = {
  exact: (accept: string | readonly string[], normalize?: NormMode): Grader => ({
    type: "exact",
    accept: typeof accept === "string" ? [accept] : accept,
    ...(normalize ? { normalize } : {}),
  }),
  numeric: (value: number, tolerance = 1e-6): Grader => ({ type: "numeric", value, tolerance }),
  regex: (pattern: string, opts?: { flags?: string; mustNotMatch?: readonly string[] }): Grader => ({
    type: "regex",
    pattern,
    ...(opts?.flags ? { flags: opts.flags } : {}),
    ...(opts?.mustNotMatch ? { mustNotMatch: opts.mustNotMatch } : {}),
  }),
  contains: (spec: { all?: readonly string[]; any?: readonly string[]; none?: readonly string[]; caseSensitive?: boolean }): Grader => ({
    type: "contains",
    ...spec,
  }),
  programmatic: (description: string, run: ProgrammaticCheck["run"]): Grader => ({
    type: "programmatic",
    check: { description, run },
  }),
  judge: (rubric: Rubric): Grader => ({ type: "judge", rubric }),
};
