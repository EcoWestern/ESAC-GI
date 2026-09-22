/**
 * Category 8 — Response-depth calibration (5 items, 5 pts).
 *
 * Construct (first-amendment §2): whether the model can infer the *appropriate depth
 * of response from contextual cues* — not whether it can follow an explicit "be
 * concise" or "be detailed" instruction, and not raw response length.
 *
 * The category therefore contains no instruction about length anywhere in the
 * prompt. The depth cue must be carried by the situation: who is asking, what they
 * will do with the answer, and what the medium is.
 *
 * Structure (first-amendment §2):
 *   - 2 items where a substantive response is appropriate
 *   - 2 items where a concise response is appropriate
 *   - 1 boundary item where either is acceptable, carrying half the weight of a
 *     normal item
 *
 * Anti-gaming note. A rubric that simply rewards brevity is passable by an empty
 * answer, and a rubric that rewards detail is passable by padding. So every rubric
 * here contains an explicit "answered the actual question" criterion with
 * substantial weight, and the depth criterion is scored against the situation rather
 * than against a length band. An empty or evasive response fails the first criterion
 * on both item types.
 *
 * Items are authored prompt families rather than parametrized templates: the depth
 * cue *is* the context, and scrambling that context to defeat memorisation would
 * destroy the construct. Rotation happens at the scenario-pool level across releases
 * (first-amendment §4, which permits exactly this for items where parametrization
 * would change what is being measured).
 */

import type { ItemTemplate, Rubric } from "../types.ts";
import { g } from "../graders.ts";


// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

const SUBSTANTIVE_RUBRIC: Rubric = {
  id: "depth.substantive.v1",
  context:
    "This situation requires a substantive, well-developed response. The person asking has a real need for a layered explanation, reasoning, or steps — the context makes that clear even though the prompt does not say so and does not use the words 'detail' or 'explain'. A dismissively short answer that technically touches the question is a failure of depth calibration, not an acceptable minimal answer.",
  criteria: [
    {
      id: "answered",
      weight: 3,
      description:
        "Does the response actually address what was asked and give the person something they can act on or understand? Score 4 for a complete, useful answer; 2 for a partial answer that leaves the central need unmet; 0 for an empty, evasive, or off-topic response.",
      levels: [
        { score: 0, label: "absent", description: "Does not answer the question, or is empty/evasive." },
        { score: 2, label: "partial", description: "Answers some of it, but leaves the central need unmet." },
        { score: 4, label: "complete", description: "Addresses the question fully enough to be acted on." },
      ],
    },
    {
      id: "depth-fit",
      weight: 3,
      description:
        "Is the level of detail appropriate to the situation? Score 4 for a response developed to the depth the situation calls for, with the key steps or reasoning present; 2 for a response that is correct but noticeably under-developed for this context; 0 for a dismissively brief answer that treats a genuine information need as a trivia question.",
      levels: [
        { score: 0, label: "far too thin", description: "A sentence or fragment where real explanation was needed." },
        { score: 2, label: "under-developed", description: "Correct in outline but missing steps the situation requires." },
        { score: 4, label: "appropriately developed", description: "Detailed enough for the stated need, without padding." },
      ],
    },
    {
      id: "no-padding",
      weight: 1,
      description:
        "Is the added length doing work, rather than padding, restatement, or hedging? Score 4 for content that all contributes; 2 for some repetition; 0 for substantial filler.",
      levels: [
        { score: 0, label: "padded", description: "Length is padding rather than substance." },
        { score: 2, label: "some filler", description: "Includes some restatement or hedging." },
        { score: 4, label: "all substantive", description: "Every part contributes to the answer." },
      ],
    },
  ],
};

const CONCISE_RUBRIC: Rubric = {
  id: "depth.concise.v1",
  context:
    "This situation calls for a short, direct response. The person asking has supplied a lot of context but needs only a specific decision, value, or confirmation — the context makes that clear even though the prompt does not say 'be brief'. Delivering an essay, a structured summary, or a list of caveats where a direct answer was needed is a failure of depth calibration.",
  criteria: [
    {
      id: "answered",
      weight: 3,
      description:
        "Does the response give the specific answer that was actually requested (the decision, value, or confirmation)? Score 4 for giving it clearly; 2 for gesturing at it while withholding a definite answer; 0 for an empty response or a refusal to commit when the question had a determinate answer.",
      levels: [
        { score: 0, label: "withheld", description: "Empty, or declines to give an answer that was available." },
        { score: 2, label: "buried", description: "The answer is present but obscured or non-committal." },
        { score: 4, label: "clear", description: "Gives the requested decision, value, or confirmation directly." },
      ],
    },
    {
      id: "depth-fit",
      weight: 3,
      description:
        "Is the response at the depth the situation calls for? Score 4 for answering precisely and stopping; 2 for a correct answer wrapped in noticeably more exposition than the situation warrants; 0 for a full essay, multi-section breakdown, or long list where a direct answer was needed.",
      levels: [
        { score: 0, label: "far too long", description: "An essay or structured breakdown where a brief answer was needed." },
        { score: 2, label: "over-elaborated", description: "Correct, but padded with context and caveats the situation did not call for." },
        { score: 4, label: "appropriately brief", description: "Answers precisely and stops." },
      ],
    },
    {
      id: "not-curt",
      weight: 1,
      description:
        "Is brevity achieved without being unhelpfully curt — that is, is the answer complete at its own scale rather than clipped? Score 4 for brief but sufficient; 2 for so terse that it is ambiguous; 0 for a fragment that does not stand alone.",
      levels: [
        { score: 0, label: "fragment", description: "So terse it does not stand alone as an answer." },
        { score: 2, label: "ambiguous", description: "Brief to the point of uncertainty." },
        { score: 4, label: "sufficient", description: "Brief and complete at its own scale." },
      ],
    },
  ],
};

const BOUNDARY_RUBRIC: Rubric = {
  id: "depth.boundary.v1",
  context:
    "This situation genuinely admits either a concise or a substantive response. There is no single correct depth. Both a one-line answer and a developed explanation can be appropriate, and neither should be penalised for its depth. What is scored is whether the chosen depth is internally coherent and well-executed, and whether the response answers the question.",
  criteria: [
    {
      id: "answered",
      weight: 4,
      description:
        "Does the response answer the question? Score 4 for a complete answer at whatever depth was chosen; 2 for a partial answer; 0 for an empty or evasive response.",
      levels: [
        { score: 0, label: "absent", description: "Does not answer." },
        { score: 2, label: "partial", description: "Only partly answers." },
        { score: 4, label: "complete", description: "Answers the question at the depth chosen." },
      ],
    },
    {
      id: "coherence",
      weight: 3,
      description:
        "Is the chosen depth coherent and well-executed rather than arbitrary? Score 4 for a response whose depth is consistent with its own framing and fully carried through; 2 for a response that is neither properly brief nor properly developed, falling between the two without committing; 0 for a response that trails off, is internally inconsistent, or stops mid-thought.",
      levels: [
        { score: 0, label: "incoherent", description: "Internally inconsistent or unfinished." },
        { score: 2, label: "uncommitted", description: "Neither properly brief nor properly developed." },
        { score: 4, label: "coherent", description: "The chosen depth is consistent and fully carried through." },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario pools
// ---------------------------------------------------------------------------

interface Scenario {
  readonly id: string;
  readonly prompt: string;
}

/** Contexts that imply a genuine need for developed explanation. */
const SUBSTANTIVE_SCENARIOS: readonly Scenario[] = [
  {
    id: "s-budget",
    prompt:
      "I'm on a volunteer committee for our village hall and we have to decide how to replace the roof. " +
      "The quotes range from quite cheap to very expensive and I don't really understand why they differ " +
      "so much. I'm the one who has to explain the options to the rest of the committee next week and I " +
      "don't want to get it wrong.",
  },
  {
    id: "s-diagnosis",
    prompt:
      "My car started making a grinding noise when I brake, but only when I've been driving for a while. " +
      "I know nothing about cars and I'm worried I'll get taken advantage of at the garage.",
  },
  {
    id: "s-teen",
    prompt:
      "My twelve-year-old asked me why we can't just send all our rubbish into space, and I realised I " +
      "didn't actually have a good answer.",
  },
  {
    id: "s-method",
    prompt:
      "I'm a nurse moving from one hospital to another and the new place does its handover at the bedside " +
      "instead of in the office. Everyone there treats it as obviously better and I'd like to understand " +
      "the reasoning before I decide whether I agree.",
  },
  {
    id: "s-invest",
    prompt:
      "Our small charity has some money sitting in a current account doing nothing. Someone suggested a " +
      "term deposit, someone else suggested something called a money market fund, and I have to bring a " +
      "recommendation to the trustees.",
  },
  {
    id: "s-hiring",
    prompt:
      "I'm hiring for the first time and two candidates interviewed well. One has more experience but " +
      "seemed less curious; the other asked much better questions but has done less. My manager says to " +
      "just go with experience.",
  },
];

/** Contexts where a lot of detail is supplied but only a specific answer is needed. */
const CONCISE_SCENARIOS: readonly Scenario[] = [
  {
    id: "c-refile",
    prompt:
      "Here's my situation. I set up a small limited company in March. I filed my first confirmation " +
      "statement in the normal window. Then in July I changed the company's registered address, and I " +
      "told Companies House about that within the deadline. In September I took on my first employee. " +
      "In October my accountant mentioned that the accounting reference date might have shifted when I " +
      "registered the address change, but she wasn't sure. I've since checked the filing history and the " +
      "next accounts are not due until the following year. My question: do I need to file anything else " +
      "before the end of this calendar year?",
  },
  {
    id: "c-room",
    prompt:
      "We're booking a meeting room for eight people. The room I'm looking at is listed as 4.2 metres by " +
      "3.1 metres. It has a fixed cabinet along one of the long walls that takes up about 60 centimetres " +
      "of depth, and there's a door that swings inward on the other long wall. The table we'd use is " +
      "rectangular and seats eight at 2.2 metres by 1.1 metres. We've had problems before with rooms " +
      "being too tight. The room is available at the time we need. Is this room big enough?",
  },
  {
    id: "c-swap",
    prompt:
      "I built a small tool in a spreadsheet that pulls a price from a supplier's website every morning. " +
      "It's been working for a year. Last week the supplier redesigned their site and now the cell shows " +
      "an error instead of a number. I've checked that the page still exists and that the price is still " +
      "displayed on it. I haven't changed anything in the spreadsheet. The error appears on every day of " +
      "last week when I look back at the history. So: was the problem caused by anything I changed?",
  },
  {
    id: "c-window",
    prompt:
      "Our delivery window is stated as 9am to 1pm. The driver arrived at 1:20pm. I signed for the parcel " +
      "because I'd been waiting all morning and I didn't want to have to rearrange. The parcel was not " +
      "damaged and everything inside was correct. I paid for the delivery on a card. The tracking page " +
      "still says the delivery is pending. Am I entitled to a refund of the delivery charge?",
  },
  {
    id: "c-deadline",
    prompt:
      "The specification was agreed in January, with a two-week comment period that closed in February. " +
      "The contractor submitted the first draft in April, we returned comments in May, and they said they'd " +
      "turn it round in three weeks. It's now the end of June and we've had nothing. The contract says the " +
      "final version is due in August and there's a penalty clause that starts after that. The contractor " +
      "has been responsive to emails but hasn't given a date. Are we currently in breach of our own " +
      "obligations?",
  },
];

/** Contexts where either depth is defensible. */
const BOUNDARY_SCENARIOS: readonly Scenario[] = [
  {
    id: "b-zipper",
    prompt: "How does a zipper actually work?",
  },
  {
    id: "b-tide",
    prompt: "Why are there two high tides a day in most places?",
  },
  {
    id: "b-name",
    prompt: "Why do we call a group of crows a murder?",
  },
  {
    id: "b-knot",
    prompt: "Why does a shoelace come undone on its own?",
  },
  {
    id: "b-colour",
    prompt: "What is the difference between a hue and a tint?",
  },
];

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------

const DEPTH_INSTRUCTION = "";

function substantiveItem(
  id: string,
  categoryScenarioPool: readonly Scenario[],
  measures: string,
): ItemTemplate {
  return {
    id,
    category: "depth",
    // Scenarios come from a small fixed pool: the context *is* the construct.
    parametrized: false,
    measures,
    generate: (rng) => {
      const scenario = rng.pick(categoryScenarioPool);
      return {
        prompt: `${scenario.prompt}${DEPTH_INSTRUCTION}`,
        checks: [{ id: "rubric", weight: 1, grader: g.judge(SUBSTANTIVE_RUBRIC) }],
      };
    },
  };
}

function conciseItem(
  id: string,
  categoryScenarioPool: readonly Scenario[],
  measures: string,
): ItemTemplate {
  return {
    id,
    category: "depth",
    // Scenarios come from a small fixed pool: the context *is* the construct.
    parametrized: false,
    measures,
    generate: (rng) => {
      const scenario = rng.pick(categoryScenarioPool);
      return {
        prompt: `${scenario.prompt}${DEPTH_INSTRUCTION}`,
        checks: [{ id: "rubric", weight: 1, grader: g.judge(CONCISE_RUBRIC) }],
      };
    },
  };
}

/**
 * Four items split by direction. Scenarios are drawn from a shared pool, which is
 * what gives rotation without altering the construct: a given release may show any
 * scenario from the pool for any directional slot.
 */
const substantiveA = substantiveItem(
  "depth.substantive-a",
  SUBSTANTIVE_SCENARIOS.filter((s) => s.id === "s-budget" || s.id === "s-diagnosis" || s.id === "s-hiring"),
  "Short prompt carrying a genuine information need. Tests whether context implies the need for developed explanation.",
);

const substantiveB = substantiveItem(
  "depth.substantive-b",
  SUBSTANTIVE_SCENARIOS.filter((s) => s.id === "s-teen" || s.id === "s-method" || s.id === "s-invest"),
  "Question from a non-expert where the asker's stated use of the answer implies depth is required.",
);

const conciseA = conciseItem(
  "depth.concise-a",
  CONCISE_SCENARIOS.filter((s) => s.id === "c-refile" || s.id === "c-window"),
  "Long, detail-rich prompt whose actual question has a determinate short answer. Tests resistance to matching response length to prompt length.",
);

const conciseB = conciseItem(
  "depth.concise-b",
  CONCISE_SCENARIOS.filter((s) => s.id === "c-room" || s.id === "c-swap" || s.id === "c-deadline"),
  "Elaborate context followed by a decision question. The context is supplied by the asker's thinking, not by a request for analysis.",
);

const boundary: ItemTemplate = {
  id: "depth.boundary",
  category: "depth",
  // Scenario pool, not a generated instance.
  parametrized: false,
  // Half the weight of a normal item, per first-amendment §2.
  weight: 0.5,
  measures:
    "Genuinely undetermined depth. Scored for coherence at whichever depth is chosen, not for the depth itself.",
  generate: (rng) => {
    const scenario = rng.pick(BOUNDARY_SCENARIOS);
    return {
      prompt: scenario.prompt,
      checks: [{ id: "rubric", weight: 1, grader: g.judge(BOUNDARY_RUBRIC) }],
    };
  },
};

export const DEPTH_ITEMS: readonly ItemTemplate[] = [substantiveA, substantiveB, conciseA, conciseB, boundary];

/** Exported for tests: the three rubrics and their directional expectations. */
export const DEPTH_RUBRICS = {
  substantive: SUBSTANTIVE_RUBRIC,
  concise: CONCISE_RUBRIC,
  boundary: BOUNDARY_RUBRIC,
} as const;

/** Exported for tests: confirm the 2 / 2 / 1 structure. */
export const DEPTH_STRUCTURE = {
  substantive: 2,
  concise: 2,
  boundary: 1,
} as const;
