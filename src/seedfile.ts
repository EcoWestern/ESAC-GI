/**
 * Held-out seed custody.
 *
 * The held-out pool is not a stored artifact. Both pools come from the same templates, so
 * what makes a held-out run held out is the dataset seed: an instance is derived from
 * `hash(datasetSeed + ":" + itemId)`, and a seed the model under test has never seen
 * produces instances it has never seen. The seed is therefore the only private state this
 * project has, and this module is where it is generated, kept, and resolved.
 *
 * Two rules shape the design:
 *
 *   - **Generation always persists.** A seed that is generated and discarded is worse than
 *     no seed at all, because it produces a run that nobody can repeat. So a seed is
 *     written to `.heldout/seed` (already gitignored), and a later run resolves it from
 *     there rather than inventing a fresh one.
 *   - **The environment beats the file.** A CI job supplies `ESAC_HELD_OUT_SEED` from a
 *     secret so that nothing is written to disk, and a missing file stays an ordinary
 *     condition rather than an error at startup.
 *
 * Nothing here is a secret in the credential sense, but the value is worthless the moment
 * it is published: an evaluator who wants a comparable public result publishes results
 * with the *fingerprint* only, and retires the seed for future use.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { HELD_OUT_DATASET_SEED_ENV } from "./version.ts";

/** Default location. Ignored by git along with the rest of `.heldout/`. */
export const HELD_OUT_SEED_FILE = ".heldout/seed";

/**
 * Prefix, so that a leaked seed is recognisable as one on sight.
 *
 * The value after the prefix is 256 bits from the platform CSPRNG, which is far beyond
 * what any search could cover, and it is why the generator being public does not weaken
 * the split.
 */
const SEED_PREFIX = "esac-gi-heldout-";

export type SeedSource = "flag" | "environment" | "file";

export interface ResolvedSeed {
  readonly seed: string;
  readonly source: SeedSource;
}

/** Generate a held-out seed. */
export function generateSeed(bytes = 32): string {
  return SEED_PREFIX + randomBytes(bytes).toString("hex");
}

/** Read a stored seed. Absent, empty, or unreadable all mean "no seed here". */
export function readSeedFile(path = HELD_OUT_SEED_FILE): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw.length === 0 ? null : raw;
  } catch {
    return null;
  }
}

/**
 * Store a seed, refusing to replace one that is already present unless `force` is set.
 *
 * Replacement has to be asked for: silently losing a seed would invalidate every earlier
 * held-out run that cites its fingerprint.
 */
export function writeSeedFile(
  seed: string,
  options: { path?: string | undefined; force?: boolean | undefined } = {},
): string {
  const path = options.path ?? HELD_OUT_SEED_FILE;
  if (existsSync(path) && options.force !== true) {
    throw new Error(`${path} already holds a held-out seed. Pass force to replace it.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${seed}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

/**
 * Find the seed a held-out run should use: the flag wins, then the environment, then the
 * stored file.
 *
 * Returns null when none of them has one, so the caller decides what to say rather than
 * this module exiting or guessing. Guessing is the one thing it must not do: an
 * involuntarily generated seed produces a run that cannot be reproduced.
 */
export function resolveHeldOutSeed(options: {
  explicit?: string | undefined;
  environment?: string | undefined;
  path?: string | undefined;
}): ResolvedSeed | null {
  const explicit = options.explicit?.trim();
  if (explicit) return { seed: explicit, source: "flag" };

  const environment = options.environment?.trim();
  if (environment) return { seed: environment, source: "environment" };

  const stored = readSeedFile(options.path);
  return stored === null ? null : { seed: stored, source: "file" };
}

/** What a held-out run says when there is no seed anywhere. */
export function missingSeedMessage(): string {
  return (
    "Running the held-out pool needs a dataset seed, and none was found. Pass --seed, set " +
    `${HELD_OUT_DATASET_SEED_ENV}, or run \`npm run esac -- seed\` to generate one and keep ` +
    `it in ${HELD_OUT_SEED_FILE}. The seed is evaluator-controlled and must not be committed.`
  );
}
