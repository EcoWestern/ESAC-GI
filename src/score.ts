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

import { CATEGORIES, JUDGE_GRADED_POINTS, TOTAL_POINTS } from "./categories.ts";
import { itemPoints } from "./registry.ts";
import { ITEMS_BY_ID } from "./registry.ts";
import { PASS_THRESHOLD, ESAC_SUITE, ESAC_VERSION, ESAC_VERSION_TAG, ESAC_FULL_NAME } from "./version.ts";
import type { CategoryId, CategoryScore, ItemRunResult, RunReport, Split } from "./types.ts";
import { seedFingerprint } from "./registry.ts";

export interface ScoreInput {
  readonly items: readonly ItemRunResult[];
  readonly split: Split;
  readonly datasetSeed: string;
  readonly model: string;
  readonly judge: string | null;
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
  const passed =
    anyRan &&
    meetsThreshold(normalized, PASS_THRESHOLD.overall) &&
    failedCategories.length === 0;

  return {
    suite: ESAC_SUITE,
    version: ESAC_VERSION,
    versionTag: ESAC_VERSION_TAG,
    fullName: ESAC_FULL_NAME,
    split: input.split,
    datasetSeedFingerprint: seedFingerprint(input.datasetSeed),
    model: input.model,
    judge: input.judge,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    categories,
    total,
    totalPossible: TOTAL_POINTS,
    attemptedPoints: round(attemptedPoints),
    normalized,
    passed,
    failedCategories,
    judgeGradedPoints: JUDGE_GRADED_POINTS,
    items: scored,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Plain-text report. Deliberately readable in a terminal and in a commit message. */
export function renderReport(report: RunReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const bar = (fraction: number, width = 24): string => {
    const filled = Math.round(fraction * width);
    return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
  };

  lines.push("");
  lines.push(`${report.fullName}`);
  lines.push(`${report.versionTag}  ·  split: ${report.split}  ·  model: ${report.model}`);
  if (report.judge) lines.push(`judge: ${report.judge}`);
  lines.push("");

  const partial = report.attemptedPoints < report.totalPossible;
  lines.push(
    `SCORE   ${report.total.toFixed(2)} / ${report.totalPossible}   (${(report.normalized * 100).toFixed(1)}%)`,
  );
  if (partial) {
    lines.push(
      `        NOTE: partial run — only ${report.attemptedPoints.toFixed(2)} of ` +
        `${report.totalPossible} points were attempted, so the percentage above is against the ` +
        `full suite and is not a comparable score.`,
    );
  }
  lines.push(`RESULT  ${partial ? "INCOMPLETE" : report.passed ? "PASS" : "FAIL"}`);
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
        lines.push(`      ${check.checkId}: ${(check.fraction * 100).toFixed(0)}% — ${check.detail}`);
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
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      total: report.total,
      totalPossible: report.totalPossible,
      attemptedPoints: report.attemptedPoints,
      normalized: report.normalized,
      passed: report.passed,
      failedCategories: report.failedCategories,
      judgeGradedPoints: report.judgeGradedPoints,
      thresholds: PASS_THRESHOLD,
      categories: report.categories,
      items: report.items,
    },
    null,
    2,
  );
}
