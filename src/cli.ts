#!/usr/bin/env node
/**
 * ESAC-GI command-line interface.
 *
 * Usage:
 *   esac list                                     show the item bank
 *   esac export [--split public|heldout]          write a JSONL snapshot
 *   esac inspect <itemId> [--seed <s>]            render one instance
 *   esac key --split heldout                      emit the held-out scoring key
 *   esac run [options]                            run the benchmark
 *   esac selftest                                 verify the harness end-to-end
 *
 * `run` options:
 *   --model <spec>        baseUrl|model|apiKeyEnvVar   (or `oracle` for a dry run)
 *   --judge <spec>        same shape; required only for judge-graded items
 *   --split <s>           public (default) | heldout
 *   --items <a,b,c>       restrict to these item ids or category ids
 *   --json <path>         write the full report as JSON
 *   --quiet               suppress the per-item progress tally
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { CATEGORIES, TOTAL_ITEMS, TOTAL_POINTS } from "./categories.ts";
import { ALL_ITEMS, ITEMS_BY_ID, instantiate, validateBank, itemPoints, seedFingerprint } from "./registry.ts";
import { orderItems, runItem } from "./runner.ts";
import { scoreRun, renderReport, toJson } from "./score.ts";
import { createHttpAdapter, createOracleAdapter, createOracleJudge } from "./adapters.ts";
import { PUBLIC_DATASET_SEED, HELD_OUT_DATASET_SEED_ENV, ESAC_VERSION_TAG, CANARY, REPLICATION, DECODING, PASS_THRESHOLD } from "./version.ts";
import { gradeChecks } from "./graders.ts";
import type { Instance, ItemRunResult, JudgeAdapter, ModelAdapter, Split } from "./types.ts";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Args {
  readonly command: string;
  readonly flags: ReadonlyMap<string, string>;
  readonly positional: readonly string[];
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(arg.slice(2), next);
          i++;
        } else {
          flags.set(arg.slice(2), "true");
        }
      }
    } else if (command === "") {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

function datasetSeedFor(split: Split, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (split === "heldout") {
    const env = process.env[HELD_OUT_DATASET_SEED_ENV];
    if (!env) {
      fail(
        `Running the held-out pool requires a dataset seed. Set ${HELD_OUT_DATASET_SEED_ENV} ` +
          `or pass --seed. The held-out seed is evaluator-controlled and must not be committed.`,
      );
    }
    return env;
  }
  return PUBLIC_DATASET_SEED;
}

function fail(message: string): never {
  console.error(`\n  error: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Adapter construction
// ---------------------------------------------------------------------------

/**
 * Parse an adapter spec:
 *   oracle                            built-in self-test adapter
 *   <baseUrl>|<model>|<apiKeyEnvVar>  OpenAI-compatible endpoint
 */
function buildAdapter(spec: string, role: "model" | "judge"): ModelAdapter | JudgeAdapter {
  if (spec === "oracle") {
    // The oracle judge returns full marks so that `--model oracle --judge oracle`
    // demonstrates the complete scoring path reaching 75/75 without ambiguity.
    // Partial-credit and malformed-judge paths are exercised by `esac selftest`.
    return role === "judge"
      ? createOracleJudge({ fixedFraction: 1 })
      : createOracleAdapter({ accuracy: 1 });
  }

  const parts = spec.split("|");
  if (parts.length < 2) {
    fail(
      `--${role} expects either "oracle" or "<baseUrl>|<model>|<apiKeyEnvVar>", got "${spec}"`,
    );
  }

  const [baseUrl, model, keyEnv] = parts as [string, string, string?];
  const apiKey = keyEnv ? (process.env[keyEnv] ?? "") : "";
  if (keyEnv && !apiKey) fail(`environment variable ${keyEnv} is empty or unset`);

  return createHttpAdapter({
    id: `${model}@${new URL(baseUrl).host}`,
    baseUrl,
    model,
    apiKey,
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(): void {
  validateBank();
  console.log(`\n${ESAC_VERSION_TAG} — ${TOTAL_ITEMS} items across ${CATEGORIES.length} categories, ${TOTAL_POINTS} points\n`);
  for (const category of CATEGORIES) {
    const items = ALL_ITEMS.filter((i) => i.category === category.id);
    const grading = category.grading === "judge" ? "judge" : "deterministic";
    console.log(
      `${category.name}  —  ${category.points} pts, ${items.length} items, ${grading}`,
    );
    for (const item of items) {
      const weight = item.weight !== undefined && item.weight !== 1 ? `  [weight ${item.weight}]` : "";
      const pts = itemPoints(item).toFixed(2);
      console.log(`    ${item.id.padEnd(36)} ${pts.padStart(6)} pts${weight}`);
      console.log(`      ${item.measures}`);
    }
    console.log("");
  }
  console.log(`Judge-graded items use ${REPLICATION.judgeModelRuns} model runs x ${REPLICATION.judgeJudgmentsPerResponse} judgments.`);
  console.log(`Passing: ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% per category and ${(PASS_THRESHOLD.overall * 100).toFixed(0)}% overall.\n`);
}

function cmdExport(args: Args, split: Split, datasetSeed: string): void {
  const instances = instantiate(datasetSeed, split === "heldout" ? "heldout" : "public");
  const lines: string[] = [
    `# ${ESAC_VERSION_TAG} — ${split} pool, ${instances.length} instances`,
    `# dataset seed fingerprint: ${seedFingerprint(datasetSeed)}`,
    `# CANARY: ${CANARY}`,
  ];

  for (const instance of instances) {
    const template = ITEMS_BY_ID.get(instance.itemId)!;
    lines.push(
      JSON.stringify({
        itemId: instance.itemId,
        category: instance.category,
        fingerprint: instance.fingerprint,
        split,
        judgeGraded: instance.judgeGraded,
        points: itemPoints(template),
        measures: template.measures,
        // The reference is included only for the public pool's convenience and is
        // what a third party would use to self-check their own harness.
        prompt: instance.prompt,
        ...(instance.reference !== undefined && split === "public" ? { reference: instance.reference } : {}),
        checks: instance.checks.map((c) => ({
          id: c.id,
          weight: c.weight,
          grader: c.grader.type,
          ...(c.expected !== undefined ? { expected: c.expected } : {}),
        })),
      }),
    );
  }

  const out = args.flags.get("out");
  const body = lines.join("\n") + "\n";
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body, "utf8");
    console.log(`Wrote ${instances.length} instances to ${out}`);
  } else {
    console.log(body);
  }
}

function cmdInspect(args: Args): void {
  const itemId = args.positional[0];
  if (!itemId) fail("inspect requires an item id");

  const seedArg = args.flags.get("seed");
  const datasetSeed = seedArg ? `esac-custom-${seedArg}` : PUBLIC_DATASET_SEED;
  const instances = instantiate(datasetSeed, "public");
  const instance = instances.find((i) => i.itemId === itemId);
  if (!instance) fail(`no item with id "${itemId}". Run \`esac list\` to see available ids.`);

  console.log(`\n=== ${instance.itemId} (${instance.category}) ===`);
  console.log(`fingerprint: ${instance.fingerprint}`);
  console.log(`judge-graded: ${instance.judgeGraded}`);
  console.log(`\n--- PROMPT ---\n${instance.prompt}`);
  console.log(`\n--- CHECKS ---`);
  for (const check of instance.checks) {
    console.log(`  ${check.id} (weight ${check.weight}) — ${check.grader.type}`);
    if (check.expected !== undefined) console.log(`    expected: ${trim(check.expected, 400)}`);
  }
  if (instance.reference !== undefined) {
    console.log(`\n--- REFERENCE ANSWER (never sent to the model) ---\n${trim(instance.reference, 400)}`);
  }
  console.log("");
}

/** Emit the scoring key for a pool. This is the held-out artifact. */
function cmdKey(args: Args, split: Split, datasetSeed: string): void {
  const instances = instantiate(datasetSeed, split === "heldout" ? "heldout" : "public");
  const key = {
    versionTag: ESAC_VERSION_TAG,
    split,
    seedFingerprint: seedFingerprint(datasetSeed),
    canary: CANARY,
    items: instances.map((i) => ({
      itemId: i.itemId,
      fingerprint: i.fingerprint,
      reference: i.reference ?? null,
      checks: i.checks.map((c) => ({
        id: c.id,
        weight: c.weight,
        graderType: c.grader.type,
        expected: c.expected ?? null,
      })),
    })),
  };

  const out = args.flags.get("out");
  const body = JSON.stringify(key, null, 2);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body, "utf8");
    console.log(`Wrote scoring key for ${instances.length} items to ${out}`);
  } else {
    console.log(body);
  }
}

async function cmdRun(args: Args): Promise<void> {
  validateBank();

  const split = (args.flags.get("split") ?? "public") as Split;
  if (split !== "public" && split !== "heldout" && split !== "both") {
    fail(`--split must be public, heldout, or both (got "${split}")`);
  }

  const datasetSeed = datasetSeedFor(split === "both" ? "heldout" : split, args.flags.get("seed"));

  const modelSpec = args.flags.get("model") ?? "oracle";
  const judgeSpec = args.flags.get("judge");
  const dryRun = modelSpec === "oracle";

  // Select instances.
  let instances: Instance[] = [];
  const pools: readonly ("public" | "heldout")[] =
    split === "both" ? ["public", "heldout"] : [split];
  for (const pool of pools) {
    instances.push(...instantiate(datasetSeed, pool));
  }

  const filter = args.flags.get("items");
  if (filter) {
    const wanted = filter.split(",").map((s) => s.trim());
    const categoryIds = new Set(CATEGORIES.map((c) => c.id as string));
    instances = instances.filter(
      (i) => wanted.includes(i.itemId) || wanted.includes(i.category as string),
    );
    if (instances.length === 0) {
      fail(`--items matched nothing. Known categories: ${[...categoryIds].join(", ")}`);
    }
  }

  const judgeGradedPresent = instances.some((i) => i.judgeGraded);
  if (judgeGradedPresent && !judgeSpec && !dryRun) {
    fail(
      "this selection includes judge-graded items, so --judge is required.\n" +
        "  Example: --judge https://api.deepseek.com/v1|deepseek-chat|DEEPSEEK_API_KEY",
    );
  }

  const model = buildAdapter(modelSpec, "model") as ModelAdapter;

  // The oracle exists to exercise the harness, so it is given the reference answers
  // for the instances actually selected. Without this, `--model oracle` would score
  // zero and the dry run would say nothing useful about the pipeline.
  if (dryRun && "answerKey" in model) {
    const key = (model as { answerKey: Map<string, string> }).answerKey;
    for (const instance of instances) {
      if (instance.reference !== undefined && !instance.judgeGraded) {
        key.set(instance.prompt, instance.reference);
      }
    }
  }
  const judge: JudgeAdapter | null = judgeSpec
    ? (buildAdapter(judgeSpec, "judge") as JudgeAdapter)
    : judgeGradedPresent
      ? createOracleJudge({ fixedFraction: 0.8 })
      : null;

  const ordered = orderItems(instances);
  const quiet = args.flags.has("quiet");

  console.log(
    `\n${ESAC_VERSION_TAG}  ·  split: ${split}  ·  model: ${model.id}  ·  ` +
      `${ordered.length} items  ·  ${judge ? `judge: ${judge.id}` : "no judge"}`,
  );
  if (dryRun) {
    console.log("  NOTE: oracle adapter — this exercises the harness, it does not measure a model.\n");
  } else {
    console.log("");
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const results: ItemRunResult[] = [];
  let runningAwarded = 0;
  let runningPossible = 0;
  let infraAborted = false;

  for (const instance of ordered) {
    const template = ITEMS_BY_ID.get(instance.itemId)!;
    const points = itemPoints(template);
    runningPossible += points;

    try {
      const result = await runItem(instance, { model, judge });
      results.push(result);
      runningAwarded += result.fraction * points;

      if (!quiet) {
        const pct = ((runningAwarded / runningPossible) * 100).toFixed(1);
        const status = result.modelFailed ? "model-fail" : `${(result.fraction * 100).toFixed(0)}%`;
        console.log(
          `  [${String(results.length).padStart(2)}/${ordered.length}] ` +
            `${instance.itemId.padEnd(36)} ${status.padStart(10)}  ` +
            `running: ${runningAwarded.toFixed(2)}/${runningPossible.toFixed(2)} (${pct}%)`,
        );
      }
    } catch (err) {
      // An unrecoverable infrastructure failure. Reported and the run is stopped:
      // scoring the remaining items would produce a number that looks like a
      // measurement but is partly an outage (resolution 8).
      console.error(
        `\n  infrastructure failure on ${instance.itemId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        `  The run is stopped rather than scored, so that an evaluation-system failure is not ` +
          `reported as a model score.\n`,
      );
      infraAborted = true;
      break;
    }
  }

  if (infraAborted) process.exit(2);

  const durationMs = Date.now() - startMs;
  const report = scoreRun({
    items: results,
    split,
    datasetSeed,
    model: model.id,
    judge: judge?.id ?? null,
    startedAt,
    durationMs,
  });

  console.log(renderReport(report, { verbose: args.flags.has("verbose") }));

  const jsonPath = args.flags.get("json");
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, toJson(report), "utf8");
    console.log(`Full report written to ${jsonPath}\n`);
  }

  process.exit(report.passed ? 0 : 1);
}

/**
 * Self-test: verify the harness end-to-end without a network.
 *
 * Checks the properties that matter for trust in the numbers: the bank validates,
 * generators are deterministic and stable across runs, a perfect oracle scores
 * 75/75 and passes, a zero oracle scores 0 and fails, and infrastructure failures
 * neither score nor aborted the run.
 */
async function cmdSelftest(): Promise<void> {
  const failures: string[] = [];
  const note = (ok: boolean, label: string): void => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  console.log(`\n${ESAC_VERSION_TAG} self-test\n`);

  console.log("bank validation");
  try {
    validateBank();
    note(true, "bank validates against the published distribution");
  } catch (err) {
    note(false, `bank validation: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\ngenerator determinism");
  const seed = PUBLIC_DATASET_SEED;
  const first = instantiate(seed, "public");
  const second = instantiate(seed, "public");
  note(
    JSON.stringify(first.map((i) => i.fingerprint)) === JSON.stringify(second.map((i) => i.fingerprint)),
    "same seed produces identical fingerprints across runs",
  );
  note(first.length === TOTAL_ITEMS, `public pool has ${TOTAL_ITEMS} items (got ${first.length})`);

  // Parametrized items must yield a different instance under the held-out seed.
  // Scenario-pool items (writing, response-depth) deliberately do not: their context
  // *is* the construct, so they rotate at the pool level across releases instead.
  // Asserting the right property for each kind is what makes the split claim precise.
  const heldout = instantiate("esac-selftest-heldout", "heldout");
  const parametrizedPublic = first.filter((i) => i.parametrized);
  const scenarioPublic = first.filter((i) => !i.parametrized);
  const allParametrizedDiffer = parametrizedPublic.every(
    (i) => heldout.find((h) => h.itemId === i.itemId)?.fingerprint !== i.fingerprint,
  );
  note(
    allParametrizedDiffer,
    `${parametrizedPublic.length} parametrized items all differ between public and held-out seeds`,
  );
  note(
    scenarioPublic.length > 0 && scenarioPublic.every((i) => !i.parametrized),
    `${scenarioPublic.length} scenario-pool items are flagged as rotating at pool level`,
  );

  console.log("\ngolden answers");
  let goldenOk = 0;
  let goldenTotal = 0;
  for (const instance of first) {
    if (instance.reference === undefined || instance.judgeGraded) continue;
    goldenTotal++;
    const { fraction } = gradeChecks(instance.checks, instance.reference);
    if (fraction === 1) goldenOk++;
    else failures.push(`golden answer fails its own checks: ${instance.itemId} (${fraction})`);
  }
  note(
    goldenOk === goldenTotal,
    `every deterministic reference answer scores 100% (${goldenOk}/${goldenTotal})`,
  );
  if (goldenOk !== goldenTotal) {
    for (const instance of first) {
      if (instance.reference === undefined || instance.judgeGraded) continue;
      const { fraction } = gradeChecks(instance.checks, instance.reference);
      if (fraction !== 1) console.log(`        ${instance.itemId}: ${fraction}`);
    }
  }

  console.log("\nnegative controls");
  let wrongOk = 0;
  let wrongTotal = 0;
  for (const instance of first) {
    if (instance.judgeGraded) continue;
    wrongTotal++;
    const { fraction } = gradeChecks(instance.checks, "I am not sure about this one.");
    if (fraction < 1) wrongOk++;
  }
  note(wrongOk === wrongTotal, `a non-answer scores below 100% on every deterministic item (${wrongOk}/${wrongTotal})`);

  console.log("\nend-to-end run with a perfect oracle");
  const oracle = createOracleAdapter({ accuracy: 1 });
  for (const instance of first) {
    if (instance.reference !== undefined && !instance.judgeGraded) {
      oracle.answerKey.set(instance.prompt, instance.reference);
    }
  }
  const judge = createOracleJudge({ fixedFraction: 1 });
  const results: ItemRunResult[] = [];
  for (const instance of orderItems(first)) {
    results.push(await runItem(instance, { model: oracle, judge }));
  }
  const perfect = scoreRun({
    items: results,
    split: "public",
    datasetSeed: seed,
    model: oracle.id,
    judge: judge.id,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  note(
    Math.abs(perfect.total - perfect.totalPossible) < 1e-6,
    `perfect answers score ${perfect.totalPossible}/${perfect.totalPossible} (got ${perfect.total.toFixed(2)})`,
  );
  note(perfect.passed, "a perfect run passes");
  note(
    results.filter((r) => r.judgeGraded).every((r) => r.modelRuns === REPLICATION.judgeModelRuns),
    `judge-graded items ran the model ${REPLICATION.judgeModelRuns}x (2x2 protocol)`,
  );
  note(
    results.filter((r) => !r.judgeGraded).every((r) => r.modelRuns === REPLICATION.deterministicModelRuns),
    "deterministic items ran the model once",
  );

  console.log("\ninfrastructure failure handling");
  let infraAttempts = 0;
  const flaky: ModelAdapter = {
    id: "flaky",
    async complete() {
      infraAttempts++;
      if (infraAttempts <= 2) {
        const { InfrastructureError } = await import("./types.ts");
        throw new InfrastructureError("simulated transport failure");
      }
      return { text: "recovered", promptTokens: 0, completionTokens: 0 };
    },
  };
  const probe: Instance = {
    itemId: "selftest.probe",
    category: "logic",
    seed: 1,
    fingerprint: "00000000",
    prompt: "probe",
    checks: [{ id: "a", weight: 1, grader: { type: "programmatic", check: { description: "ok", run: () => 1 } } }],
    judgeGraded: false,
    parametrized: true,
  };
  const probeResult = await runItem(probe, { model: flaky, judge: null });
  note(infraAttempts === 3, `infrastructure failure retried, then succeeded (attempts: ${infraAttempts})`);
  note(probeResult.infraRetries === 2, `retry count recorded (${probeResult.infraRetries})`);
  note(probeResult.fraction === 1, "recovered response was scored normally, not zeroed");

  console.log("\nthreshold behaviour");
  const exactly60 = scoreRun({
    items: results.map((r) => ({ ...r, fraction: 0.6 })),
    split: "public",
    datasetSeed: seed,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  note(exactly60.passed, "exactly 60% in every category passes");
  const justUnder = scoreRun({
    items: results.map((r) => ({ ...r, fraction: 0.59 })),
    split: "public",
    datasetSeed: seed,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  note(!justUnder.passed, "59% fails");
  const oneCategoryDown = scoreRun({
    items: results.map((r) => ({ ...r, fraction: r.category === "depth" ? 0.2 : 0.95 })),
    split: "public",
    datasetSeed: seed,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  note(
    !oneCategoryDown.passed && oneCategoryDown.failedCategories.includes("depth"),
    "high overall score still fails if one category is below threshold",
  );

  console.log(
    `\n  version ${ESAC_VERSION_TAG}  ·  decoding temperature ${DECODING.temperature}  ·  ` +
      `canary ${CANARY}\n`,
  );

  if (failures.length > 0) {
    console.error(`  ${failures.length} self-test failure(s):\n`);
    for (const f of failures) console.error(`    - ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log("  all checks passed\n");
}

function trim(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  switch (args.command) {
    case "list":
      cmdList();
      break;

    case "export": {
      const split = (args.flags.get("split") ?? "public") as Split;
      cmdExport(args, split, datasetSeedFor(split === "heldout" ? "heldout" : "public", args.flags.get("seed")));
      break;
    }

    case "inspect":
      cmdInspect(args);
      break;

    case "key": {
      const split = (args.flags.get("split") ?? "heldout") as Split;
      cmdKey(args, split, datasetSeedFor(split === "heldout" ? "heldout" : "public", args.flags.get("seed")));
      break;
    }

    case "run":
      await cmdRun(args);
      break;

    case "selftest":
      await cmdSelftest();
      break;

    case "version":
      console.log(`${ESAC_VERSION_TAG} (${TOTAL_POINTS} points, ${TOTAL_ITEMS} items)`);
      console.log(`canary: ${CANARY}`);
      break;

    case "":
    case "help":
    case "--help":
      console.log(helpText());
      break;

    default:
      fail(`unknown command "${args.command}". Run \`esac help\`.`);
  }
}

function helpText(): string {
  return `
ESAC-GI — EcoWestern Short and Cheap General Intelligence Benchmark

  esac list                                  show the item bank and point allocation
  esac export [--split public|heldout] [--out <file>]
                                             write a JSONL snapshot of a pool
  esac inspect <itemId> [--seed <s>]         render one generated instance
  esac key [--split heldout] [--out <file>]  emit the scoring key for a pool
  esac run [options]                         run the benchmark
  esac selftest                              verify the harness end-to-end, offline
  esac version                               print the version tag and canary

run options:
  --model <spec>     "oracle" (harness self-test) or "<baseUrl>|<model>|<envVar>"
  --judge <spec>     same shape; required when judge-graded items are selected
  --split <s>        public (default) | heldout | both
  --items <list>     comma-separated item ids or category ids
  --json <path>      write the full report as JSON
  --verbose          include per-check detail in the report
  --quiet            suppress the per-item progress tally

Environment:
  ${HELD_OUT_DATASET_SEED_ENV}   dataset seed for the held-out pool (never commit it)

Notes:
  The reported score is always out of ${TOTAL_POINTS}, and passing requires
  ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% in every category plus ${(PASS_THRESHOLD.overall * 100).toFixed(0)}% overall. Scores are only
  comparable within the same major version (${ESAC_VERSION_TAG}).
`;
}

await main();
