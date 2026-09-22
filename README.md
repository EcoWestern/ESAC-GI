# ESAC-GI — EcoWestern Short and Cheap General Intelligence Benchmark

**Version:** ESAC-GI v1.0 · **Suite:** General Intelligence, 75 points across 42 items
**Companion suite:** ESAC-AG (Agentic Work & Capability) — not in this repository

Canary: `ESAC-CANARY-GI-a3f9c17e4b2d8056-v1.0`

---

## What this is

A short, cheap benchmark that measures difficult capabilities. Cost and time come from
token volume and wall-clock, not from difficulty: a single-line answer can require a
great deal of correct internal reasoning to reach. The instrument optimises for
*compressed difficulty* — small input, hard problem.

The design specifications live in `specs/`:

- `spec.md` — the original design specification
- `first-amendment.md` — ten pre-build resolutions that supersede specific parts of it

Where the two disagree, the amendment governs. This README summarises the resolved
design; the specs are authoritative.

## Category structure

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

The four normal response-depth items are weighted equally and the boundary item carries
half weight, per resolution 2. Only 15 of 75 points (20%) depend on a judge; the
remaining 60 are graded programmatically, so most of the score is exactly reproducible.

## Reporting

A score is always reported as three things together:

- **Total /75**
- **Per-category subscore**, raw and normalised to a percentage, so a 10-point category
  and a 5-point category are visually comparable
- **A version tag** — "58/75" means nothing on its own; "58/75 on ESAC-GI v1.0" does

```
$ esac run --model <spec>
SCORE   48.25 / 75   (64.3%)
RESULT  PASS

CATEGORY BREAKDOWN
    Logic & deduction                    8.00/10   80.0%  [###################.....]
  ! Writing quality                      4.50/10   45.0%  [###########.............]
...
  ! = below the 60% category threshold
```

### Passing

A model must reach **60% in every category** *and* **60% overall**. Both conditions are
required, so a strong average does not rescue a weak category. The threshold has been
part of the benchmark since v1.0; changing it is a major-version change.

### Versioning

- **Minor** — content and organisation only (item rotation, new parametrized instances,
  prompt edits). Scores remain comparable.
- **Major** — anything that changes what the score measures (scoring methodology,
  judging methodology, criteria, category definitions, pass criteria). Scores are
  **not** comparable across majors.

## Design properties worth knowing

### Items are code, not stored questions

Most items are templates that generate an instance from a seed, and the expected answer
is **computed** rather than remembered. This is what makes contamination resistance
work: memorising "the answer to item 14" is impossible when item 14 is a different
instance on every dataset seed.

Three consequences:

- The **public repository is the distributable artifact.** Third parties run the real
  generators; there is no separate private item file to drift out of sync.
- Scoring logic is part of the item. A stored answer key could not survive regeneration.
- Where the instance *is* the construct — the writing and response-depth items, whose
  whole point is the specific context — the item is marked `parametrized: false` and
  rotates at the pool level across releases instead. Resolution 4 permits exactly this.

### Difficulty is enforced structurally

Several items are built so that the obvious shortcut produces a *plausible wrong
answer*:

- `math.packing` draws from a verified pool in which greedily taking the best
  value-per-unit ratio is strictly suboptimal. That pool's defining property is
  re-verified by the test suite, so the item cannot silently become easy.
- `math.pipes` is two-phase, so applying the net rate across the whole duration is wrong.
- `math.crt` uses three congruences; taking the remainder of the product of remainders
  is wrong.
- `logic.syllogism` computes entailment by enumeration over all models, so the answer is
  whatever is *actually* forced — not whatever sounds plausible.
- Distractors are the converse, obverse, and weakened variants that surface reasoning
  produces.

### Response-depth calibration

Two items expect a substantive response; two expect a concise one; one is a boundary
case where either is acceptable. **No prompt contains any length instruction** — the
depth cue is carried entirely by the situation. A test asserts this, because a prompt
saying "be concise" would measure instruction-following instead.

Both rubrics carry a heavily weighted "did it answer the question" criterion, so the
category cannot be gamed by an empty response (which would win a pure brevity rubric) or
by padding (which would win a pure length rubric).

### Judge discipline

No vendor grades anyone. The judge must be open-weight, self-hostable, and pinned per
release. The bundled HTTP adapter speaks the OpenAI chat-completions shape, which covers
OpenAI, DeepSeek, Groq, Together, vLLM, Ollama, LM Studio, and llama.cpp's server — so a
judge can run locally with no API key from the company being tested.

Judge-graded items use **2×2 replication**: the model is run twice and each response is
judged twice, and the four observations are averaged. This separates model-side from
judge-side variance. Deterministic items run once.

### Model failures and infrastructure failures are different

- **Infrastructure failure** — API error, rate limit, transport reset, unparseable judge
  output. Retried under identical conditions; **never scored as a zero**. If it persists,
  the run aborts rather than reporting an outage as a low score.
- **Model failure** — an empty answer, a refusal, a response that is simply wrong, or the
  model exceeding the item's time budget. Scored as a failure.

The distinction is enforced in `runner.ts` and covered by tests.

## Usage

The harness has **zero runtime dependencies**. Node 22.6+ runs the TypeScript directly
via native type stripping, so the benchmark is reproducible from the repository alone.

```bash
npm install            # dev dependencies only (typescript, @types/node)

esac list              # show the item bank and point allocation
esac inspect <itemId>  # render one generated instance
esac selftest          # verify the harness end-to-end, offline
esac version           # print the version tag and canary
```

### Running against a model

```bash
# A dry run that exercises the harness but measures nothing
esac run --model oracle --judge oracle

# A real run against an OpenAI-compatible endpoint
esac run \
  --model "https://api.example.com/v1|model-name|EXAMPLE_API_KEY" \
  --judge "http://localhost:11434/v1|glm-4.6|OLLAMA_KEY" \
  --json runs/example.json \
  --verbose
```

The adapter spec is `baseUrl|model|apiKeyEnvVar`, where the third field names an
environment variable rather than holding a key inline.

| Flag | Meaning |
|---|---|
| `--split` | `public` (default), `heldout`, or `both` |
| `--items` | comma-separated item ids or category ids, for a partial run |
| `--json` | write the full report as JSON |
| `--verbose` | include per-check detail |
| `--quiet` | suppress the per-item progress tally |

### Public and held-out pools

The same generators produce both pools, under different dataset seeds:

```bash
esac export --split public --out public/esac-gi-v1.0-public.jsonl
esac key --split heldout --seed "$EVALUATOR_SEED" --out runs/heldout-key.json
```

The public seed is disclosed with the repository. **The held-out seed is
evaluator-controlled and must not be committed** — the CLI refuses to run the held-out
pool without one. Because the split is by *instance* rather than by template, every
category has held-out coverage; a mechanically exact 70/30 template split is neither
required nor used (resolution 3).

Official comparative claims should cite a held-out run. A model scoring substantially
higher on the public pool than on the held-out pool is a visible, publishable signal of
overfitting to the benchmark — arguably one of the more useful things this project can
surface.

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
specs/                 design specification and amendments
tests/all.test.ts      the test suite
tools/                 offline generators for the verified parameter pools
```

## Tests

```bash
npm test          # 60 tests
npm run typecheck
```

The suite asserts the properties the benchmark's claims depend on, not merely that the
code runs:

- the bank matches the published distribution exactly, including item weights
- generators are deterministic, and every parametrized item varies across seeds
- every reference answer scores 100% on its own checks, and non-answers never do
- the difficulty claims hold — the shortcut answer for each trap item is verified wrong
- syllogism items never rely on vacuous truth (premises that are satisfiable only
  because their terms are empty)
- graders reject near-misses, and multiple-choice extraction cannot be fooled by the
  pronoun "I" or the article "A"
- the 2×2 replication protocol, the infrastructure/model failure split, and the retry
  accounting all behave as specified
- thresholds pass at exactly 60% and fail below it, including the floating-point boundary
  that item weights produce

`esac selftest` runs a comparable set of checks as a single offline command, and a
perfect-oracle run reproduces exactly 75/75 through the full pipeline.

## Interpreting a result honestly

- **42 items is a small sample.** The total is a directional signal; the per-category
  breakdown is where the diagnostic value is. A category with two items cannot support a
  fine-grained claim, and the writing category in particular should be read as a small
  sample of writing behaviour rather than a comprehensive assessment.
- **Judge-graded categories carry more uncertainty than the arithmetic suggests.**
  Writing and response-depth are 15 of 75 points; the 2×2 protocol damps that variance
  but does not remove it.
- **Report the version tag.** Results from different major versions are not comparable,
  and a score without a version is not a result.

## Licence

MIT © EcoWestern
