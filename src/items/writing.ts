/**
 * Category 7: Writing quality (2 items, 10 pts).
 *
 * Judge-graded (tenet 2's documented exception). Two items, deliberately different
 * in their demands: one constrained register/compression task, one persuasive/
 * argumentative task. Resolution 7 asks for them to be meaningfully different rather
 * than near-duplicates, not for two samples of the same skill.
 *
 * Rubric design constraints:
 * - Every criterion must be something a mechanically-compliant non-answer fails. A
 *   rubric made of "clarity / correctness / style" is gameable by generic fluent
 *   prose, so clarity is folded into criteria that require specific content.
 * - Each criterion is scored on its own 0-4 scale and weighted; the scorer normalises.
 * - Rubrics are version-pinned by `id`; changing one is a MAJOR-version change (§9).
 */

import type { ItemTemplate, Rubric } from "../types.ts";
import { g } from "../graders.ts";


const REGISTERS = [
  { id: "safety-card", label: "an in-flight safety card", constraint: "second person, present tense, no sentence longer than 12 words" },
  { id: "field-note", label: "a geologist's field note", constraint: "past tense, first person singular, observational rather than interpretive" },
  { id: "museum-label", label: "a museum object label", constraint: "third person, present tense, no sentence longer than 20 words" },
  { id: "radio-bulletin", label: "a radio news bulletin", constraint: "third person, past tense, written to be read aloud" },
];

const TOPICS = [
  "the two-year closure of a mountain pass",
  "the relocation of a river gauge after a flood",
  "the retirement of a long-serving signal operator",
  "the discovery of an undocumented cellar beneath a town hall",
  "the replacement of a mechanical clock with a digital one",
  "the last scheduled sailing of a harbour ferry",
];

// ---------------------------------------------------------------------------
// Item 1: constrained register / compression
// ---------------------------------------------------------------------------

const registerRubric: Rubric = {
  id: "writing.register.v1",
  context:
    "The task is a register-constrained compression exercise. The response must adopt the specified register, obey the stated sentence-length rule, and convey a concrete situation. Generic fluent prose that ignores the register must not score well.",
  criteria: [
    {
      id: "register",
      weight: 2,
      description:
        "How fully does the response adopt the specified register (person, tense, and voice)? Score 4 for consistent and idiomatic use throughout; 2 for partial consistency with lapses; 0 for prose that reads as a different register entirely.",
      levels: [
        { score: 0, label: "absent", description: "The register is not attempted or is overridden by a generic essayistic voice." },
        { score: 2, label: "partial", description: "Register is recognisable but breaks at least once in a way that would be conspicuous in context." },
        { score: 4, label: "sustained", description: "Register is consistent and idiomatic throughout; it would be at home in the real artefact." },
      ],
    },
    {
      id: "constraint",
      weight: 2,
      description:
        "How well is the stated sentence-length constraint observed? Score 4 if every sentence complies; 2 if one or two sentences exceed it; 0 if the constraint is ignored or only accidentally met.",
      levels: [
        { score: 0, label: "ignored", description: "The length constraint is not observed." },
        { score: 2, label: "mostly", description: "One or two sentences breach the constraint." },
        { score: 4, label: "observed", description: "Every sentence complies." },
      ],
    },
    {
      id: "specificity",
      weight: 3,
      description:
        "Does the response convey a concrete, particular situation with at least one differentiating detail, rather than generic filler that would suit any topic? Score 4 for specific and grounded; 1 for vague but topical; 0 for content that would fit any prompt.",
      levels: [
        { score: 0, label: "generic", description: "Content is interchangeable; it could describe any topic." },
        { score: 1, label: "vague", description: "On topic but with no particularising detail." },
        { score: 4, label: "specific", description: "Concrete and particularising; the reader learns something only true of this case." },
      ],
    },
    {
      id: "compression",
      weight: 2,
      description:
        "Is the response economically written, with no wasted words and no padding? Score 4 for dense, deliberate wording; 2 for acceptable but loose; 0 for padding, repetition, or boilerplate.",
      levels: [
        { score: 0, label: "padded", description: "Noticeable padding, repetition, or filler." },
        { score: 2, label: "loose", description: "Generally readable but several words carry no information." },
        { score: 4, label: "dense", description: "Every clause carries information; nothing could be cut without loss." },
      ],
    },
    {
      id: "accuracy",
      weight: 1,
      description:
        "Is the prose free of grammatical error and awkward construction? Score 4 for clean; 2 for minor slips that do not impede reading; 0 for errors that obscure meaning.",
      levels: [
        { score: 0, label: "impedes", description: "Errors interfere with comprehension." },
        { score: 2, label: "minor", description: "Minor slips; meaning remains clear." },
        { score: 4, label: "clean", description: "Grammatically clean and well-formed throughout." },
      ],
    },
  ],
};

const registerTask: ItemTemplate = {
  id: "writing.register",
  category: "writing",
  split: "both",
  // Authored prompt family rather than a generated instance: the register
  // constraint is the construct (resolution 4, and resolution 7).
  parametrized: false,
  measures:
    "Register control and compression under a hard formal constraint. Rubric-graded; judge-graded items use the 2x2 replication protocol.",
  generate: (rng) => {
    const register = rng.pick(REGISTERS);
    const topic = rng.pick(TOPICS);
    const wordBudget = rng.range(45, 70);

    return {
      prompt:
        `Write ${register.label} describing ${topic}.\n\n` +
        `Constraints:\n` +
        `- Write in ${register.constraint}.\n` +
        `- Total length must be between ${wordBudget - 10} and ${wordBudget} words.\n` +
        `- Include at least one concrete detail specific to this situation.\n` +
        `- Output only the text itself. No heading, no title, no commentary.`,
      checks: [
        {
          id: "rubric",
          weight: 1,
          grader: g.judge(registerRubric),
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Item 2: persuasive / argumentative
// ---------------------------------------------------------------------------

const argumentRubric: Rubric = {
  id: "writing.argument.v1",
  context:
    "The task asks for a short piece of persuasive writing that takes a definite position on a stated trade-off and concedes one genuine counter-consideration. Balanced, non-committal prose that surveys both sides without choosing must not score well; neither should a one-sided piece that ignores the strongest objection.",
  criteria: [
    {
      id: "position",
      weight: 3,
      description:
        "Does the response take a definite, identifiable position on the stated trade-off and sustain it? Score 4 for a clear committed position maintained throughout; 2 for a position that is present but hedged or diluted; 0 for a survey of considerations that declines to choose.",
      levels: [
        { score: 0, label: "no position", description: "Surveys both sides without committing; the reader cannot tell what the writer thinks." },
        { score: 2, label: "hedged", description: "A position exists but is weakened by equivocation or contradicts itself later." },
        { score: 4, label: "committed", description: "A clear position is stated early and consistently maintained." },
      ],
    },
    {
      id: "reasoning",
      weight: 3,
      description:
        "Is the position supported by reasoning that would stand on its own, rather than by assertion or appeals to unspecified authority? Score 4 for at least one genuinely developed argument with a warrant; 2 for reasons stated but not developed; 0 for assertion without support.",
      levels: [
        { score: 0, label: "assertion", description: "The position is asserted but not supported." },
        { score: 2, label: "stated", description: "Reasons are named but not developed or connected to the position." },
        { score: 4, label: "developed", description: "At least one line of reasoning is developed with a warrant a sceptical reader could evaluate." },
      ],
    },
    {
      id: "concession",
      weight: 2,
      description:
        "Does the response acknowledge one genuine counter-consideration, and is it a real objection rather than a token concession? Score 4 for a substantive objection that is engaged with; 2 for a token acknowledgement; 0 for no acknowledgement or a strawman.",
      levels: [
        { score: 0, label: "absent", description: "No counter-consideration is acknowledged." },
        { score: 2, label: "token", description: "A concession is mentioned only to be dismissed without engagement." },
        { score: 4, label: "engaged", description: "A genuine objection is stated fairly and the position is defended against it." },
      ],
    },
    {
      id: "economy",
      weight: 2,
      description:
        "Is the piece economical and free of filler, throat-clearing, and rhetorical padding? Score 4 for tight argumentation; 2 for readable but loose; 0 for padding and repetition.",
      levels: [
        { score: 0, label: "padded", description: "Substantial filler; the argument is hard to locate." },
        { score: 2, label: "loose", description: "Readable, but several sentences do no work." },
        { score: 4, label: "economical", description: "No filler; each sentence advances the argument." },
      ],
    },
    {
      id: "no-fabrication",
      weight: 2,
      description:
        "Does the response avoid inventing specific statistics, studies, dates, or quotations? Score 4 for no fabricated specifics; 2 for one vague unsourced figure; 0 for concrete fabricated evidence presented as fact. Hedged illustrative examples clearly marked as hypothetical are acceptable.",
      levels: [
        { score: 0, label: "fabricated", description: "Presents invented specifics (figures, studies, quotes) as established fact." },
        { score: 2, label: "unsourced", description: "Includes a vague quantity or attribution that is presented as fact." },
        { score: 4, label: "clean", description: "No fabricated specifics; any illustration is clearly hypothetical or general." },
      ],
    },
  ],
};

const argumentTask: ItemTemplate = {
  id: "writing.argument",
  category: "writing",
  split: "both",
  // Authored prompt family rather than a generated instance.
  parametrized: false,
  measures:
    "Committed argumentation under a length constraint, including intellectual honesty about the opposing case. Explicitly penalises fabricated evidence.",
  generate: (rng) => {
    // `proposal` is a full noun phrase naming the decision under debate. The stance
    // is kept separate so the instruction reads "argue for the following proposal:
    // …". Concatenating a stance phrase that already contains its own object onto a
    // noun phrase produces ungrammatical text ("arguing against the ban a
    // university's decision to…") and would make the prompt look machine-generated.
    const proposals = [
      "a small town should close its only public library and fund a mobile service instead",
      "a university should ban all generative-AI assistance in assessed coursework",
      "a city should remove a lane of traffic from a major bridge to build a cycleway",
      "a national government should require all new buildings to install solar panels",
      "a national government should hold a binding referendum before joining any new international treaty",
      "a large employer should move to a four-day working week at the same salary",
    ];
    const proposal = rng.pick(proposals);
    const stance = rng.chance(0.5) ? "for" : "against";
    const wordBudget = rng.range(120, 160);

    return {
      prompt:
        `Write a short persuasive piece arguing ${stance} the following proposal:\n\n` +
        `> ${proposal}.\n\n` +
        `Requirements:\n` +
        `- Take a definite position and sustain it; do not write a balanced survey that declines to choose.\n` +
        `- Give at least one developed reason for your position.\n` +
        `- Acknowledge one genuine counter-consideration and respond to it.\n` +
        `- Do not invent statistics, studies, dates, or quotations. Argue from reasoning and general ` +
        `principle. If you want to illustrate with a hypothetical, mark it clearly as hypothetical.\n` +
        `- Length: approximately ${wordBudget} words. Output only the piece.`,
      checks: [
        {
          id: "rubric",
          weight: 1,
          grader: g.judge(argumentRubric),
        },
      ],
    };
  },
};

export const WRITING_ITEMS: readonly ItemTemplate[] = [registerTask, argumentTask];

/** Exported for tests: verify that every rubric criterion is reachable and weighted. */
export const WRITING_RUBRICS: readonly Rubric[] = [registerRubric, argumentRubric];
