/**
 * Category 6: Instruction-following (5 items, 10 pts).
 *
 * Every grader in this category is programmatic: the constraint is the task, so it
 * must be verified structurally rather than by string comparison. Checks are
 * deliberately weighted internally (via `weight`) so that an item can express
 * "the content is worth half, the format is worth half" without splitting the item.
 *
 * These are the most gameable items in the suite if written carelessly, so each one
 * verifies something a model cannot produce by echoing the instruction back.
 */

import type { Check, ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import type { Rng } from "../rng.ts";


const WORDS = [
  "harbour", "lantern", "quarry", "meridian", "thicket", "cinder", "vellum",
  "gantry", "tundra", "saffron", "anvil", "cobalt", "estuary", "fathom",
  "gossamer", "husk", "kelp", "loom", "mosaic", "nectar", "obsidian",
];

/** Approximate syllable count. Used where the constraint is prosodic. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  if (w.endsWith("e") && !w.endsWith("le") && n > 1) n -= 1;
  return Math.max(1, n);
}

// ---------------------------------------------------------------------------
// 1. Formatted extraction with exact line discipline
// ---------------------------------------------------------------------------

const formattedExtraction: ItemTemplate = {
  id: "instruction.formatted-extraction",
  category: "instruction",
  measures:
    "Simultaneous constraints on line count, line content, ordering, separator, and absence of extra prose. A format that is nearly right scores proportionally.",
  generate: (rng) => {
    const count = rng.range(6, 9);
    const items = rng.sample(WORDS, count).map((w, i) => ({ name: w, value: rng.range(10, 999), rank: i }));
    const sortedDesc = [...items].sort((a, b) => b.value - a.value);

    const sourceList = items.map((it) => `${it.name}: ${it.value}`).join("\n");

    const checks: Check[] = [
      {
        id: "line-count",
        weight: 0.2,
        expected: `exactly ${count} lines`,
        grader: g.programmatic(`exactly ${count} non-empty lines`, (r) => {
          const lines = r.split(/\r?\n/).filter((l) => l.trim().length > 0);
          return lines.length === count ? 1 : 0;
        }),
      },
      {
        id: "no-extra-prose",
        weight: 0.2,
        expected: "no preamble, heading, code fence, or explanation",
        grader: g.programmatic("no preamble, fence, or trailing prose", (r) => {
          const text = r.trim();
          if (/```/.test(text)) return 0;
          if (/^\s*(here|the following|sure|below|output)\b/i.test(text)) return 0;
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          // Every line must look like `name = value`; anything else is prose.
          const allMatch = lines.every((l) => /^\s*[a-z]+\s*=\s*\d+\s*$/i.test(l));
          return allMatch ? 1 : 0;
        }),
      },
      {
        id: "ordering",
        weight: 0.3,
        expected: `descending by value: ${sortedDesc.map((i) => i.name).join(", ")}`,
        grader: g.programmatic("lines are in descending value order", (r) => {
          const parsed = parsePairs(r);
          if (parsed.length !== count) return 0;
          for (let i = 1; i < parsed.length; i++) {
            if (parsed[i]!.value > parsed[i - 1]!.value) return 0;
          }
          return 1;
        }),
      },
      {
        id: "values-correct",
        weight: 0.3,
        expected: items.map((i) => `${i.name}=${i.value}`).join(", "),
        grader: g.programmatic("each name is paired with its own value", (r) => {
          const parsed = parsePairs(r);
          if (parsed.length !== count) return 0;
          const byName = new Map(parsed.map((p) => [p.name, p.value]));
          if (byName.size !== count) return 0;
          let correct = 0;
          for (const it of items) if (byName.get(it.name) === it.value) correct++;
          return correct / count;
        }),
      },
    ];

    return {
      prompt:
        `Convert the list below into a strict format. Do not add any text before or after the output.\n\n` +
        `Rules:\n` +
        `1. Output exactly ${count} lines, one per item.\n` +
        `2. Each line must use the form \`name = value\` with single spaces around the equals sign.\n` +
        `3. Use the name exactly as it appears in the input, but lowercase it.\n` +
        `4. Order the lines by value from highest to lowest.\n` +
        `5. Do not include a heading, code fence, numbering, or any explanation.\n\n` +
        `Input:\n${sourceList}`,
      checks,
      reference: sortedDesc.map((i) => `${i.name} = ${i.value}`).join("\n"),
    };
  },
};

function parsePairs(r: string): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  for (const line of r.split(/\r?\n/)) {
    const m = /^\s*([a-z]+)\s*=\s*(\d+)\s*$/i.exec(line);
    if (m) out.push({ name: m[1]!.toLowerCase(), value: Number(m[2]) });
  }
  return out;
}

/**
 * Construct one concrete sentence satisfying all four content constraints.
 *
 * The item admits many valid answers, so this is not "the" answer. It is a
 * known-good witness. It exists so the held-out scoring key has something to
 * verify against and so the harness self-test can confirm a perfect run is
 * reachable. Deterministic in its inputs.
 */
function buildValidSentence(rng: Rng, subject: string, exactWords: number, forbidden: string): string | null {
  // A sentence of the form: <subject> <verb> <numeral> <noun-phrase words...> .
  // Word count includes every whitespace-separated token.
  const banned = new Set([forbidden.toLowerCase()]);
  const fillers = [
    "recorded", "measured", "counted", "listed", "charted", "logged", "tracked",
    "quietly", "carefully", "plainly", "briefly", "openly", "neatly",
    "crates", "barrels", "lanterns", "tickets", "parcels", "samples", "ledgers",
    "harbour", "quarry", "thicket", "gantry", "tundra", "anvil", "estuary",
    "during", "across", "beside", "within", "beyond", "against", "beneath",
  ].filter((w) => !banned.has(w));

  const numeral = String(rng.range(3, 90));

  // The final period attaches to the last token rather than forming its own word,
  // so the token count is three leading tokens plus the fillers.
  const remaining = exactWords - 3;
  if (remaining < 0) return null;

  const shuffled = rng.shuffle(fillers);
  const parts: string[] = [subject, "recorded", numeral];
  for (let i = 0; i < remaining; i++) {
    parts.push(shuffled[i % shuffled.length]!);
  }

  const sentence = `${parts.join(" ")}.`;
  const wordCount = sentence.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  if (wordCount !== exactWords) return null;
  if (new RegExp(`\\b${forbidden}\\b`, "i").test(sentence)) return null;
  if (!/\d/.test(sentence)) return null;
  return sentence;
}

// ---------------------------------------------------------------------------
// 2. Phrase construction with simultaneous constraints
// ---------------------------------------------------------------------------

const constrainedSentence: ItemTemplate = {
  id: "instruction.constrained-sentence",
  category: "instruction",
  measures:
    "Multiple hard constraints on a single sentence. The constraints act as a joint filter: satisfying three and dropping one is the common failure. Fractional credit is awarded per constraint.",
  generate: (rng) => {
    const subject = rng.pick(WORDS);
    const exactWords = rng.range(12, 15);
    const forbidden = rng.pick(["the", "and", "but", "very", "that", "which"]);
    const witness = buildValidSentence(rng, subject, exactWords, forbidden);

    const checks: Check[] = [
      {
        id: "single-sentence",
        weight: 0.15,
        expected: "exactly one sentence",
        grader: g.programmatic("exactly one sentence", (r) => {
          const t = r.trim();
          if (t.length === 0) return 0;
          const terminators = t.match(/[.!?](\s|$)/g);
          if (!terminators) return 0;
          // Tolerate a trailing terminator only; anything more means multiple sentences.
          const internal = t.slice(0, -1).match(/[.!?](\s|$)/g);
          return internal && internal.length > 0 ? 0 : 1;
        }),
      },
      {
        id: "word-count",
        weight: 0.25,
        expected: `exactly ${exactWords} words`,
        grader: g.programmatic(`exactly ${exactWords} words`, (r) => {
          const words = r.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
          return words.length === exactWords ? 1 : 0;
        }),
      },
      {
        id: "forbidden-word",
        weight: 0.2,
        expected: `does not contain "${forbidden}"`,
        grader: g.programmatic(`does not contain the word "${forbidden}"`, (r) =>
          new RegExp(`\\b${forbidden}\\b`, "i").test(r) ? 0 : 1,
        ),
      },
      {
        id: "starts-with-subject",
        weight: 0.2,
        expected: `begins with "${subject}"`,
        grader: g.programmatic(`begins with "${subject}"`, (r) =>
          r.trim().toLowerCase().startsWith(subject) ? 1 : 0,
        ),
      },
      {
        id: "contains-digit",
        weight: 0.2,
        expected: "contains at least one numeral",
        grader: g.programmatic("contains a numeral", (r) => (/\d/.test(r) ? 1 : 0)),
      },
    ];

    return {
      prompt:
        `Write exactly one sentence that satisfies every one of the following constraints simultaneously:\n\n` +
        `1. The sentence begins with the word "${subject}".\n` +
        `2. The sentence contains exactly ${exactWords} words.\n` +
        `3. The sentence does not contain the word "${forbidden}" anywhere.\n` +
        `4. The sentence contains at least one numeral.\n` +
        `5. The sentence ends with a period.\n\n` +
        `Output only the sentence, with no preamble or explanation.`,
      checks,
      // Many sentences satisfy the constraints; this is one known-good witness, used
      // for the scoring key and the harness self-test rather than as "the" answer.
      ...(witness !== null ? { reference: witness } : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Ordered list with exact label discipline
// ---------------------------------------------------------------------------

const labelledList: ItemTemplate = {
  id: "instruction.labelled-list",
  category: "instruction",
  measures:
    "Per-element constraints inside a structured output: exact labels, exact ordering, per-item limits, and a stated absence. Partial credit reflects partial compliance.",
  generate: (rng) => {
    const topics = rng.sample(WORDS, 3);
    const maxWords = rng.range(6, 9);

    const checks: Check[] = [
      {
        id: "exactly-three-sections",
        weight: 0.2,
        expected: "exactly three sections, headed ALPHA, BRAVO, CHARLIE in order",
        grader: g.programmatic("three headings in the required order", (r) => {
          const heads = [...r.matchAll(/^\s*(ALPHA|BRAVO|CHARLIE)\s*:/gim)].map((m) => m[1]!.toUpperCase());
          return JSON.stringify(heads) === JSON.stringify(["ALPHA", "BRAVO", "CHARLIE"]) ? 1 : 0;
        }),
      },
      {
        id: "per-section-word-limit",
        weight: 0.3,
        expected: `each section body at most ${maxWords} words`,
        grader: g.programmatic(`each section body is at most ${maxWords} words`, (r) => {
          const bodies = sectionBodies(r);
          if (bodies.length !== 3) return 0;
          const ok = bodies.filter((b) => b.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length <= maxWords).length;
          return ok / 3;
        }),
      },
      {
        id: "content-mentions-topic",
        weight: 0.3,
        expected: topics.map((t, i) => `${["ALPHA", "BRAVO", "CHARLIE"][i]}: ${t}`).join(", "),
        grader: g.programmatic("each section names its assigned topic", (r) => {
          const bodies = sectionBodies(r);
          if (bodies.length !== 3) return 0;
          let ok = 0;
          for (let i = 0; i < 3; i++) {
            if (new RegExp(`\\b${topics[i]}\\b`, "i").test(bodies[i]!)) ok++;
          }
          return ok / 3;
        }),
      },
      {
        id: "no-bullets",
        weight: 0.2,
        expected: "no bullet points or numbering",
        grader: g.programmatic("no bullets or numbering", (r) =>
          /^\s*(?:[-*•]|\d+[.)])\s/m.test(r) ? 0 : 1,
        ),
      },
    ];

    return {
      prompt:
        `Produce a three-section response.\n\n` +
        `- Section 1 must be headed exactly \`ALPHA:\` and must discuss ${topics[0]}.\n` +
        `- Section 2 must be headed exactly \`BRAVO:\` and must discuss ${topics[1]}.\n` +
        `- Section 3 must be headed exactly \`CHARLIE:\` and must discuss ${topics[2]}.\n` +
        `- Each section body must be at most ${maxWords} words.\n` +
        `- Use no bullet points and no numbered lists anywhere.\n` +
        `- Output the three sections and nothing else.`,
      checks,
      reference: [
        `ALPHA: ${topics[0]}`,
        `BRAVO: ${topics[1]}`,
        `CHARLIE: ${topics[2]}`,
      ].join("\n"),
    };
  },
};

function sectionBodies(r: string): string[] {
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of r.split(/\r?\n/)) {
    const m = /^\s*(ALPHA|BRAVO|CHARLIE)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      current = m[1]!.toUpperCase();
      out[current] = m[2] ?? "";
    } else if (current) {
      out[current] += ` ${line}`;
    }
  }
  return ["ALPHA", "BRAVO", "CHARLIE"].filter((k) => k in out).map((k) => out[k]!.trim());
}

// ---------------------------------------------------------------------------
// 4. Transform with offset arithmetic
// ---------------------------------------------------------------------------

const offsetCipher: ItemTemplate = {
  id: "instruction.offset-transform",
  category: "instruction",
  measures:
    "A precisely specified transformation where the natural assumption (forward shift) is wrong. Tests whether the instruction is read literally or pattern-matched to 'Caesar cipher'.",
  generate: (rng) => {
    const word = rng.pick(WORDS);
    const offset = rng.range(3, 9);

    const encoded = [...word]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return String.fromCharCode(((code - 97 - offset + 26) % 26) + 97);
      })
      .join("");

    return {
      prompt:
        `Apply this transformation to the input word and report the result.\n\n` +
        `Transformation: for each letter, replace it with the letter ${offset} positions EARLIER in the ` +
        `alphabet. If you pass the beginning of the alphabet, wrap around to the end. For example, with ` +
        `an offset of 1 the letter "a" becomes "z".\n\n` +
        `Input: ${encoded}\n\n` +
        `Output only the transformed word, in lowercase, with no explanation.`,
      checks: [
        {
          id: "word",
          weight: 1,
          expected: `${word} (decode ${encoded} by shifting forward ${offset})`,
          grader: g.programmatic(`equals "${word}"`, (r) => {
            const cleaned = r.trim().toLowerCase().replace(/[^a-z]/g, "");
            return cleaned === word ? 1 : 0;
          }),
        },
      ],
      reference: word,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Negative constraints and deliberate omission
// ---------------------------------------------------------------------------

const negativeConstraints: ItemTemplate = {
  id: "instruction.negative-constraints",
  category: "instruction",
  measures:
    "Prohibitions rather than requirements. Models are strongly biased toward supplying helpful extra content, so the tested behaviour is omission under a rule that forbids it.",
  generate: (rng) => {
    const [readA, readB, writeC] = rng.sample(WORDS, 3).map((w) => w.toUpperCase());
    const banned = ["probably", "perhaps", "might", "could", "seems", "arguably"];

    const checks: Check[] = [
      {
        id: "sections-present",
        weight: 0.2,
        expected: `${readA}, ${readB}, and ${writeC} sections present in order`,
        grader: g.programmatic("the three required headings appear in order", (r) => {
          const heads = [...r.matchAll(/^\s*([A-Z]{3,})\s*:/gm)].map((m) => m[1]!);
          return JSON.stringify(heads) === JSON.stringify([readA, readB, writeC]) ? 1 : 0;
        }),
      },
      {
        id: "omission-respected",
        weight: 0.35,
        expected: `the word DATA appears nowhere in the response`,
        grader: g.programmatic("does not use the forbidden word DATA", (r) => (/\bdata\b/i.test(r) ? 0 : 1)),
      },
      {
        id: "no-hedging",
        weight: 0.25,
        expected: `none of: ${banned.join(", ")}`,
        grader: g.programmatic("contains no hedging words", (r) => {
          const hits = banned.filter((b) => new RegExp(`\\b${b}\\b`, "i").test(r));
          return hits.length === 0 ? 1 : Math.max(0, 1 - hits.length / 3);
        }),
      },
      {
        id: "word-budget",
        weight: 0.2,
        expected: "at most 60 words in total",
        grader: g.programmatic("total length at most 60 words", (r) => {
          const n = r.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
          if (n === 0) return 0;
          return n <= 60 ? 1 : Math.max(0, 1 - (n - 60) / 60);
        }),
      },
    ];

    return {
      prompt:
        `Write a short note with exactly three sections, headed ${readA}:, ${readB}:, and ${writeC}:, in ` +
        `that order.\n\n` +
        `Hard prohibitions, which override any other consideration:\n` +
        `- The word "data" must not appear anywhere in your response, in any form or capitalisation.\n` +
        `- Do not use any of these words: ${banned.join(", ")}.\n` +
        `- Do not write anything outside the three sections. No introduction, no conclusion, no summary.\n\n` +
        `Total length must be 60 words or fewer.`,
      checks,
      reference: [
        `${readA}: A short opening statement of the position.`,
        `${readB}: The supporting reason, stated plainly in a few words.`,
        `${writeC}: A closing line that follows directly from the reason given.`,
      ].join("\n"),
    };
  },
};

export const INSTRUCTION_ITEMS: readonly ItemTemplate[] = [
  formattedExtraction,
  constrainedSentence,
  labelledList,
  offsetCipher,
  negativeConstraints,
];

/** Exported for tests. */
export function _countSyllables(w: string): number {
  return countSyllables(w);
}
