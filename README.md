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

The harness is an OpenAI-compatible client, so it evaluates any model behind a
chat-completions endpoint with no provider-specific code. The recommended way to run it is
through an aggregator such as OpenRouter, which supplies both the model under test and the
independent open-weight judge through one key. See
[Running against a model](#running-against-a-model).

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
- [Repository settings](#repository-settings)
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

The package is private and unpublished, so there is no global `esac` on your PATH. From a
clone, use the npm scripts, or pass a command through `npm run esac`:

```bash
npm run auto                      # guided setup, then a run with a summary
npm run esac -- list              # the item bank, with point allocation
npm run esac -- inspect <itemId>  # render one generated instance, with its checks
npm run esac -- seed              # generate a held-out seed, or `seed show` to inspect it
npm run esac -- selftest          # verify the harness end to end, offline
npm run esac -- version           # the version tag, canary, and pinned judge

# A dry run that exercises the whole pipeline and measures nothing
npm run esac -- run --model oracle --judge oracle
```

`npm run auto` is shorthand for `npm run esac -- auto`. The `--` in the second form is
what makes npm forward the arguments to the script rather than consume them itself, so
`npm run esac -- list` and `npm run esac list` both work.

`auto` is the shortest path to a real number. It asks four questions (model, judge,
pool, and categories), each with a default that produces a correct run, then reports
each section as it closes and prints one summary at the end:

```
$ npm run esac -- auto

ESAC-GI auto mode
A few questions. Press Enter to accept the default shown in [brackets].

Model under test
  A model id (assumed to be on https://openrouter.ai/api/v1),
  a full "baseUrl|model|apiKeyEnvVar" spec, or "oracle" for a dry run.
  > deepseek/deepseek-chat
  using https://openrouter.ai/api/v1|deepseek/deepseek-chat|OPENROUTER_API_KEY

Judge
  The judge must be open-weight and pinned per release. Press Enter for the
  pinned judge (xiaomi/mimo-v2.6-pro), or give a model id, a full
  "baseUrl|model|apiKeyEnvVar" spec, or "oracle".
  [xiaomi/mimo-v2.6-pro] >
  using https://openrouter.ai/api/v1|xiaomi/mimo-v2.6-pro|OPENROUTER_API_KEY

Pool
  public or heldout [public] >
Categories
  Comma-separated category or item ids, or Enter for the whole suite.
  [all] >

  Ready:
    model    https://openrouter.ai/api/v1|deepseek/deepseek-chat|OPENROUTER_API_KEY
    judge    https://openrouter.ai/api/v1|xiaomi/mimo-v2.6-pro|OPENROUTER_API_KEY
    pool     public
    items    all

  Start the run? [Y/n] >

ESAC-GI v1.0  starting  ·  42 items  ·  model: deepseek/deepseek-chat@openrouter.ai  ·  judge: xiaomi/mimo-v2.6-pro@openrouter.ai
  Section results appear below as each section completes.

  [ 1/42] logic.seating                          100%
  ...

  SECTION  Writing quality                     6.50 / 10    65.0%
  ...

========================================================================
  EcoWestern Short and Cheap General Intelligence Benchmark, Version 1
  ESAC-GI v1.0   public pool   model: deepseek/deepseek-chat@openrouter.ai   judge: xiaomi/mimo-v2.6-pro@openrouter.ai
========================================================================

  OVERALL SCORE   48.25 / 75          64.3%     FAIL

  SECTION SCORES
    Logic & deduction                  8.00 / 10    80.0%  [###################.....]
  ! Writing quality                    4.50 / 10    45.0%  [###########.............]
  ...

  NOTES
  - Below the 60% category threshold: Writing quality.
  - Judge-graded categories carry more uncertainty than the arithmetic suggests: 15 of 75 points.
  - This was a public-pool run. Official comparative claims should cite a held-out run.
  - 42 items is a small sample. The total is a directional signal; the per-category
    breakdown is where the diagnostic value is.
```

Passing `--model` answers the first question and skips it; `--yes` skips the whole
conversation and requires the answers to be supplied as flags. Both are useful in
scripts and in CI.

`npm run export:public` regenerates the committed public pool. CI fails if that snapshot
drifts from what the generators produce, so the public repository cannot quietly stop
matching itself.

## Running against a model

ESAC-GI ships an OpenAI-compatible client and nothing else. It speaks the chat-completions
shape, which is the de facto standard for hosted inference, so any endpoint that
implements it can be evaluated with no provider-specific code and no vendor SDK.

An adapter spec has the form `baseUrl|model|apiKeyEnvVar`. The third field names an
environment variable rather than holding a key inline.

The named variable is read from the environment. A `.env` file in the working directory is
loaded automatically if present, and a variable already exported in your shell wins over
the file, so a CI secret is never shadowed by a stale `.env`. `.env.example` shows the
shape, and `.env` itself is gitignored.

```bash
npm run esac -- run --model "https://api.example.com/v1|model-name|EXAMPLE_API_KEY" --judge "http://localhost:11434/v1|judge-model|OLLAMA_KEY" --json runs/example.json --verbose
```

| Flag | Meaning |
|---|---|
| `--split` | `public` (default) or `heldout`; one run is one pool |
| `--items` | comma-separated item ids or category ids, for a partial run |
| `--json` | write the full report as JSON |
| `--verbose` | include per-check detail |
| `--quiet` | suppress the per-item progress tally |
| `--max-tokens <n>` | output cap for the model under test (default 4096) |
| `--extra-body <json>` | extra JSON merged into each model request, for provider-specific parameters |
| `--allow-unpinned-judge` | run anyway with a substituted judge; the result carries no verdict |

### Run it with OpenRouter if you can

The awkward part of running this benchmark is the judge, not the model. Fifteen of the 75
points are rubric-graded, the judge must be open-weight and pinned per release, and most
first-party APIs either do not serve open-weight models or would make the company being
tested the grader.

An aggregator removes that problem in a single connection, and **OpenRouter is the
recommended way to run ESAC-GI**. It serves a wide range of open-weight models, including
the judge pinned for this release, behind one OpenAI-compatible endpoint and one key, so
the model under test and the independent judge are reached from the same place:

```bash
npm run esac -- run --model "https://openrouter.ai/api/v1|deepseek/deepseek-chat|OPENROUTER_API_KEY" --judge "https://openrouter.ai/api/v1|xiaomi/mimo-v2.6-pro|OPENROUTER_API_KEY" --json runs/report.json --verbose
```

Nothing above is OpenRouter-specific, though. A locally hosted judge works just as well,
and that is the point of the open-weight rule. Any of these endpoints will do:

| Endpoint | Base URL | Typical role |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | Recommended. Open-weight judges and models behind one key |
| OpenAI | `https://api.openai.com/v1` | Model under test only |
| DeepSeek | `https://api.deepseek.com/v1` | Model under test, or an open-weight judge |
| Groq | `https://api.groq.com/openai/v1` | Hosted open-weight models |
| Together | `https://api.together.xyz/v1` | Hosted open-weight models |
| Ollama | `http://localhost:11434/v1` | Local judge, no API key required |
| LM Studio | `http://localhost:1234/v1` | Local judge, no API key required |
| llama.cpp server | `http://localhost:8080/v1` | Local judge, no API key required |
| vLLM | `http://localhost:8000/v1` | Self-hosted judge at scale |

Base URLs follow each provider's own convention, so check their documentation if a run
returns a transport error. A closed first-party model is acceptable as the model under
test, and never as the judge.

### The pinned judge

The judge pinned for ESAC-GI v1.0 is **`xiaomi/mimo-v2.6-pro`**, a new open-weight model.
It was chosen for judge duty on two grounds: strong general capability, and an absence of
bias in its chain of thought in the maintainers' private testing. The second matters more
here than raw benchmark standing, because the judge's job is to apply a rubric neutrally
rather than to be impressive.

The pin is what keeps rubric scores from drifting when a judge model is updated upstream.
The judge actually used is recorded in every report, so a run graded by something else is
visible rather than silent, and changing the pinned judge is a major-version change.

Model ids are provider-specific, so confirm the id in the provider's catalogue before a
run. Hosting the pinned judge yourself is equally valid, and is the strongest form of the
independent-judge claim. The check compares the model name rather than the full id, so a
self-hosted copy still satisfies it.

The pin is enforced rather than merely documented. A run whose judge is not the pinned
judge is refused, and `--allow-unpinned-judge` is required to proceed. Such a run carries
**no verdict**: it is reported as `NOT VALID` rather than pass or fail, because the judge
decides a whole category and therefore decides the outcome. The 60 points that do not
depend on a judge are still measured and reported. Changing the judge is a
major-version change for anyone publishing results, and a substituted-judge run exits
with status code 3 so a script cannot mistake it for a result.

### Thinking budgets

Some models spend output tokens on hidden reasoning before writing an answer, and on most
APIs that reasoning counts against `--max-tokens`. When it does, a model can exhaust its
allowance thinking and never answer at all, which the harness reports as a truncated model
failure. A cap high enough to stop that happening is doing its job; a cap much higher than
that mostly costs money, because a correct answer here is a short one.

Where the provider can separate the two allowances, separate them, so thinking stops
competing with answering:

```bash
npm run auto -- --thinking-tokens 4096 --max-tokens 2048
```

`--thinking-tokens` sends that budget in the shape OpenRouter expects, and is the form to
prefer, because raw JSON also has to survive your shell. For any other provider parameter,
`--extra-body` merges a JSON object into the request, which covers OpenAI-style
`reasoning_effort` and whatever else a provider accepts:

```powershell
# PowerShell: the inner quotes need escaping
npm run auto -- --extra-body '{\"reasoning\":{\"max_tokens\":4096}}' --max-tokens 2048
```

```bash
# bash
npm run auto -- --extra-body '{"reasoning":{"max_tokens":4096}}' --max-tokens 2048
```

Both apply to the model under test and never to the judge, whose decoding parameters are
part of the pinned configuration: changing them would change what a rubric score means.

## Public and held-out pools

The same generators produce both pools. A pool is not a stored set of items: an instance is
derived from `hash(datasetSeed + ":" + itemId)`, so the pool is whichever dataset seed a run
resolves. The public seed is disclosed with the repository. The held-out seed is
evaluator-controlled and must not be committed.

```bash
npm run esac -- seed --out .heldout/seed   # generate one, or omit --out for the default
npm run esac -- seed show                  # path and fingerprint; --reveal prints the seed

npm run esac -- key --split heldout --out runs/heldout-key.json
npm run esac -- run --split heldout --model "<spec>" --json runs/heldout.json
```

A held-out run resolves its seed in this order: `--seed`, then `ESAC_HELD_OUT_SEED`, then
`.heldout/seed` (gitignored). With none of the three, the run refuses rather than inventing
one, because a seed nobody keeps produces a run nobody can repeat. Guided `auto` mode, run
on a terminal, offers to generate one at the point where you choose the pool.

The split is by *instance* rather than by *template*, so every category has held-out
coverage even though the bank is small. The consequence worth knowing: two held-out runs are
item-identical only when they share a seed. Use one seed for a comparison, and publish the
fingerprint from the report rather than the seed itself.

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
release, and for v1.0 the pin is `xiaomi/mimo-v2.6-pro`. Reaching one is the only
genuinely awkward part of running the benchmark, which is why an aggregator such as
OpenRouter is the recommended route. See
[Running against a model](#running-against-a-model).

Judge-graded items use 2x2 replication: the model is run twice on the item, each response
is judged twice, and the four observations are averaged. That separates model-side
variance from judge-side variance. Deterministic items run once.

### Failures are separated

- An **infrastructure failure** is an API error, a rate limit, a transport reset, or an
  unparseable judge response. It is retried under identical conditions and is never scored
  as a zero. If it persists, the run aborts rather than reporting an outage as a low
  score.
- A **model failure** is an empty answer, a refusal, a wrong answer, a model that exceeds
  the item's time budget, or a model that reaches the output cap without producing an
  answer. It is scored as a failure, and a truncated response is not retried, because the
  same budget produces the same outcome.

The output cap is part of the benchmark definition, like the time budget, so it is set
generously: a reasoning model can spend thousands of tokens thinking before it emits a
single answer token, and a tight cap would cut such models off before they answer anything
at all. Raise it with `--max-tokens <n>`, and note that a report says when a cap was hit,
so a low score is not mistaken for a wrong answer.

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
  seedfile.ts         held-out seed generation, storage, and resolution
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
  scoring.md          the scoring reference: run structure, per-category
                      scoring, and the criteria behind every point
tests/all.test.ts     the test suite
tools/                offline generators for the verified parameter pools
.github/              issue templates, CODEOWNERS, CI, the release check, rulesets,
                      and dependency automation
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

For the operational side of the same instrument, `specs/scoring.md` documents how a run is
structured, how each point is awarded, and the criteria behind every item: the run order,
the replication protocol, the dual 60 percent gate, the check-level criteria for all forty
items, and the full text of the four judge rubrics. The specification says why; the scoring
reference says what.

## Tests

```bash
npm test          # the full suite, offline
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

## Repository settings

Some of this project's guarantees are not files, and cannot be reviewed here: they are
settings on the GitHub repository. They are listed so that a fork can reproduce them and so
that none of them is silently lost.

### Rulesets

`.github/rulesets/` holds two rulesets as JSON: one for the default branch and one for
release tags. They are not applied by pushing them. Apply each once per repository through
**Settings**, **Rules**, then **Import a ruleset**, or with `gh api`. See
`.github/rulesets/README.md` for the commands, for what each rule does, and for the one
setting worth thinking about: the admin bypass, which is what lets the maintainer push to
`main` directly instead of requiring a pull request.

### Release check

`.github/workflows/release.yml` runs on a `v*` tag and refuses a tag that disagrees with
the code. It checks three things: that the tag matches the package version and the benchmark
version in `src/version.ts`, that `CHANGELOG.md` has a section for that version, and that
the tagged tree still reproduces the committed public pool. A published tag can never be
moved, so this is the last moment at which a mistake is cheap.

### Pull requests

Practice matches policy here without anyone watching.
`.github/workflows/close-pull-requests.yml` replies to a pull request from outside the
organisation with the notice in `.github/pull-request-notice.md` and closes it, and it
leaves maintainers, members, and collaborators alone. A declined pull request therefore
comes with a reason and a route forward rather than silence, and the policy in
`CONTRIBUTING.md` is enforced rather than merely stated.

### Features to switch on

| Setting | Where | Why it matters here |
|---|---|---|
| Private vulnerability reporting | Settings, Security | `SECURITY.md` and the issue templates both link to the private advisory form. Until this is enabled, that link does not work and there is no private route for a report. |
| Dependabot alerts and security updates | Settings, Security | The project has no runtime dependencies, so the realistic risk is the dev toolchain. |
| Secret scanning and push protection | Settings, Security | The repository should never hold a held-out seed or an API key. Push protection stops one arriving by accident. |
| CodeQL default setup | Settings, Security | The CLI parses untrusted model output, so static analysis of the harness is worth having. |
| Actions default workflow permissions | Settings, Actions | Keep the default read-only, so a workflow cannot write to the repository unless it asks. Every workflow here declares `contents: read`. |
| Topics | Repository page | Set from the list below. Topics are how anyone finds this repository at all. |

### Description and topics

The repository description, ready to paste into the About panel. 277 characters, inside
GitHub's limit of 350:

> A short, cheap benchmark that measures difficult capabilities: 42 generated items, 75
> points across 8 categories. 60 points graded deterministically, 15 by a pinned
> open-weight judge. Answers are computed from a seed rather than stored, so the repository
> is the whole artifact.

Topics, most load-bearing first. Eighteen of GitHub's twenty slots, all lowercase and
hyphenated as GitHub requires, and none longer than the 50 character cap:

```
benchmark, ai-benchmark, llm, llm-benchmark, llm-evaluation, evaluation,
general-intelligence, reproducibility, contamination, judge, rubric, scoring,
openai-compatible, openrouter, cli, typescript, zero-dependencies, mit-license
```

The two ways to set them. The description:

```bash
gh repo edit EcoWestern/ESAC-GI --description "A short, cheap benchmark that measures difficult capabilities: 42 generated items, 75 points across 8 categories. 60 points graded deterministically, 15 by a pinned open-weight judge. Answers are computed from a seed rather than stored, so the repository is the whole artifact."
```

And the topics, one flag per topic:

```bash
gh repo edit EcoWestern/ESAC-GI --add-topic benchmark --add-topic ai-benchmark --add-topic llm --add-topic llm-benchmark --add-topic llm-evaluation --add-topic evaluation --add-topic general-intelligence --add-topic reproducibility --add-topic contamination --add-topic judge --add-topic rubric --add-topic scoring --add-topic openai-compatible --add-topic openrouter --add-topic cli --add-topic typescript --add-topic zero-dependencies --add-topic mit-license
```

Every command in this section is a single line on purpose. A trailing backslash is a bash
continuation, and pasting one into PowerShell is a parse error that runs nothing at all,
including the lines above it. Single lines paste into PowerShell, bash, and cmd unchanged.

### Publishing a release

Push the tag, let the release check pass, then create the GitHub release at that tag and use
the matching `CHANGELOG.md` section as the body. Do not move or delete a published tag:
the ruleset refuses both, and a moved tag would make every score attributed to that version
unattributable.

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
