/**
 * Scoring and reporting.
 *
 * Two rules from the amendment that are easy to get backwards, and are therefore
 * spelled out here rather than left implicit:
 *
 * 1. **The total is always reported out of 75.** ESAC-GI has no efficiency modifier
 *    (that is ESAC-AG), so 75 is both the reported denominator and the pass basis.
 *    The 70-vs-75 distinction in resolution 10 applies to the agentic suite only.
 *
 * 2. **Passing requires both the overall threshold and every category threshold.**
 *    Eight independent category gates make this materially stricter than "60%
 *    overall" sounds, and that is intentional. A category that scored 60% of its
 *    points does not fail; one that scored 59% does.
 */

import { CATEGORIES, JUDGE_GRADED_POINTS, TOTAL_ITEMS, TOTAL_POINTS } from "./categories.ts";
import { itemPoints } from "./registry.ts";
import { ITEMS_BY_ID } from "./registry.ts";
import { PASS_THRESHOLD, ESAC_SUITE, ESAC_VERSION, ESAC_VERSION_TAG, ESAC_FULL_NAME, OUTPUT_LIMITS } from "./version.ts";
import type { CategoryId, CategoryScore, ItemRunResult, RunReport, Split, Verdict } from "./types.ts";
import { seedFingerprint } from "./registry.ts";

export interface ScoreInput {
  readonly items: readonly ItemRunResult[];
  readonly split: Split;
  readonly datasetSeed: string;
  readonly model: string;
  readonly judge: string | null;
  /** Whether the judge used was the model pinned for this release. */
  readonly judgePinned: boolean;
  /**
   * Output cap used for the model under test. Omit to mean the benchmark's own limit,
   * which is what every run uses unless the caller overrode it.
   */
  readonly maxTokens?: number;
  readonly startedAt: string;
  readonly durationMs: number;
}

/**
 * Threshold comparison tolerance.
 *
 * Item points are fractional (a 5-point category split across four items and a
 * half-weight boundary item produces values like 1.111...), so a category that
 * mathematically scores exactly 60% can accumulate to 0.5999999 in binary floating
 * point. Without this tolerance a model sitting exactly on the threshold would fail
 * on rounding. The tolerance is far smaller than any meaningful scoring increment.
 */
const THRESHOLD_EPSILON = 1e-9;

function meetsThreshold(value: number, threshold: number): boolean {
  return value >= threshold - THRESHOLD_EPSILON;
}

export function scoreRun(input: ScoreInput): RunReport {
  // Attach point values. Item weights live on the templates, not on the run result,
  // so they are resolved here rather than carried through the runner.
  const scored = input.items.map((result) => {
    const template = ITEMS_BY_ID.get(result.itemId);
    const points = template ? itemPoints(template) : 0;
    return { ...result, points, awarded: result.fraction * points };
  });

  const categories: CategoryScore[] = CATEGORIES.map((def) => {
    const inCategory = scored.filter((r) => r.category === def.id);
    const awarded = inCategory.reduce((n, r) => n + r.awarded, 0);
    // Denominator is the category's declared allocation, not the sum of items that
    // happened to run. A category that is short of items still scores against its
    // full allocation, so a missing item cannot silently inflate a percentage.
    const normalized = def.points > 0 ? awarded / def.points : 0;
    return {
      id: def.id,
      name: def.name,
      points: def.points,
      awarded: round(awarded),
      normalized,
      itemCount: inCategory.length,
      judgeGraded: def.grading === "judge",
      // A category with no items in the run was not attempted, so it is neither
      // passed nor failed. Treating "not run" as "failed" would make a subset run
      // (and any filtered comparison) report a spurious failure.
      passed: inCategory.length === 0 ? true : meetsThreshold(normalized, PASS_THRESHOLD.perCategory),
    };
  });

  const total = round(scored.reduce((n, r) => n + r.awarded, 0));
  const attemptedPoints = categories
    .filter((c) => c.itemCount > 0)
    .reduce((n, c) => n + c.points, 0);
  const normalized = total / TOTAL_POINTS;
  const failedCategories = categories
    .filter((c) => c.itemCount > 0 && !c.passed)
    .map((c) => c.id as CategoryId);
  const anyRan = scored.length > 0;
  const partial = attemptedPoints < TOTAL_POINTS;
  const passedArithmetically =
    anyRan &&
    meetsThreshold(normalized, PASS_THRESHOLD.overall) &&
    failedCategories.length === 0;

  // A judge that is not the pinned one changes 15 of the 75 points and decides a whole
  // category, so the result is not an ESAC-GI score and gets no verdict either way. The
  // oracle judge is exempt: it is the harness exercising itself, not a substituted
  // instrument, and the self-test depends on it reaching a pass.
  const judgeIsHarness = input.judge !== null && input.judge.startsWith("oracle");
  const judgeSubstituted =
    input.judge !== null && !input.judgePinned && !judgeIsHarness;

  const verdict: Verdict = judgeSubstituted
    ? "not-valid"
    : !anyRan || partial
      ? "incomplete"
      : passedArithmetically
        ? "pass"
        : "fail";

  return {
    suite: ESAC_SUITE,
    version: ESAC_VERSION,
    versionTag: ESAC_VERSION_TAG,
    fullName: ESAC_FULL_NAME,
    split: input.split,
    datasetSeedFingerprint: seedFingerprint(input.datasetSeed),
    model: input.model,
    judge: input.judge,
    judgePinned: input.judgePinned,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    categories,
    total,
    totalPossible: TOTAL_POINTS,
    attemptedPoints: round(attemptedPoints),
    normalized,
    passed: verdict === "pass",
    verdict,
    failedCategories,
    judgeGradedPoints: JUDGE_GRADED_POINTS,
    maxTokens: input.maxTokens ?? OUTPUT_LIMITS.modelTokens,
    items: scored,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A fixed-width fraction bar, shared by the text renderers. */
function bar(fraction: number, width = 24): string {
  // Clamped, because a renderer should never be the thing that fails. A fraction above
  // 1 can only come from a scoring bug, and throwing here would hide the number that
  // explains it.
  const capped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(capped * width);
  return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
}

/** The one-word status shown next to a score, in both text renderers. */
const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  pass: "PASS",
  fail: "FAIL",
  incomplete: "INCOMPLETE",
  "not-valid": "NOT VALID",
};

/** Plain-text report. Deliberately readable in a terminal and in a commit message. */
export function renderReport(report: RunReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`${report.fullName}`);
  lines.push(`${report.versionTag}  ·  split: ${report.split}  ·  model: ${report.model}`);
  if (report.judge) {
    const status = report.judge.startsWith("oracle")
      ? "harness self-test"
      : report.judgePinned
        ? "pinned"
        : "not the pinned judge";
    lines.push(`judge: ${report.judge} (${status})`);
  }
  lines.push("");

  const partial = report.attemptedPoints < report.totalPossible;
  lines.push(
    `SCORE   ${report.total.toFixed(2)} / ${report.totalPossible}   (${(report.normalized * 100).toFixed(1)}%)`,
  );
  if (partial) {
    lines.push(
      `        NOTE: partial run. Only ${report.attemptedPoints.toFixed(2)} of ` +
        `${report.totalPossible} points were attempted, so the percentage above is against the ` +
        `full suite and is not a comparable score.`,
    );
  }
  lines.push(`RESULT  ${VERDICT_LABEL[report.verdict]}`);
  if (report.verdict === "not-valid") {
    lines.push(
      "        The judge was not the judge pinned for this release, so no verdict is reported.",
    );
  }
  lines.push("");

  lines.push("CATEGORY BREAKDOWN");
  for (const category of report.categories) {
    const name = category.name.padEnd(34).slice(0, 34);
    if (category.itemCount === 0) {
      lines.push(`    ${name} ${"not run".padStart(9)}`);
      continue;
    }
    const raw = `${category.awarded.toFixed(2)}/${category.points}`.padStart(9);
    const pct = `${(category.normalized * 100).toFixed(1)}%`.padStart(7);
    const flag = category.passed ? " " : "!";
    lines.push(`  ${flag} ${name} ${raw} ${pct}  ${bar(category.normalized)}`);
  }
  lines.push("");
  lines.push(`  ! = below the ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% category threshold`);

  if (report.failedCategories.length > 0) {
    lines.push("");
    lines.push(`  Failed categories: ${report.failedCategories.join(", ")}`);
  }

  lines.push("");
  lines.push(
    `Judge-graded share: ${report.judgeGradedPoints}/${report.totalPossible} points ` +
      `(${((report.judgeGradedPoints / report.totalPossible) * 100).toFixed(0)}%)`,
  );

  const truncated = report.items.filter((i) => i.truncated).length;
  if (truncated > 0) {
    lines.push(
      `Output cap reached before answering on ${truncated} item(s). ` +
        "Raise --max-tokens if the model needs more room to reason.",
    );
  }

  if (report.maxTokens !== OUTPUT_LIMITS.modelTokens) {
    lines.push(
      `Output cap: ${report.maxTokens} tokens, where the benchmark's own limit is ` +
        `${OUTPUT_LIMITS.modelTokens}. Scores at different caps are not strictly comparable.`,
    );
  }

  const infraRetries = report.items.reduce((n, i) => n + i.infraRetries, 0);
  const modelFailures = report.items.filter((i) => i.modelFailed).length;
  const tokens = report.items.reduce((n, i) => n + i.promptTokens + i.completionTokens, 0);
  lines.push(
    `Items: ${report.items.length}  ·  model failures: ${modelFailures}  ·  ` +
      `infrastructure retries: ${infraRetries}  ·  tokens: ${tokens}`,
  );
  lines.push(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push(`Seed fingerprint: ${report.datasetSeedFingerprint}`);
  lines.push("");

  if (opts.verbose) {
    lines.push("ITEM DETAIL");
    for (const item of report.items) {
      const name = item.itemId.padEnd(38).slice(0, 38);
      const score = `${item.awarded.toFixed(2)}/${item.points.toFixed(2)}`.padStart(11);
      lines.push(`  ${name} ${score}  ${(item.fraction * 100).toFixed(0).padStart(3)}%`);
      for (const check of item.checks) {
        lines.push(`      ${check.checkId}: ${(check.fraction * 100).toFixed(0)}% (${check.detail})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Compact JSON suitable for a results file. */
export function toJson(report: RunReport): string {
  return JSON.stringify(
    {
      suite: report.suite,
      version: report.version,
      versionTag: report.versionTag,
      fullName: report.fullName,
      split: report.split,
      seedFingerprint: report.datasetSeedFingerprint,
      model: report.model,
      judge: report.judge,
      judgePinned: report.judgePinned,
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      total: report.total,
      totalPossible: report.totalPossible,
      attemptedPoints: report.attemptedPoints,
      normalized: report.normalized,
      passed: report.passed,
      verdict: report.verdict,
      failedCategories: report.failedCategories,
      judgeGradedPoints: report.judgeGradedPoints,
      maxTokens: report.maxTokens,
      thresholds: PASS_THRESHOLD,
      categories: report.categories,
      items: report.items,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Auto-mode presentation
// ---------------------------------------------------------------------------

/**
 * The observations that qualify a score, in the order a reader should meet them.
 *
 * Anything that makes a number mean less than it appears to belongs here: a judge that
 * is not the pinned one, a partial run, a public-pool run, and the plain fact that the
 * suite is small.
 */
export function reportNotes(report: RunReport): string[] {
  const notes: string[] = [];
  const partial = report.attemptedPoints < report.totalPossible;
  const nameOf = (id: CategoryId): string =>
    report.categories.find((c) => c.id === id)?.name ?? id;

  if (partial) {
    notes.push(
      `Partial run: only ${report.attemptedPoints.toFixed(2)} of ${report.totalPossible} ` +
        "points were attempted, so this is not a comparable full-suite score.",
    );
  }

  const truncated = report.items.filter((i) => i.truncated).length;
  if (truncated > 0) {
    notes.push(
      `${truncated} item(s) hit the output cap before the model produced an answer and ` +
        "were scored as failures. Raise --max-tokens if the model needs more room to reason. " +
        "For judge-graded items a capped run is averaged in as a zero, which is why they can " +
        "land on partial credit.",
    );
  }

  if (report.maxTokens !== OUTPUT_LIMITS.modelTokens) {
    notes.push(
      `This run used an adjusted output cap of ${report.maxTokens} tokens, where the ` +
        `benchmark's own limit is ${OUTPUT_LIMITS.modelTokens}. Scores at different caps are ` +
        "not strictly comparable, with each other or with official runs.",
    );
  }

  const judgeIsHarness = report.judge !== null && report.judge.startsWith("oracle");
  if (report.verdict === "not-valid") {
    notes.push(
      "Not a valid ESAC-GI result. The judge was not the judge pinned for this release, " +
        `and that judge decides ${report.judgeGradedPoints} of the ${report.totalPossible} ` +
        "points, including a whole category. No verdict is reported either way. The " +
        "deterministic categories were measured normally and are reported above.",
    );
  } else if (report.judge !== null && !judgeIsHarness && !report.judgePinned) {
    notes.push(
      "The judge was not the judge pinned for this release, so the rubric scores are " +
        "not comparable with official runs.",
    );
  }

  if (report.failedCategories.length > 0) {
    notes.push(
      `Below the ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% category threshold: ` +
        `${report.failedCategories.map(nameOf).join(", ")}.`,
    );
  } else if (!partial && !report.passed) {
    notes.push(
      `The overall score is below the ${(PASS_THRESHOLD.overall * 100).toFixed(0)}% threshold.`,
    );
  }

  if (report.judgeGradedPoints > 0) {
    notes.push(
      "Judge-graded categories carry more uncertainty than the arithmetic suggests: " +
        `${report.judgeGradedPoints} of ${report.totalPossible} points.`,
    );
  }

  if (report.split === "public") {
    notes.push(
      "This was a public-pool run. Official comparative claims should cite a held-out run.",
    );
  }

  notes.push(
    `${TOTAL_ITEMS} items is a small sample. The total is a directional signal; the ` +
      "per-category breakdown is where the diagnostic value is.",
  );

  return notes;
}

/**
 * Auto-mode presentation: the headline first, the sections beneath it, and the notes
 * that qualify the number at the end.
 *
 * ASCII only, so it survives a terminal with a hostile code page.
 */
export function renderFinalReport(report: RunReport): string {
  const lines: string[] = [];
  const rule = "=".repeat(72);
  const verdict = VERDICT_LABEL[report.verdict];

  lines.push("");
  lines.push(rule);
  lines.push(`  ${report.fullName}`);
  lines.push(
    `  ${report.versionTag}   ${report.split} pool   model: ${report.model}` +
      (report.judge ? `   judge: ${report.judge}` : ""),
  );
  lines.push(rule);
  lines.push("");

  const total = `${report.total.toFixed(2)} / ${report.totalPossible}`;
  const pct = `${(report.normalized * 100).toFixed(1)}%`;
  lines.push(`  OVERALL SCORE   ${total.padEnd(16)} ${pct.padStart(7)}     ${verdict}`);
  lines.push("");

  lines.push("  SECTION SCORES");
  for (const category of report.categories) {
    const name = category.name.padEnd(33).slice(0, 33);
    if (category.itemCount === 0) {
      lines.push(`    ${name} ${"not run".padStart(22)}`);
      continue;
    }
    const flag = category.passed ? " " : "!";
    const raw = `${category.awarded.toFixed(2)} / ${category.points}`.padStart(14);
    const categoryPct = `${(category.normalized * 100).toFixed(1)}%`.padStart(7);
    lines.push(
      `  ${flag} ${name} ${raw} ${categoryPct}  ${bar(category.normalized)}`,
    );
  }
  lines.push("");
  if (report.failedCategories.length > 0) {
    lines.push(
      `  ! = below the ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% category threshold`,
      "",
    );
  }

  const notes = reportNotes(report);
  if (notes.length > 0) {
    lines.push("  NOTES");
    for (const note of notes) lines.push(...wrapNote(note, 76));
    lines.push("");
  }

  const infraRetries = report.items.reduce((n, i) => n + i.infraRetries, 0);
  const modelFailures = report.items.filter((i) => i.modelFailed).length;
  const tokens = report.items.reduce((n, i) => n + i.promptTokens + i.completionTokens, 0);
  lines.push(
    `  ${(report.durationMs / 1000).toFixed(1)}s   ${report.items.length} items   ` +
      `${tokens} tokens   model failures: ${modelFailures}   infra retries: ${infraRetries}   ` +
      `output cap: ${report.maxTokens}`,
  );
  lines.push(`  seed fingerprint: ${report.datasetSeedFingerprint}`);
  lines.push("");

  return lines.join("\n");
}

/** Wrap a note to `width` columns under a bullet, hanging-indenting continuations. */
function wrapNote(text: string, width: number): string[] {
  const out: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width - 4) {
      current += ` ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current.length > 0) out.push(current);

  return out.map((line, index) => (index === 0 ? `  - ${line}` : `    ${line}`));
}
