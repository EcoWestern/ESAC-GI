# ESAC-GI scoring reference

**What the instrument does, category by category.**

This document is the operational companion to the ESAC specification, which lives in the
program repository, [EcoWestern/ESAC](https://github.com/EcoWestern/ESAC), as a constitution
plus numbered amendments. That says *why* the benchmark is shaped the way it is; this says
*what* it measures and *how* each point is awarded. Where the two disagree about the
reasoning, the specification governs; where either disagrees with the harness, the harness is
authoritative, because it is what produces a score.

Every figure here was read out of the generators and graders. The quickest way to check
any of it against the running code:

```bash
npm run esac -- list              # the bank, with point allocation and each item's purpose
npm run esac -- inspect <itemId>  # one generated instance, with its checks and reference
```

---

## 1. Structure of the run

### 1.1 The bank

Forty-two items across eight categories, totalling 75 points. Item counts and point
allocations are fixed by the specification and asserted at load time, so a drift in either
is a hard failure rather than a silently wrong score.

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

That is 35 items and 60 points graded programmatically, and 7 items and 15 points graded by
the pinned judge. The judge-graded share is reported with every run.

### 1.2 How item points are derived

An item's point value is its share of its category's allocation, weighted:

```
item points = category points x (item weight / sum of weights in the category)
```

Every item has weight 1 except one. The response-depth boundary item carries weight 0.5,
which makes the four normal depth items worth 1.111 points each and the boundary item
0.556, for a category total of exactly 5.

### 1.3 Run order

Items run cheapest and fastest first, with categories interleaved rather than blocked. The
ordering is by cost tier: judge-graded items last, then long prompts, then short ones. The
purpose is that a broken harness or a dead API key is discovered on item 1 rather than
after burning through forty items, and that the live progress tally moves visibly.

Ordering does not affect a score. It affects how quickly a broken run tells you it is
broken.

### 1.4 Replication

| Item kind | Model runs | Judgments per response | Observations averaged |
|---|---:|---:|---:|
| Deterministic | 1 | n/a | 1 |
| Judge-graded | 2 | 2 | 4 |

Judge-graded items are therefore run twice and each response is judged twice, which
separates model-side variance from judge-side variance. A model failure on one of the two
runs contributes zero for that run and does not abort the item, so failing selectively
cannot improve a score.

### 1.5 Pinned parameters

Part of the benchmark definition rather than per-run configuration:

| Parameter | Value |
|---|---|
| Model temperature | 0 |
| Model top_p | 1 |
| Judge temperature | 0 |
| Judge top_p | 1 |
| Output cap, model under test | 4096 tokens |
| Output cap, judge | 1024 tokens |

The output cap is a scoring parameter, so it is recorded in every report. A run at a cap
other than 4096 is marked as not strictly comparable, with each other or with official
runs. A response that reaches the cap without producing an answer is scored as a model
failure and is not retried.

### 1.6 Pools

There is no held-out artifact to download. Both pools are the same 42 templates; the only
thing that distinguishes them is the dataset seed, because an instance is derived from
`hash(datasetSeed + ":" + itemId)`. Change the seed and every parametrized item becomes a
different instance with a freshly computed answer. The split is therefore by *instance*
rather than by template, and every category has held-out coverage even where a category
holds only two items.

| Pool | Seed | Purpose |
|---|---|---|
| Public | disclosed in `src/version.ts` | development, self-checking, directional signal |
| Held-out | evaluator-supplied, never committed | claims that are meant to be comparable |

A held-out run resolves its seed from `--seed`, then `ESAC_HELD_OUT_SEED`, then
`.heldout/seed`, which is gitignored and is where `esac seed` writes a freshly generated
one. With none of the three the run refuses, because a seed invented at that moment could
not be reproduced afterwards. There is no combined mode: one run is one pool, one seed, and
one set of instances, so a public-versus-held-out comparison is two runs.

Nothing private has to be shipped for the harness to run the held-out pool, because the
scoring key is recomputed from the generators at run time rather than stored. What a
held-out evaluation rests on is not a hidden file but a seed that the model under test has
never seen. `esac key --split heldout` materialises the key for review; it is the artifact
that must never be published.

A full run is 42 items either way. Official comparative claims should cite a held-out run,
and a report always records a seed fingerprint so two runs can be shown to have used the
same instances without disclosing the seed itself.

One consequence is worth stating plainly: a held-out score is only item-identical to
another held-out score produced under the same seed. Runs under different seeds are the
same instrument applied to different instances, so they are comparable in distribution
rather than item by item. Publishing a seed after the fact makes that comparison exact and
retires the seed for future use.

### 1.7 Version identity

A score is always reported with its version tag. `ESAC-GI v1.0` is the comparable unit.
Minor releases rotate content and leave scores comparable; major releases change what the
score means and do not.

---

## 2. How scoring works

### 2.1 From checks to points

```
check fraction  -> item fraction   (check weights are normalised within the item)
item fraction   -> item points     (fraction x the item's point value)
item points     -> category score  (summed, divided by the category's allocation)
category scores -> total out of 75 (summed, divided by 75)
```

Three details matter:

- **Check weights are relative.** Within an item they are normalised, so an item may write
  its checks as 0.2/0.3/0.5 or as 2/3/5 and behave identically. Partial credit is per
  check.
- **The category denominator is its declared allocation**, not the sum of the items that
  happened to run. A category short of items still scores against its full allocation, so a
  missing item cannot inflate a percentage.
- **The total is always out of 75**, even for a subset run, and a subset run is labelled
  as incomplete rather than scored as a poor full run.

### 2.2 Passing

A model must reach **60 percent in every category and 60 percent overall**, and both
conditions are required, so a strong average does not rescue a weak category.

| Basis | Threshold |
|---|---|
| A 10-point category | 6.00 / 10 |
| The 5-point category | 3.00 / 5 |
| Overall | 45.00 / 75 |

The comparison carries a tiny tolerance (`1e-9`), because item weights are fractional and a
category that scores exactly 60 percent mathematically can accumulate to 0.5999999 in
binary floating point.

### 2.3 Verdicts

| Verdict | Meaning | Exit code |
|---|---|---:|
| `PASS` | Complete run under the pinned judge, both conditions met | 0 |
| `FAIL` | Complete run under the pinned judge, a condition missed | 1 |
| `INCOMPLETE` | Items were skipped, so no comparable full-suite score exists | 1 |
| `NOT VALID` | The judge was not the pinned judge, so no verdict is given at all | 3 |

An infrastructure failure aborts the run with exit code 2 and no report, so an outage is
never reported as a low score.

### 2.4 What "no verdict" means

The judge decides the writing category outright, and with the dual gate that decides the
whole verdict. A substituted judge therefore changes the instrument rather than the
measurement, and the run is reported as `NOT VALID` instead of pass or fail. The 60 points
that do not depend on a judge are still measured and reported.

### 2.5 The graders

| Grader | Accepts | Used by |
|---|---|---|
| `exact` | a normalised string match against one of several accepted answers | (available; not used by v1.0 items) |
| `numeric` | a number within a tolerance, extracted from the response | math, some factual and reading items |
| `regex` | a pattern match, with forbidden patterns to reject | (available; not used by v1.0 items) |
| `contains` | required, optional, and forbidden substrings | some factual items |
| `programmatic` | an arbitrary structural check over the raw response | logic, much of factual, reading, abstraction, instruction |
| `judge` | a weighted rubric scored by the pinned judge | writing, response-depth |

Two properties of the deterministic graders are worth knowing:

- **Answer extraction is conservative.** A numeric answer is a labelled value where one is
  present (`answer:`, `total =`), otherwise the last number stated. A multiple-choice letter
  is only extracted from an explicit answer cue, a response that is nothing but a letter, or
  a letter terminating a response of twelve words or fewer. It deliberately does not scan
  prose for a stray letter, because the pronoun "I" and the article "A" are both legitimate
  option letters, and several items have options that literally begin with a letter word.
- **Judge output parsing is tolerant but strict about content.** A judge reply is accepted
  as a bare JSON object, a fenced block, or an object embedded in a sentence. A reply with
  no recoverable scores is an infrastructure failure, not a zero.

### 2.6 Judge rubrics

Every judge criterion is scored 0 to 4 by the pinned judge, and the criterion weights are
normalised by the harness rather than by the judge, so a rubric can be edited without the
judge having to reason about relative importance.

```
criterion fraction = score / 4
item fraction      = sum of (criterion fraction x criterion weight)
                     / sum of criterion weights
```

---

## 3. Category reference

### 3.1 Logic & deduction

**10 points, 5 items, deterministic, 2 points each.** Every item is all or nothing: one
check, weight 1. The answers are computed, not stored, and the distractors are the
converse, obverse, and weakened variants that surface reasoning produces.

| Item | Points | What it measures | Check |
|---|---:|---|---|
| `logic.seating` | 2 | Constraint satisfaction over a linear order; several relational clues must be propagated to force one placement. | `answer` (programmatic, 1) |
| `logic.knights` | 2 | Self-referential truth assignment; requires reasoning about the fixed point between a speaker's honesty and what they said. | `choice` (programmatic, 1) |
| `logic.syllogism` | 2 | Formal entailment rather than plausibility. Entailment is decided by enumeration over all models, so the answer is whatever is actually forced. | `choice` (programmatic, 1) |
| `logic.ranking` | 2 | Transitive ordering under partially redundant clues, where the answer sits in the middle and needs the full chain. | `answer` (programmatic, 1) |
| `logic.grid` | 2 | Joint constraint solving across two bijections. The subject is picked to have no direct assertion about them, so elimination is required instead of retrieval. | `choice` (programmatic, 1) |

### 3.2 Math reasoning

**10 points, 5 items, deterministic, 2 points each.** Every item is one numeric check with
tolerance 0, so the answer must be exact. Each is built so that the obvious shortcut
produces a plausible wrong integer.

| Item | Points | What it measures | Check |
|---|---:|---|---|
| `math.crt` | 2 | Simultaneous congruences. Taking the remainder of the product of remainders is the trap; instances where the shortcut coincides are rejected at generation. | `answer` (numeric, 1) |
| `math.modpow` | 2 | Modular exponentiation with an exponent too large to expand. Remainders of 0 and 1 are rejected, since they can be guessed. | `answer` (numeric, 1) |
| `math.divisors` | 2 | Divisor enumeration under a classification label. The label invites a yes/no shortcut, but the question asks for the sum. | `answer` (numeric, 1) |
| `math.pipes` | 2 | Two-phase rate accounting. Applying the net rate across the whole duration is wrong unless the phase boundary is handled. | `answer` (numeric, 1) |
| `math.packing` | 2 | Small integer program under two binding constraints, drawn from a verified pool in which greedily taking the best value-per-unit ratio is strictly suboptimal. The pool's defining property is re-verified by the test suite. | `answer` (numeric, 1) |

### 3.3 Factual knowledge

**10 points, 10 items, deterministic, 1 point each.** Every answer is uncontested: facts
with genuinely disputed answers are excluded, because a benchmark that grades a defensible
answer as wrong is measuring its own editorial choices. Graders are chosen so that
formatting does not decide the point.

| Item | Point | What it measures | Check |
|---|---:|---|---|
| `factual.element-symbol` | 1 | Chemical symbols, including those that do not follow the English name. | `answer` (contains, 1) |
| `factual.capital` | 1 | Capital cities, favouring countries where the largest city is not the capital. | `choice` (programmatic, 1) |
| `factual.planets` | 1 | Solar-system ordering combined with a well-established planetary property. | `choice` (programmatic, 1) |
| `factual.vertebrate-class` | 1 | Biological classification at class level, using uncontroversial animals. | `choice` (programmatic, 1) |
| `factual.noble-gas` | 1 | Periodic-table group membership, where surface similarity to other non-metals is the trap. | `choice` (programmatic, 1) |
| `factual.si-unit` | 1 | Physical quantity to named SI unit, including derived units with personal names. | `choice` (programmatic, 1) |
| `factual.language-family` | 1 | Historical linguistics, where the correct answer is often counter-geographical. | `choice` (programmatic, 1) |
| `factual.history-year` | 1 | Dated historical recall, answered numerically so the grader is exact rather than a string match. | `answer` (numeric, 1) |
| `factual.literary-author` | 1 | Author to work attribution, graded on a normalised surname so accents and naming conventions do not decide the point. | `answer` (contains, 1) |
| `factual.chemistry-formula` | 1 | Molecular formula recall, graded structurally so subscript formatting and element order do not decide the point. | `answer` (programmatic, 1) |

### 3.4 Reading comprehension

**10 points, 5 items, deterministic, 2 points each.** Each item carries a passage, and the
work is locating the relevant material rather than the reading itself.

| Item | Points | What it measures | Check |
|---|---:|---|---|
| `reading.literal-detail` | 2 | Direct retrieval of a stated quantity, where the wrong options are other quantities from the same passage. | `choice` (programmatic, 1) |
| `reading.arithmetic-inference` | 2 | Combining two stated figures that the text never combines. The arithmetic is trivial; locating the operands is the work. | `answer` (numeric, 1) |
| `reading.temporal-order` | 2 | Reconstructing a chronology from dates scattered through the passage rather than presented as a list. | `choice` (programmatic, 1) |
| `reading.scope` | 2 | Distinguishing claims the passage supports from a claim adjacent to the topic but absent from it. | `choice` (programmatic, 1) |
| `reading.position` | 2 | Inferring the position the passage implies rather than one the reader might hold; the wrong options are positions the passage is consistent with but does not adopt. | `choice` (programmatic, 1) |

### 3.5 Abstraction / pattern recognition

**10 points, 5 items, deterministic, 2 points each.** Five distinct mechanics rather than
five variations of one, and each is built so the rule must be inferred before it can be
applied.

| Item | Points | What it measures | Check |
|---|---:|---|---|
| `abstraction.grid-rule` | 2 | Inductive rule extraction from two complete rows, then application to a third. The rule must be found before it can be used. | `choice` (programmatic, 1) |
| `abstraction.analogy` | 2 | Relational mapping where surface association is the trap; distractors share a topic with a term but not the relation. | `choice` (programmatic, 1) |
| `abstraction.sequence` | 2 | Second-order sequence completion. Every distractor is the value produced by a simpler rule that fits the visible terms. | `choice` (programmatic, 1) |
| `abstraction.odd-one-out` | 2 | Identifying a shared abstract property rather than a shared topic, where that property is not named in the prompt. | `answer` (programmatic, 1) |
| `abstraction.matrix` | 2 | Two-dimensional rule inference. Both axes matter, so a rule fitted to one axis produces one of the distractors. | `choice` (programmatic, 1) |

### 3.6 Instruction-following

**10 points, 5 items, deterministic, 2 points each.** These are the only items with
fractional credit inside a single item, because the constraints are joint: satisfying three
of four is the common failure, and the score should say so. Every check is programmatic,
and each is weighted within the item.

| Item | Points | Check | Weight | Criterion |
|---|---:|---|---:|---|
| `instruction.formatted-extraction` | 2 | `line-count` | 0.20 | Exactly the stated number of non-empty lines. |
| | | `no-extra-prose` | 0.20 | No preamble, heading, code fence, or trailing explanation. |
| | | `ordering` | 0.30 | Lines in descending value order. |
| | | `values-correct` | 0.30 | Each name paired with its own value. |
| `instruction.constrained-sentence` | 2 | `single-sentence` | 0.15 | Exactly one sentence. |
| | | `word-count` | 0.25 | Within the stated word budget. |
| | | `forbidden-word` | 0.20 | None of the banned words appear. |
| | | `starts-with-subject` | 0.20 | Begins with the required subject. |
| | | `contains-digit` | 0.20 | Contains a digit as required. |
| `instruction.labelled-list` | 2 | `exactly-three-sections` | 0.20 | Exactly three sections. |
| | | `per-section-word-limit` | 0.30 | Every section within its own limit. |
| | | `content-mentions-topic` | 0.30 | Each section addresses the stated topic. |
| | | `no-bullets` | 0.20 | No bullet characters. |
| `instruction.offset-transform` | 2 | `word` | 1.00 | The precisely specified transformation, where the natural assumption of a forward shift is wrong. |
| `instruction.negative-constraints` | 2 | `sections-present` | 0.20 | The three required headings, in order. |
| | | `omission-respected` | 0.35 | The forbidden word appears nowhere. |
| | | `no-hedging` | 0.25 | None of the banned hedging words appear. |
| | | `word-budget` | 0.20 | Total length within the stated budget. |

The negative-constraints item is weighted so that omission carries the most, because the
tested behaviour is restraint: models are strongly biased toward supplying extra content,
and the item measures whether the model can refrain.

### 3.7 Writing quality

**10 points, 2 items, judge-graded, 5 points each.** The two tasks differ in kind rather
than being two samples of one skill: one is constrained register and compression, the other
is committed argumentation.

| Item | Points | What it measures |
|---|---:|---|
| `writing.register` | 5 | Register control and compression under a hard formal constraint, from a pool of registers and topics. |
| `writing.argument` | 5 | Committed argumentation under a length constraint, including honesty about the opposing case, with fabricated evidence explicitly penalised. |

Both draw their content from small authored pools rather than from free generation, because
the context *is* the construct here: the register, the topic, and the word budget are
picked from a hand-vetted set, so an instance varies with the seed without ever leaving the
construct it was written to test. Criteria are in section 4.

### 3.8 Response-depth calibration

**5 points, 5 items, judge-graded.** The category measures whether a model can infer the
appropriate depth of response from contextual cues. No prompt contains any length
instruction; the cue is carried entirely by the situation, and the test suite asserts that
absence, because a prompt saying "be concise" would measure instruction-following instead.

| Item | Points | Weight | What it measures |
|---|---:|---:|---|
| `depth.substantive-a` | 1.111 | 1.0 | Short prompt carrying a genuine information need. Tests whether the context implies that developed explanation is required. |
| `depth.substantive-b` | 1.111 | 1.0 | Question from a non-expert whose stated use of the answer implies depth. |
| `depth.concise-a` | 1.111 | 1.0 | Long, detail-rich prompt whose actual question has a determinate short answer. Tests resistance to matching response length to prompt length. |
| `depth.concise-b` | 1.111 | 1.0 | Elaborate context followed by a decision question; the context is the asker's thinking, not a request for analysis. |
| `depth.boundary` | 0.556 | 0.5 | Genuinely undetermined depth. Scored for coherence at whichever depth is chosen, never for the depth itself. |

The first four items carry the directional test, and the boundary item carries half weight
because both response styles are valid. The category is normalised to its full allocation,
so half weight does not reduce the category total.

---

## 4. Judge-graded criteria

Four rubrics, versioned by id. Changing any of them is a major-version change, because it
changes what a rubric score means. Every criterion is scored 0 to 4 and weighted; weights
below are within their own rubric.

### 4.1 `writing.register.v1`

*Register control and compression. The response must adopt the specified register, obey the
stated sentence-length rule, and convey a concrete situation. Generic fluent prose that
ignores the register must not score well.*

| Criterion | Weight | Scored 4 when | Scored 2 when | Scored 0 when |
|---|---:|---|---|---|
| `register` | 2 | Consistent and idiomatic throughout; it would be at home in the real artefact. | Recognisable but breaks at least once conspicuously. | Not attempted, or overridden by a generic essayistic voice. |
| `constraint` | 2 | Every sentence complies with the stated length rule. | One or two sentences breach it. | The constraint is not observed. |
| `specificity` | 3 | Concrete and particularising; the reader learns something true only of this case. | (1) On topic but with no particularising detail. | Interchangeable content that could describe any topic. |
| `compression` | 2 | Every clause carries information; nothing could be cut without loss. | Readable but several words carry no information. | Noticeable padding, repetition, or filler. |
| `accuracy` | 1 | Grammatically clean and well-formed throughout. | Minor slips that do not impede reading. | Errors that interfere with comprehension. |

Note that `specificity` uses anchors at 0, 1, and 4 rather than 0, 2, and 4, because "on
topic but vague" deserves less than half credit on that criterion.

### 4.2 `writing.argument.v1`

*Committed argumentation. Balanced, non-committal prose that surveys both sides without
choosing must not score well, and neither should a one-sided piece that ignores the
strongest objection.*

| Criterion | Weight | Scored 4 when | Scored 2 when | Scored 0 when |
|---|---:|---|---|---|
| `position` | 3 | A clear position is stated early and consistently maintained. | A position exists but is weakened by equivocation or later contradicted. | Both sides are surveyed without committing. |
| `reasoning` | 3 | At least one line of reasoning is developed with a warrant a sceptical reader could evaluate. | Reasons are named but not developed or connected to the position. | The position is asserted but unsupported. |
| `concession` | 2 | A genuine objection is stated fairly and the position is defended against it. | A concession is mentioned only to be dismissed without engagement. | No counter-consideration is acknowledged. |
| `economy` | 2 | No filler; each sentence advances the argument. | Readable, but several sentences do no work. | Substantial filler; the argument is hard to locate. |
| `no-fabrication` | 2 | No fabricated specifics; any illustration is clearly hypothetical or general. | A vague quantity or attribution is presented as fact. | Invented figures, studies, dates, or quotations are presented as established fact. |

### 4.3 `depth.substantive.v1`

*Applied to the two items where a developed response is appropriate. A dismissively short
answer that technically touches the question is a failure of depth calibration.*

| Criterion | Weight | Scored 4 when | Scored 2 when | Scored 0 when |
|---|---:|---|---|---|
| `answered` | 3 | Addresses the question fully enough to be acted on. | Answers some of it, leaving the central need unmet. | Does not answer, or is empty or evasive. |
| `depth-fit` | 3 | Developed to the depth the situation calls for, with the key steps or reasoning present. | Correct in outline but missing steps the situation requires. | A dismissively brief answer where real explanation was needed. |
| `no-padding` | 1 | Every part contributes to the answer. | Includes some restatement or hedging. | Length is padding rather than substance. |

### 4.4 `depth.concise.v1`

*Applied to the two items where a brief response is appropriate. Delivering an essay where a
direct answer was needed is a failure of depth calibration.*

| Criterion | Weight | Scored 4 when | Scored 2 when | Scored 0 when |
|---|---:|---|---|---|
| `answered` | 3 | Gives the requested decision, value, or confirmation directly. | The answer is present but obscured or non-committal. | Empty, or withholds an answer that was available. |
| `depth-fit` | 3 | Answers precisely and stops. | Correct, but padded with context and caveats the situation did not call for. | An essay or structured breakdown where a brief answer was needed. |
| `not-curt` | 1 | Brief and complete at its own scale. | Brief to the point of uncertainty. | So terse it does not stand alone as an answer. |

Both depth rubrics carry a heavily weighted "answered the actual question" criterion at the
same weight as the depth criterion. That is deliberate: a rubric that rewarded brevity
alone would be won by an empty response, and one that rewarded detail alone would be won by
padding.

---

## 5. What the tests guarantee

The claims above are not documentation promises. The test suite asserts them, including:

- the bank matches this distribution exactly, item counts and point weights included;
- every reference answer scores 100 percent on its own checks, and a non-answer never does;
- the shortcut answer for every trap item is rejected, whether at generation or by explicit
  assertion: greedy packing totals, the single-phase rate, the naive product of remainders,
  and each non-odd member of the odd-one-out item;
- near-miss numeric answers are rejected, and choice extraction reads "I think the answer is
  B" without mistaking the pronoun for an option letter;
- depth prompts contain no explicit length instruction, and the boundary item carries half
  weight without distorting the category total;
- judge output is accepted as bare, fenced, or embedded JSON, is clamped to the rubric
  scale, and is an infrastructure failure rather than a zero when unusable;
- the 2x2 replication, the model-failure versus infrastructure-failure split, and the retry
  accounting behave as specified;
- a perfect run scores exactly 75/75, exactly 60 percent passes while 59 percent fails in
  every category simultaneously, and a strong average still fails when one category is
  below threshold.

Run `npm test` to check all of it offline.
