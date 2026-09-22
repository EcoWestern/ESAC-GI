#!/usr/bin/env node
/**
 * ESAC-GI command-line interface.
 *
 * Usage:
 *   esac list                                     show the item bank
 *   esac export [--split public|heldout]          write a JSONL snapshot
 *   esac inspect <itemId> [--seed <s>]            render one instance
 *   esac key --split heldout                      emit the held-out scoring key
 *   esac seed [show] [--force] [--out <path>]    generate or inspect a held-out seed
 *   esac run [options]                            run the benchmark
 *   esac selftest                                 verify the harness end-to-end
 *
 * `run` options:
 *   --model <spec>        baseUrl|model|apiKeyEnvVar   (or `oracle` for a dry run)
 *   --judge <spec>        same shape; required only for judge-graded items
 *   --allow-unpinned-judge  run with a judge other than the one pinned for this release
 *   --split <s>           public (default) | heldout
 *   --items <a,b,c>       restrict to these item ids or category ids
 *   --json <path>         write the full report as JSON
 *   --quiet               suppress the per-item progress tally
 *
 * `auto` options (a guided setup, then a run summarized section by section):
 *   --model <spec>        answer the questions up front and skip the conversation
 *   --judge <spec>        the pinned judge is used if this is omitted
 *   --split <s>           public (default) | heldout
 *   --items <a,b,c>       restrict to these item ids or category ids
 *   --json <path>         write the full report as JSON
 *   --yes                 never prompt, for scripts; requires --model
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { CATEGORIES, CATEGORY_BY_ID, TOTAL_ITEMS, TOTAL_POINTS } from "./categories.ts";
import { ALL_ITEMS, ITEMS_BY_ID, instantiate, validateBank, itemPoints, seedFingerprint } from "./registry.ts";
import { orderItems, runItem } from "./runner.ts";
import { scoreRun, renderReport, renderFinalReport, toJson } from "./score.ts";
import { createHttpAdapter, createOracleAdapter, createOracleJudge } from "./adapters.ts";
import { PUBLIC_DATASET_SEED, HELD_OUT_DATASET_SEED_ENV, ESAC_VERSION_TAG, CANARY, PINNED_JUDGE, isPinnedJudge, REPLICATION, DECODING, PASS_THRESHOLD } from "./version.ts";
import { gradeChecks } from "./graders.ts";
import { resolveAutoConfig, type AutoConfig } from "./auto.ts";
import { loadDotEnv } from "./env.ts";
import { parseExtraBody, parseMaxTokens, parseThinkingTokens } from "./flags.ts";
import {
  HELD_OUT_SEED_FILE,
  generateSeed,
  missingSeedMessage,
  readSeedFile,
  resolveHeldOutSeed,
  writeSeedFile,
} from "./seedfile.ts";
import type { CategoryId, Instance, ItemRunResult, JudgeAdapter, ModelAdapter, RunReport, Split } from "./types.ts";

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
  if (split === "public") return PUBLIC_DATASET_SEED;

  // Held-out: the flag was already handled above, so this is the environment, then the
  // stored seed, then a refusal. Refusing is deliberate: a seed invented on the spot
  // could not be reproduced afterwards, and reproducing a run is the whole point.
  const resolved = resolveHeldOutSeed({ environment: process.env[HELD_OUT_DATASET_SEED_ENV] });
  if (!resolved) fail(missingSeedMessage());
  return resolved.seed;
}

/** The message for a `--split` value that is not a pool. */
function notAPool(value: string): string {
  return value === "both"
    ? '--split no longer takes "both": one run is one pool. Run the two pools'
      + " separately and compare the reports."
    : `--split must be public or heldout (got "${value}")`;
}

/** Resolve the `--split` flag, refusing anything that is not a pool. */
function splitFlag(raw: string | undefined, fallback: Split): Split {
  if (raw === undefined) return fallback;
  if (raw === "public" || raw === "heldout") return raw;
  fail(notAPool(raw));
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
function buildAdapter(
  spec: string,
  role: "model" | "judge",
  extraBody?: Record<string, unknown>,
): ModelAdapter | JudgeAdapter {
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
  if (keyEnv && !apiKey) {
    fail(
      `environment variable ${keyEnv} is empty or unset.\n` +
        "  Export it, or put it in a .env file in the working directory.",
    );
  }

  return createHttpAdapter({
    id: `${model}@${new URL(baseUrl).host}`,
    baseUrl,
    model,
    apiKey,
    ...(extraBody ? { extraBody } : {}),
  });
}

/** The model id named by an adapter spec, or `oracle` for the built-in adapter. */
function adapterModelOf(spec: string): string {
  if (spec === "oracle") return "oracle";
  const parts = spec.split("|");
  return (parts[1] ?? "").trim();
}

/** Read a flag and parse it, turning a parser complaint into CLI output. */
function parseFlag<T>(args: Args, name: string, parse: (raw: string) => T): T | undefined {
  const raw = args.flags.get(name);
  if (raw === undefined) return undefined;
  try {
    return parse(raw);
  } catch (err) {
    return fail(`--${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Request extras for the model under test: a named thinking budget plus any raw fields,
 * with an explicit --extra-body winning on a name collision.
 */
function extraBodyFlags(args: Args): Record<string, unknown> | undefined {
  const thinking = parseFlag(args, "thinking-tokens", parseThinkingTokens);
  const raw = parseFlag(args, "extra-body", parseExtraBody);
  if (!thinking && !raw) return undefined;
  return { ...(thinking ?? {}), ...(raw ?? {}) };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(): void {
  validateBank();
  console.log(`\n${ESAC_VERSION_TAG}: ${TOTAL_ITEMS} items across ${CATEGORIES.length} categories, ${TOTAL_POINTS} points\n`);
  for (const category of CATEGORIES) {
    const items = ALL_ITEMS.filter((i) => i.category === category.id);
    const grading = category.grading === "judge" ? "judge" : "deterministic";
    console.log(
      `${category.name}: ${category.points} pts, ${items.length} items, ${grading}`,
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
    `# ${ESAC_VERSION_TAG}: ${split} pool, ${instances.length} instances`,
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
    console.log(`  ${check.id} (weight ${check.weight}), ${check.grader.type}`);
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

/**
 * Generate or inspect the held-out seed.
 *
 * The seed is the only private input the benchmark has, so this command is deliberately
 * small and explicit. It never generates a seed as a side effect of anything else, and it
 * never replaces one without being asked, because a report that cites a fingerprint is
 * only reproducible while the seed behind it still exists.
 */
function cmdSeed(args: Args): void {
  const action = args.positional[0] ?? "new";
  const path = args.flags.get("out") ?? HELD_OUT_SEED_FILE;

  if (action === "show") {
    const stored = readSeedFile(path);
    if (stored === null) {
      fail(`no held-out seed at ${path}. Run \`esac seed\` to generate one.`);
    }
    console.log(`seed file:   ${path}`);
    console.log(`fingerprint: ${seedFingerprint(stored)}`);
    if (args.flags.has("reveal")) {
      console.log(`seed:        ${stored}`);
    } else {
      console.log(
        "\nThe seed itself stays in the file. --reveal prints it, which makes it a public\n" +
          "value: anything printed can end up in a log, a scrollback buffer, or a screenshot.",
      );
    }
    return;
  }

  if (action !== "new") {
    fail(`seed takes "new" (the default) or "show" (got "${action}")`);
  }

  const existing = readSeedFile(path);
  if (existing !== null && !args.flags.has("force")) {
    fail(
      `a held-out seed already exists at ${path}, fingerprint ${seedFingerprint(existing)}. ` +
        "Nothing was changed. Pass --force to replace it: any run that cites the old " +
        "fingerprint would stop being reproducible.",
    );
  }

  const seed = generateSeed();
  writeSeedFile(seed, { path, force: true });
  console.log(`Generated a held-out seed and wrote it to ${path}\n`);
  console.log(`fingerprint: ${seedFingerprint(seed)}`);
  console.log(`seed:        ${seed}\n`);
  console.log("The fingerprint is safe to publish and is what a report records. Keep the seed");
  console.log("itself out of the repository and out of any log: the split rests on nobody");
  console.log("else having it, and the file is gitignored for that reason.");
}

/** Normalised inputs for a run, whatever produced them. */
interface RunRequest {
  readonly split: Split;
  readonly modelSpec: string;
  readonly judgeSpec: string | null;
  readonly itemsFilter: string | null;
  readonly seed: string | undefined;
  /** Output cap for the model under test. Undefined uses the benchmark's own limit. */
  readonly maxTokens: number | undefined;
  /** Extra JSON merged into each model request, for provider-specific parameters. */
  readonly extraBody: Record<string, unknown> | undefined;
  /** True when the caller has already accepted a judge that is not the pinned one. */
  readonly allowUnpinnedJudge: boolean;
}

/** Everything needed to execute a run, with validation already done. */
interface RunPlan {
  readonly split: Split;
  readonly datasetSeed: string;
  readonly instances: readonly Instance[];
  readonly model: ModelAdapter;
  readonly judge: JudgeAdapter | null;
  readonly judgePinned: boolean;
  readonly dryRun: boolean;
  readonly maxTokens: number | undefined;
}

/**
 * Turn a request into a plan, refusing anything that would produce a misleading score.
 *
 * Shared by `run` and `auto`, so the judge discipline cannot differ between them.
 */
function planRun(request: RunRequest): RunPlan {
  validateBank();

  const split = request.split;
  const datasetSeed = datasetSeedFor(split, request.seed);
  const dryRun = request.modelSpec === "oracle";

  // Instantiate the pool. A pool name selects no items of its own: both pools come from
  // the same templates, so the name matters only through the seed it resolves to.
  let instances: Instance[] = instantiate(datasetSeed, split);

  if (request.itemsFilter) {
    const wanted = request.itemsFilter.split(",").map((s) => s.trim());
    instances = instances.filter(
      (i) => wanted.includes(i.itemId) || wanted.includes(i.category as string),
    );
    if (instances.length === 0) {
      fail(
        "--items matched nothing. Known categories: " +
          `${CATEGORIES.map((c) => c.id).join(", ")}`,
      );
    }
  }

  const judgeGradedPresent = instances.some((i) => i.judgeGraded);
  if (judgeGradedPresent && !request.judgeSpec && !dryRun) {
    fail(
      "this selection includes judge-graded items, so --judge is required.\n" +
        "  The judge must be open-weight and pinned per release. An aggregator such as\n" +
        "  OpenRouter is the recommended way to reach one.\n" +
        "  Example: --judge https://openrouter.ai/api/v1|xiaomi/mimo-v2.6-pro|OPENROUTER_API_KEY",
    );
  }

  const model = buildAdapter(request.modelSpec, "model", request.extraBody) as ModelAdapter;

  // The oracle exists to exercise the harness, so it is given the reference answers for
  // the instances actually selected. Without this, `--model oracle` would score zero and
  // the dry run would say nothing useful about the pipeline.
  if (dryRun && "answerKey" in model) {
    const key = (model as { answerKey: Map<string, string> }).answerKey;
    for (const instance of instances) {
      if (instance.reference !== undefined && !instance.judgeGraded) {
        key.set(instance.prompt, instance.reference);
      }
    }
  }

  const judge: JudgeAdapter | null = request.judgeSpec
    ? (buildAdapter(request.judgeSpec, "judge") as JudgeAdapter)
    : judgeGradedPresent
      ? createOracleJudge({ fixedFraction: 0.8 })
      : null;

  // Judge discipline is enforced, not merely documented. Rubric scores are only
  // comparable across runs that used the judge pinned for this release, so any other
  // judge is refused unless the caller states that the run is exploratory. The oracle
  // judge is exempt: it exists to exercise the harness and measures nothing.
  const judgeModel = request.judgeSpec
    ? adapterModelOf(request.judgeSpec)
    : judge
      ? "oracle"
      : null;
  const judgePinned =
    judgeModel !== null && judgeModel !== "oracle" && isPinnedJudge(judgeModel);
  if (judgeGradedPresent && judgeModel !== null && judgeModel !== "oracle" && !judgePinned) {
    if (!request.allowUnpinnedJudge) {
      fail(
        `judge "${judgeModel}" is not the judge pinned for this release (${PINNED_JUDGE}).\n` +
          "  Rubric scores are only comparable across runs that used the pinned judge, so an\n" +
          "  unpinned judge is refused by default. Pass --allow-unpinned-judge to run anyway;\n" +
          "  the run will be reported without a verdict, because a substituted judge decides\n" +
          "  a whole category and the number would not be an ESAC-GI score.",
      );
    }
    console.log(
      `\n  WARNING: judge "${judgeModel}" is not the pinned judge (${PINNED_JUDGE}).\n` +
        "  This run is exploratory; its rubric scores are not comparable with official runs.\n",
    );
  }

  return { split, datasetSeed, instances, model, judge, judgePinned, dryRun, maxTokens: request.maxTokens };
}

/** Outcome of executing a plan: a scored report, or the failure that stopped it. */
interface RunOutcome {
  readonly report: RunReport | null;
  readonly infrastructureFailure: string | null;
}

/**
 * Execute a plan. Printing is the caller's job, so `run` can show a per-item tally while
 * `auto` shows section results, from one execution path.
 *
 * An unrecoverable infrastructure failure stops the run and returns no report, rather
 * than scoring the items that happened to succeed (resolution 8).
 */
async function executeRun(
  plan: RunPlan,
  onItem?: (result: ItemRunResult, position: number, total: number) => void,
): Promise<RunOutcome> {
  const ordered = orderItems(plan.instances);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const results: ItemRunResult[] = [];

  for (const [index, instance] of ordered.entries()) {
    try {
      const result = await runItem(instance, {
        model: plan.model,
        judge: plan.judge,
        maxTokens: plan.maxTokens,
      });
      results.push(result);
      onItem?.(result, index + 1, ordered.length);
    } catch (err) {
      return {
        report: null,
        infrastructureFailure:
          `${instance.itemId}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    report: scoreRun({
      items: results,
      split: plan.split,
      datasetSeed: plan.datasetSeed,
      model: plan.model.id,
      judge: plan.judge?.id ?? null,
      judgePinned: plan.judgePinned,
      maxTokens: plan.maxTokens,
      startedAt,
      durationMs: Date.now() - startMs,
    }),
    infrastructureFailure: null,
  };
}

function reportInfrastructureFailure(detail: string): void {
  console.error(`\n  infrastructure failure on ${detail}`);
  console.error(
    "  The run is stopped rather than scored, so that an evaluation-system failure is not " +
      "reported as a model score.\n",
  );
}

function writeJsonReport(path: string, report: RunReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toJson(report), "utf8");
  console.log(`Full report written to ${path}\n`);
}

/**
 * Exit codes, so a caller can tell a result from a non-result:
 *   0  a valid pass
 *   1  a valid fail, or a run that did not cover the whole suite
 *   2  infrastructure failure, so nothing was scored
 *   3  not a valid ESAC-GI result, because the judge was substituted
 */
function exitCodeFor(report: RunReport): number {
  if (report.verdict === "pass") return 0;
  if (report.verdict === "not-valid") return 3;
  return 1;
}

async function cmdRun(args: Args): Promise<void> {
  const split = splitFlag(args.flags.get("split"), "public");

  const plan = planRun({
    split,
    modelSpec: args.flags.get("model") ?? "oracle",
    judgeSpec: args.flags.get("judge") ?? null,
    itemsFilter: args.flags.get("items") ?? null,
    seed: args.flags.get("seed"),
    maxTokens: parseFlag(args, "max-tokens", parseMaxTokens),
    extraBody: extraBodyFlags(args),
    allowUnpinnedJudge: args.flags.has("allow-unpinned-judge"),
  });

  const quiet = args.flags.has("quiet");
  let runningAwarded = 0;
  let runningPossible = 0;

  console.log(
    `\n${ESAC_VERSION_TAG}  ·  split: ${split}  ·  model: ${plan.model.id}  ·  ` +
      `${plan.instances.length} items  ·  ` +
      `${plan.judge ? `judge: ${plan.judge.id}` : "no judge"}`,
  );
  if (plan.dryRun) {
    console.log("  NOTE: oracle adapter. This exercises the harness; it does not measure a model.\n");
  } else {
    console.log("");
  }

  const outcome = await executeRun(plan, (result, position, total) => {
    const points = itemPoints(ITEMS_BY_ID.get(result.itemId)!);
    runningPossible += points;
    runningAwarded += result.fraction * points;
    if (quiet) return;

    const pct = ((runningAwarded / runningPossible) * 100).toFixed(1);
    const status = result.truncated
      ? "truncated"
      : result.modelFailed
        ? "model-fail"
        : `${(result.fraction * 100).toFixed(0)}%`;
    console.log(
      `  [${String(position).padStart(2)}/${total}] ` +
        `${result.itemId.padEnd(36)} ${status.padStart(10)}  ` +
        `running: ${runningAwarded.toFixed(2)}/${runningPossible.toFixed(2)} (${pct}%)`,
    );
  });

  if (outcome.report === null) {
    reportInfrastructureFailure(outcome.infrastructureFailure!);
    process.exit(2);
  }

  const report = outcome.report;
  console.log(renderReport(report, { verbose: args.flags.has("verbose") }));

  const jsonPath = args.flags.get("json");
  if (jsonPath) writeJsonReport(jsonPath, report);

  process.exit(exitCodeFor(report));
}

/**
 * Tracks per-category progress so auto mode can report a section the moment its last
 * item resolves. Items run cheapest-first with categories interleaved, so sections
 * finish at scattered points rather than in blocks.
 */
function makeCategoryProgress(instances: readonly Instance[]) {
  const totals = new Map<
    CategoryId,
    { items: number; points: number; awarded: number; done: number }
  >();

  for (const instance of instances) {
    const entry =
      totals.get(instance.category) ?? { items: 0, points: 0, awarded: 0, done: 0 };
    entry.items += 1;
    entry.points += itemPoints(ITEMS_BY_ID.get(instance.itemId)!);
    totals.set(instance.category, entry);
  }

  return {
    /** Returns the section totals once its last item has resolved, else null. */
    record(result: ItemRunResult): { id: CategoryId; awarded: number; points: number } | null {
      const entry = totals.get(result.category);
      if (!entry) return null;
      entry.done += 1;
      entry.awarded += result.fraction * itemPoints(ITEMS_BY_ID.get(result.itemId)!);
      if (entry.done < entry.items) return null;
      return { id: result.category, awarded: entry.awarded, points: entry.points };
    },
  };
}

/**
 * Auto mode: ask for the basics, run, and report section by section.
 *
 * The presentation differs from `run` on purpose. `run` is for someone who already has
 * a spec in hand and wants a per-item tally; `auto` is for someone who wants to see each
 * section close and then read one summary.
 */
async function cmdAuto(args: Args): Promise<void> {
  const config: AutoConfig = await resolveAutoConfig({
    modelSpec: args.flags.get("model"),
    judgeSpec: args.flags.get("judge"),
    split: args.flags.get("split"),
    items: args.flags.get("items"),
    jsonPath: args.flags.get("json"),
    allowUnpinnedJudge: args.flags.has("allow-unpinned-judge"),
    yes: args.flags.has("yes"),
  }).catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

  const plan = planRun({
    split: config.split,
    modelSpec: config.modelSpec,
    judgeSpec: config.judgeSpec,
    itemsFilter: config.items,
    seed: args.flags.get("seed"),
    maxTokens: parseFlag(args, "max-tokens", parseMaxTokens),
    extraBody: extraBodyFlags(args),
    allowUnpinnedJudge: config.allowUnpinnedJudge,
  });

  const quiet = args.flags.has("quiet");
  const progress = makeCategoryProgress(plan.instances);

  console.log(
    `\n${ESAC_VERSION_TAG}  starting  ·  ${plan.instances.length} items  ·  ` +
      `model: ${plan.model.id}${plan.judge ? `  ·  judge: ${plan.judge.id}` : ""}`,
  );
  console.log("  Section results appear below as each section completes.\n");

  const outcome = await executeRun(plan, (result, position, total) => {
    if (!quiet) {
      const status = result.truncated
        ? "truncated"
        : result.modelFailed
          ? "model-fail"
          : `${(result.fraction * 100).toFixed(0)}%`;
      console.log(
        `  [${String(position).padStart(2)}/${total}] ` +
          `${result.itemId.padEnd(36)} ${status.padStart(10)}`,
      );
    }

    const section = progress.record(result);
    if (section) {
      const name = CATEGORY_BY_ID.get(section.id)?.name ?? section.id;
      const pct = `${((section.awarded / section.points) * 100).toFixed(1)}%`.padStart(7);
      const raw = `${section.awarded.toFixed(2)} / ${section.points}`.padStart(14);
      console.log(`\n  SECTION  ${name.padEnd(33).slice(0, 33)} ${raw} ${pct}\n`);
    }
  });

  if (outcome.report === null) {
    reportInfrastructureFailure(outcome.infrastructureFailure!);
    process.exit(2);
  }

  const report = outcome.report;
  console.log(renderFinalReport(report));
  if (config.jsonPath) writeJsonReport(config.jsonPath, report);
  process.exit(exitCodeFor(report));
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
    judgePinned: false,
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
    judgePinned: false,
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
    judgePinned: false,
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
    judgePinned: false,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  note(
    !oneCategoryDown.passed && oneCategoryDown.failedCategories.includes("depth"),
    "high overall score still fails if one category is below threshold",
  );

  console.log(
    `\n  version ${ESAC_VERSION_TAG}  ·  decoding temperature ${DECODING.temperature}  ·  ` +
      `pinned judge ${PINNED_JUDGE}  ·  canary ${CANARY}\n`,
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
  // Load a working-directory .env before anything reads a key. Variables exported in the
  // real environment win, so a CI secret is never shadowed by a stale file.
  loadDotEnv();

  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  switch (args.command) {
    case "list":
      cmdList();
      break;

    case "export": {
      const split = splitFlag(args.flags.get("split"), "public");
      cmdExport(args, split, datasetSeedFor(split, args.flags.get("seed")));
      break;
    }

    case "inspect":
      cmdInspect(args);
      break;

    case "key": {
      const split = splitFlag(args.flags.get("split"), "heldout");
      cmdKey(args, split, datasetSeedFor(split, args.flags.get("seed")));
      break;
    }

    case "seed":
      cmdSeed(args);
      break;

    case "run":
      await cmdRun(args);
      break;

    case "auto":
      await cmdAuto(args);
      break;

    case "selftest":
      await cmdSelftest();
      break;

    case "version":
      console.log(`${ESAC_VERSION_TAG} (${TOTAL_POINTS} points, ${TOTAL_ITEMS} items)`);
      console.log(`canary: ${CANARY}`);
      console.log(`pinned judge: ${PINNED_JUDGE}`);
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
ESAC-GI: EcoWestern Short and Cheap General Intelligence Benchmark

  esac list                                  show the item bank and point allocation
  esac export [--split public|heldout] [--out <file>]
                                             write a JSONL snapshot of a pool
  esac inspect <itemId> [--seed <s>]         render one generated instance
  esac key [--split heldout] [--out <file>]  emit the scoring key for a pool
  esac seed [show] [--force] [--out <path>]  generate or inspect the held-out seed
  esac run [options]                         run the benchmark
  esac auto [options]                        guided setup, then a run with a summary
  esac selftest                              verify the harness end-to-end, offline
  esac version                               print the version tag and canary

run options:
  --model <spec>     "oracle" (harness self-test) or "<baseUrl>|<model>|<envVar>"
  --judge <spec>     same shape; required when judge-graded items are selected
  --split <s>        public (default) | heldout
  --items <list>     comma-separated item ids or category ids
  --max-tokens <n>   output cap for the model under test (default 4096)
  --thinking-tokens <n>
                     separate budget for the model's hidden reasoning, where the
                     provider supports it, so thinking does not spend the answer cap
  --extra-body <json>
                     extra JSON merged into each model request, for other provider
                     parameters
  --json <path>      write the full report as JSON
  --verbose          include per-check detail in the report
  --quiet            suppress the per-item progress tally
  --allow-unpinned-judge
                     run with a judge other than the one pinned for this release

Environment:
  ${HELD_OUT_DATASET_SEED_ENV}   dataset seed for the held-out pool (never commit it)
  API keys             named by each adapter spec, read from the environment or from a
                       .env file in the working directory

Notes:
  A held-out run takes its seed from --seed, then ${HELD_OUT_DATASET_SEED_ENV}, then
  ${HELD_OUT_SEED_FILE}. Generate one with \`esac seed\`. The seed never leaves the machine.
  The harness is an OpenAI-compatible client: any chat-completions endpoint works.
  An aggregator such as OpenRouter is the recommended way to reach an open-weight judge.
  auto: asks for the model, judge, pool, and categories, then runs and prints a
  section-by-section summary. Pass --model to answer everything up front and skip the
  questions entirely.
  The judge pinned for this release is ${PINNED_JUDGE}; the judge actually used is
  recorded in every report. A run under any other judge is reported without a verdict.
  The reported score is always out of ${TOTAL_POINTS}, and passing requires
  ${(PASS_THRESHOLD.perCategory * 100).toFixed(0)}% in every category plus ${(PASS_THRESHOLD.overall * 100).toFixed(0)}% overall. Scores are only
  comparable within the same major version (${ESAC_VERSION_TAG}).
`;
}

await main();
