/**
 * Category 4: Reading comprehension (5 items, 10 pts).
 *
 * The passage is generated from a structured fact base, and every question is
 * derived from that same structure. This is what makes the answers computable:
 * "what does the passage imply" is only gradeable exactly if the implication was
 * put there deliberately.
 *
 * Question types deliberately span the comprehension range rather than repeating
 * one skill: literal detail, arithmetic inference, temporal ordering, scope
 * discrimination (which claim is *not* supported), and authorial position.
 */

import type { ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import type { Rng } from "../rng.ts";
import { buildOptions, optionCheck } from "./helpers.ts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const REGIONS = ["north", "south", "east", "west", "central", "coastal", "upland", "lowland"];

interface PassageFacts {
  readonly authority: string;
  readonly regionA: string;
  readonly regionB: string;
  readonly baseA: number;
  readonly baseB: number;
  readonly growthA: number;
  readonly growthB: number;
  readonly year1: number;
  readonly year2: number;
  readonly year3: number;
  readonly surveyMonth: number;
  readonly reviewMonth: number;
  readonly adoptionMonth: number;
  readonly staff: number;
  readonly contractors: number;
  readonly vacancies: number;
  readonly budget: number;
  readonly deltaA: number;
  readonly deltaB: number;
  readonly totalWorkforce: number;
}

interface Passage {
  readonly text: string;
  readonly facts: PassageFacts;
}

/**
 * A generated report about a fictional regional authority. Neutral domain, invented
 * entities, no real-world claims to be wrong about.
 */
function makePassage(rng: Rng): Passage {
  const authority = rng.pick([
    "the Bracken Valley Water Board",
    "the Solent Regional Transport Commission",
    "the Harlow Uplands Conservation Trust",
    "the Marlowe District Library Service",
  ]);

  const regionA = rng.pick(REGIONS);
  const regionB = rng.pick(REGIONS.filter((r) => r !== regionA));

  const baseA = rng.range(20, 60);
  const baseB = rng.range(20, 60);
  const growthA = rng.range(3, 9);
  const growthB = rng.range(-8, -1);

  const year1 = rng.range(2019, 2022);
  const year2 = year1 + 1;
  const year3 = year1 + 2;

  const surveyMonth = rng.int(6);
  const reviewMonth = 6 + rng.int(5);
  const adoptionMonth = 11;

  const staff = rng.range(40, 90);
  const contractors = rng.range(10, staff);
  const vacancies = rng.range(2, 12);
  const budget = rng.range(4, 20);

  const text =
    `${authority} published its triennial review in ${MONTHS[adoptionMonth]} ${year3}. ` +
    `The review covers three financial years beginning in ${year1}.\n\n` +
    `Demand in the ${regionA} region rose from ${baseA} thousand units in ${year1} to ` +
    `${baseA + growthA} thousand units in ${year2}, an increase the board attributes primarily to ` +
    `new housing rather than to changes in consumption per household. Demand in the ${regionB} region ` +
    `moved in the opposite direction over the same period, falling from ${baseB} thousand units to ` +
    `${baseB + growthB} thousand units, which the board links to the closure of two industrial sites.\n\n` +
    `A household survey was conducted in ${MONTHS[surveyMonth]} ${year2}. Respondents were asked whether ` +
    `they would accept a higher tariff in exchange for a guaranteed reduction in supply interruptions. ` +
    `A draft of the review was circulated for consultation in ${MONTHS[reviewMonth]} ${year2}, and the ` +
    `board's formal response to that consultation was adopted in ${MONTHS[adoptionMonth]} ${year3}.\n\n` +
    `At the time of publication the authority employed ${staff} staff directly and engaged ` +
    `${contractors} contractors, with ${vacancies} permanent posts unfilled. Its annual operating budget ` +
    `is £${budget} million. The board states that it will not commit to the guaranteed-interruption ` +
    `standard unless the higher tariff is approved first, on the grounds that the two cannot be separated: ` +
    `the service improvement depends on the revenue, and the revenue cannot be justified without the improvement.`;

  return {
    text,
    facts: {
      authority, regionA, regionB, baseA, baseB, growthA, growthB,
      year1, year2, year3, surveyMonth, reviewMonth, adoptionMonth,
      staff, contractors, vacancies, budget,
      deltaA: growthA,
      deltaB: Math.abs(growthB),
      totalWorkforce: staff + contractors,
    },
  };
}

const PASSAGE_ANSWER_INSTRUCTION = "Answer with only the letter of the correct choice.";

// ---------------------------------------------------------------------------
// 1. Literal detail
// ---------------------------------------------------------------------------

const literalDetail: ItemTemplate = {
  id: "reading.literal-detail",
  category: "reading",
  measures: "Direct retrieval of a stated quantity, where the wrong options are other quantities from the same passage.",
  generate: (rng) => {
    const p = makePassage(rng);
    const f = p.facts;
    const correct = `£${f.budget} million`;

    // Build the wrong amounts as a set so that a randomly-drawn delta cannot
    // coincide with the doubling or with another delta and leave the item with
    // fewer than four options.
    const wrongAmounts = new Set<number>([
      f.budget + rng.range(1, 5),
      f.budget - rng.range(1, 3),
      f.budget * 2,
      f.budget + 7,
      f.budget + 11,
      Math.max(1, f.budget - 4),
    ]);
    wrongAmounts.delete(f.budget);
    const distractors = [...wrongAmounts].filter((n) => n > 0).map((n) => `£${n} million`);
    if (distractors.length < 3) throw new Error("reading.literal-detail: insufficient distractors");

    const opts = buildOptions(rng, correct, distractors.slice(0, 3));

    return {
      prompt: `${p.text}\n\n---\n\nAccording to the passage, what is the authority's annual operating budget?\n\n${opts.block}\n\n${PASSAGE_ANSWER_INSTRUCTION}`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Arithmetic inference
// ---------------------------------------------------------------------------

const arithmeticInference: ItemTemplate = {
  id: "reading.arithmetic-inference",
  category: "reading",
  measures:
    "Combining two stated figures that are never combined in the text. The arithmetic is trivial; locating the operands is the work.",
  generate: (rng) => {
    const p = makePassage(rng);
    const f = p.facts;
    const answer = f.totalWorkforce;
    const staff = f.staff;
    const contractors = f.contractors;

    return {
      prompt:
        `${p.text}\n\n---\n\nIn total, including both directly-employed staff and engaged contractors, ` +
        `how many people was the authority working with at the time of publication? ` +
        `Answer with only a number.`,
      checks: [
        {
          id: "answer",
          weight: 1,
          expected: `${answer} (${staff} staff + ${contractors} contractors)`,
          grader: g.numeric(answer, 0),
        },
      ],
      reference: String(answer),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Temporal ordering
// ---------------------------------------------------------------------------

const temporalOrdering: ItemTemplate = {
  id: "reading.temporal-order",
  category: "reading",
  measures: "Reconstructing a chronology from dates scattered across the passage rather than presented as a list.",
  generate: (rng) => {
    const p = makePassage(rng);
    const f = p.facts;

    interface Ev {
      readonly label: string;
      readonly month: number;
      readonly year: number;
    }
    const events: Ev[] = [
      { label: "the household survey was conducted", month: f.surveyMonth, year: f.year2 },
      { label: "the draft review was circulated for consultation", month: f.reviewMonth, year: f.year2 },
      { label: "the board's formal response to the consultation was adopted", month: f.adoptionMonth, year: f.year3 },
      { label: "the three-year review period began", month: 0, year: f.year1 },
    ];

    const sorted = [...events].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    const correctEvent = sorted[3]!;

    const opts = buildOptions(
      rng,
      correctEvent.label,
      sorted.slice(0, 3).map((e) => e.label),
    );

    return {
      prompt:
        `${p.text}\n\n---\n\nWhich of the following happened most recently, according to the passage?\n\n` +
        `${opts.block}\n\n${PASSAGE_ANSWER_INSTRUCTION}`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. Scope discrimination: which claim is NOT supported
// ---------------------------------------------------------------------------

const scopeDiscrimination: ItemTemplate = {
  id: "reading.scope",
  category: "reading",
  measures:
    "Distinguishing claims the passage supports from a claim adjacent to the topic but absent from it. Models that match topic rather than content fail here.",
  generate: (rng) => {
    const p = makePassage(rng);
    const f = p.facts;

    const supported = [
      `Demand in the ${f.regionA} region increased between ${f.year1} and ${f.year2}.`,
      `Demand in the ${f.regionB} region fell between ${f.year1} and ${f.year2}.`,
      `The authority had ${f.vacancies} unfilled permanent posts at the time of publication.`,
    ];

    // Unsupported claims: plausible on topic, but never asserted. One is chosen so
    // the same construct is tested with different surface content.
    const unsupportedPool = [
      `The household survey found that a majority of respondents supported the higher tariff.`,
      `The authority's annual operating budget was increased during the review period.`,
      `The closure of the industrial sites reduced the authority's revenue.`,
      `The consultation produced more objections than the board had anticipated.`,
    ];
    const unsupported = rng.pick(unsupportedPool);

    const opts = buildOptions(rng, unsupported, supported);

    return {
      prompt:
        `${p.text}\n\n---\n\nWhich of the following is NOT supported by the passage?\n\n` +
        `${opts.block}\n\n${PASSAGE_ANSWER_INSTRUCTION}`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Authorial position
// ---------------------------------------------------------------------------

const authorialPosition: ItemTemplate = {
  id: "reading.position",
  category: "reading",
  measures:
    "Inferring the position the passage implies rather than one the reader might hold. The wrong options are positions the passage is consistent with but does not adopt.",
  generate: (rng) => {
    const p = makePassage(rng);
    const f = p.facts;

    // The passage states the board's position as a conditional dependency: no
    // commitment without the tariff, justified by mutual dependence.
    const correct =
      "The authority treats the service standard and the tariff as mutually dependent, so neither is offered unconditionally.";

    const distractors = [
      "The authority intends to raise the tariff regardless of whether it can meet the service standard.",
      "The authority regards the service standard as achievable without any change in revenue.",
      `The authority considers demand growth in the ${f.regionA} region to be the sole reason for its current budget.`,
      "The authority has already approved the guaranteed-interruption standard.",
    ];

    const opts = buildOptions(rng, correct, rng.sample(distractors, 3));

    return {
      prompt:
        `${p.text}\n\n---\n\nWhich statement best captures the position the passage attributes to the authority?\n\n` +
        `${opts.block}\n\n${PASSAGE_ANSWER_INSTRUCTION}`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

export const READING_ITEMS: readonly ItemTemplate[] = [
  literalDetail,
  arithmeticInference,
  temporalOrdering,
  scopeDiscrimination,
  authorialPosition,
];
