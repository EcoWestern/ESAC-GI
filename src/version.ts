/**
 * Version identity for ESAC-GI.
 *
 * Tenet 5: "Every score is meaningless without a version tag."
 *
 * Per `specs/first-amendment.md` §9, version numbers are meaningful:
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

/** Major version — the unit that scores are comparable within. */
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
 * `hash(datasetSeed + ":" + itemId)` — never from the run id — so that every model
 * and every replication within a comparison sees byte-identical instances.
 */
export const PUBLIC_DATASET_SEED = "esac-gi-v1.0-public";

/** Placeholder only. Real held-out seed is supplied at run time via --heldout-seed. */
export const HELD_OUT_DATASET_SEED_ENV = "ESAC_HELD_OUT_SEED";

/**
 * Canary string. Embedded in every public raw item file so that leaked training
 * data can be detected. See spec "Contamination resistance".
 */
export const CANARY = "ESAC-CANARY-GI-a3f9c17e4b2d8056-v1.0";

/** Pinned decoding parameters. Part of the benchmark definition, not per-run config. */
export const DECODING = {
  temperature: 0,
  topP: 1,
  /** Judge items need non-zero temperature to sample judge-side variance meaningfully. */
  judgeTemperature: 0,
  judgeTopP: 1,
} as const;

/**
 * Replication protocol (first-amendment §5).
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

/** Passing criteria (first-amendment §10). Defined from v1.0, never retrofitted. */
export const PASS_THRESHOLD = {
  /** Every capability category must reach this fraction of its points. */
  perCategory: 0.6,
  /** Plus the total must reach this fraction of the 75-point suite. */
  overall: 0.6,
} as const;

/** Infrastructure retry policy (first-amendment §8). Infra retries never score. */
export const INFRA_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8000,
} as const;
