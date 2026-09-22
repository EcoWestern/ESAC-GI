/**
 * Core type contracts for ESAC-GI.
 *
 * Design note — why items are code, not JSON:
 * Resolution 4 requires parametrized items whose generation *and scoring* logic is
 * reproducible. A stored answer key cannot satisfy that: if the instance is
 * regenerated, the key is wrong. So each item is a template that, given a
 * deterministic seed, produces an (instance, checks) pair in which the expected
 * answer is computed rather than remembered.
 *
 * The public repo is therefore the distributable artifact, and `esac export`
 * additionally emits a flat JSONL snapshot of the public pool for third parties who
 * want to inspect the item text without running the harness.
 */

import type { Rng } from "./rng.ts";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryId =
  | "logic"
  | "math"
  | "factual"
  | "reading"
  | "abstraction"
  | "instruction"
  | "writing"
  | "depth";

export interface CategoryDef {
  readonly id: CategoryId;
  readonly name: string;
  /** Points awarded at a perfect score. */
  readonly points: number;
  /** Number of item templates. Fixed by first-amendment §6 for GI. */
  readonly itemCount: number;
  /**
   * Whether this category is graded deterministically, by the pinned judge, or both.
   * Used to report the judge-graded share of the suite without recomputing it ad hoc.
   */
  readonly grading: "deterministic" | "judge";
}

// ---------------------------------------------------------------------------
// Graders
// ---------------------------------------------------------------------------

/** How strictly to normalise a free-text answer before exact comparison. */
export type NormMode = "strict" | "trim" | "answer";

export type Grader =
  /** Answer must equal one of `accept` after normalisation. */
  | { readonly type: "exact"; readonly accept: readonly string[]; readonly normalize?: NormMode }
  /** Answer must parse as a number within `tolerance` of `value`. */
  | { readonly type: "numeric"; readonly value: number; readonly tolerance: number }
  /** Answer must match `pattern` and must not match any of `mustNotMatch`. */
  | { readonly type: "regex"; readonly pattern: string; readonly flags?: string; readonly mustNotMatch?: readonly string[] }
  /** Substring presence/absence checks. Cheap, robust, and serializable. */
  | {
      readonly type: "contains";
      readonly all?: readonly string[];
      readonly any?: readonly string[];
      readonly none?: readonly string[];
      readonly caseSensitive?: boolean;
    }
  /**
   * Arbitrary structural verification over the raw response. Used by
   * instruction-following, where the constraint *is* the task and cannot be
   * expressed as a string comparison.
   */
  | { readonly type: "programmatic"; readonly check: ProgrammaticCheck }
  /** Rubric grading by the pinned judge model. */
  | { readonly type: "judge"; readonly rubric: Rubric };

export interface ProgrammaticCheck {
  readonly description: string;
  /** Return 0..1. Must be pure and must not mutate its input. */
  readonly run: (response: string) => number;
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export interface RubricLevel {
  readonly score: number;
  readonly label: string;
  readonly description: string;
}

export interface RubricCriterion {
  readonly id: string;
  readonly description: string;
  /** Relative weight within the rubric. Normalised by the scorer. */
  readonly weight: number;
  readonly levels?: readonly RubricLevel[];
}

export interface Rubric {
  /** Identifies the rubric version; a change here is a MAJOR-version change (§9). */
  readonly id: string;
  readonly criteria: readonly RubricCriterion[];
  /**
   * Injected into the judge prompt to state what the task was asking for, so the
   * judge scores against the intended construct rather than a generic notion of
   * quality. For response-depth items this carries the directional expectation.
   */
  readonly context: string;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Which pool(s) a template contributes instances to.
 *
 * `both` is the default and the reason the split is content-balanced by
 * construction: the same template is instantiated under the public seed and the
 * held-out seed, producing different instances of the same task class. Splitting
 * instances rather than templates means every category has held-out coverage
 * without hand-partitioning a small bank.
 */
export type Split = "public" | "heldout" | "both";

/** One graded sub-question within an item. Partial credit is per-check. */
export interface Check {
  readonly id: string;
  /** Fraction of the item's credit this check carries. Weights are normalised. */
  readonly weight: number;
  readonly grader: Grader;
  /** Shown to the judge / included in the answer key. Never sent to the model. */
  readonly expected?: string;
}

/** A single concrete, promptable instance produced from an item template. */
export interface Instance {
  readonly itemId: string;
  readonly category: CategoryId;
  readonly seed: number;
  /**
   * Stable fingerprint of this instantiation.
   *
   * Computed centrally by the registry from the instance's full content, never
   * supplied by the generator. Hand-built fingerprints that hash only *some* fields
   * are liable to collide when two instances differ in an unhashed field, and a
   * colliding fingerprint defeats the purpose of recording one: it makes the
   * public-vs-held-out overfitting signal unattributable to a specific instance.
   */
  readonly fingerprint: string;
  /** The exact text sent to the model. */
  readonly prompt: string;
  readonly checks: readonly Check[];
  /**
   * True when any check requires the judge. Drives the 2x2 replication protocol:
   * judge items get 2 model runs x 2 judgments; everything else runs once.
   */
  readonly judgeGraded: boolean;
  /** Optional per-item system prompt. */
  readonly system?: string;
  /** Mirrors the template flag; see `ItemTemplate.parametrized`. */
  readonly parametrized: boolean;
  /**
   * Canonical correct response, where one exists.
   *
   * NEVER sent to the model. Used for three things:
   *   - the held-out scoring key, which must stay private (spec, "held-out custody");
   *   - golden-answer regression tests over the generators;
   *   - priming the oracle adapter so the harness can be self-tested.
   *
   * Absent for judge-graded items, where no single correct response exists.
   */
  readonly reference?: string;
}

export interface ItemTemplate {
  readonly id: string;
  readonly category: CategoryId;
  /** Defaults to `both`. */
  readonly split?: Split;
  /** Defaults to 1. Overridden per category by the scorer. */
  readonly points?: number;
  /**
   * Optional per-release weights. The response-depth boundary item uses 0.5 here
   * (first-amendment §2).
   */
  readonly weight?: number;
  /** Human-readable note on what the item measures. Not sent to the model. */
  readonly measures: string;
  /**
   * Whether the generator produces a genuinely new instance per seed, as opposed to
   * drawing a scenario from a small fixed pool.
   *
   * Resolution 4 makes parametrization a principle rather than an absolute: for the
   * response-depth and writing items the scenario *is* the construct, and scrambling
   * it to defeat memorisation would change what is measured. Those items are marked
   * `false` and rotate at the pool level across releases instead. The distinction is
   * recorded because it determines whether a held-out instance is guaranteed to
   * differ from a public one, which the self-test asserts.
   */
  readonly parametrized?: boolean;
  /** Pure and deterministic in `rng` and `seed`. */
  readonly generate: (
    rng: Rng,
    seed: number,
  ) => Omit<
    Instance,
    "itemId" | "category" | "seed" | "fingerprint" | "judgeGraded" | "parametrized"
  >;
}

// ---------------------------------------------------------------------------
// Model + judge adapters
// ---------------------------------------------------------------------------

export interface ModelRequest {
  readonly prompt: string;
  readonly system?: string;
  readonly temperature: number;
  readonly topP: number;
  /** Hard cap on output. Keeps a single item from ballooning. */
  readonly maxTokens: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly model?: string;
}

/**
 * Model under test.
 *
 * `infrastructure` distinguishes a scored model response from an evaluation that
 * could not be completed (first-amendment §8). Throwing anything else is treated
 * as an infrastructure failure by the runner.
 */
export interface ModelAdapter {
  readonly id: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** Judge adapter. Must be an open-weight, self-hostable model (tenet 3). */
export interface JudgeAdapter {
  readonly id: string;
  /** Return one 0..maxScore value per criterion id. */
  score(input: JudgeInput): Promise<JudgeResponse>;
}

export interface JudgeInput {
  readonly rubric: Rubric;
  readonly taskPrompt: string;
  readonly response: string;
  readonly temperature: number;
  readonly topP: number;
}

export interface JudgeResponse {
  /**
   * Parsed criterion scores, when the adapter parsed them itself. Optional because
   * an adapter may instead return raw text for the shared parser to handle — which
   * is what the HTTP adapter does, so that every provider goes through one parser.
   */
  readonly scores?: Readonly<Record<string, number>>;
  /** Raw judge output. Parsed by `parseJudgeResponse` when `scores` is absent. */
  readonly raw?: string;
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * Raised by adapters when no valid model response was obtained. Never scores.
 * The runner retries these under identical conditions (first-amendment §8).
 *
 * Written without constructor parameter properties so the file is valid under
 * Node's strip-only TypeScript mode, which the benchmark relies on to stay
 * dependency-free.
 */
export class InfrastructureError extends Error {
  override readonly name = "InfrastructureError";
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.reason = reason;
  }
}

/** Thrown when the evaluated model exceeded the item's time budget. Scored as failure. */
export class ModelTimeoutError extends Error {
  override readonly name = "ModelTimeoutError";
  constructor(message = "model exceeded item time budget") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CheckResult {
  readonly checkId: string;
  readonly graderType: Grader["type"];
  /** 0..1 for deterministic checks; per-criterion fraction for judge checks. */
  readonly fraction: number;
  readonly detail: string;
}

export interface ItemRunResult {
  readonly itemId: string;
  readonly category: CategoryId;
  readonly fingerprint: string;
  /** Fraction of this item's credit, in [0, 1]. */
  readonly fraction: number;
  readonly points: number;
  readonly awarded: number;
  readonly judgeGraded: boolean;
  readonly checks: readonly CheckResult[];
  /** Number of infrastructure retries consumed. Zero on a clean run. */
  readonly infraRetries: number;
  /** Model runs actually performed (1 deterministic, 2 judge-graded). */
  readonly modelRuns: number;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Model-side failure (scored zero), as distinct from infrastructure failure. */
  readonly modelFailed: boolean;
}

export interface CategoryScore {
  readonly id: CategoryId;
  readonly name: string;
  readonly points: number;
  readonly awarded: number;
  readonly normalized: number;
  readonly itemCount: number;
  readonly judgeGraded: boolean;
  readonly passed: boolean;
}

export interface RunReport {
  readonly suite: string;
  readonly version: string;
  readonly versionTag: string;
  readonly fullName: string;
  readonly split: "public" | "heldout" | "both";
  readonly datasetSeedFingerprint: string;
  readonly model: string;
  readonly judge: string | null;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly categories: readonly CategoryScore[];
  readonly total: number;
  readonly totalPossible: number;
  /**
   * Points covered by the items actually run. Equal to `totalPossible` for a full
   * suite run; lower when a subset was selected, so a partial run is not mistaken
   * for a poor full-suite score.
   */
  readonly attemptedPoints: number;
  readonly normalized: number;
  readonly passed: boolean;
  readonly failedCategories: readonly CategoryId[];
  /** Share of suite points that depend on a judge. Reported explicitly. */
  readonly judgeGradedPoints: number;
  readonly items: readonly ItemRunResult[];
}
