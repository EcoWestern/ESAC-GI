/**
 * Item registry and instantiation.
 *
 * Instantiation is the mechanism that makes the public/held-out split
 * content-balanced by construction: a template marked `both` is instantiated once
 * under the public seed and once under the held-out seed, producing two *different
 * instances of the same task class*. Splitting instances rather than templates means
 * every category has held-out coverage even where the category only has two items.
 *
 * Seed discipline (agreed pre-build constraint):
 *   - The instance a model sees is derived from `hash(datasetSeed + ":" + itemId)`.
 *   - It is NOT derived from the run id, timestamp, or model, so every model in a
 *     comparison receives byte-identical instances.
 *   - Public and held-out use different dataset seeds, so the held-out instances are
 *     genuinely unseen even though the generator is in the public repo.
 */

import { deriveSeed, makeRng, fnv1a, fingerprint as fingerprintOf } from "./rng.ts";
import { CATEGORIES, CATEGORY_BY_ID } from "./categories.ts";
import type { CategoryId, Instance, ItemTemplate, Split } from "./types.ts";
import { LOGIC_ITEMS } from "./items/logic.ts";
import { MATH_ITEMS } from "./items/math.ts";
import { FACTUAL_ITEMS } from "./items/factual.ts";
import { READING_ITEMS } from "./items/reading.ts";
import { ABSTRACTION_ITEMS } from "./items/abstraction.ts";
import { INSTRUCTION_ITEMS } from "./items/instruction.ts";
import { WRITING_ITEMS } from "./items/writing.ts";
import { DEPTH_ITEMS } from "./items/depth.ts";
import { ESAC_VERSION } from "./version.ts";

/** All item templates, ordered by category. */
export const ALL_ITEMS: readonly ItemTemplate[] = [
  ...LOGIC_ITEMS,
  ...MATH_ITEMS,
  ...FACTUAL_ITEMS,
  ...READING_ITEMS,
  ...ABSTRACTION_ITEMS,
  ...INSTRUCTION_ITEMS,
  ...WRITING_ITEMS,
  ...DEPTH_ITEMS,
];

export const ITEMS_BY_ID: ReadonlyMap<string, ItemTemplate> = new Map(ALL_ITEMS.map((i) => [i.id, i]));

/** Instances for a given dataset seed and pool. Deterministic. */
export function instantiateAll(datasetSeed: string, pool: "public" | "heldout"): Instance[] {
  const out: Instance[] = [];

  for (const template of ALL_ITEMS) {
    const split: Split = template.split ?? "both";
    if (!appliesToPool(split, pool)) continue;

    // The seed depends only on (datasetSeed, itemId), never on the run.
    const seed = deriveSeed(datasetSeed, template.id);
    const rng = makeRng(seed);
    const generated = template.generate(rng, seed);
    const judgeGraded = generated.checks.some((c) => c.grader.type === "judge");

    // The fingerprint is derived from the instance's full content rather than from
    // whatever the generator chose to hash. Two instances that differ anywhere in
    // their prompt, checks, or reference necessarily fingerprint differently, so a
    // collision can only mean the instances are genuinely identical.
    const fingerprint = fingerprintOf([
      template.id,
      generated.prompt,
      generated.system ?? "",
      generated.reference ?? "",
      ...generated.checks.map(
        (check) => `${check.id}:${check.weight}:${check.expected ?? ""}`,
      ),
    ]);

    out.push({
      itemId: template.id,
      category: template.category,
      seed,
      fingerprint,
      prompt: generated.prompt,
      checks: generated.checks,
      judgeGraded,
      parametrized: template.parametrized ?? true,
      ...(generated.system ? { system: generated.system } : {}),
      ...(generated.reference !== undefined ? { reference: generated.reference } : {}),
    });
  }

  return out;
}

function appliesToPool(split: Split, pool: "public" | "heldout"): boolean {
  return split === "both" || split === pool;
}

/**
 * The public pool plus its held-out counterpart.
 *
 * `heldout` is returned only when a held-out seed is supplied. Its instances are
 * produced by the same generators as the public ones, so the harness can run them
 * without any private artifact beyond the seed itself.
 */
export function instantiate(datasetSeed: string, pool: "public" | "heldout"): Instance[] {
  return instantiateAll(datasetSeed, pool);
}

/** Fingerprint of the dataset seed, for run records. Does not reveal the seed. */
export function seedFingerprint(datasetSeed: string): string {
  return fnv1a(datasetSeed).toString(16).padStart(8, "0");
}

/**
 * Per-item point value, honouring the per-template weight override.
 *
 * The response-depth boundary item carries weight 0.5 (first-amendment §2). Weights
 * are applied as a share of the category pool, so the category still totals its full
 * allocation: with weights 1,1,1,1,0.5 the four normal items each receive
 * `points * (1/4.5)` and the boundary item receives half of that.
 */
export function itemPoints(template: ItemTemplate): number {
  const def = CATEGORY_BY_ID.get(template.category);
  if (!def) throw new Error(`unknown category ${template.category}`);
  const peers = ALL_ITEMS.filter((i) => i.category === template.category);
  const totalWeight = peers.reduce((n, p) => n + (p.weight ?? 1), 0);
  const share = (template.weight ?? 1) / totalWeight;
  return def.points * share;
}

/** Sum of item points for a category. Must equal the category allocation. */
export function categoryPointsFromItems(category: CategoryId): number {
  return ALL_ITEMS.filter((i) => i.category === category).reduce((n, i) => n + itemPoints(i), 0);
}

/** Verify the bank against the published distribution. Throws on any drift. */
export function validateBank(): void {
  const errors: string[] = [];

  for (const def of CATEGORIES) {
    const items = ALL_ITEMS.filter((i) => i.category === def.id);
    if (items.length !== def.itemCount) {
      errors.push(`${def.id}: expected ${def.itemCount} items, found ${items.length}`);
    }
    const sum = items.reduce((n, i) => n + itemPoints(i), 0);
    if (Math.abs(sum - def.points) > 1e-9) {
      errors.push(`${def.id}: item points total ${sum}, expected ${def.points}`);
    }
  }

  const ids = ALL_ITEMS.map((i) => i.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) errors.push(`duplicate item ids: ${[...new Set(dupes)].join(", ")}`);

  const versionSeen = ESAC_VERSION;
  if (!versionSeen) errors.push("missing version");

  if (errors.length > 0) {
    throw new Error(`ESAC-GI item bank is invalid:\n  - ${errors.join("\n  - ")}`);
  }
}
