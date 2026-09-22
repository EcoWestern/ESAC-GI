/**
 * Category 3: Factual knowledge (10 items, 10 pts).
 *
 * Two properties matter here that do not apply to the other categories:
 *
 * 1. **No contested facts.** Every entry below is unambiguous. Facts with genuinely
 *    disputed answers (constitutional vs. administrative capitals, languages whose
 *    family assignment is actively debated) are excluded. A benchmark that grades a
 *    defensible answer as wrong is measuring its own editorial choices.
 *
 * 2. **Parametrized across a vetted pool, not reformatted boilerplate.** Each item
 *    draws from a pool of individually-verified entries, so the surface question
 *    stays fixed while the instance rotates. A model cannot memorise "the answer to
 *    item 7" because item 7 is a different fact every run.
 */

import type { Check, ItemTemplate } from "../types.ts";
import { g } from "../graders.ts";
import { buildOptions, optionCheck } from "./helpers.ts";
import { CHEMICAL_FORMULAS, HISTORICAL_YEARS } from "./factual-pools.ts";

/** Free-response check that accepts any of several surface forms of one answer. */
function freeText(id: string, expected: string, accept: readonly string[]): Check {
  return { id, weight: 1, expected, grader: g.contains({ all: accept }) };
}

// ---------------------------------------------------------------------------
// 1. Element symbols
// ---------------------------------------------------------------------------

const SYMBOLS: ReadonlyArray<readonly [symbol: string, name: string]> = [
  ["H", "hydrogen"], ["He", "helium"], ["Li", "lithium"], ["Be", "beryllium"],
  ["B", "boron"], ["C", "carbon"], ["N", "nitrogen"], ["O", "oxygen"],
  ["F", "fluorine"], ["Ne", "neon"], ["Na", "sodium"], ["Mg", "magnesium"],
  ["Al", "aluminium"], ["Si", "silicon"], ["P", "phosphorus"], ["S", "sulfur"],
  ["Cl", "chlorine"], ["Ar", "argon"], ["K", "potassium"], ["Ca", "calcium"],
  ["Ti", "titanium"], ["Cr", "chromium"], ["Mn", "manganese"], ["Fe", "iron"],
  ["Co", "cobalt"], ["Ni", "nickel"], ["Cu", "copper"], ["Zn", "zinc"],
  ["Br", "bromine"], ["Ag", "silver"], ["Sn", "tin"], ["I", "iodine"],
  ["Xe", "xenon"], ["Ba", "barium"], ["W", "tungsten"], ["Pt", "platinum"],
  ["Au", "gold"], ["Hg", "mercury"], ["Pb", "lead"], ["Rn", "radon"],
  ["U", "uranium"], ["Rb", "rubidium"], ["Sr", "strontium"], ["Cs", "caesium"],
];

const elementSymbol: ItemTemplate = {
  id: "factual.element-symbol",
  category: "factual",
  measures: "Recall of the chemical symbol table, including the symbols that do not follow the English name.",
  generate: (rng) => {
    const [symbol, name] = rng.pick(SYMBOLS);
    // Accept the American spelling of aluminium as well as the IUPAC one.
    const accept = name === "aluminium" ? ["aluminium", "aluminum"] : [name];
    return {
      prompt: `Which chemical element has the symbol ${symbol}? Answer with only the element's name.`,
      checks: [freeText("answer", name, accept)],
      reference: name,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Capitals
// ---------------------------------------------------------------------------

const CAPITALS: ReadonlyArray<readonly [country: string, capital: string]> = [
  ["Australia", "Canberra"], ["Canada", "Ottawa"], ["Switzerland", "Bern"],
  ["Turkey", "Ankara"], ["Brazil", "Brasília"], ["Nigeria", "Abuja"],
  ["Tanzania", "Dodoma"], ["Morocco", "Rabat"], ["Vietnam", "Hanoi"],
  ["Peru", "Lima"], ["Kenya", "Nairobi"], ["Saudi Arabia", "Riyadh"],
  ["Iran", "Tehran"], ["Japan", "Tokyo"], ["China", "Beijing"],
  ["Thailand", "Bangkok"], ["New Zealand", "Wellington"], ["Norway", "Oslo"],
  ["Egypt", "Cairo"], ["Portugal", "Lisbon"], ["Indonesia", "Jakarta"],
  ["Argentina", "Buenos Aires"], ["Chile", "Santiago"], ["Mongolia", "Ulaanbaatar"],
];

const capital: ItemTemplate = {
  id: "factual.capital",
  category: "factual",
  measures:
    "Capital-city recall where the largest city is not the capital. The item pool deliberately favours countries where the two differ.",
  generate: (rng) => {
    const [country, cap] = rng.pick(CAPITALS);
    const distractors = [
      "Sydney", "Toronto", "Zurich", "Istanbul", "Rio de Janeiro", "Lagos",
      "Dar es Salaam", "Casablanca", "Ho Chi Minh City", "Auckland", "Bergen",
      "Alexandria", "Porto", "Surabaya", "Córdoba", "Valparaíso", "Almaty",
    ].filter((d) => d.toLowerCase() !== cap.toLowerCase());
    const opts = buildOptions(rng, cap, rng.sample(distractors, 3));
    return {
      prompt: `What is the capital city of ${country}?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Solar system order and properties
// ---------------------------------------------------------------------------

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"] as const;

const planets: ItemTemplate = {
  id: "factual.planets",
  category: "factual",
  measures: "Solar-system ordering combined with a well-established planetary property.",
  generate: (rng) => {
    const kind = rng.int(3);

    if (kind === 0) {
      const idx = rng.range(0, 7);
      const answer = PLANETS[idx]!;
      const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
      return {
        prompt:
          `Counting outward from the Sun, which planet is the ${ordinals[idx]} planet in the Solar System?\n\n` +
          `Answer with only the planet's name.`,
        checks: [freeText("answer", answer, [answer.toLowerCase()])],
        reference: answer,
      };
    }

    if (kind === 1) {
      const idx = rng.range(1, 6);
      const answer = PLANETS[8 - idx]!;
      return {
        prompt:
          `Counting inward from the outermost planet, which planet is the ${["1st", "2nd", "3rd", "4th", "5th", "6th"][idx - 1]} planet?\n\n` +
          `Answer with only the planet's name.`,
        checks: [freeText("answer", answer, [answer.toLowerCase()])],
        reference: answer,
      };
    }

    // Property question. Only properties with a single unambiguous holder are used.
    const props: ReadonlyArray<readonly [string, string]> = [
      ["largest by diameter", "Jupiter"],
      ["smallest by diameter", "Mercury"],
      ["closest to the Sun", "Mercury"],
      ["farthest from the Sun", "Neptune"],
      ["hottest at its surface", "Venus"],
      ["the most prominent ring system", "Saturn"],
    ];
    const [property, answer] = rng.pick(props);
    const opts = buildOptions(rng, answer, rng.sample(PLANETS.filter((p) => p !== answer), 3));
    return {
      prompt:
        `In the Solar System, which planet is ${property}?\n\n${opts.block}\n\n` +
        `Answer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. Vertebrate class
// ---------------------------------------------------------------------------

const VERTEBRATES: ReadonlyArray<readonly [animal: string, klass: string]> = [
  ["dolphin", "Mammalia"], ["bat", "Mammalia"], ["whale", "Mammalia"],
  ["kangaroo", "Mammalia"], ["pangolin", "Mammalia"], ["manatee", "Mammalia"],
  ["penguin", "Aves"], ["ostrich", "Aves"], ["albatross", "Aves"],
  ["flamingo", "Aves"], ["crocodile", "Reptilia"], ["tortoise", "Reptilia"],
  ["gecko", "Reptilia"], ["python", "Reptilia"], ["frog", "Amphibia"],
  ["salamander", "Amphibia"], ["caecilian", "Amphibia"], ["newt", "Amphibia"],
];

const vertebrateClass: ItemTemplate = {
  id: "factual.vertebrate-class",
  category: "factual",
  measures: "Biological classification at the class level, using animals whose class assignment is uncontroversial.",
  generate: (rng) => {
    const [animal, klass] = rng.pick(VERTEBRATES);
    const optionPool = ["Mammalia", "Aves", "Reptilia", "Amphibia", "Chondrichthyes", "Actinopterygii"];
    const opts = buildOptions(rng, klass, rng.sample(optionPool.filter((k) => k !== klass), 3));
    return {
      prompt: `To which vertebrate class does the ${animal} belong?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Noble gases
// ---------------------------------------------------------------------------

const NOBLE_GASES = ["helium", "neon", "argon", "krypton", "xenon", "radon"] as const;

/**
 * Non-noble gases used as distractors. A pool of eight was too small: three of the
 * four options are distractors, so a small pool collapses toward duplicates.
 */
const NON_NOBLE = [
  "nitrogen", "hydrogen", "chlorine", "oxygen", "fluorine", "bromine",
  "iodine", "sulfur", "carbon", "phosphorus", "selenium", "silicon",
  "boron", "arsenic",
] as const;

const nobleGas: ItemTemplate = {
  id: "factual.noble-gas",
  category: "factual",
  measures: "Group membership in the periodic table, where surface similarity to other non-metals is the trap.",
  generate: (rng) => {
    const correct = rng.pick(NOBLE_GASES);
    const opts = buildOptions(rng, correct, rng.sample(NON_NOBLE, 3));
    return {
      prompt: `Which of the following is a noble gas?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 6. SI units
// ---------------------------------------------------------------------------

const SI_UNITS: ReadonlyArray<readonly [quantity: string, unit: string]> = [
  ["force", "newton"], ["energy", "joule"], ["power", "watt"],
  ["pressure", "pascal"], ["frequency", "hertz"], ["electric charge", "coulomb"],
  ["electrical resistance", "ohm"], ["capacitance", "farad"],
  ["magnetic flux", "weber"], ["inductance", "henry"],
  ["thermodynamic temperature", "kelvin"], ["amount of substance", "mole"],
  ["luminous intensity", "candela"], ["radioactive activity", "becquerel"],
  ["absorbed radiation dose", "gray"], ["equivalent radiation dose", "sievert"],
];

const siUnit: ItemTemplate = {
  id: "factual.si-unit",
  category: "factual",
  measures: "Mapping of physical quantity to named SI unit, including the derived units with personal names.",
  generate: (rng) => {
    const [quantity, unit] = rng.pick(SI_UNITS);
    const pool = ["newton", "joule", "watt", "pascal", "hertz", "coulomb", "ohm", "farad", "weber", "henry", "tesla", "volt", "ampere"];
    const opts = buildOptions(rng, unit, rng.sample(pool.filter((u) => u !== unit), 3));
    return {
      prompt: `What is the SI unit of ${quantity}?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 7. Language families
// ---------------------------------------------------------------------------

/**
 * Restricted to family assignments that are settled. Languages whose classification
 * is genuinely debated (Korean, Japanese, Basque, Ainu) are deliberately excluded.
 */
const LANGUAGES: ReadonlyArray<readonly [language: string, family: string]> = [
  ["Finnish", "Uralic"], ["Hungarian", "Uralic"], ["Estonian", "Uralic"],
  ["Turkish", "Turkic"], ["Azerbaijani", "Turkic"], ["Kazakh", "Turkic"],
  ["Arabic", "Afro-Asiatic"], ["Hebrew", "Afro-Asiatic"], ["Amharic", "Afro-Asiatic"],
  ["Swahili", "Niger-Congo"], ["Zulu", "Niger-Congo"], ["Yoruba", "Niger-Congo"],
  ["Vietnamese", "Austroasiatic"], ["Khmer", "Austroasiatic"],
  ["Thai", "Kra-Dai"], ["Tagalog", "Austronesian"], ["Maori", "Austronesian"],
  ["Malagasy", "Austronesian"], ["Welsh", "Indo-European"], ["Hindi", "Indo-European"],
  ["Russian", "Indo-European"], ["Persian", "Indo-European"], ["Greek", "Indo-European"],
  ["Mandarin Chinese", "Sino-Tibetan"], ["Burmese", "Sino-Tibetan"],
  ["Quechua", "Quechuan"], ["Navajo", "Na-Dene"], ["Inuktitut", "Inuit-Yupik-Unangan"],
];

const languageFamily: ItemTemplate = {
  id: "factual.language-family",
  category: "factual",
  measures: "Historical linguistics, where the correct answer is often counter-geographical (Finnish is not Indo-European).",
  generate: (rng) => {
    const [language, family] = rng.pick(LANGUAGES);
    const pool = ["Indo-European", "Uralic", "Turkic", "Afro-Asiatic", "Niger-Congo", "Austronesian", "Sino-Tibetan", "Austroasiatic", "Kra-Dai", "Na-Dene"];
    const opts = buildOptions(rng, family, rng.sample(pool.filter((f) => f !== family), 3));
    return {
      prompt: `To which language family does ${language} belong?\n\n${opts.block}\n\nAnswer with only the letter of the correct choice.`,
      checks: [optionCheck(opts.options, opts.answer)],
      reference: opts.answer,
    };
  },
};

// ---------------------------------------------------------------------------
// 8. Historical years
// ---------------------------------------------------------------------------

const historyYear: ItemTemplate = {
  id: "factual.history-year",
  category: "factual",
  measures: "Dated historical recall, answered numerically so the grader is exact rather than a string match.",
  generate: (rng) => {
    const entry = rng.pick(HISTORICAL_YEARS);
    const event = entry.key;
    const year = Number(entry.answer);
    return {
      prompt: `In what year did ${event} occur? Answer with only the four-digit year.`,
      checks: [{ id: "answer", weight: 1, expected: String(year), grader: g.numeric(year, 0) }],
      reference: String(year),
    };
  },
};

// ---------------------------------------------------------------------------
// 9. Literary attribution
// ---------------------------------------------------------------------------

const AUTHORS: ReadonlyArray<readonly [work: string, author: string, key: string]> = [
  ["Pride and Prejudice", "Jane Austen", "austen"],
  ["Nineteen Eighty-Four", "George Orwell", "orwell"],
  ["One Hundred Years of Solitude", "Gabriel García Márquez", "márquez"],
  ["Crime and Punishment", "Fyodor Dostoevsky", "dostoevsky"],
  ["Things Fall Apart", "Chinua Achebe", "achebe"],
  ["The Metamorphosis", "Franz Kafka", "kafka"],
  ["Don Quixote", "Miguel de Cervantes", "cervantes"],
  ["Frankenstein", "Mary Shelley", "shelley"],
  ["Wuthering Heights", "Emily Brontë", "bront"],
  ["Moby-Dick", "Herman Melville", "melville"],
  ["Beloved", "Toni Morrison", "morrison"],
  ["The Trial", "Franz Kafka", "kafka"],
  ["Middlemarch", "George Eliot", "eliot"],
  ["The Old Man and the Sea", "Ernest Hemingway", "hemingway"],
  ["Mrs Dalloway", "Virginia Woolf", "woolf"],
];

const literaryAuthor: ItemTemplate = {
  id: "factual.literary-author",
  category: "factual",
  measures: "Author-work attribution. Graded on a normalised surname key so that accents and naming conventions do not decide the point.",
  generate: (rng) => {
    const [work, author, key] = rng.pick(AUTHORS);
    return {
      prompt: `Who wrote the novel *${work}*? Answer with only the author's name.`,
      checks: [freeText("answer", author, [key])],
      reference: author,
    };
  },
};

// ---------------------------------------------------------------------------
// 10. Chemical formulas
// ---------------------------------------------------------------------------

const chemicalFormula: ItemTemplate = {
  id: "factual.chemistry-formula",
  category: "factual",
  measures: "Molecular formula recall. Graded by structural comparison so subscript formatting and element order do not decide the point.",
  generate: (rng) => {
    const entry = rng.pick(CHEMICAL_FORMULAS);
    const substance = entry.key;
    const formula = entry.answer;

    // Normalise to a canonical element->count map: order-insensitive and
    // subscript-agnostic, so "H2O", "OH2", and "H₂O" all compare equal.
    const toCounts = (s: string): string => {
      const cleaned = s.replace(/[^A-Za-z0-9]/g, "");
      const parts = cleaned.match(/[A-Z][a-z]?\d*/g) ?? [];
      const counts = new Map<string, number>();
      for (const part of parts) {
        const m = /^([A-Z][a-z]?)(\d*)$/.exec(part)!;
        const el = m[1]!;
        const n = m[2] === "" ? 1 : Number(m[2]);
        counts.set(el, (counts.get(el) ?? 0) + n);
      }
      return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([el, n]) => `${el}${n}`)
        .join("");
    };

    const want = toCounts(formula);
    const alternatives = entry.accept ?? [];

    return {
      prompt: `What is the chemical formula of ${substance}? Answer with only the formula.`,
      checks: [
        {
          id: "answer",
          weight: 1,
          expected: `${formula}${alternatives.length > 0 ? ` (also accepted: ${alternatives.join(", ")})` : ""}`,
          grader: g.programmatic(`formula is structurally ${formula}`, (r) => {
            const got = toCounts(r);
            if (got.length === 0) return 0;
            if (got === want) return 1;
            return alternatives.some((alt) => toCounts(alt) === got) ? 1 : 0;
          }),
        },
      ],
      reference: formula,
    };
  },
};

export const FACTUAL_ITEMS: readonly ItemTemplate[] = [
  elementSymbol,
  capital,
  planets,
  vertebrateClass,
  nobleGas,
  siUnit,
  languageFamily,
  historyYear,
  literaryAuthor,
  chemicalFormula,
];
