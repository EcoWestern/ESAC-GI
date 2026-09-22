/**
 * Category 1 — Logic & deduction (5 items, 10 pts).
 *
 * Every puzzle is generated from a randomly-drawn ground truth and then verified
 * by brute force to have exactly one solution. That verification is what makes the
 * expected answer computable rather than stored, which is the whole point of
 * resolution 4's parametrization requirement.
 */

import type { Check, ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import type { Rng } from "../rng.ts";
import { buildOptions, extractNamesFromLastLine, lastLine, optionCheck, permutations } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const PEOPLE = ["Ada", "Bram", "Corin", "Dax", "Eleni", "Fen", "Greta", "Hale"] as const;

/** Answer line must name exactly one person from the pool, and it must be right. */
function singleNameCheck(pool: readonly string[], expected: string): Check {
  return {
    id: "answer",
    weight: 1,
    expected,
    grader: g.programmatic(`names exactly one person, ${expected}`, (r) => {
      const named = extractNamesFromLastLine(r, pool);
      return named.length === 1 && named[0] === expected ? 1 : 0;
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. Linear seating arrangement
// ---------------------------------------------------------------------------

interface SeatClue {
  readonly text: string;
  readonly test: (pos: Readonly<Record<string, number>>) => boolean;
}

function makeSeatClues(names: readonly string[], rng: Rng, truth: Readonly<Record<string, number>>): SeatClue[] {
  const out: SeatClue[] = [];
  const n = names.length;

  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      out.push({
        text: `${a} sits next to ${b}.`,
        test: (p) => Math.abs(p[a]! - p[b]!) === 1,
      });
      out.push({
        text: `${a} sits somewhere to the left of ${b}.`,
        test: (p) => p[a]! < p[b]!,
      });
      out.push({
        text: `${a} sits immediately to the left of ${b}.`,
        test: (p) => p[a]! === p[b]! - 1,
      });
      out.push({
        text: `${a} does not sit next to ${b}.`,
        test: (p) => Math.abs(p[a]! - p[b]!) !== 1,
      });
      for (let k = 2; k < n - 1; k++) {
        const between = k - 1;
        out.push({
          // Singular/plural agreement matters here: "There are exactly 1 person" reads
          // as a typo and would make the item look machine-generated to a careful
          // reader, which invites scrutiny of the puzzle rather than the reasoning.
          text:
            between === 1
              ? `There is exactly 1 person seated between ${a} and ${b}.`
              : `There are exactly ${between} people seated between ${a} and ${b}.`,
          test: (p) => Math.abs(p[a]! - p[b]!) === k,
        });
      }
    }
    out.push({ text: `${a} sits at one of the two ends.`, test: (p) => p[a] === 0 || p[a] === n - 1 });
    out.push({ text: `${a} does not sit at either end.`, test: (p) => p[a] !== 0 && p[a] !== n - 1 });
  }

  return rng.shuffle(out.filter((c) => c.test(truth)));
}

function countSeatings(names: readonly string[], clues: readonly SeatClue[]): Record<string, number>[] {
  const solutions: Record<string, number>[] = [];
  for (const perm of permutations(names)) {
    const pos: Record<string, number> = {};
    perm.forEach((name, i) => (pos[name] = i));
    if (clues.every((c) => c.test(pos))) solutions.push(pos);
  }
  return solutions;
}

const seating: ItemTemplate = {
  id: "logic.seating",
  category: "logic",
  measures: "Constraint satisfaction over a linear order; requires propagating several relational clues to a single forced placement.",
  generate: (rng) => {
    const names = rng.sample(PEOPLE, 5);

    for (let attempt = 0; attempt < 300; attempt++) {
      const order = rng.shuffle(names);
      const truth: Record<string, number> = {};
      order.forEach((n, i) => (truth[n] = i));

      const candidates = makeSeatClues(names, rng, truth);
      const chosen: SeatClue[] = [];
      for (const clue of candidates) {
        chosen.push(clue);
        if (chosen.length > 5) break;
        const solutions = countSeatings(names, chosen);
        if (solutions.length === 1 && chosen.length >= 3) break;
        if (solutions.length === 0) {
          chosen.pop();
        }
      }

      if (chosen.length < 3 || chosen.length > 5) continue;
      if (countSeatings(names, chosen).length !== 1) continue;

      // Ask about a middle seat so the answer is not just "one of the ends".
      const target = rng.range(1, 3);
      const answer = order[target]!;
      const clueBlock = chosen.map((c) => `- ${c.text}`).join("\n");

      return {
        prompt:
          `${names.length} people — ${names.join(", ")} — are seated in a row of ${names.length} chairs, ` +
          `numbered 1 to ${names.length} from left to right. Exactly one person occupies each chair.\n\n` +
          `${clueBlock}\n\n` +
          `Who is seated in chair ${target + 1}? Answer with only that person's name.`,
        checks: [singleNameCheck(names, answer)],
        reference: answer,
      };
    }

    throw new Error("logic.seating: failed to generate a uniquely-determined puzzle");
  },
};

// ---------------------------------------------------------------------------
// 2. Knights and knaves
// ---------------------------------------------------------------------------

interface Statement {
  readonly text: string;
  /** Given the set of knights, is this statement true? */
  readonly truth: (knights: ReadonlySet<string>) => boolean;
}

const knightsAndKnaves: ItemTemplate = {
  id: "logic.knights",
  category: "logic",
  measures:
    "Self-referential truth assignment. Requires reasoning about the fixed point between a speaker's honesty and the content of what they said.",
  generate: (rng) => {
    const names = rng.sample(PEOPLE, 3);

    for (let attempt = 0; attempt < 400; attempt++) {
      const makeStatement = (speaker: string): Statement | null => {
        const others = names.filter((n) => n !== speaker);
        const target = rng.pick(others);
        const other = others.find((n) => n !== target)!;
        const kind = rng.int(6);
        switch (kind) {
          case 0:
            return {
              text: `${target} is a knave.`,
              truth: (k) => !k.has(target),
            };
          case 1:
            return {
              text: `${target} is a knight.`,
              truth: (k) => k.has(target),
            };
          case 2:
            return {
              text: `${target} and ${other} are of the same kind.`,
              truth: (k) => k.has(target) === k.has(other),
            };
          case 3:
            return {
              text: `${target} and ${other} are of different kinds.`,
              truth: (k) => k.has(target) !== k.has(other),
            };
          case 4:
            return {
              text: `At least one of ${other} and I is a knave.`,
              truth: (k) => !k.has(other) || !k.has(speaker),
            };
          default:
            return {
              text: `I and ${target} are of the same kind.`,
              truth: (k) => k.has(speaker) === k.has(target),
            };
        }
      };

      const statements = new Map<string, Statement>();
      for (const speaker of names) {
        const s = makeStatement(speaker);
        if (s) statements.set(speaker, s);
      }
      if (statements.size !== 3) continue;

      // A valid world: every knight's statement is true, every knave's is false.
      const solutions: Set<string>[] = [];
      for (let mask = 0; mask < 1 << names.length; mask++) {
        const k = new Set<string>();
        names.forEach((n, i) => {
          if (mask & (1 << i)) k.add(n);
        });
        const consistent = names.every((n) => statements.get(n)!.truth(k) === k.has(n));
        if (consistent) solutions.push(k);
      }

      if (solutions.length !== 1) continue;

      const only = solutions[0]!;
      if (only.size === 0 || only.size === 3) continue;

      const statementBlock = names.map((n) => `${n}: "${statements.get(n)!.text}"`).join("\n");
      const preamble = `On an island, every inhabitant is either a knight, who always tells the truth, or a knave, who always lies. You meet three inhabitants:\n\n${statementBlock}\n\n`;

      const askCount = rng.chance(0.5);
      if (askCount) {
        return {
          prompt: `${preamble}How many of the three are knights? Answer with only a number.`,
          checks: [{ id: "answer", weight: 1, expected: String(only.size), grader: g.numeric(only.size, 0) }],
          reference: String(only.size),
        };
      }

      const subject = rng.pick(names);
      const isKnight = only.has(subject);
      const opts = buildOptions(rng, isKnight ? "A knight" : "A knave", [
        isKnight ? "A knave" : "A knight",
        "Cannot be determined",
        "Neither — the statements are inconsistent",
      ]);

      return {
        prompt: `${preamble}Which of the following is ${subject}?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
        checks: [optionCheck(opts.options, opts.answer)],
        reference: opts.answer,
      };
    }

    throw new Error("logic.knights: failed to generate a uniquely-determined puzzle");
  },
};

// ---------------------------------------------------------------------------
// 3. Syllogistic entailment
// ---------------------------------------------------------------------------

/**
 * Monadic predicate logic has the property that a model is fully characterised by
 * which of the 2^n predicate-signature "types" are non-empty. With three predicates
 * that is 255 models, so entailment can be decided exactly by enumeration — no
 * heuristic and no dependence on a hand-written answer key.
 */
const NUM_TYPES = 8;

function typeSatisfiesAll(type: number, predicateBit: number): boolean {
  return (type & (1 << predicateBit)) !== 0;
}

interface StatementForm {
  readonly p: number;
  readonly q: number;
  readonly test: (present: ReadonlySet<number>) => boolean;
  readonly text: (pv: string, qv: string) => string;
}

const FORMS: readonly StatementForm[] = [
  {
    p: 0,
    q: 1,
    test: (s) => [...s].every((t) => !typeSatisfiesAll(t, 0) || typeSatisfiesAll(t, 1)),
    text: (a, b) => `All ${a} are ${b}.`,
  },
  {
    p: 0,
    q: 1,
    test: (s) => [...s].every((t) => !typeSatisfiesAll(t, 1) || typeSatisfiesAll(t, 0)),
    text: (a, b) => `All ${b} are ${a}.`,
  },
  {
    p: 0,
    q: 1,
    test: (s) => [...s].some((t) => typeSatisfiesAll(t, 0) && typeSatisfiesAll(t, 1)),
    text: (a, b) => `Some ${a} are ${b}.`,
  },
  {
    p: 0,
    q: 1,
    test: (s) => [...s].some((t) => typeSatisfiesAll(t, 0) && !typeSatisfiesAll(t, 1)),
    text: (a, b) => `Some ${a} are not ${b}.`,
  },
  {
    p: 0,
    q: 1,
    test: (s) => [...s].every((t) => !(typeSatisfiesAll(t, 0) && typeSatisfiesAll(t, 1))),
    text: (a, b) => `No ${a} are ${b}.`,
  },
  {
    p: 0,
    q: 1,
    test: (s) => [...s].some((t) => !typeSatisfiesAll(t, 0) && typeSatisfiesAll(t, 1)),
    text: (a, b) => `Some ${b} are not ${a}.`,
  },
];

/** Build a statement over two of the three predicate slots. */
function formOverPair(form: StatementForm, i: number, j: number): { test: (s: ReadonlySet<number>) => boolean; text: (a: string, b: string) => string } {
  const remap = (bit: number): number => (bit === 0 ? i : j);
  return {
    test: (present) => {
      const projected = new Set<number>();
      for (const t of present) {
        let p = 0;
        if (typeSatisfiesAll(t, remap(0))) p |= 1;
        if (typeSatisfiesAll(t, remap(1))) p |= 2;
        projected.add(p);
      }
      return form.test(projected);
    },
    text: form.text,
  };
}

const syllogism: ItemTemplate = {
  id: "logic.syllogism",
  category: "logic",
  measures:
    "Formal entailment rather than plausibility. Distractors are the converse, obverse, and weakened variants that surface reasoning typically produces.",
  generate: (rng) => {
    const words = rng.sample(
      ["engineers", "cyclists", "poets", "gardeners", "archivists", "pilots", "welders", "surveyors", "cellists", "beekeepers"],
      3,
    );

    for (let attempt = 0; attempt < 500; attempt++) {
      // Draw premises from the statement forms, then compute what they entail.
      const premiseForms = rng.sample([0, 1, 2, 3, 4, 5], 2);
      const premises = premiseForms.map((f, idx) => {
        const pairs: [number, number][] = [
          [0, 1],
          [1, 2],
          [0, 2],
        ];
        const [i, j] = rng.pick(pairs);
        const form = FORMS[f]!;
        const over = formOverPair(form, i, j);
        return {
          kind: idx,
          text: form.text(words[i]!, words[j]!),
          test: over.test,
        };
      });

      const models: number[][] = [];
      for (let bits = 1; bits < 1 << NUM_TYPES; bits++) {
        const present = new Set<number>();
        for (let t = 0; t < NUM_TYPES; t++) if (bits & (1 << t)) present.add(t);

        // Require existential import: every predicate must have at least one member in
        // every model considered.
        //
        // Without this, a premise pair like "No engineers are surveyors" together with
        // "All engineers are surveyors" is satisfiable — but only when no engineers
        // exist. That is valid first-order logic and useless as a puzzle: it reads to a
        // competent solver as a flat contradiction rather than as a subtle inference, so
        // the item would test willingness to accept a vacuous reading instead of
        // deductive reasoning. Standard logic puzzles assume their terms are inhabited.
        const allInhabited = [0, 1, 2].every((predicate) => {
          for (const t of present) if ((t >> predicate) & 1) return true;
          return false;
        });
        if (!allInhabited) continue;

        if (premises.every((p) => p.test(present))) {
          const arr: number[] = [];
          present.forEach((t) => arr.push(t));
          models.push(arr);
        }
      }
      if (models.length === 0) continue;

      // Every candidate conclusion, classified as entailed or not.
      const candidates: { text: string; entailed: boolean }[] = [];
      const pairs: [number, number][] = [
        [0, 1],
        [1, 2],
        [0, 2],
      ];
      for (const [i, j] of pairs) {
        for (const form of FORMS) {
          const over = formOverPair(form, i, j);
          const text = form.text(words[i]!, words[j]!);
          if (premises.some((p) => p.text === text)) continue;
          const entailed = models.every((m) => over.test(new Set(m)));
          candidates.push({ text, entailed });
        }
      }

      const dedupe = new Map<string, boolean>();
      for (const c of candidates) dedupe.set(c.text, c.entailed);
      const all = [...dedupe.entries()].map(([text, entailed]) => ({ text, entailed }));

      const entailedOptions = all.filter((c) => c.entailed);
      const nonEntailed = all.filter((c) => !c.entailed);
      if (entailedOptions.length === 0 || nonEntailed.length < 4) continue;

      const correct = rng.pick(entailedOptions).text;
      const distractors = rng.sample(nonEntailed.map((c) => c.text), 4);
      const opts = buildOptions(rng, correct, distractors, 5);

      const premiseBlock = premises.map((p) => `- ${p.text}`).join("\n");
      return {
        prompt:
          `Assume the following premises are all true:\n\n${premiseBlock}\n\n` +
          `Which one of the following statements must also be true? Only one option is logically ` +
          `forced by the premises; the others are consistent with them but do not follow.\n\n` +
          `${opts.block}\n\nAnswer with only the letter of the correct choice.`,
        checks: [optionCheck(opts.options, opts.answer)],
        reference: opts.answer,
      };
    }

    throw new Error("logic.syllogism: failed to generate an item with exactly one entailed option");
  },
};

// ---------------------------------------------------------------------------
// 4. Race ranking
// ---------------------------------------------------------------------------

const ranking: ItemTemplate = {
  id: "logic.ranking",
  category: "logic",
  measures: "Transitive ordering under partially-redundant clues, where the answer sits in the middle and needs the full chain.",
  generate: (rng) => {
    const names = rng.sample(PEOPLE, 5);

    for (let attempt = 0; attempt < 300; attempt++) {
      const order = rng.shuffle(names);
      const place: Record<string, number> = {};
      order.forEach((n, i) => (place[n] = i));

      const candidates: { text: string; test: (p: Readonly<Record<string, number>>) => boolean }[] = [];
      for (const a of names) {
        for (const b of names) {
          if (a === b) continue;
          if (place[a]! < place[b]!) {
            candidates.push({
              text: `${a} finished ahead of ${b}.`,
              test: (p) => p[a]! < p[b]!,
            });
            const gap = place[b]! - place[a]!;
            if (gap >= 2) {
              candidates.push({
                text: `${a} finished ahead of ${b} but not immediately ahead.`,
                test: (p) => p[a]! < p[b]! && p[b]! - p[a]! > 1,
              });
            }
          } else {
            candidates.push({
              text: `${b} finished ahead of ${a}.`,
              test: (p) => p[b]! < p[a]!,
            });
          }
        }
      }

      const chosen: typeof candidates = [];
      for (const clue of rng.shuffle(candidates)) {
        chosen.push(clue);
        if (chosen.length > 4) break;
        const solutions = permutations(names).filter((perm) => {
          const p: Record<string, number> = {};
          perm.forEach((n, i) => (p[n] = i));
          return chosen.every((c) => c.test(p));
        });
        if (solutions.length === 1 && chosen.length >= 3) break;
        if (solutions.length === 0) chosen.pop();
      }

      if (chosen.length < 3 || chosen.length > 4) continue;
      const solutions = permutations(names).filter((perm) => {
        const p: Record<string, number> = {};
        perm.forEach((n, i) => (p[n] = i));
        return chosen.every((c) => c.test(p));
      });
      if (solutions.length !== 1) continue;

      const target = rng.range(1, 3);
      const answer = order[target]!;
      const clueBlock = chosen.map((c) => `- ${c.text}`).join("\n");

      return {
        prompt:
          `Five runners — ${names.join(", ")} — finished a race. No two finished at the same time.\n\n` +
          `${clueBlock}\n\n` +
          `Who finished ${target + 1}${target === 1 ? "nd" : target === 2 ? "rd" : "th"}? Answer with only that person's name.`,
        checks: [singleNameCheck(names, answer)],
        reference: answer,
      };
    }

    throw new Error("logic.ranking: failed to generate a uniquely-determined ranking");
  },
};

// ---------------------------------------------------------------------------
// 5. Two-attribute logic grid
// ---------------------------------------------------------------------------

const PETS = ["cat", "dog", "ferret", "parrot"] as const;
const CITIES = ["Oslo", "Lima", "Tunis", "Perth"] as const;

const grid: ItemTemplate = {
  id: "logic.grid",
  category: "logic",
  measures:
    "Joint constraint solving across two bijections. The subject is chosen to be the one person with no direct assertion about them, so the answer requires elimination across several clues rather than retrieval.",
  generate: (rng) => {
    const names = rng.sample(PEOPLE, 4);

    interface PetClue {
      readonly text: string;
      readonly test: (po: Readonly<Record<string, string>>) => boolean;
      /** Whether this clue asserts a pet positively (used to pick a non-trivial subject). */
      readonly positive: boolean;
    }
    interface CityClue {
      readonly text: string;
      readonly test: (po: Readonly<Record<string, string>>, co: Readonly<Record<string, string>>) => boolean;
    }

    const asPetMap = (perm: readonly string[]): Record<string, string> => {
      const m: Record<string, string> = {};
      names.forEach((n, i) => (m[n] = perm[i]!));
      return m;
    };
    const asCityMap = (perm: readonly string[]): Record<string, string> => {
      const m: Record<string, string> = {};
      names.forEach((n, i) => (m[n] = perm[i]!));
      return m;
    };

    const allPetPerms = permutations([...PETS]);
    const allCityPerms = permutations([...CITIES]);

    for (let attempt = 0; attempt < 300; attempt++) {
      const petOf = asPetMap(rng.shuffle([...PETS]));
      const cityOf = asCityMap(rng.shuffle([...CITIES]));

      // ---------------------------------------------------------------------
      // Phase A — pin the pet mapping by greedy constraint minimisation.
      //
      // Candidates are ordered compound-negation first, then single negation,
      // then positive, so the greedy search prefers the more informative
      // negations over a bare "X keeps the Y" assertion.
      // ---------------------------------------------------------------------
      const petCandidates: PetClue[] = [];

      for (const n of names) {
        const truePet = petOf[n]!;
        const wrong = PETS.filter((p) => p !== truePet);
        for (let i = 0; i < wrong.length; i++) {
          for (let j = i + 1; j < wrong.length; j++) {
            const [x, y] = [wrong[i]!, wrong[j]!];
            petCandidates.push({
              text: `${n} keeps neither the ${x} nor the ${y}.`,
              test: (po) => po[n] !== x && po[n] !== y,
              positive: false,
            });
          }
        }
      }
      for (const n of names) {
        const truePet = petOf[n]!;
        for (const p of PETS) {
          if (p === truePet) continue;
          petCandidates.push({
            text: `${n} does not keep the ${p}.`,
            test: (po) => po[n] !== p,
            positive: false,
          });
        }
      }
      for (const n of names) {
        const truePet = petOf[n]!;
        petCandidates.push({
          text: `${n} keeps the ${truePet}.`,
          test: (po) => po[n] === truePet,
          positive: true,
        });
      }

      let petRemaining = allPetPerms.slice();
      const chosenPet: PetClue[] = [];
      while (petRemaining.length > 1 && chosenPet.length < 4) {
        let best: PetClue | null = null;
        let bestCount = petRemaining.length;
        for (const candidate of petCandidates) {
          if (chosenPet.includes(candidate)) continue;
          const count = petRemaining.filter((perm) => candidate.test(asPetMap(perm))).length;
          if (count < bestCount) {
            bestCount = count;
            best = candidate;
          }
        }
        if (!best) break;
        chosenPet.push(best);
        petRemaining = petRemaining.filter((perm) => best!.test(asPetMap(perm)));
      }
      if (petRemaining.length !== 1) continue;

      // The answer must require elimination: ask about someone the clues never
      // assert a pet for directly.
      const asserted = new Set(
        chosenPet.filter((c) => c.positive).map((c) => names.find((n) => c.text.startsWith(n))!),
      );
      const candidatesForSubject = names.filter((n) => !asserted.has(n));
      if (candidatesForSubject.length === 0) continue;

      // ---------------------------------------------------------------------
      // Phase B — pin the city mapping, seeded with one cross clue so the item
      // genuinely requires holding both mappings at once.
      // ---------------------------------------------------------------------
      const petPerm = petRemaining[0]!;
      const pinnedPetOf = asPetMap(petPerm);

      const crossPet = rng.pick([...PETS]);
      const crossOwner = names.find((n) => pinnedPetOf[n] === crossPet)!;
      const crossCity = cityOf[crossOwner]!;
      const crossClue: CityClue = {
        text: `The ${crossPet} owner lives in ${crossCity}.`,
        test: (po, co) => co[names.find((n) => po[n] === crossPet)!] === crossCity,
      };

      let cityRemaining = allCityPerms.filter((perm) => crossClue.test(pinnedPetOf, asCityMap(perm)));
      const chosenCity: CityClue[] = [crossClue];

      const cityCandidates: CityClue[] = [];
      for (const n of names) {
        const trueCity = cityOf[n]!;
        cityCandidates.push({ text: `${n} lives in ${trueCity}.`, test: (_po, co) => co[n] === trueCity });
        for (const c of CITIES) {
          if (c === trueCity) continue;
          cityCandidates.push({ text: `${n} does not live in ${c}.`, test: (_po, co) => co[n] !== c });
        }
      }

      while (cityRemaining.length > 1 && chosenCity.length < 4) {
        let best: CityClue | null = null;
        let bestCount = cityRemaining.length;
        for (const candidate of cityCandidates) {
          if (chosenCity.includes(candidate)) continue;
          const count = cityRemaining.filter((perm) => candidate.test(pinnedPetOf, asCityMap(perm))).length;
          if (count < bestCount) {
            bestCount = count;
            best = candidate;
          }
        }
        if (!best) break;
        chosenCity.push(best);
        cityRemaining = cityRemaining.filter((perm) => best!.test(pinnedPetOf, asCityMap(perm)));
      }
      if (cityRemaining.length !== 1) continue;

      const subject = rng.pick(candidatesForSubject);
      const answer = petOf[subject]!;
      const opts = buildOptions(
        rng,
        answer,
        PETS.filter((p) => p !== answer),
      );

      const allClues = rng.shuffle([...chosenPet, ...chosenCity]);
      const clueBlock = allClues.map((c) => `- ${c.text}`).join("\n");

      return {
        prompt:
          `Four friends — ${names.join(", ")} — each keep a different animal (one of: ${PETS.join(", ")}) ` +
          `and each live in a different city (one of: ${CITIES.join(", ")}).\n\n` +
          `${clueBlock}\n\n` +
          `Which animal does ${subject} keep?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
        checks: [optionCheck(opts.options, opts.answer)],
        reference: opts.answer,
      };
    }

    throw new Error("logic.grid: failed to generate a uniquely-determined grid puzzle");
  },
};

/** Lightweight guard used by tests: the last line must not be empty. */
export function _lastLineNonEmpty(s: string): boolean {
  return lastLine(s).length > 0;
}

export const LOGIC_ITEMS: readonly ItemTemplate[] = [seating, knightsAndKnaves, syllogism, ranking, grid];
