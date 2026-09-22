/**
 * ESAC-GI category registry.
 *
 * Point allocations and item counts are fixed by the design spec and
 * first-amendment §6. Both must total 75 and 42 respectively — asserted at load
 * time so a drift in either is a hard failure rather than a silently wrong score.
 */

import type { CategoryDef, CategoryId } from "./types.ts";

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "logic",
    name: "Logic & deduction",
    points: 10,
    itemCount: 5,
    grading: "deterministic",
  },
  {
    id: "math",
    name: "Math reasoning",
    points: 10,
    itemCount: 5,
    grading: "deterministic",
  },
  {
    id: "factual",
    name: "Factual knowledge",
    points: 10,
    itemCount: 10,
    grading: "deterministic",
  },
  {
    id: "reading",
    name: "Reading comprehension",
    points: 10,
    itemCount: 5,
    grading: "deterministic",
  },
  {
    id: "abstraction",
    name: "Abstraction / pattern recognition",
    points: 10,
    itemCount: 5,
    grading: "deterministic",
  },
  {
    id: "instruction",
    name: "Instruction-following",
    points: 10,
    itemCount: 5,
    grading: "deterministic",
  },
  {
    id: "writing",
    name: "Writing quality",
    points: 10,
    itemCount: 2,
    grading: "judge",
  },
  {
    id: "depth",
    name: "Response-depth calibration",
    points: 5,
    itemCount: 5,
    grading: "judge",
  },
];

export const CATEGORY_BY_ID: ReadonlyMap<CategoryId, CategoryDef> = new Map(
  CATEGORIES.map((c) => [c.id, c]),
);

export const TOTAL_POINTS: number = CATEGORIES.reduce((n, c) => n + c.points, 0);
export const TOTAL_ITEMS: number = CATEGORIES.reduce((n, c) => n + c.itemCount, 0);

/**
 * Judge-graded share of the suite. Tenet 2 makes judge grading the exception, so
 * the figure is computed rather than asserted, and reported with every run.
 */
export const JUDGE_GRADED_POINTS: number = CATEGORIES.filter(
  (c) => c.grading === "judge",
).length
  ? CATEGORIES.filter((c) => c.grading === "judge").reduce((n, c) => n + c.points, 0)
  : 0;

// --- Invariants -------------------------------------------------------------

if (TOTAL_POINTS !== 75) {
  throw new Error(`ESAC-GI category points must total 75, got ${TOTAL_POINTS}`);
}
if (TOTAL_ITEMS !== 42) {
  throw new Error(`ESAC-GI item count must total 42, got ${TOTAL_ITEMS}`);
}

/** Points a single item in a category is worth, before per-item weighting. */
export function pointsPerItem(category: CategoryId): number {
  const def = CATEGORY_BY_ID.get(category);
  if (!def) throw new Error(`unknown category: ${category}`);
  return def.points / def.itemCount;
}
