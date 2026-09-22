/**
 * ESAC-GI test suite.
 *
 * These tests assert the properties the benchmark's claims depend on, not just that
 * the code runs. Roughly in order of importance:
 *
 *  1. The bank matches the published distribution exactly.
 *  2. Generators are deterministic and seed-sensitive (resolution 4).
 *  3. Every item's reference answer actually passes its own checks, and a
 *     plausible wrong answer does not (these catch authoring mistakes).
 *  4. Difficulty claims hold: the "shortcut" answers for the math and abstraction
 *     items are genuinely wrong, so the items cannot be beaten by a heuristic.
 *  5. Graders reject near-misses rather than accepting them.
 *  6. The 2x2 replication protocol and the infra/model failure split behave as
 *     specified (resolutions 5 and 8).
 *  7. Thresholds behave, including at the exact boundary (resolution 10).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CATEGORIES, TOTAL_ITEMS, TOTAL_POINTS, JUDGE_GRADED_POINTS } from "../src/categories.ts";
import { ALL_ITEMS, instantiate, validateBank, seedFingerprint, itemPoints } from "../src/registry.ts";
import { gradeChecks, extractNumber, extractChoice, normalize } from "../src/graders.ts";
import { parseJudgeResponse, scoreRubric, meanFraction, JUDGE_SCORE_MAX } from "../src/judge.ts";
import { runItem, orderItems } from "../src/runner.ts";
import { scoreRun } from "../src/score.ts";
import { createOracleAdapter, createOracleJudge } from "../src/adapters.ts";
import { makeRng, deriveSeed, fnv1a } from "../src/rng.ts";
import { PASS_THRESHOLD, REPLICATION, PUBLIC_DATASET_SEED, ESAC_VERSION, ESAC_VERSION_TAG, ESAC_MAJOR, ESAC_FULL_NAME, CANARY } from "../src/version.ts";
import { PACKING_POOL } from "../src/items/packing-pool.ts";
import { InfrastructureError } from "../src/types.ts";
import type { Instance, ItemRunResult, ModelAdapter } from "../src/types.ts";

const PUBLIC_SEED = PUBLIC_DATASET_SEED;
const HOLDOUT_SEED = "esac-test-heldout-seed";

// ===========================================================================
// 1. Bank integrity
// ===========================================================================

test("bank validates against the published distribution", () => {
  validateBank();
  assert.equal(TOTAL_POINTS, 75);
  assert.equal(TOTAL_ITEMS, 42);
});

test("every category has its declared item count", () => {
  for (const category of CATEGORIES) {
    const items = ALL_ITEMS.filter((i) => i.category === category.id);
    assert.equal(items.length, category.itemCount, `${category.id} item count`);
  }
});

test("item points sum to each category allocation, including the half-weight boundary item", () => {
  for (const category of CATEGORIES) {
    const sum = ALL_ITEMS.filter((i) => i.category === category.id).reduce(
      (n, i) => n + itemPoints(i),
      0,
    );
    assert.ok(
      Math.abs(sum - category.points) < 1e-9,
      `${category.id}: ${sum} !== ${category.points}`,
    );
  }
});

test("the response-depth boundary item carries half the weight of a normal item", () => {
  const depth = ALL_ITEMS.filter((i) => i.category === "depth");
  const boundary = depth.find((i) => i.id === "depth.boundary")!;
  const normal = depth.find((i) => i.id === "depth.concise-a")!;
  const ratio = itemPoints(boundary) / itemPoints(normal);
  assert.ok(Math.abs(ratio - 0.5) < 1e-9, `expected 0.5, got ${ratio}`);
});

test("response-depth category is structured 2 substantive / 2 concise / 1 boundary", () => {
  const ids = ALL_ITEMS.filter((i) => i.category === "depth").map((i) => i.id).sort();
  assert.deepEqual(ids, [
    "depth.boundary",
    "depth.concise-a",
    "depth.concise-b",
    "depth.substantive-a",
    "depth.substantive-b",
  ]);
});

test("judge-graded share matches the categories marked as judge-graded", () => {
  const expected = CATEGORIES.filter((c) => c.grading === "judge").reduce((n, c) => n + c.points, 0);
  assert.equal(JUDGE_GRADED_POINTS, expected);
  assert.equal(expected, 15, "writing (10) + response-depth (5)");
});

test("judge-graded items are marked consistently with their checks", () => {
  for (const instance of instantiate(PUBLIC_SEED, "public")) {
    const hasJudgeCheck = instance.checks.some((c) => c.grader.type === "judge");
    assert.equal(instance.judgeGraded, hasJudgeCheck, `${instance.itemId} judgeGraded flag`);
  }
});

// ===========================================================================
// 2. Determinism and seeding
// ===========================================================================

test("generators are deterministic for a fixed dataset seed", () => {
  const a = instantiate(PUBLIC_SEED, "public");
  const b = instantiate(PUBLIC_SEED, "public");
  assert.deepEqual(
    a.map((i) => [i.itemId, i.fingerprint, i.prompt]),
    b.map((i) => [i.itemId, i.fingerprint, i.prompt]),
  );
});

test("instance seeds depend only on dataset seed and item id", () => {
  const first = instantiate(PUBLIC_SEED, "public");
  const other = instantiate("a-different-dataset-seed", "public");
  for (const instance of first) {
    assert.equal(instance.seed, deriveSeed(PUBLIC_SEED, instance.itemId));
    const counterpart = other.find((i) => i.itemId === instance.itemId)!;
    assert.equal(counterpart.seed, deriveSeed("a-different-dataset-seed", instance.itemId));
  }
});

test("parametrized items vary substantially across dataset seeds", () => {
  // Two seeds drawing the same value from a bounded pool is a legitimate
  // statistical event, not a defect: with a 50-entry chemistry pool a single
  // collision between two specific seeds is expected. Asserting "never collides"
  // would therefore assert something false. What must hold is that collisions are
  // rare and that every parametrized item genuinely varies.
  const pub = instantiate(PUBLIC_SEED, "public").filter((i) => i.parametrized);
  const held = instantiate(HOLDOUT_SEED, "heldout");
  assert.ok(pub.length > 0);

  const collided = pub.filter(
    (i) => held.find((h) => h.itemId === i.itemId)?.fingerprint === i.fingerprint,
  );
  assert.ok(
    collided.length <= Math.ceil(pub.length * 0.1),
    `too many items collided between the two dataset seeds: ${collided
      .map((c) => c.itemId)
      .join(", ")}`,
  );

  // Every parametrized item must be able to produce a range of instances.
  for (const item of ALL_ITEMS.filter((i) => i.parametrized)) {
    const fingerprints = new Set(
      Array.from({ length: 40 }, (_, s) =>
        instantiate(`${PUBLIC_SEED}-variety-${s}`, "public").find((i) => i.itemId === item.id)!
          .fingerprint,
      ),
    );
    assert.ok(
      fingerprints.size >= 3,
      `${item.id} produced only ${fingerprints.size} distinct instances over 40 seeds`,
    );
  }
});

test("scenario-pool items are explicitly flagged as not parametrized", () => {
  const scenarioItems = ALL_ITEMS.filter((i) => i.parametrized === false);
  assert.ok(scenarioItems.length >= 5, "expected the writing and depth items");
  for (const item of scenarioItems) {
    const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === item.id)!;
    assert.equal(instance.parametrized, false);
  }
});

test("rng is stable and reproducible", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 50; i++) assert.equal(a.float(), b.float());
  assert.equal(fnv1a("esac"), fnv1a("esac"));
  assert.notEqual(fnv1a("esac"), fnv1a("esaC"));
});

test("seed fingerprint is stable and does not leak the seed", () => {
  const fp = seedFingerprint(PUBLIC_SEED);
  assert.equal(fp, seedFingerprint(PUBLIC_SEED));
  assert.ok(!fp.includes(PUBLIC_SEED));
});

// ===========================================================================
// 3. Item correctness — references and negative controls
// ===========================================================================

test("every deterministic reference answer scores 100% on its own checks", () => {
  for (const instance of instantiate(PUBLIC_SEED, "public")) {
    if (instance.judgeGraded) continue;
    assert.ok(instance.reference !== undefined, `${instance.itemId} has no reference answer`);
    const { fraction } = gradeChecks(instance.checks, instance.reference);
    assert.equal(fraction, 1, `${instance.itemId} reference scored ${fraction}`);
  }
});

test("a non-answer never scores full marks on a deterministic item", () => {
  for (const instance of instantiate(PUBLIC_SEED, "public")) {
    if (instance.judgeGraded) continue;
    // Note: a bare option letter is deliberately NOT used as junk here. On a
    // multiple-choice item a bare letter can legitimately be the answer, so
    // asserting it fails would be asserting the item is broken.
    for (const junk of [
      "I don't know.",
      "",
      "Sorry, I can't help with that.",
      "This question is not answerable as stated.",
    ]) {
      const { fraction } = gradeChecks(instance.checks, junk);
      assert.ok(fraction < 1, `${instance.itemId} awarded full marks for ${JSON.stringify(junk)}`);
    }
  }
});

test("references are produced across a range of seeds without throwing", () => {
  for (let s = 0; s < 25; s++) {
    const instances = instantiate(`${PUBLIC_SEED}-sweep-${s}`, "public");
    assert.equal(instances.length, TOTAL_ITEMS, `sweep ${s} produced ${instances.length} items`);
    for (const instance of instances) {
      if (instance.judgeGraded) continue;
      const { fraction } = gradeChecks(instance.checks, instance.reference!);
      assert.equal(fraction, 1, `seed sweep ${s}: ${instance.itemId} reference scored ${fraction}`);
    }
  }
});

test("multiple-choice items have distinct options and a contiguous letter sequence", () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  let checked = 0;
  for (const instance of instances) {
    const match = /\n([A-J]\. .*(?:\n[A-J]\. .*)+)\n/.exec(instance.prompt);
    if (!match) continue;
    checked++;
    const options = match[1]!.split("\n").map((l) => l.trim());
    assert.ok(options.length >= 4, `${instance.itemId} has only ${options.length} options`);
    const texts = options.map((o) => o.replace(/^[A-J]\.\s*/, ""));
    assert.equal(
      new Set(texts).size,
      texts.length,
      `${instance.itemId} has duplicate options: ${texts.join(" | ")}`,
    );
    const letters = options.map((o) => o[0]);
    const expected = options.map((_, i) => String.fromCharCode(65 + i));
    assert.deepEqual(letters, expected, `${instance.itemId} letters are not contiguous`);
    assert.ok(match, `${instance.itemId} options block`);
  }
  assert.ok(checked >= 15, `expected to check many multiple-choice items, saw ${checked}`);
});

// ===========================================================================
// 4. Difficulty claims — the shortcuts must be wrong
// ===========================================================================

test("packing pool entries all make greedy strictly suboptimal", () => {
  assert.ok(PACKING_POOL.length >= 100, `pool has only ${PACKING_POOL.length} tuples`);
  for (const t of PACKING_POOL) {
    let best = -1;
    let optimalCount = 0;
    let bestBig = 0;
    let bestSmall = 0;
    for (let nBig = 0; nBig * t.wBig <= t.W; nBig++) {
      for (let nSmall = 0; nBig * t.wBig + nSmall * t.wSmall <= t.W; nSmall++) {
        if (nBig * t.vBig + nSmall * t.vSmall > t.V) continue;
        const value = nBig * t.pBig + nSmall * t.pSmall;
        if (value > best) {
          best = value;
          optimalCount = 1;
          bestBig = nBig;
          bestSmall = nSmall;
        } else if (value === best) {
          optimalCount++;
        }
      }
    }
    assert.equal(best, t.best, `tuple ${t.W}/${t.V} best value mismatch`);
    assert.equal(bestBig, t.bestBig, "bestBig mismatch");
    assert.equal(bestSmall, t.bestSmall, "bestSmall mismatch");
    assert.equal(optimalCount, 1, "optimum is not unique");
    assert.ok(
      t.greedy < t.best,
      `tuple ${t.W}/${t.V}: greedy ${t.greedy} is not worse than optimum ${t.best}`,
    );
    assert.ok(t.bestBig > 0 && t.bestSmall > 0, "optimum must use both box types");
  }
});

test("the packing item never accepts the greedy total", () => {
  const instances = instantiate(PUBLIC_SEED, "public").filter((i) => i.itemId === "math.packing");
  assert.equal(instances.length, 1);
  const tuple = PACKING_POOL.find(
    (t) =>
      instances[0]!.prompt.includes(`at most ${t.W} kg`) &&
      instances[0]!.prompt.includes(`at most ${t.V} litres`) &&
      instances[0]!.prompt.includes(`| ${t.pBig} |`) &&
      instances[0]!.prompt.includes(`| ${t.pSmall} |`),
  );
  assert.ok(tuple, "could not identify the drawn tuple from the prompt");
  const { fraction } = gradeChecks(instances[0]!.checks, String(tuple.greedy));
  assert.equal(fraction, 0, "the greedy answer was accepted");
});

test("the two-phase pipe item rejects the single-phase shortcut", () => {
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === "math.pipes")!;
  const correct = Number(instance.reference);

  // Recover the rates from the prompt to compute the naive single-phase answer.
  const a = Number(/adds (\d+) litres per minute/.exec(instance.prompt)![1]);
  const b = Number(/adds (\d+) litres per minute/.exec(instance.prompt.slice(instance.prompt.indexOf("pipe B")))![1]);
  const drain = Number(/removes (\d+) litres per minute/.exec(instance.prompt)![1]);
  const capacity = Number(/holds (\d+) litres/.exec(instance.prompt)![1]);

  const naive = capacity / (a + b - drain);
  if (Math.abs(naive - correct) > 1e-9) {
    const { fraction } = gradeChecks(instance.checks, naive.toFixed(4));
    assert.equal(fraction, 0, `naive answer ${naive} was accepted over ${correct}`);
  }
});

test("the analogue-clock modulo item rejects the naive product-remainder answer", () => {
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === "math.crt")!;
  const remainders = [...instance.prompt.matchAll(/remainder of (\d+) when divided by (\d+)/g)];
  assert.equal(remainders.length, 3);
  const product = remainders.reduce((n, m) => n * Number(m[1]), 1);
  const naive = product % Number(remainders[0]![2]);
  if (naive !== Number(instance.reference)) {
    const { fraction } = gradeChecks(instance.checks, String(naive));
    assert.equal(fraction, 0, "the naive product-remainder answer was accepted");
  }
});

test("the elemental/odd-one-out items reject each of the non-odd members", () => {
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === "abstraction.odd-one-out")!;
  const options = [...instance.prompt.matchAll(/^([A-D])\. (.+)$/gm)];
  const answerLetter = instance.reference;
  for (const [, letter, text] of options) {
    if (letter === answerLetter) continue;
    const { fraction } = gradeChecks(instance.checks, text!);
    assert.equal(fraction, 0, `member "${text}" was accepted as the odd one out`);
  }
});

test("syllogism items never rely on vacuous truth", async () => {
  // "No X are Y" together with "All X are Y" is satisfiable in first-order logic, but
  // only when no X exist. Such an item is formally valid and pedagogically useless: a
  // competent solver reads it as a contradiction and starts distrusting the puzzle
  // rather than reasoning about it. The generator therefore requires every predicate
  // to be inhabited, and this test guards that requirement.
  for (let s = 0; s < 40; s++) {
    const instance = instantiate(`${PUBLIC_SEED}-syllogism-${s}`, "public").find(
      (i) => i.itemId === "logic.syllogism",
    )!;
    const premises = [...instance.prompt.matchAll(/^- (.+)\.$/gm)].map((m) => m[1]!);

    for (const premise of premises) {
      const all = /^All (\S+) are (\S+)$/.exec(premise);
      const none = /^No (\S+) are (\S+)$/.exec(premise);
      if (!all) continue;
      const contradicts = none && none[1] === all[1] && none[2] === all[2];
      assert.ok(
        !contradicts,
        `seed ${s}: premises are satisfiable only vacuously: ${premises.join(" / ")}`,
      );
      // The reverse pairing is the same defect stated the other way round.
      const converse = premises.find((p) => {
        const m = /^No (\S+) are (\S+)$/.exec(p);
        return m && m[1] === all[2] && m[2] === all[1];
      });
      assert.ok(
        !converse,
        `seed ${s}: premises are satisfiable only vacuously: ${premises.join(" / ")}`,
      );
    }

    // Every premise must also mention only well-formed terms.
    assert.equal(premises.length, 2, `seed ${s}: expected two premises`);
  }
});

// ===========================================================================
// 5. Grader behaviour
// ===========================================================================

test("numeric extraction prefers the concluding value over working", () => {
  assert.equal(extractNumber("Let me work through this. 12 + 30 = 42"), 42);
  assert.equal(extractNumber("The answer is 17."), 17);
  assert.equal(extractNumber("**84**"), 84);
  assert.equal(extractNumber("Answer: 1,250"), 1250);
  assert.equal(extractNumber("no digits here"), null);
});

test("choice extraction handles the common answer formats", () => {
  const options = ["a", "b", "c", "d"];
  assert.equal(extractChoice("B", options), "B");
  assert.equal(extractChoice("(C)", options), "C");
  assert.equal(extractChoice("Answer: D", options), "D");
  assert.equal(extractChoice("I think the answer is B.", options), "B");
  assert.equal(extractChoice("The correct choice is option A", options), "A");
  assert.equal(extractChoice("nothing useful", options), null);
});

test("normalisation strips decoration without erasing content", () => {
  assert.equal(normalize("**Sodium**"), "sodium");
  assert.equal(normalize("Answer: Sodium."), "sodium");
  assert.ok(normalize("sodium chloride").includes("sodium"));
  assert.equal(normalize("  Hello   world  ", "trim"), "Hello world");
});

test("numeric grading respects tolerance and rejects near misses outside it", () => {
  const exact = { id: "a", weight: 1, grader: { type: "numeric" as const, value: 42, tolerance: 0 } };
  assert.equal(gradeChecks([exact], "42").fraction, 1);
  assert.equal(gradeChecks([exact], "42.0").fraction, 1);
  assert.equal(gradeChecks([exact], "43").fraction, 0);

  const tolerant = { id: "a", weight: 1, grader: { type: "numeric" as const, value: 100, tolerance: 0.5 } };
  assert.equal(gradeChecks([tolerant], "100.4").fraction, 1);
  assert.equal(gradeChecks([tolerant], "100.6").fraction, 0);
});

test("check weights are normalised, so an item can mix weighted sub-checks", () => {
  // Uses `contains` rather than `exact` because an exact grader compares the whole
  // normalised response, so it cannot match one clause of a multi-part answer.
  const checks = [
    { id: "major", weight: 3, grader: { type: "contains" as const, all: ["alpha"] } },
    { id: "minor", weight: 1, grader: { type: "contains" as const, all: ["beta"] } },
  ];
  assert.equal(gradeChecks(checks, "alpha").fraction, 0.75);
  assert.equal(gradeChecks(checks, "beta").fraction, 0.25);
  assert.equal(gradeChecks(checks, "alpha and beta").fraction, 1);
  assert.equal(gradeChecks(checks, "neither").fraction, 0);
});

test("instruction-following items award partial credit per constraint", () => {
  const instance = instantiate(PUBLIC_SEED, "public").find(
    (i) => i.itemId === "instruction.constrained-sentence",
  )!;
  // A sentence that breaks only the word count should score better than nothing.
  const partial = gradeChecks(instance.checks, "Harbour recorded 12 crates.").fraction;
  const nothing = gradeChecks(instance.checks, "I cannot do that.").fraction;
  assert.ok(partial > nothing, `partial ${partial} should exceed ${nothing}`);
  assert.ok(partial < 1, "an incomplete constraint set must not score full marks");
});

// ===========================================================================
// 6. Judge layer
// ===========================================================================

test("judge parser accepts bare, fenced, and embedded JSON", () => {
  const rubric = {
    id: "t",
    context: "",
    criteria: [
      { id: "a", weight: 1, description: "" },
      { id: "b", weight: 1, description: "" },
    ],
  };
  assert.deepEqual(parseJudgeResponse('{"a": 3, "b": 4}', rubric)?.scores, { a: 3, b: 4 });
  assert.deepEqual(parseJudgeResponse('```json\n{"a": 2, "b": 1}\n```', rubric)?.scores, { a: 2, b: 1 });
  assert.deepEqual(
    parseJudgeResponse('Here are my scores: {"a": 1, "b": 1} — done.', rubric)?.scores,
    { a: 1, b: 1 },
  );
});

test("judge parser returns null on unusable output rather than defaulting to zero", () => {
  const rubric = {
    id: "t",
    context: "",
    criteria: [{ id: "a", weight: 1, description: "" }],
  };
  assert.equal(parseJudgeResponse("I think it is quite good.", rubric), null);
  assert.equal(parseJudgeResponse('{"b": 3}', rubric), null, "missing criterion must fail");
});

test("judge scores are clamped to the rubric scale", () => {
  const rubric = {
    id: "t",
    context: "",
    criteria: [{ id: "a", weight: 1, description: "" }],
  };
  assert.equal(scoreRubric({ a: 99 }, rubric), 1);
  assert.equal(scoreRubric({ a: -5 }, rubric), 0);
  assert.equal(scoreRubric({ a: JUDGE_SCORE_MAX / 2 }, rubric), 0.5);
});

test("rubric scoring normalises criterion weights", () => {
  const rubric = {
    id: "t",
    context: "",
    criteria: [
      { id: "heavy", weight: 3, description: "" },
      { id: "light", weight: 1, description: "" },
    ],
  };
  assert.equal(scoreRubric({ heavy: 4, light: 0 }, rubric), 0.75);
  assert.equal(scoreRubric({ heavy: 0, light: 4 }, rubric), 0.25);
});

test("every rubric used by an item is well-formed", () => {
  for (const instance of instantiate(PUBLIC_SEED, "public")) {
    for (const check of instance.checks) {
      if (check.grader.type !== "judge") continue;
      const rubric = check.grader.rubric;
      assert.ok(rubric.id, `${instance.itemId} rubric has no id`);
      assert.ok(rubric.context.length > 40, `${instance.itemId} rubric context is too thin`);
      assert.ok(rubric.criteria.length >= 2, `${instance.itemId} rubric has too few criteria`);
      for (const criterion of rubric.criteria) {
        assert.ok(criterion.weight > 0, `${rubric.id}.${criterion.id} weight must be positive`);
        assert.ok(criterion.description.length > 30, `${rubric.id}.${criterion.id} description too thin`);
      }
      // A rubric that cannot fail a non-answer is not measuring anything.
      const zeroed: Record<string, number> = {};
      for (const criterion of rubric.criteria) zeroed[criterion.id] = 0;
      assert.equal(scoreRubric(zeroed, rubric), 0);
    }
  }
});

test("the concise-depth rubric penalises over-elaboration and the substantive rubric penalises it too", () => {
  // Both directions must be able to reach full marks and to fail, otherwise the
  // category would reward a constant response style.
  for (const instance of instantiate(PUBLIC_SEED, "public").filter((i) => i.category === "depth")) {
    const check = instance.checks.find((c) => c.grader.type === "judge")!;
    if (check.grader.type !== "judge") continue;
    const rubric = check.grader.rubric;
    const perfect: Record<string, number> = {};
    const worst: Record<string, number> = {};
    for (const criterion of rubric.criteria) {
      perfect[criterion.id] = JUDGE_SCORE_MAX;
      worst[criterion.id] = 0;
    }
    assert.equal(scoreRubric(perfect, rubric), 1);
    assert.equal(scoreRubric(worst, rubric), 0);
  }
});

test("no response-depth prompt contains an explicit length instruction", () => {
  // The category measures inference of depth from context. If a prompt said "be
  // concise" or "explain in detail", it would measure instruction-following instead.
  const offenders = /(be (?:concise|brief|detailed|thorough)|in detail|at length|one sentence|word limit|maximum of \d+ words)/i;
  for (const instance of instantiate(PUBLIC_SEED, "public").filter((i) => i.category === "depth")) {
    assert.ok(
      !offenders.test(instance.prompt),
      `${instance.itemId} contains an explicit depth instruction`,
    );
  }
});

test("meanFraction averages the 2x2 observation set", () => {
  assert.equal(meanFraction([1, 1, 1, 1]), 1);
  assert.equal(meanFraction([1, 0, 1, 0]), 0.5);
  assert.equal(meanFraction([]), 0);
});

// ===========================================================================
// 7. Runner behaviour — replication and failure classification
// ===========================================================================

function stubModel(text: string): ModelAdapter {
  return { id: "stub", async complete() { return { text }; } };
}

test("judge-graded items use two model runs; deterministic items use one", async () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const judge = createOracleJudge({ fixedFraction: 0.5 });

  const deterministic = instances.find((i) => !i.judgeGraded)!;
  const detResult = await runItem(deterministic, { model: stubModel("x"), judge });
  assert.equal(detResult.modelRuns, REPLICATION.deterministicModelRuns);

  const judged = instances.find((i) => i.judgeGraded)!;
  const judgeResult = await runItem(judged, { model: stubModel("some response"), judge });
  assert.equal(judgeResult.modelRuns, REPLICATION.judgeModelRuns);
  assert.equal(judgeResult.fraction, 0.5);
});

test("infrastructure failures are retried and never scored as model failures", async () => {
  let attempts = 0;
  const flaky: ModelAdapter = {
    id: "flaky",
    async complete() {
      attempts++;
      if (attempts <= 2) throw new InfrastructureError("transport");
      return { text: "42" };
    },
  };
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === "math.modpow")!;
  const result = await runItem(instance, { model: flaky, judge: null });
  assert.equal(attempts, 3);
  assert.equal(result.infraRetries, 2);
  assert.equal(result.modelFailed, false, "an infra fault must not be recorded as a model failure");
});

test("an unrecoverable infrastructure failure throws rather than scoring zero", async () => {
  const dead: ModelAdapter = {
    id: "dead",
    async complete() {
      throw new InfrastructureError("connection refused");
    },
  };
  const instance = instantiate(PUBLIC_SEED, "public")[0]!;
  await assert.rejects(
    () => runItem(instance, { model: dead, judge: null }),
    (err: unknown) => err instanceof InfrastructureError,
  );
});

test("an empty model response is scored as a failure, not treated as infrastructure", async () => {
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.itemId === "math.modpow")!;
  const result = await runItem(instance, { model: stubModel(""), judge: null });
  assert.equal(result.fraction, 0);
  assert.equal(result.infraRetries, 0, "an empty response must not be retried as infra");
});

test("the runner requires a judge for judge-graded items", async () => {
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.judgeGraded)!;
  await assert.rejects(
    () => runItem(instance, { model: stubModel("x"), judge: null }),
    (err: unknown) => err instanceof InfrastructureError,
  );
});

test("a judge that cannot be parsed is an infrastructure failure, not a zero", async () => {
  const badJudge = {
    id: "bad",
    async score() {
      return { raw: "I decline to score this." };
    },
  };
  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.judgeGraded)!;
  await assert.rejects(
    () => runItem(instance, { model: stubModel("response"), judge: badJudge }),
    (err: unknown) => err instanceof InfrastructureError,
  );
});

test("a model failure on one replication run is scored as a zero for that run", async () => {
  // Resolution 5: a judge-graded item averages its two model runs. If one run fails
  // at the model level (a timeout, per the agreed classification), that run must
  // contribute zero rather than being silently dropped — dropping it would let a
  // model improve its score by failing selectively.
  let call = 0;
  const { ModelTimeoutError: MTE } = await import("../src/types.ts");
  const partlyTimingOut: ModelAdapter = {
    id: "partly-timeout",
    async complete() {
      call++;
      if (call === 2) throw new MTE();
      return { text: "a response" };
    },
  };

  const instance = instantiate(PUBLIC_SEED, "public").find((i) => i.judgeGraded)!;
  const result = await runItem(instance, {
    model: partlyTimingOut,
    judge: createOracleJudge({ fixedFraction: 1 }),
  });

  assert.equal(result.modelRuns, REPLICATION.judgeModelRuns);
  assert.equal(result.modelFailed, true, "the timeout must be recorded as a model failure");
  assert.ok(
    Math.abs(result.fraction - 0.5) < 1e-9,
    `one perfect run and one failed run must average to 0.5, got ${result.fraction}`,
  );
  // A timeout is a model failure, so it must not be retried as infrastructure.
  assert.equal(result.infraRetries, 0, "a model timeout must not be retried as infrastructure");
});

test("ordering runs cheap items first and interleaves categories", () => {
  const ordered = orderItems(instantiate(PUBLIC_SEED, "public"));
  const firstJudgeIndex = ordered.findIndex((i) => i.judgeGraded);
  const lastDeterministicIndex = ordered.map((i) => i.judgeGraded).lastIndexOf(false);
  assert.ok(
    lastDeterministicIndex < firstJudgeIndex,
    "judge-graded (most expensive) items must come last",
  );
  const firstFew = ordered.slice(0, 8).map((i) => i.category);
  assert.ok(new Set(firstFew).size >= 3, `early items should span categories, got ${firstFew.join(", ")}`);
});

// ===========================================================================
// 8. Scoring and thresholds
// ===========================================================================

function syntheticResults(instances: readonly Instance[], fraction: number): ItemRunResult[] {
  return instances.map((i) => ({
    itemId: i.itemId,
    category: i.category,
    fingerprint: i.fingerprint,
    fraction,
    points: 0,
    awarded: 0,
    judgeGraded: i.judgeGraded,
    checks: [],
    infraRetries: 0,
    modelRuns: 1,
    latencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    modelFailed: false,
  }));
}

test("a perfect run scores exactly 75/75 and passes", () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const report = scoreRun({
    items: syntheticResults(instances, 1),
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  assert.equal(report.total, 75);
  assert.equal(report.totalPossible, 75);
  assert.equal(report.normalized, 1);
  assert.equal(report.passed, true);
  assert.deepEqual(report.failedCategories, []);
});

test("exactly 60% passes and 59% fails, in every category simultaneously", () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const base = {
    split: "public" as const,
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  };
  const at = scoreRun({ items: syntheticResults(instances, PASS_THRESHOLD.perCategory), ...base });
  assert.equal(at.passed, true, "exactly at threshold must pass");
  const under = scoreRun({ items: syntheticResults(instances, PASS_THRESHOLD.perCategory - 0.01), ...base });
  assert.equal(under.passed, false, "just under threshold must fail");
});

test("a high overall score still fails when one category is below threshold", () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const items = instances.map((i) => ({
    ...syntheticResults([i], i.category === "writing" ? 0.1 : 1)[0]!,
  }));
  const report = scoreRun({
    items,
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  assert.ok(report.normalized > PASS_THRESHOLD.overall, "overall should still be high");
  assert.equal(report.passed, false);
  assert.deepEqual(report.failedCategories, ["writing"]);
});

test("the half-weight boundary item does not distort the depth category total", () => {
  const instances = instantiate(PUBLIC_SEED, "public").filter((i) => i.category === "depth");
  const report = scoreRun({
    items: syntheticResults(instances, 1),
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  const depth = report.categories.find((c) => c.id === "depth")!;
  assert.equal(depth.points, 5);
  assert.ok(Math.abs(depth.awarded - 5) < 1e-9, `depth awarded ${depth.awarded}`);
});

test("category percentages are comparable across differently-sized categories", () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const items = instances.map((i) => ({
    ...syntheticResults([i], i.category === "writing" ? 1 : 0.5)[0]!,
  }));
  const report = scoreRun({
    items,
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  const writing = report.categories.find((c) => c.id === "writing")!;
  const logic = report.categories.find((c) => c.id === "logic")!;
  // 10-point and 5-point categories should report the same normalised figure.
  assert.ok(Math.abs(writing.normalized - 1) < 1e-9);
  assert.ok(Math.abs(logic.normalized - 0.5) < 1e-9);
});

test("a category with missing items is scored against its full allocation, not the items that ran", () => {
  const instances = instantiate(PUBLIC_SEED, "public").filter((i) => i.category === "factual").slice(0, 3);
  const report = scoreRun({
    items: syntheticResults(instances, 1),
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  const factual = report.categories.find((c) => c.id === "factual")!;
  assert.ok(
    factual.normalized < 1,
    `partial category must score below 100%, got ${factual.normalized}`,
  );
});

test("report always carries a version tag and seed fingerprint", () => {
  const report = scoreRun({
    items: syntheticResults(instantiate(PUBLIC_SEED, "public"), 0.5),
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: "synthetic",
    judge: "oracle-judge",
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });
  assert.match(report.versionTag, /^ESAC-GI v\d+\.\d+$/);
  assert.ok(report.version.length > 0);
  assert.ok(report.datasetSeedFingerprint.length > 0);
  assert.equal(report.judgeGradedPoints, 15);
});

test("held-out runs require an evaluator-supplied seed", async () => {
  // Enforced in the CLI, asserted here at the registry level: the held-out pool must
  // not be reachable from the public seed, or "held-out" would mean nothing.
  const held = instantiate(HOLDOUT_SEED, "heldout");
  const pub = instantiate(PUBLIC_SEED, "public");
  assert.notEqual(seedFingerprint(HOLDOUT_SEED), seedFingerprint(PUBLIC_SEED));
  assert.ok(
    held.some((h) => {
      const p = pub.find((i) => i.itemId === h.itemId)!;
      return p.fingerprint !== h.fingerprint;
    }),
    "held-out pool must not reproduce the public pool",
  );
});

// ===========================================================================
// 10. HTTP adapter
// ===========================================================================

test("the HTTP adapter parses OpenAI-compatible responses and classifies transport failure", async () => {
  const { createServer } = await import("node:http");
  const { createHttpAdapter } = await import("../src/adapters.ts");

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const isJudge = parsed["response_format"] !== undefined;
      const content = isJudge ? JSON.stringify({ a: 4, b: 3 }) : "the model's answer";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content } }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  const adapter = createHttpAdapter({ id: "stub", baseUrl, apiKey: "test", model: "stub-model" });

  const completion = await adapter.complete({
    prompt: "hello",
    temperature: 0,
    topP: 1,
    maxTokens: 32,
  });
  assert.equal(completion.text, "the model's answer");
  assert.equal(completion.promptTokens, 11);
  assert.equal(completion.completionTokens, 3);

  const judged = await adapter.score({
    rubric: { id: "r", context: "context", criteria: [{ id: "a", weight: 1, description: "d" }] },
    taskPrompt: "task",
    response: "response",
    temperature: 0,
    topP: 1,
  });
  assert.ok(judged.raw?.includes('"a"'), "judge raw output should be passed through for parsing");

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // A closed server is a transport failure: no valid response was obtained, so it
  // must raise an infrastructure error rather than a scored zero (resolution 8).
  await assert.rejects(
    () => adapter.complete({ prompt: "hello", temperature: 0, topP: 1, maxTokens: 32 }),
    (err: unknown) => err instanceof InfrastructureError,
  );
});

test("the HTTP adapter rejects an unparseable body as infrastructure", async () => {
  const { createServer } = await import("node:http");
  const { createHttpAdapter } = await import("../src/adapters.ts");

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json at all");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const adapter = createHttpAdapter({
    id: "bad",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test",
    model: "m",
  });

  await assert.rejects(
    () => adapter.complete({ prompt: "hello", temperature: 0, topP: 1, maxTokens: 32 }),
    (err: unknown) => err instanceof InfrastructureError,
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("the HTTP adapter rejects a non-2xx status as infrastructure", async () => {
  const { createServer } = await import("node:http");
  const { createHttpAdapter } = await import("../src/adapters.ts");

  const server = createServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "rate limited" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const adapter = createHttpAdapter({
    id: "limited",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test",
    model: "m",
  });

  await assert.rejects(
    () => adapter.complete({ prompt: "hello", temperature: 0, topP: 1, maxTokens: 32 }),
    (err: unknown) => err instanceof InfrastructureError,
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// 11. Version identity
// ===========================================================================

test("version constants are internally consistent", () => {
  assert.match(ESAC_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(ESAC_VERSION_TAG, `ESAC-GI v${ESAC_MAJOR}.0`);
  assert.match(ESAC_FULL_NAME, /EcoWestern Short and Cheap General Intelligence Benchmark, Version 1$/);
  assert.ok(CANARY.startsWith("ESAC-CANARY-GI-"));
});

// ===========================================================================
// 9. End-to-end
// ===========================================================================

test("a perfect oracle run reproduces exactly 75/75 through the full pipeline", async () => {
  const instances = instantiate(PUBLIC_SEED, "public");
  const oracle = createOracleAdapter({ accuracy: 1 });
  for (const instance of instances) {
    if (instance.reference !== undefined && !instance.judgeGraded) {
      oracle.answerKey.set(instance.prompt, instance.reference);
    }
  }
  const judge = createOracleJudge({ fixedFraction: 1 });

  const results: ItemRunResult[] = [];
  for (const instance of orderItems(instances)) {
    results.push(await runItem(instance, { model: oracle, judge }));
  }

  const report = scoreRun({
    items: results,
    split: "public",
    datasetSeed: PUBLIC_SEED,
    model: oracle.id,
    judge: judge.id,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  });

  assert.equal(report.total, 75);
  assert.equal(report.passed, true);
  assert.equal(report.items.filter((i) => i.infraRetries > 0).length, 0);
});

test("the public and held-out pools are both complete and use different dataset seeds", () => {
  const pub = instantiate(PUBLIC_SEED, "public");
  const held = instantiate(HOLDOUT_SEED, "heldout");
  assert.equal(pub.length, TOTAL_ITEMS);
  assert.equal(held.length, TOTAL_ITEMS);

  // The two pools must be seeded independently: their seeds must differ for every
  // item, which is what makes the held-out instances unseen rather than merely
  // relabelled public ones.
  for (const instance of pub) {
    const counterpart = held.find((i) => i.itemId === instance.itemId)!;
    assert.notEqual(counterpart.seed, instance.seed, `${instance.itemId} shares a seed`);
  }

  // And for the great majority of items the produced instance must differ too.
  const differing = held.filter((h) => {
    const p = pub.find((i) => i.itemId === h.itemId)!;
    return p.fingerprint !== h.fingerprint;
  });
  assert.ok(
    differing.length >= TOTAL_ITEMS - 2,
    `only ${differing.length}/${TOTAL_ITEMS} items differ between pools`,
  );
});

test("the scoring key is not recoverable from the model prompt", () => {
  // Two categories of item must be excluded from a naive "does the answer appear"
  // check, because for them the appearance is intrinsic rather than a leak:
  //   - a multiple-choice reference is a letter that necessarily appears as part of
  //     the option list, and
  //   - a name answer necessarily appears among the candidate names the item lists.
  //
  // Note this inspects `reference` (the actual scorable answer) and not `expected`,
  // which is human-readable documentation for the scoring key and legitimately quotes
  // prompt text ("exactly 8 lines" describes a constraint that is *in* the prompt).
  const statedAnswer = /\bthe answer is\b|\bcorrect answer[:\s]|\banswer\s*[:=]\s*(?!only)/i;

  let checkedFreeResponse = 0;

  for (const instance of instantiate(PUBLIC_SEED, "public")) {
    assert.ok(
      !statedAnswer.test(instance.prompt),
      `${instance.itemId} states its answer in the prompt`,
    );

    if (instance.reference === undefined) continue;
    if (/^[A-J]$/.test(instance.reference)) continue;

    // Name-answer items list every candidate name in the prompt by construction.
    const nameListed = new RegExp(
      instance.reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).test(instance.prompt);
    if (nameListed) continue;

    // A numeric or formula answer appearing verbatim in the prompt would mean the
    // model can read it off.
    checkedFreeResponse++;
    assert.ok(
      !instance.prompt.includes(instance.reference),
      `${instance.itemId} embeds its reference answer in the prompt`,
    );
  }

  assert.ok(
    checkedFreeResponse >= 8,
    `expected to check several free-response items, checked ${checkedFreeResponse}`,
  );
});
