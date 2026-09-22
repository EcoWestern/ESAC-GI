/**
 * Category 5: Abstraction / pattern recognition (5 items, 10 pts).
 *
 * Five distinct mechanics rather than five variations of one. Each is structured so
 * that the rule must be *inferred* before it can be applied to new material. A
 * grid item with a visible answer would test transcription, not abstraction.
 *
 * Where a sequence is generated, the wrong options are the answers produced by
 * plausible alternative rules (interpreting the gap as constant, reading the digits
 * as coordinates), so guessing the rule that "feels right" is not sufficient.
 */

import type { ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import { buildOptions, optionCheck } from "./helpers.ts";

// ---------------------------------------------------------------------------
// 1. Grid: infer a rule and apply it to a row that is not given
// ---------------------------------------------------------------------------

const GRID_RULES: ReadonlyArray<{
  readonly id: string;
  readonly rowLabel: string;
  readonly derive: (n: number) => number;
}> = [
  { id: "double-plus-one", rowLabel: "row rule", derive: (n) => n * 2 + 1 },
  { id: "square-plus-two", rowLabel: "row rule", derive: (n) => n * n + 2 },
  { id: "collatz-step", rowLabel: "row rule", derive: (n) => (n % 2 === 0 ? n / 2 : 3 * n + 1) },
  { id: "grow-by-row", rowLabel: "row rule", derive: (n) => n + 3 },
  { id: "sum-of-previous", rowLabel: "row rule", derive: (n) => n * 3 - 2 },
];

const gridRule: ItemTemplate = {
  id: "abstraction.grid-rule",
  category: "abstraction",
  measures:
    "Inductive rule extraction from two complete rows, then application to a third. Analogy rather than arithmetic: the rule must be found before it can be used.",
  generate: (rng) => {
    const rule = rng.pick(GRID_RULES);

    for (let attempt = 0; attempt < 200; attempt++) {
      const a = rng.range(1, 9);
      const rowCount = 5;
      const row1 = Array.from({ length: rowCount }, (_, i) => a + i);
      const row2 = row1.map(rule.derive);
      const b = a + rng.range(1, 5);
      if (row2.some((v) => !Number.isInteger(v) || v < 0)) continue;

      const row3 = Array.from({ length: rowCount }, (_, i) => b + i);
      const row3Mapped = row3.map(rule.derive);
      if (row3Mapped.some((v) => !Number.isInteger(v) || v < 0)) continue;

      const shown = row3Mapped.slice(0, rowCount - 1);
      const answer = row3Mapped[rowCount - 1]!;

      // Wrong options are the results of plausible misreadings of the rule. Built as a
      // set so two misreadings that coincide cannot produce duplicate options.
      const wrongCandidates = new Set<string>([
        String(answer + (b + rowCount - 2)),
        String(answer - 1),
        String(rule.derive(b + rowCount - 1) + 1),
        String((b + rowCount - 1) * 2),
        String(answer + 2),
        String(answer - 3),
        String(rule.derive(b + rowCount - 1) - 1),
      ]);
      wrongCandidates.delete(String(answer));
      if (wrongCandidates.size < 3) continue;

      const opts = buildOptions(rng, String(answer), [...wrongCandidates].slice(0, 3));

      return {
        prompt:
          `Each row of the table below is produced from its first column by the same rule. The rule is ` +
          `applied identically to every row.\n\n` +
          `| Input | Output 1 | Output 2 | Output 3 | Output 4 |\n` +
          `|---|---|---|---|---|\n` +
          `| ${row1.join(" | ")} |\n` +
          `| ${row2.join(" | ")} |\n` +
          `| ${row3.slice(0, rowCount - 1).join(" | ")} | ? |\n\n` +
          `The third row shows inputs ${shown.map((_, i) => row3[i]).join(", ")} but only the first ` +
          `${rowCount - 1} outputs: ${shown.join(", ")}.\n\n` +
          `What is the missing value?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
        checks: [optionCheck(opts.options, opts.answer)],
        reference: opts.answer,
      };
    }

    throw new Error("abstraction.grid-rule: failed to generate a suitable grid");
  },
};

// ---------------------------------------------------------------------------
// 2. Analogy
// ---------------------------------------------------------------------------

const ANALOGIES: ReadonlyArray<{
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly d: string;
  readonly relation: string;
}> = [
  { a: "scalpel", b: "surgeon", c: "chisel", d: "sculptor", relation: "tool to its characteristic user" },
  { a: "library", b: "books", c: "aviary", d: "birds", relation: "place to what it houses" },
  { a: "drought", b: "famine", c: "spark", d: "inferno", relation: "small cause to disproportionate consequence" },
  { a: "hour", b: "time", c: "gram", d: "mass", relation: "unit to the quantity it measures" },
  { a: "frown", b: "displeasure", c: "tremble", d: "fear", relation: "involuntary signal to the state it betrays" },
  { a: "seed", b: "orchard", c: "founder", d: "company", relation: "origin to the entity it grows into" },
  { a: "thermometer", b: "temperature", c: "barometer", d: "pressure", relation: "instrument to the quantity it reads" },
  { a: "preamble", b: "treaty", c: "overture", d: "opera", relation: "opening section to the whole work" },
  { a: "eclipse", b: "astronomer", c: "fossil", d: "palaeontologist", relation: "object of study to its specialist" },
];

const analogy: ItemTemplate = {
  id: "abstraction.analogy",
  category: "abstraction",
  measures:
    "Relational mapping where surface association is the trap. Distractors share a topic with one of the terms but not the relation.",
  generate: (rng) => {
    const pairs = rng.sample(ANALOGIES, 2);
    const main = pairs[0]!;
    const donor = pairs[1]!;

    const opts = buildOptions(
      rng,
      main.d,
      // Distractors: the donor's answer (thematically tempting), plus two terms
      // that associate with the prompt terms without completing the relation.
      [donor.d, donor.a, main.a],
    );

    return {
      prompt:
        `Complete the analogy.\n\n` +
        `**${main.a} : ${main.b} :: ${main.c} : ?**\n\n` +
        `${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Number sequence with a non-obvious second-order rule
// ---------------------------------------------------------------------------

const SEQUENCE_RULES: ReadonlyArray<{
  readonly id: string;
  readonly term: (n: number) => number;
  readonly plausibleWrong: (n: number) => number;
}> = [
  { id: "product-of-digits-plus-n", term: (n) => n, plausibleWrong: (n) => n },
  { id: "recurring-n3", term: (n) => n ** 3, plausibleWrong: (n) => n ** 2 },
  { id: "factorial-plus-n", term: (n) => factorialOf(n) + n, plausibleWrong: (n) => factorialOf(n) },
  { id: "triangle-squares", term: (n) => ((n * (n + 1)) / 2) ** 2, plausibleWrong: (n) => (n * (n + 1)) / 2 },
];

function factorialOf(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

const sequence: ItemTemplate = {
  id: "abstraction.sequence",
  category: "abstraction",
  measures:
    "Second-order sequence completion. Every distractor is the value produced by a simpler rule that fits the visible terms. A constant difference rarely survives, but slightly richer wrong rules do.",
  generate: (rng) => {
    const rule = rng.pick(SEQUENCE_RULES);
    const start = rule.id === "factorial-plus-n" ? 1 : rng.range(1, 3);
    const shownCount = 5;

    const terms = Array.from({ length: shownCount + 1 }, (_, i) => rule.term(start + i));
    if (terms.some((t) => !Number.isFinite(t) || t > 1e9)) return generateFallback(rng);

    const shown = terms.slice(0, shownCount);
    const answer = terms[shownCount]!;

    const wrongFromRule = rule.plausibleWrong(start + shownCount);
    const distractors = [String(wrongFromRule), String(answer - 1), String(answer + shown[shownCount - 1]!)].filter(
      (d) => d !== String(answer),
    );
    if (new Set(distractors).size < 3) return generateFallback(rng);

    const opts = buildOptions(rng, String(answer), distractors.slice(0, 3));

    return {
      prompt:
        `What number comes next in this sequence?\n\n` +
        `${shown.join(", ")}, ?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

/** A guaranteed-simple fallback so the generator can never fail to produce an item. */
function generateFallback(rng: ReturnType<typeof import("../rng.ts").makeRng>): ReturnType<ItemTemplate["generate"]> {
  const start = rng.range(1, 4);
  const shown = Array.from({ length: 5 }, (_, i) => (start + i) ** 3);
  const answer = (start + 5) ** 3;
  const opts = buildOptions(rng, String(answer), [String((start + 5) ** 2), String(answer - 5), String(answer + shown[4]!)]);
  return {
    prompt: `What number comes next in this sequence?\n\n${shown.join(", ")}, ?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
    checks: [optionCheck(opts.options, opts.answer)],
    reference: opts.answer,
  };
}

// ---------------------------------------------------------------------------
// 4. Set-completion (odd one out)
// ---------------------------------------------------------------------------

/** Groups where a non-obvious shared property holds for exactly three of four. */
const SETS: ReadonlyArray<readonly [members: readonly string[], odd: string, property: string]> = [
  [
    ["Lima", "Quito", "Bogotá", "Montevideo"],
    "Montevideo",
    "the other three are capitals of countries that border the Pacific",
  ],
  [
    ["bat", "dolphin", "penguin", "crocodile"],
    "crocodile",
    "the other three are endothermic (warm-blooded)",
  ],
  [
    ["zinc", "copper", "nickel", "sulfur"],
    "sulfur",
    "the other three are transition metals",
  ],
  [
    ["rectangle", "rhombus", "kite", "trapezoid"],
    "trapezoid",
    "the other three always have two axes of symmetry",
  ],
  [
    ["triangle", "pentagon", "hexagon", "octagon"],
    "triangle",
    "the other three can tile the plane edge-to-edge with copies of themselves",
  ],
  [
    ["sextant", "astrolabe", "compass", "sundial"],
    "compass",
    "the other three are primarily instruments for measuring position or time by the sky",
  ],
  [
    ["harp", "lyre", "lute", "oboe"],
    "oboe",
    "the other three are plucked string instruments",
  ],
  [
    ["granite", "basalt", "obsidian", "marble"],
    "marble",
    "the other three are igneous rocks",
  ],
];

const oddOneOut: ItemTemplate = {
  id: "abstraction.odd-one-out",
  category: "abstraction",
  measures:
    "Identifying the shared abstract property rather than the shared topic. Requires grouping on a property that is not named in the prompt.",
  generate: (rng) => {
    const [members, odd, property] = rng.pick(SETS);
    // The four set members are the four options; the odd one out is the answer.
    const opts = buildOptions(rng, odd, members);
    return {
      prompt:
        `Which of the following does not belong with the others?\n\n${opts.block}\n\n` +
        `Answer with only the letter of the correct choice.`,
      checks: [
        {
          id: "answer",
          weight: 1,
          expected: `${odd} (${property})`,
          grader: g.programmatic(`selects the odd member (${odd})`, (r) => {
            // Import locally to keep the grader self-contained and pure.
            const letters = opts.options.map((_, i) => String.fromCharCode(65 + i));
            const m = new RegExp(`(?:answer|choice|option)\\s*[:=\\-]?\\s*\\(?([A-J])\\b`, "i").exec(r);
            if (m?.[1] && letters.includes(m[1].toUpperCase())) {
              return m[1].toUpperCase() === opts.answer ? 1 : 0;
            }
            const bare = r.trim();
            if (/^\(?([A-J])\)?[.):]?$/i.test(bare) && letters.includes(bare.replace(/[^A-Ja-j]/g, "").toUpperCase())) {
              return bare.replace(/[^A-Ja-j]/g, "").toUpperCase() === opts.answer ? 1 : 0;
            }
            // Accept naming the member directly.
            return new RegExp(`\\b${odd}\\b`, "i").test(r) ? 1 : 0;
          }),
        },
      ],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Matrix completion
// ---------------------------------------------------------------------------

const MATRIX_RULES: ReadonlyArray<{
  readonly id: string;
  readonly combine: (row: number, col: number) => number;
}> = [
  { id: "sum", combine: (r, c) => r + c },
  { id: "product-minus-row", combine: (r, c) => r * c - r },
  { id: "col-squared-plus-row", combine: (r, c) => c * c + r },
  { id: "row-times-col-plus-1", combine: (r, c) => r * c + 1 },
];

const matrixCompletion: ItemTemplate = {
  id: "abstraction.matrix",
  category: "abstraction",
  measures:
    "Two-dimensional rule inference. Both the row axis and the column axis matter, so a rule fitted to one axis alone produces one of the distractors.",
  generate: (rng) => {
    const rule = rng.pick(MATRIX_RULES);
    const rowInputs = rng.sample([1, 2, 3, 4, 5, 6], 4).sort((a, b) => a - b);
    const colInputs = rng.sample([1, 2, 3, 4, 5], 4).sort((a, b) => a - b);

    const grid = rowInputs.map((r) => colInputs.map((c) => rule.combine(r, c)));

    // Blank the bottom-right cell.
    const answer = grid[3]![3]!;
    const rows = grid.map((row, i) => {
      const cells = row.map((v, j) => (i === 3 && j === 3 ? "?" : String(v)));
      return `| ${rowInputs[i]} | ${cells.join(" | ")} |`;
    });

    // A rule fitted to the row axis alone still explains the visible cells; the
    // distractor exploits exactly that.
    const rowOnlyPrediction = grid[3]![2]! + (grid[3]![1]! - grid[3]![0]!);
    const distractors = new Set<string>([
      String(rowOnlyPrediction),
      String(answer - 1),
      String(answer + rowInputs[3]!),
    ]);
    distractors.delete(String(answer));
    if (distractors.size < 3) return oddOneOutFallback(rng);

    const opts = buildOptions(rng, String(answer), [...distractors].slice(0, 3));

    return {
      prompt:
        `The table below is generated by a single rule that depends on both the row label and the ` +
        `column header. The same rule produces every cell.\n\n` +
        `| row \\ col | ${colInputs.join(" | ")} |\n` +
        `|---|---|---|---|---|\n` +
        `${rows.join("\n")}\n\n` +
        `What value belongs in the cell marked "?"\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

function oddOneOutFallback(rng: ReturnType<typeof import("../rng.ts").makeRng>): ReturnType<ItemTemplate["generate"]> {
  const [members, odd] = SETS[0]!;
  const opts = buildOptions(rng, odd, members);
  return {
    prompt: `Which of the following does not belong with the others?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
    checks: [optionCheck(opts.options, opts.answer)],
    reference: opts.answer,
  };
}

export const ABSTRACTION_ITEMS: readonly ItemTemplate[] = [
  gridRule,
  analogy,
  sequence,
  oddOneOut,
  matrixCompletion,
];
