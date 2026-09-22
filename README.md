# ESAC-GI

**EcoWestern Short and Cheap General Intelligence Benchmark, Version 1**

[![CI](https://github.com/EcoWestern/ESAC-GI/actions/workflows/ci.yml/badge.svg)](https://github.com/EcoWestern/ESAC-GI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node: >= 22.6](https://img.shields.io/badge/node-%3E%3D22.6-brightgreen.svg)](package.json)
[![Benchmark: ESAC-GI v1.0](https://img.shields.io/badge/benchmark-ESAC--GI%20v1.0-informational.svg)](CHANGELOG.md)

ESAC-GI is a small benchmark for difficult capabilities: 42 items, 75 points, eight
categories, one sitting, a few tens of thousands of tokens.

Short is not the same as easy. Cost here comes from how much text goes in and out, not
from how hard the problem is, so the suite is built to make a short answer require a
substantial amount of correct reasoning to reach. A single-line answer can be the hardest
item in the bank.

This repository is the benchmark. Items are generators rather than stored questions, and
every expected answer is computed from a seed rather than looked up, so there is no
private answer file that can drift out of sync with the copy you are reading. Anyone who
has the repository can reproduce a score exactly.

The companion suite, ESAC-AG (Agentic Work and Capability), is specified in the design
document but is not implemented here.

## Contents

- [At a glance](#at-a-glance)
- [Reading a result](#reading-a-result)
- [Quick start](#quick-start)
- [Running against a model](#running-against-a-model)
- [Public and held-out pools](#public-and-held-out-pools)
- [How the benchmark is built](#how-the-benchmark-is-built)
- [What this benchmark does not claim](#what-this-benchmark-does-not-claim)
- [Versioning](#versioning)
- [Repository layout](#repository-layout)
- [Design specification](#design-specification)
- [Tests](#tests)
- [Contributing, security, and licence](#contributing-security-and-licence)

## At a glance

| Category | Items | Points | Grading |
|---|---:|---:|---|
| Logic & deduction | 5 | 10 | deterministic |
| Math reasoning | 5 | 10 | deterministic |
| Factual knowledge | 10 | 10 | deterministic |
| Reading comprehension | 5 | 10 | deterministic |
| Abstraction / pattern recognition | 5 | 10 | deterministic |
| Instruction-following | 5 | 10 | deterministic |
| Writing quality | 2 | 10 | judge |
| Response-depth calibration | 5 | 5 | judge |
| **Total** | **42** | **75** | |

Sixty of the 75 points are graded programmatically, so the majority of a score is exactly
reproducible. The remaining 15 points, in writing quality and response-depth calibration,
are graded by a small open-weight judge.

The four normal response-depth items carry equal weight, and the boundary item carries
half weight, so the category still totals its full 5 points.

## Reading a result

Three things are always reported together:

- **the total out of 75**;
- **the per-category breakdown**, raw and normalised, so a 10-point category and a
  5-point category are visually comparable;
- **a version tag**. "58/75" is not a result. "58/75 on ESAC-GI v1.0" is.

```
$ npm run esac -- run --model <spec>
EcoWestern Short and Cheap General Intelligence Benchmark, Version 1
ESAC-GI v1.0  ·  split: public  ·  model: <spec>

SCORE   48.25 / 75   (64.3%)
RESULT  FAIL

CATEGORY BREAKDOWN
    Logic & deduction                    8.00/10   80.0%  [###################.....]
  ! Writing quality                      4.50/10   45.0%  [###########.............]
...
  ! = below the 60% category threshold
```

### Passing

A model must reach **60 percent in every category** and **60 percent overall**. Both
conditions are required, so a strong average does not rescue a weak category. In the
example above the overall figure is above 60 percent and the result is still a failure,
because writing quality is below its category threshold.

The threshold is part of the scoring protocol. Changing it is a major-version change.

## Quick start

Node 22.6 or newer. The harness has no runtime dependencies, because Node runs the
TypeScript directly through native type stripping.

```bash
npm install            # dev dependencies only: typescript and @types/node
npm run verify         # typecheck plus the full test suite, offline
```

The CLI is reached through npm from a clone. A bare `esac` command exists only if you
have linked the package yourself.

```bash
npm run esac -- list              # the item bank, with point allocation
npm run esac -- inspect <itemId>  # render one generated instance, with its checks
npm run esac -- selftest          # verify the harness end to end, offline
npm run esac -- version           # the version tag and the canary

# A dry run that exercises the whole pipeline and measures nothing
npm run esac -- run --model oracle --judge oracle
```

`npm run export:public` regenerates the committed public pool. CI fails if that snapshot
drifts from what the generators produce, so the public repository cannot quietly stop
matching itself.

## Running against a model

An adapter spec has the form `baseUrl|model|apiKeyEnvVar`. The third field names an
environment variable rather than holding a key inline.

```bash
npm run esac -- run \
  --model "https://api.example.com/v1|model-name|EXAMPLE_API_KEY" \
  --judge "http://localhost:11434/v1|glm-4.6|OLLAMA_KEY" \
  --json runs/example.json \
  --verbose
```

| Flag | Meaning |
|---|---|
| `--split` | `public` (default), `heldout`, or `both` |
| `--items` | comma-separated item ids or category ids, for a partial run |
| `--json` | write the full report as JSON |
| `--verbose` | include per-check detail |
| `--quiet` | suppress the per-item progress tally |

The bundled HTTP adapter speaks the OpenAI chat-completions shape, so it reaches OpenAI,
DeepSeek, Groq, Together, vLLM, Ollama, LM Studio, and llama.cpp's server. That is what
makes the judging rule practically satisfiable: the judge can be a locally hosted
open-weight model, with no API key from the company being tested.

## Public and held-out pools

The same generators produce both pools under different dataset seeds. The public seed is
disclosed with the repository. The held-out seed is evaluator-controlled and must not be
committed, and the CLI refuses to run the held-out pool without one.

```bash
npm run esac -- export --split public --out public/esac-gi-v1.0-public.jsonl

$env:ESAC_HELD_OUT_SEED = "<evaluator seed>"          # PowerShell
npm run esac -- key --split heldout --out runs/heldout-key.json
```

The split is by *instance* rather than by *template*, so every category has held-out
coverage even though the bank is small.

Official comparative claims should cite a held-out run. A model that scores substantially
higher on the public pool than on the held-out pool is a visible signal of overfitting to
the benchmark, and surfacing that signal is one of the more useful things this project
can do.

## How the benchmark is built

### Items are generators, not stored questions

Most items are templates that produce an instance and its checks from a seed. The expected
answer is computed, never remembered. Memorising "the answer to item 14" does not help,
because item 14 is a different problem under every dataset seed.

Three consequences follow:

- the public repository is the distributable artifact, and third parties run the real
  generators, so there is no private item file to drift out of sync;
- scoring logic is part of the item, because a stored answer key could not survive
  regeneration;
- where the instance *is* the construct, as in the writing and response-depth items, the
  item is marked `parametrized: false` and rotates at the pool level across releases
  instead.

### Difficulty is built into the items

Several items are constructed so that the obvious shortcut produces a plausible wrong
answer rather than an obviously wrong one.

- `math.packing` draws from a verified pool in which greedily taking the best
  value-per-unit ratio is strictly suboptimal. The test suite re-verifies that property,
  so the item cannot silently become easy.
- `math.pipes` is two-phase, so applying the net rate across the whole duration is wrong.
- `math.crt` uses three congruences, so taking the remainder of the product of the
  remainders is wrong.
- `logic.syllogism` computes entailment by enumeration over all models, so the answer is
  whatever is actually forced, not whatever sounds plausible.
- Distractors are the converse, obverse, and weakened variants that surface reasoning
  produces.

### Response-depth calibration

Two items expect a substantive response, two expect a concise one, and one is a boundary
case where either is acceptable. No prompt contains a length instruction. The depth cue is
carried entirely by the situation, and a test asserts that, because a prompt saying "be
concise" would measure instruction-following instead.

Both rubrics carry a heavily weighted "did it answer the question" criterion, so the
category cannot be gamed by an empty response, which would win a pure brevity rubric, or
by padding, which would win a pure length rubric.

### Judge discipline

No vendor grades anyone. The judge must be open-weight, self-hostable, and pinned per
release.

Judge-graded items use 2x2 replication: the model is run twice on the item, each response
is judged twice, and the four observations are averaged. That separates model-side
variance from judge-side variance. Deterministic items run once.

### Failures are separated

- An **infrastructure failure** is an API error, a rate limit, a transport reset, or an
  unparseable judge response. It is retried under identical conditions and is never scored
  as a zero. If it persists, the run aborts rather than reporting an outage as a low
  score.
- A **model failure** is an empty answer, a refusal, a wrong answer, or a model that
  exceeds the item's time budget. It is scored as a failure.

The distinction is enforced in `runner.ts` and covered by tests.

### Contamination and the canary

A canary string is embedded in the public item files:

```
ESAC-CANARY-GI-a3f9c17e4b2d8056-v1.0
```

If a future model completes canary-adjacent text unprompted, that is evidence the item
leaked into a training corpus, which flags that it needs retiring rather than merely
rotating.

## What this benchmark does not claim

- **42 items is a small sample.** The total is a directional signal, and the per-category
  breakdown is where the diagnostic value is. A category with two items cannot support a
  fine-grained claim, and the writing category in particular is a small sample of writing
  behaviour rather than a comprehensive assessment.
- **Judge-graded categories carry more uncertainty than the arithmetic suggests.** Writing
  and response-depth are 15 of the 75 points. The 2x2 protocol damps that variance but
  does not remove it.
- **This is not a general intelligence test in the broad sense.** It is a short instrument
  that samples eight specific capabilities cheaply. Its value is that it is cheap,
  reproducible, and hard to game, not that it is comprehensive.
- **A score without a version tag is not a result.** Results from different major versions
  are not comparable.

## Versioning

- **Minor** releases change content and organisation only: item rotation, new parametrized
  instances, prompt edits. Scores remain comparable.
- **Major** releases change what the score measures: scoring methodology, judging
  methodology, criteria, category definitions, or pass criteria. Scores are **not**
  comparable across major versions.

## Repository layout

```
src/
  version.ts          version identity, seeds, decoding params, thresholds
  types.ts            core contracts (Instance, ItemTemplate, Grader, adapters)
  rng.ts              deterministic PRNG, seed derivation, fingerprints
  categories.ts       category registry, with point/item invariants asserted
  graders.ts          deterministic grading (exact, numeric, regex, programmatic)
  judge.ts            judge prompt construction, tolerant parsing, normalisation
  runner.ts           ordering, retries, the 2x2 replication protocol
  score.ts            aggregation, thresholds, reporting
  adapters.ts         oracle + OpenAI-compatible HTTP adapters
  cli.ts              command-line interface
  registry.ts         item registry, instantiation, bank validation
  items/              one file per category, plus verified parameter pools
public/
  esac-gi-v1.0-public.jsonl   the distributable public pool
specs/
  spec.md             the design specification: Part I is the original basis,
                      Part II is the first amendment, which governs
tests/all.test.ts     the test suite
tools/                offline generators for the verified parameter pools
.github/              issue templates, CI, and dependency automation
CONTRIBUTING.md       contribution policy: issues and forks, no pull requests
SECURITY.md           vulnerability and benchmark-integrity reporting
CODE_OF_CONDUCT.md    expectations for the issue trackers
CHANGELOG.md          version history
CITATION.cff          citation metadata
LICENSE               MIT
```

## Design specification

`specs/spec.md` is the design specification, in two parts:

- **Part I** is the original design basis, including the reasoning behind it and the
  questions that were still open at the time.
- **Part II** is the first amendment: ten decisions that supersede specific clauses in
  Part I, and that govern wherever the two disagree.

The document is kept in that shape rather than flattened, because the reasoning behind an
instrument is part of the instrument, and because it should be visible what changed and
why.

## Tests

```bash
npm test          # 60 tests, offline
npm run typecheck
```

The suite asserts the properties the benchmark's claims depend on, not merely that the
code runs:

- the bank matches the published distribution exactly, including item weights;
- generators are deterministic, and every parametrized item varies across seeds;
- every reference answer scores 100 percent on its own checks, and non-answers never do;
- the difficulty claims hold: the shortcut answer for each trap item is verified wrong;
- syllogism items never rely on vacuous truth, meaning premises that are satisfiable only
  because their terms are empty;
- graders reject near-misses, and multiple-choice extraction cannot be fooled by the
  pronoun "I" or the article "A";
- the 2x2 replication protocol, the infrastructure and model failure split, and the retry
  accounting all behave as specified;
- thresholds pass at exactly 60 percent and fail below it, including the floating-point
  boundary that item weights produce.

`npm run esac -- selftest` runs a comparable set of checks as a single offline command, and
a perfect-oracle run reproduces exactly 75/75 through the full pipeline.

## Contributing, security, and licence

ESAC-GI is published as source-available, to be read, run, audited, and forked. **Pull
requests are not accepted**, because a published score has to be traceable to a specific,
trusted revision. Issues are open, and forks are welcome under the MIT licence.

- `CONTRIBUTING.md` explains the policy and what is welcome instead, including item
  challenges, which are the most useful reports this project can receive.
- `SECURITY.md` covers private reporting of held-out seed disclosure, canary exposure,
  score misreporting, and judge manipulation.
- `CODE_OF_CONDUCT.md` covers expectations in the issue trackers.
- `CITATION.cff` carries citation metadata. If you publish a comparative claim, cite the
  repository and state the version tag.

MIT © EcoWestern. See `LICENSE`.

Forking is explicitly permitted. If you change what the benchmark measures, run it under
your own name and version identity: a number only means something when it is attached to
the instrument that produced it.
