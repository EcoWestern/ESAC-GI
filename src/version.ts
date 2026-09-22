/**
 * Version identity for ESAC-GI.
 *
 * Tenet 5: "Every score is meaningless without a version tag."
 *
 * Per `amendment 001 §9` of the ESAC specification, version numbers are meaningful:
 *   - MINOR releases change content/organisation but not what the score measures
 *     (item rotation, new parametrized instances, prompt edits).
 *   - MAJOR releases change the measurement itself (scoring methodology, judging
 *     methodology, scoring criteria, category definitions, pass criteria).
 *
 * Scores are comparable across MINOR versions of the same MAJOR version and are
 * NEVER comparable across MAJOR versions.
 */

/** Semantic version of the benchmark content + scoring protocol. */
export const ESAC_VERSION = "1.0.0";

/** Major version: the unit that scores are comparable within. */
export const ESAC_MAJOR = 1;

/** Machine-readable tag, e.g. `ESAC-GI v1.0`. Always reported with a score. */
export const ESAC_VERSION_TAG = `ESAC-GI v${ESAC_MAJOR}.0`;

/** Full formal name, per spec: "EcoWestern Short and Cheap [Suite] Benchmark, Version [#]". */
export const ESAC_FULL_NAME =
  "EcoWestern Short and Cheap General Intelligence Benchmark, Version 1";

/** Suite identifier. */
export const ESAC_SUITE = "ESAC-GI";

/**
 * Dataset seeds. The public seed is disclosed with the repo; the held-out seed is
 * evaluator-controlled and must not be committed. Instance identity is derived as
 * `hash(datasetSeed + ":" + itemId)`, never from the run id, so that every model
 * and every replication within a comparison sees byte-identical instances.
 */
export const PUBLIC_DATASET_SEED = "esac-gi-v1.0-public";

/**
 * Environment variable holding the held-out dataset seed.
 *
 * For runs that should write nothing to disk, such as CI, where the value arrives from a
 * secret. `--seed` overrides it, and `.heldout/seed` (written by `esac seed`) is the
 * fallback. All three are preferred to inventing a seed, which would produce a run nobody
 * could reproduce.
 */
export const HELD_OUT_DATASET_SEED_ENV = "ESAC_HELD_OUT_SEED";

/**
 * Canary string. Embedded in every public raw item file so that leaked training
 * data can be detected. See spec "Contamination resistance".
 */
export const CANARY = "ESAC-CANARY-GI-a3f9c17e4b2d8056-v1.0";

/**
 * The judge pinned for official ESAC-GI v1.0 runs.
 *
 * Tenet 3 requires the judge to be open-weight, self-hostable, and pinned per release,
 * so that rubric scores do not drift silently when the judge model is updated upstream.
 * This is the model reserved for that role. The harness records whichever judge a run
 * actually used, so a run graded by something else is visible in the report rather than
 * silent.
 *
 * `xiaomi/mimo-v2.6-pro` was chosen for its general capability and, in the maintainers'
 * private testing, for an absence of bias in its chain of thought. That second property
 * matters more for rubric grading than raw benchmark standing, because the judge's task
 * is to apply a rubric neutrally rather than to be impressive.
 */
export const PINNED_JUDGE = "xiaomi/mimo-v2.6-pro";

/**
 * Whether a judge model id names the pinned judge.
 *
 * Providers decorate the same weights differently: the pinned model may appear as
 * `xiaomi/mimo-v2.6-pro`, as a bare `mimo-v2.6-pro`, or as a local tag such as
 * `mimo-v2.6-pro:latest`. Identity is therefore the final path segment with any
 * version tag removed, compared case-insensitively, so that a self-hosted copy of the
 * pinned judge satisfies the pin instead of being refused as a stranger.
 */
export function isPinnedJudge(modelId: string): boolean {
  return judgeIdentity(modelId) === judgeIdentity(PINNED_JUDGE);
}

function judgeIdentity(modelId: string): string {
  const withoutTag = modelId.split(":")[0] ?? modelId;
  const lastSegment = withoutTag.split("/").pop() ?? withoutTag;
  return lastSegment.trim().toLowerCase();
}

/**
 * Pinned decoding parameters. Part of the benchmark definition, not per-run config.
 *
 * The judge is held at temperature 0 as well. At zero, judging the same response twice
 * is a reproducibility check on the judge rather than a sample of its variance, which is
 * what the value buys: the same response and the same rubric should score the same.
 * Raising it would make the 2x2 protocol measure judge-side sampling variance instead,
 * which changes what the score means and is therefore a major-version change.
 */
export const DECODING = {
  temperature: 0,
  topP: 1,
  judgeTemperature: 0,
  judgeTopP: 1,
} as const;

/**
 * Output caps. Part of the benchmark definition, for the same reason the time budget is:
 * a model that cannot answer within its budget has failed the item.
 *
 * That makes the cap a scoring parameter, so it has to be generous enough that the budget
 * is not what decides the score. A reasoning model can spend thousands of tokens thinking
 * before it emits a single answer token, and a tight cap cuts such models off before they
 * answer anything at all. Raise it further with --max-tokens for unusual models. The judge
 * only ever emits a small JSON object, so its cap stays low.
 */
export const OUTPUT_LIMITS = {
  modelTokens: 4096,
  judgeTokens: 1024,
} as const;

/**
 * Replication protocol (amendment 001 §5).
 *
 * Judge-graded items: the evaluated model is run twice; each response is judged
 * twice; the four observations are averaged.
 * Deterministic items: single run.
 */
export const REPLICATION = {
  deterministicModelRuns: 1,
  judgeModelRuns: 2,
  judgeJudgmentsPerResponse: 2,
} as const;

/** Passing criteria (amendment 001 §10). Defined from v1.0, never retrofitted. */
export const PASS_THRESHOLD = {
  /** Every capability category must reach this fraction of its points. */
  perCategory: 0.6,
  /** Plus the total must reach this fraction of the 75-point suite. */
  overall: 0.6,
} as const;

/** Infrastructure retry policy (amendment 001 §8). Infra retries never score. */
export const INFRA_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8000,
} as const;
