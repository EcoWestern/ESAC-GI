/**
 * Run orchestration.
 *
 * Responsibilities, and the specific requirement each one satisfies:
 *
 * 1. **Ordering.** Cheapest-first, categories interleaved (spec, "Run ordering").
 *    Static items are sorted before generation-heavy ones; within that, categories
 *    round-robin so a broken harness or dead API key is discovered on item 1.
 *
 * 2. **Infrastructure vs. model failure.** Resolution 8. An adapter that throws
 *    `InfrastructureError` (or any unrecognised error) yields a retry, never a zero.
 *    A returned response — including an empty one or a refusal — is a scored model
 *    response. `ModelTimeoutError` is a scored failure.
 *
 * 3. **Replication.** Resolution 5. Judge-graded items run the model twice and each
 *    response is judged twice; the four observations are averaged. Everything else is
 *    single-run.
 *
 * 4. **Progress.** A running tally after every item, so "is this still working" is
 *    answered by watching a counter rather than by waiting five hours.
 */

import { gradeChecks, clamp01 } from "./graders.ts";
import { meanFraction, parseJudgeResponse, scoreRubric } from "./judge.ts";
import { INFRA_RETRY, REPLICATION, DECODING } from "./version.ts";
import type {
  Instance,
  ItemRunResult,
  JudgeAdapter,
  ModelAdapter,
  CategoryId,
  CheckResult,
  Rubric,
} from "./types.ts";
import { InfrastructureError, ModelTimeoutError } from "./types.ts";

export interface RunOptions {
  readonly model: ModelAdapter;
  /** Null when running a pool that contains no judge-graded items. */
  readonly judge: JudgeAdapter | null;
  /** Per-item output cap. Defaults are deliberately tight. */
  readonly maxTokens?: number;
  readonly deterministic?: { readonly maxTokens: number };
  readonly judgeMaxTokens?: number;
  /** Per-item wall clock budget for the model under test. Exceeding it is a model failure. */
  readonly itemTimeoutMs?: number;
  /** Called after each item resolves, for the live tally. */
  readonly onItem?: (result: ItemRunResult, running: RunningTally) => void;
}

export interface RunningTally {
  readonly completed: number;
  readonly total: number;
  readonly awarded: number;
  readonly possible: number;
}

/** Cost proxy used for ordering. Lower runs first. */
function costRank(instance: Instance): number {
  if (instance.judgeGraded) return 3;
  // Wordier prompts cost more to run and take longer, so rank on prompt length too.
  return instance.prompt.length > 1500 ? 2 : 1;
}

/**
 * Order items cheapest-and-fastest-first with categories interleaved.
 *
 * Round-robin over categories within each cost tier, so the first few items exercise
 * several different code paths rather than hammering one category.
 */
export function orderItems(instances: readonly Instance[]): Instance[] {
  const byCost = new Map<number, Map<CategoryId, Instance[]>>();

  for (const instance of instances) {
    const cost = costRank(instance);
    if (!byCost.has(cost)) byCost.set(cost, new Map());
    const byCategory = byCost.get(cost)!;
    if (!byCategory.has(instance.category)) byCategory.set(instance.category, []);
    byCategory.get(instance.category)!.push(instance);
  }

  const out: Instance[] = [];
  for (const cost of [...byCost.keys()].sort((a, b) => a - b)) {
    const byCategory = byCost.get(cost)!;
    // Deterministic category order: keep declaration order from the instance list.
    const order: CategoryId[] = [];
    for (const instance of instances) {
      if (!order.includes(instance.category) && byCategory.has(instance.category)) {
        order.push(instance.category);
      }
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const category of order) {
        const bucket = byCategory.get(category);
        if (bucket && bucket.length > 0) {
          out.push(bucket.shift()!);
          progress = true;
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Single model call, with infrastructure retry
// ---------------------------------------------------------------------------

interface CallOutcome {
  readonly text: string | null;
  readonly infraRetries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly modelFailed: boolean;
  readonly failureDetail: string | null;
}

async function callModelWithRetries(
  model: ModelAdapter,
  instance: Instance,
  options: RunOptions,
): Promise<CallOutcome> {
  const maxTokens = instance.judgeGraded
    ? (options.deterministic?.maxTokens ?? options.maxTokens ?? 1024)
    : (options.maxTokens ?? 512);

  let infraRetries = 0;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < INFRA_RETRY.maxAttempts; attempt++) {
    try {
      const response = await withTimeout(
        model.complete({
          prompt: instance.prompt,
          ...(instance.system ? { system: instance.system } : {}),
          temperature: DECODING.temperature,
          topP: DECODING.topP,
          maxTokens,
        }),
        options.itemTimeoutMs ?? 0,
      );

      return {
        text: response.text ?? "",
        infraRetries,
        promptTokens: response.promptTokens ?? 0,
        completionTokens: response.completionTokens ?? 0,
        modelFailed: false,
        failureDetail: null,
      };
    } catch (err) {
      // A timeout of the model under test is a model failure, not an infrastructure
      // failure (agreed pre-build: "model/task timeout = failure").
      if (err instanceof ModelTimeoutError) {
        return {
          text: null,
          infraRetries,
          promptTokens: 0,
          completionTokens: 0,
          modelFailed: true,
          failureDetail: err.message,
        };
      }

      // Everything else — transport, rate limit, auth, an adapter bug, any thrown
      // value — is treated as infrastructure: retried, never scored.
      infraRetries++;
      lastError = err instanceof InfrastructureError ? err.message : String(err);
    }

    if (attempt < INFRA_RETRY.maxAttempts - 1) {
      await sleep(Math.min(INFRA_RETRY.baseDelayMs * 2 ** attempt, INFRA_RETRY.maxDelayMs));
    }
  }

  throw new InfrastructureError(
    `item ${instance.itemId}: model call failed after ${INFRA_RETRY.maxAttempts} attempts (${lastError ?? "unknown"})`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModelTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Item execution
// ---------------------------------------------------------------------------

export async function runItem(instance: Instance, options: RunOptions): Promise<ItemRunResult> {
  const started = Date.now();

  const judgeChecks = instance.checks.filter((c) => c.grader.type === "judge");
  const modelRuns = instance.judgeGraded ? REPLICATION.judgeModelRuns : REPLICATION.deterministicModelRuns;

  let infraRetries = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const observations: number[] = [];
  const checkResults: CheckResult[] = [];
  let modelFailed = false;
  let failureDetail: string | null = null;

  for (let run = 0; run < modelRuns; run++) {
    const outcome = await callModelWithRetries(options.model, instance, options);
    infraRetries += outcome.infraRetries;
    promptTokens += outcome.promptTokens;
    completionTokens += outcome.completionTokens;

    if (outcome.modelFailed || outcome.text === null) {
      modelFailed = true;
      failureDetail = outcome.failureDetail;
      // A failed model run contributes zero, and does not stop the item: the other
      // replication still produces a genuine observation.
      if (run === 0) {
        checkResults.push({
          checkId: "__model_failure__",
          graderType: "programmatic",
          fraction: 0,
          detail: failureDetail ?? "model did not return a response",
        });
      }
      if (instance.judgeGraded) observations.push(0);
      continue;
    }

    const response = outcome.text;

    // Deterministic portion.
    const deterministicChecks = instance.checks.filter((c) => c.grader.type !== "judge");
    let deterministicFraction = 0;
    if (deterministicChecks.length > 0) {
      const graded = gradeChecks(deterministicChecks, response);
      deterministicFraction = graded.fraction;
      if (run === 0) checkResults.push(...graded.results);
    }

    // Judge portion.
    let judgeFraction: number | null = null;
    if (judgeChecks.length > 0) {
      if (!options.judge) {
        throw new InfrastructureError(
          `item ${instance.itemId} is judge-graded but no judge adapter was supplied`,
        );
      }
      const fractions: number[] = [];
      for (const check of judgeChecks) {
        if (check.grader.type !== "judge") continue;
        const rubric = check.grader.rubric;
        const judgments = await judgeResponse(options.judge, rubric, instance.prompt, response);
        infraRetries += judgments.infraRetries;
        fractions.push(judgments.fraction);
      }
      judgeFraction = meanFraction(fractions);
    }

    // Combine the deterministic and judge portions by their declared weights.
    const allChecks = instance.checks;
    const totalWeight = allChecks.reduce((n, c) => n + c.weight, 0);
    const detWeight = allChecks.filter((c) => c.grader.type !== "judge").reduce((n, c) => n + c.weight, 0);
    const judgeWeight = allChecks.filter((c) => c.grader.type === "judge").reduce((n, c) => n + c.weight, 0);

    let runFraction: number;
    if (judgeWeight === 0) {
      runFraction = deterministicFraction;
    } else if (detWeight === 0) {
      runFraction = judgeFraction ?? 0;
    } else {
      runFraction =
        (deterministicFraction * detWeight + (judgeFraction ?? 0) * judgeWeight) / totalWeight;
    }

    observations.push(clamp01(runFraction));

    if (run === 0) {
      if (judgeFraction !== null) {
        for (const check of judgeChecks) {
          checkResults.push({
            checkId: check.id,
            graderType: "judge",
            fraction: judgeFraction,
            detail: `mean of ${REPLICATION.judgeJudgmentsPerResponse} judgments`,
          });
        }
      }
    }
  }

  const fraction = meanFraction(observations);

  return {
    itemId: instance.itemId,
    category: instance.category,
    fingerprint: instance.fingerprint,
    fraction: clamp01(fraction),
    points: 0, // filled by the scorer, which knows the item weights
    awarded: 0,
    judgeGraded: instance.judgeGraded,
    checks: checkResults,
    infraRetries,
    modelRuns: observations.length,
    latencyMs: Date.now() - started,
    promptTokens,
    completionTokens,
    modelFailed,
  };
}

/** Run one judge observation set: `judgeJudgmentsPerResponse` judgments, averaged. */
async function judgeResponse(
  judge: JudgeAdapter,
  rubric: Rubric,
  taskPrompt: string,
  response: string,
): Promise<{ fraction: number; infraRetries: number }> {
  const fractions: number[] = [];
  let infraRetries = 0;

  for (let i = 0; i < REPLICATION.judgeJudgmentsPerResponse; i++) {
    let scores: Readonly<Record<string, number>> | null = null;

    for (let attempt = 0; attempt < INFRA_RETRY.maxAttempts; attempt++) {
      try {
        const out = await judge.score({
          rubric,
          taskPrompt,
          response,
          temperature: DECODING.judgeTemperature,
          topP: DECODING.judgeTopP,
        });
        // Prefer the adapter's own parse; fall back to parsing its raw text through
        // the shared parser so every provider is held to the same tolerance.
        const provided = out.scores;
        if (provided && Object.keys(provided).length > 0) {
          scores = provided;
        } else if (out.raw !== undefined) {
          const reparsed = parseJudgeResponse(out.raw, rubric);
          if (reparsed && reparsed.scores) scores = reparsed.scores;
        }
        if (scores) break;
      } catch {
        // Any judge-side error is an infrastructure failure: retried, never scored.
      }
      infraRetries++;
      if (attempt < INFRA_RETRY.maxAttempts - 1) {
        await sleep(Math.min(INFRA_RETRY.baseDelayMs * 2 ** attempt, INFRA_RETRY.maxDelayMs));
      }
    }

    if (!scores) {
      throw new InfrastructureError(
        `judge produced no parseable scores after ${INFRA_RETRY.maxAttempts} attempts (rubric ${rubric.id})`,
      );
    }

    fractions.push(scoreRubric(scores, rubric));
  }

  return { fraction: meanFraction(fractions), infraRetries };
}
