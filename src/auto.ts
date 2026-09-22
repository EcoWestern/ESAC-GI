/**
 * Auto mode: a short setup conversation, then an unattended run.
 *
 * Two things make a first run awkward: assembling an adapter spec from memory, and
 * knowing that the judge has to be open-weight and pinned rather than whichever model
 * happens to be convenient. Auto mode asks for neither. A bare model id is expanded
 * against a sensible aggregator default, and the judge defaults to the pinned judge.
 *
 * This module only collects configuration. The CLI owns execution, so `run` and `auto`
 * share one code path and cannot drift apart.
 */

import { createInterface } from "node:readline/promises";
import { PINNED_JUDGE, isPinnedJudge, HELD_OUT_DATASET_SEED_ENV } from "./version.ts";
import { seedFingerprint } from "./registry.ts";
import { generateSeed, resolveHeldOutSeed, writeSeedFile } from "./seedfile.ts";
import type { Split } from "./types.ts";

/** Base URL assumed when the answer is a bare model id rather than a full spec. */
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** Environment variable assumed to hold the key for that base URL. */
const DEFAULT_KEY_ENV = "OPENROUTER_API_KEY";

/** The judge used when the user does not name one. */
export const DEFAULT_JUDGE_SPEC = `${DEFAULT_BASE_URL}|${PINNED_JUDGE}|${DEFAULT_KEY_ENV}`;

export interface AutoOverrides {
  readonly modelSpec?: string | undefined;
  readonly judgeSpec?: string | undefined;
  readonly split?: string | undefined;
  readonly items?: string | undefined;
  readonly jsonPath?: string | undefined;
  /** Set when the caller has already accepted an unpinned judge. */
  readonly allowUnpinnedJudge?: boolean | undefined;
  /** Skip the conversation entirely. Every required value must then be supplied. */
  readonly yes?: boolean | undefined;
}

export interface AutoConfig {
  readonly modelSpec: string;
  readonly judgeSpec: string | null;
  readonly split: Split;
  readonly items: string | null;
  readonly jsonPath: string | null;
  readonly allowUnpinnedJudge: boolean;
}

/**
 * Expand an answer into an adapter spec.
 *
 * `oracle` passes through, a string containing `|` is already a spec, and anything else
 * is treated as a model id on the default aggregator, which is what most people will
 * type. An empty answer yields the fallback.
 */
export function normaliseSpec(answer: string, fallback: string | null): string | null {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed === "oracle") return "oracle";
  if (trimmed.includes("|")) return trimmed;
  return `${DEFAULT_BASE_URL}|${trimmed}|${DEFAULT_KEY_ENV}`;
}

/** The model id inside an adapter spec, or `oracle`. */
export function modelIdOf(spec: string): string {
  return spec === "oracle" ? "oracle" : (spec.split("|")[1] ?? "").trim();
}

/**
 * Why a spec cannot be used, or null if it can.
 *
 * Checked during the conversation rather than at the first API call, so a mistyped URL
 * or an unexported key is caught before a run starts.
 */
export function specProblem(spec: string): string | null {
  if (spec === "oracle") return null;

  const parts = spec.split("|");
  const baseUrl = (parts[0] ?? "").trim();
  if (parts.length < 2 || (parts[1] ?? "").trim().length === 0) {
    return 'An adapter spec needs at least "baseUrl|model".';
  }

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return `"${baseUrl}" is not a URL. Include the scheme, for example ${DEFAULT_BASE_URL}`;
  }
  if (host.length === 0) return `"${baseUrl}" has no host.`;

  const env = (parts[2] ?? "").trim();
  if (env.length > 0 && !process.env[env]) {
    return (
      `Environment variable ${env} is not set. Export it, put it in a .env file, ` +
      "or name another one."
    );
  }

  return null;
}

function validateSplit(value: string): Split {
  if (value === "public" || value === "heldout") return value;
  // A combined mode cannot be expressed: the pool decides which seed the run resolves,
  // and there is no single seed for two pools.
  if (value === "both") {
    throw new Error(
      'pool must be public or heldout. "both" is not a run mode: run each pool ' +
        "separately and compare the two reports.",
    );
  }
  throw new Error(`pool must be public or heldout (got "${value}")`);
}

/**
 * Make sure a held-out run has a seed before it starts.
 *
 * Auto mode is the turnkey path, so discovering a missing seed after choosing the pool is
 * the wrong end of the conversation to find out. This asks once, here, and stores the
 * answer in the same file `esac seed` writes, which is where the run then resolves it.
 *
 * Non-interactive runs never get this far: generating a seed implicitly in a scripted or
 * CI run would produce a seed nobody holds, and therefore a comparison nobody can repeat.
 */
async function settleHeldOutSeed(
  ask: (question: string) => Promise<string>,
  split: Split,
): Promise<void> {
  if (split !== "heldout") return;

  const existing = resolveHeldOutSeed({ environment: process.env[HELD_OUT_DATASET_SEED_ENV] });
  if (existing) {
    console.log(
      `  held-out seed from the ${existing.source}, fingerprint ${seedFingerprint(existing.seed)}`,
    );
    return;
  }

  const answer = (await ask("  No held-out seed found. Generate one now? [Y/n] > ")).toLowerCase();
  if (answer === "n" || answer === "no") {
    throw new Error(
      `a held-out run needs a seed. Set ${HELD_OUT_DATASET_SEED_ENV}, or run \`esac seed\`.`,
    );
  }

  const seed = generateSeed();
  const path = writeSeedFile(seed);
  console.log(`  Wrote a new held-out seed to ${path}, fingerprint ${seedFingerprint(seed)}`);
  console.log("  Keep it out of the repository. Later runs reuse it automatically.");
}

/** Resolve the run configuration, prompting when there is a terminal to prompt on. */export async function resolveAutoConfig(overrides: AutoOverrides): Promise<AutoConfig> {
  const split = overrides.split === undefined ? "public" : validateSplit(overrides.split.trim());
  const items = overrides.items?.trim() || null;
  const jsonPath = overrides.jsonPath?.trim() || null;

  // Non-interactive when told to be, or when there is nothing to prompt on. A piped
  // stdin would otherwise hang waiting for answers that are never coming.
  const nonInteractive = overrides.yes === true || !process.stdin.isTTY;
  if (nonInteractive) {
    if (!overrides.modelSpec) {
      throw new Error(
        "auto mode needs a model. Pass --model <spec>, or run it on a terminal to be asked.",
      );
    }
    const modelSpec = normaliseSpec(overrides.modelSpec, null)!;
    const problem = specProblem(modelSpec);
    if (problem) throw new Error(`--model: ${problem}`);

    const judgeSpec = normaliseSpec(overrides.judgeSpec ?? "", DEFAULT_JUDGE_SPEC);
    if (judgeSpec) {
      const judgeProblem = specProblem(judgeSpec);
      if (judgeProblem) throw new Error(`--judge: ${judgeProblem}`);
    }

    return {
      modelSpec,
      judgeSpec,
      split,
      items,
      jsonPath,
      allowUnpinnedJudge: overrides.allowUnpinnedJudge === true,
    };
  }

  return converse({ split: split, items, jsonPath, overrides });
}

interface ConversationState {
  readonly split: Split;
  readonly items: string | null;
  readonly jsonPath: string | null;
  readonly overrides: AutoOverrides;
}

async function converse(state: ConversationState): Promise<AutoConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string): Promise<string> => (await rl.question(question)).trim();

  try {
    console.log("\nESAC-GI auto mode");
    console.log("A few questions. Press Enter to accept the default shown in [brackets].\n");

    const modelSpec = await chooseModel(ask, state.overrides.modelSpec ?? null);
    const judge = await chooseJudge(
      ask,
      state.overrides.judgeSpec ?? null,
      state.overrides.allowUnpinnedJudge === true,
    );

    console.log("Pool");
    const splitAnswer = await ask(
      `  public or heldout [${state.split}] > `,
    );
    const split = validateSplit(
      splitAnswer.length === 0 ? state.split : splitAnswer.toLowerCase(),
    );
    await settleHeldOutSeed(ask, split);

    console.log("Categories");
    console.log("  Comma-separated category or item ids, or Enter for the whole suite.");
    const itemsAnswer = await ask("  [all] > ");
    const items = itemsAnswer.length === 0 ? state.items : itemsAnswer;

    console.log("");
    console.log("  Ready:");
    console.log(`    model    ${modelSpec}`);
    console.log(`    judge    ${judge.judgeSpec ?? "none"}`);
    console.log(`    pool     ${split}`);
    console.log(`    items    ${items ?? "all"}`);
    if (state.jsonPath) console.log(`    report   ${state.jsonPath}`);
    console.log("");

    const go = (await ask("  Start the run? [Y/n] > ")).toLowerCase();
    if (go === "n" || go === "no") throw new Error("cancelled at the confirmation prompt.");
    console.log("");

    return {
      modelSpec,
      judgeSpec: judge.judgeSpec,
      split,
      items,
      jsonPath: state.jsonPath,
      allowUnpinnedJudge: judge.allowUnpinnedJudge,
    };
  } finally {
    rl.close();
  }
}

type Ask = (question: string) => Promise<string>;

async function chooseModel(ask: Ask, preset: string | null): Promise<string> {
  if (preset) {
    const spec = normaliseSpec(preset, null)!;
    const problem = specProblem(spec);
    if (problem) throw new Error(`--model: ${problem}`);
    return spec;
  }

  console.log("Model under test");
  console.log(`  A model id (assumed to be on ${DEFAULT_BASE_URL}),`);
  console.log('  a full "baseUrl|model|apiKeyEnvVar" spec, or "oracle" for a dry run.');

  for (;;) {
    const spec = normaliseSpec(await ask("  > "), null);
    if (spec === null) {
      console.log("  A model id is required.");
      continue;
    }
    const problem = specProblem(spec);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    console.log(`  using ${spec}\n`);
    return spec;
  }
}

/**
 * Pick the judge.
 *
 * Choosing something other than the pinned judge is allowed, because the harness has to
 * be usable against a local model, but it is never presented as equivalent: the user is
 * warned, must confirm, and the resulting report is marked exploratory.
 */
async function chooseJudge(
  ask: Ask,
  preset: string | null,
  presetAllowsUnpinned: boolean,
): Promise<{ judgeSpec: string | null; allowUnpinnedJudge: boolean }> {
  if (preset !== null) {
    const spec = normaliseSpec(preset, DEFAULT_JUDGE_SPEC)!;
    const problem = specProblem(spec);
    if (problem) throw new Error(`--judge: ${problem}`);
    const model = modelIdOf(spec);
    if (model === "oracle" || isPinnedJudge(model) || presetAllowsUnpinned) {
      return { judgeSpec: spec, allowUnpinnedJudge: presetAllowsUnpinned };
    }
    // Supplied on the command line, so confirm here rather than letting the run refuse
    // partway through the conversation.
    if (!(await confirmUnpinned(ask, model))) {
      throw new Error("cancelled: the judge given on the command line was declined.");
    }
    return { judgeSpec: spec, allowUnpinnedJudge: true };
  }

  console.log("Judge");
  console.log(`  The judge must be open-weight and pinned per release. Press Enter for the`);
  console.log(`  pinned judge (${PINNED_JUDGE}), or give a model id, a full`);
  console.log('  "baseUrl|model|apiKeyEnvVar" spec, or "oracle".');

  for (;;) {
    const spec = normaliseSpec(await ask(`  [${PINNED_JUDGE}] > `), DEFAULT_JUDGE_SPEC)!;
    const problem = specProblem(spec);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    const model = modelIdOf(spec);
    if (model === "oracle" || isPinnedJudge(model)) {
      console.log(`  using ${spec}\n`);
      return { judgeSpec: spec, allowUnpinnedJudge: presetAllowsUnpinned };
    }
    if (await confirmUnpinned(ask, model)) {
      console.log(`  using ${spec}\n`);
      return { judgeSpec: spec, allowUnpinnedJudge: true };
    }
  }
}

async function confirmUnpinned(ask: Ask, judgeModel: string): Promise<boolean> {
  console.log("");
  console.log(`  WARNING: "${judgeModel}" is not the pinned judge (${PINNED_JUDGE}).`);
  console.log("  Choosing a different judge is not recommended. The rubric scores from this");
  console.log("  run will not be comparable with official runs, and the final score will say so.");
  const answer = (await ask("  Use it anyway? [y/N] > ")).toLowerCase();
  console.log("");
  return answer === "y" || answer === "yes";
}
