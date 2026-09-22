# ESAC design specification

**EcoWestern Short and Cheap Benchmark (ESAC)**

Two suites are specified here. **ESAC-GI** (General Intelligence) is implemented in
this repository. **ESAC-AG** (Agentic Work and Capability) is specified but not
implemented here. Both score out of **75**.

Full names follow the pattern *EcoWestern Short and Cheap [Suite] Benchmark, Version
[#]*, abbreviated as *ESAC-[Suite] v[#]*, for example **ESAC-GI v1.0**.

## How to read this document

The specification has two parts, and the split is deliberate.

- **Part I: the original design basis.** The design as first set out, including the
  reasoning behind it and the questions that were still open at the time.
- **Part II: the first amendment.** Ten decisions taken after reviewing Part I and
  before implementation, each resolving a specific ambiguity or gap.

**Where the two disagree, Part II governs.**

Part I is kept rather than flattened into the amendment because the reasoning behind an
instrument is part of the instrument, and because it should be visible what changed and
why. Every amendment in Part II names the clauses it supersedes, and a
[supersession map](#supersession-map) at the end collects those relationships in one
place.

Three words are used with a specific meaning throughout:

- an *item* is one graded prompt that contributes points;
- an *instance* is one concrete realisation of an item under a given dataset seed;
- a *seed* is the deterministic input that selects that realisation.

---

# Part I: the original design basis

> This part records the design as originally specified. It is superseded in specific
> places by Part II, and each affected clause is listed in the supersession map.

## Core tenets

Five principles govern every design decision in both suites.

1. **Short is not the same as easy.** Cost and time come from token volume and
   wall-clock, not from difficulty. A single-line answer can require a great deal of
   correct internal reasoning to reach. The suites optimise for *compressed difficulty*:
   small input, hard problem.
2. **Deterministic scoring wherever the task allows it.** Exact match, regex, unit
   tests, state diffs. Judgment-based grading is the exception rather than the norm, and
   every exception carries a cost and a reproducibility risk.
3. **No single vendor grades anyone.** Rubric-graded items are scored by a small,
   open-weight, self-hostable model, version-pinned per release. Anyone can rerun a
   score locally without an API key from the company being tested.
4. **The public item set is a self-check, not the scoreboard.** Vendors will see it and
   will be tempted to train toward it. The benchmark is structured so that doing so does
   not move the number that matters. See
   [contamination resistance](#contamination-resistance).
5. **Every score is meaningless without a version tag.** "58/75" means nothing on its
   own. "58/75 on ESAC-GI v1.0" is a result.

## Shared architecture

Both suites share three architectural decisions.

**Scoring format.** Three things are always reported together:

- the total out of 75;
- the per-category subscore, both raw and normalised to a percentage, so that a
  10-point category and a 5-point category are visually comparable (raw points alone
  mislead people into overweighting the larger categories);
- a version tag.

A bar or radar chart of the category percentages beside the raw total is the point of
reporting cheaply. The total says whether a model is good; the breakdown says why.

**Run ordering.** Items run cheapest-and-fastest first, with categories interleaved
rather than blocked. Two reasons:

- if the harness or the API connection is broken, that is discovered on item 1 rather
  than after burning through 40 items;
- a live running tally, printed after every item, gives the progress feedback that a
  five-hour test cannot. Because each item resolves in seconds, the question "is this
  still working" is answered by watching the counter move.

**Replication protocol.** Decoding parameters (temperature, top_p) are pinned in the
specification itself rather than per run, so that a third party's rerun is comparable
rather than merely close. Part II §5 replaces the original proposal here, which was one
run for deterministic tasks and three runs with majority voting for anything with
model-side stochasticity, with an explicit protocol that separates model-side from
judge-side repetition.

## Contamination resistance

This is what keeps the benchmark honest, and it is load-bearing from v1.0 rather than
bolted on later.

- **Parametrized items, not fixed strings.** Most items are templates with swappable
  surface details (names, numbers, entity order, distractor content), so the pattern is
  public while the exact instance a model sees is regenerated. Memorising "the answer to
  item 14" stops working, because item 14 is a different problem under every seed, and
  the model has to perform the task class rather than recall an answer.
- **Public set and held-out verification set.** The public pool is what anyone downloads
  and runs for a directional signal. It should be expected to be optimised against over
  time, which is acceptable, because it is not where the real claim comes from. The
  held-out pool, together with its scoring keys, stays private and is used only for runs
  that the maintainers or a trusted third party execute directly against a model.
  Official comparative claims should cite a held-out run and never a pure public-pool
  run.
- **Rotation.** Each versioned release swaps a fraction of the public item pool,
  targeting around 20 percent. A model that scores substantially higher on the public
  pool than on the held-out pool is a visible, publishable signal of overfitting to the
  benchmark, which is arguably one of the more useful things this project can surface.
- **Canary strings.** A unique, greppable marker is embedded in the public item files.
  If a future model completes canary-adjacent text unprompted, that is evidence the item
  leaked into a training corpus, which flags that it needs retiring rather than merely
  rotating.

Part II §3 replaces the 70/30 framing above with a content-balanced split, and §4
clarifies that parametrization is a principle rather than an absolute requirement.

## Keeping items hard despite being short

Concrete techniques, not just a principle.

- **Long to think, short to answer.** Modelled on GPQA-style design: the correct answer
  is one token or one line, but reaching it requires real reasoning rather than
  pattern-matching the surface form of the question.
- **Tight step and tool-call budgets in the agentic suite.** A smaller allowed budget is
  what makes a toy environment hard, not a bigger environment. A five-step budget on a
  small mock filesystem is harder to satisfy cleanly than a 50-step budget on a large
  one, and it is still cheap.
- **Adversarial distractors, not just questions.** A short prompt with a well-placed
  wrong-but-plausible option does more work than a longer prompt with an obvious answer.
- **Calibration items are difficulty for free.** A question that a model should decline
  to answer confidently costs nothing extra to run, and it tests something a plain
  accuracy score cannot.

## ESAC-GI: General Intelligence, 75 points

As originally specified:

| Category | Points | Format | Grading |
|---|---:|---|---|
| Logic & deduction | 10 | 5 items, constraint and syllogism puzzles | exact match |
| Math reasoning | 10 | 5 items, arithmetic through moderate word problems | numeric exact match |
| Factual knowledge | 10 | 10 items, broad domain spread | exact or regex |
| Reading comprehension | 10 | passages of roughly 200 words, inference questions | exact match |
| Abstraction / pattern recognition | 10 | small grid and analogy puzzles | exact match |
| Instruction-following | 10 | precise format and constraint tasks | programmatic check |
| Writing quality | 10 | 2 constrained short-writing tasks | open-weight judge, fixed rubric |
| Calibration | 5 | trick and unanswerable questions | exact match on hedge versus confabulate |

Approximately 42 items, each prompt and response well under 500 tokens. A full run is in
the low tens of thousands of tokens, which is well under a dollar even at frontier model
API pricing.

Part II §6 fixes the exact item distribution, and §2 replaces the last category.

## ESAC-AG: Agentic Work and Capability, 75 points

ESAC-AG runs against a small, deterministic, redistributable mock environment: a toy
filesystem, a mock API with canned or state-machine responses, and a mock shell. It never
touches live services, which keeps runs cheap, free of flake, and fully reproducible from
the repository alone, with no external dependency that can go stale.

| Category | Points | Format | Grading |
|---|---:|---|---|
| Tool-call correctness | 10 | 5 mock-API tasks, right tool and right parameters on the first try | exact match on the call |
| Bounded multi-step planning | 10 | 2 to 3 tasks, tight step budget to reach a goal state | state diff, partial credit |
| Code generation and execution | 15 | 3 tasks, write then run against hidden tests, limited fix attempts | test pass or fail |
| Error recovery | 10 | 2 tasks, given a failing script or trace, diagnose and fix | test pass or fail |
| State tracking across steps | 10 | 2 multi-turn tasks requiring correct recall of earlier tool output | exact match or state diff |
| Ambiguity handling | 5 | 3 underspecified tasks, asking versus guessing sensibly | open-weight judge, fixed rubric |
| Injection and safety resistance | 10 | 5 items, malicious instructions embedded in tool output | did it comply or flag |

That is 70 of the 75 points. The remaining 5 points are an efficiency modifier rather
than a separate capability category, described in Part II §1.

Each task is capped at a small fixed number of tool-call turns, 10 to 15 at most, so no
single item can quietly become a long-running loop. That is what keeps the agentic suite
from re-becoming a five-hour test by accident.

## Open questions

Three questions were left open in the original basis.

- **Judge model pinning.** Pin one fixed open-weight judge version per benchmark release,
  so that rubric scores do not drift silently when the judge model is updated upstream.
  The release names one judge version and treats it as fixed.
  *Status: resolved for v1.0. The judge pinned for this release is
  `xiaomi/mimo-v2.6-pro`, an open-weight model chosen for general capability and for an
  absence of bias in its chain of thought in the maintainers' private testing. A run
  under any other judge is reported without a verdict rather than as an ESAC-GI score,
  because the judge decides one of the eight categories and therefore the outcome.*
- **Ensemble judging.** Whether rubric items should be scored by one judge model or by
  two-out-of-three voting, to damp single-model idiosyncrasy in the writing and ambiguity
  categories. *Status: resolved by Part II §5, which adopts repeated judging rather than
  voting.*
- **Held-out set custody.** Who runs verification-set evaluations for published claims:
  a single maintainer, or a small trusted-third-party rotation. This determines how much
  trust the published numbers carry on release day. *Status: still open.*

---

# Part II: the first amendment

Ten decisions taken after reviewing Part I and before implementation. Each one resolves a
specific ambiguity without changing the central purpose: a short, cheap benchmark that
measures difficult capabilities while remaining reproducible and resistant to
contamination.

These sections were written before the document was merged, so the source cites them as
`first-amendment §N`, which means the numbered section below.

## 1. ESAC-AG remains a 75-point benchmark

*Supersedes the efficiency-modifier paragraph in Part I, under "ESAC-AG".*

The seven ESAC-AG capability categories intentionally total 70 points. The remaining 5
points are an **efficiency modifier** rather than an additional capability category.

The modifier is deliberately separate from the task scores. A model's capability score
reflects whether it successfully completed a task. The efficiency modifier provides a
limited additional boost for models that complete successful tasks economically.

Efficiency therefore cannot compensate for an unsuccessful task. A task that is not
successfully completed receives no efficiency credit.

The purpose of the modifier is not to reward the fewest possible steps. The desired
behaviour is **efficient, correct execution that does not create downstream problems
requiring further work to repair**. An agent that reaches the correct state quickly and
cleanly earns more efficiency credit than one that reaches the same state through
unnecessary actions, redundant tool calls, avoidable corrections, or rework.

Each eligible task defines its own internal efficiency scale from 1 to 6. The benchmark
author specifies what efficient successful execution means for that task and defines the
acceptable solution envelope. The harness performs the objective parts of the
calculation, including measurable action and tool usage, token usage, and detectable
rework or redundant activity.

Action efficiency is weighted more heavily than token efficiency. The allocation is 3.5
of the 5 modifier points for action efficiency and 1.5 for token efficiency.

The local 1-to-6 task score is normalised into the common modifier scale. The
task-specific rubric is authored in advance, and individual runs are not manually graded
for efficiency.

This allows different kinds of agentic task to define efficient behaviour differently,
rather than pretending that a universal number of tool calls constitutes efficiency in
every environment.

## 2. Calibration is response-depth calibration

*Supersedes the "Calibration" row in Part I, under "ESAC-GI".*

The original description of calibration was too close to conventional uncertainty
calibration, and it did not reflect the intended construct. The category instead measures
**whether a model can infer the appropriate depth of response from contextual cues**.

Real-world communication does not always state how much explanation is wanted. A short
prompt can require a substantial explanation, and a long prompt can ultimately call for a
very short answer. The category therefore tests whether a model recognises the
communicative demands of a situation, rather than matching response length to prompt
length or following an instruction to "be detailed" or "be concise".

The category contains five items:

- 2 items where a substantive, in-depth response is appropriate;
- 2 items where a concise response is appropriate;
- 1 boundary item where either a concise or a substantive response can reasonably satisfy
  the task.

The first four items carry the primary directional test. The boundary item carries half
the weight of a normal item, because both response styles can be valid. The category is
normalised to its full 5-point allocation when it is reported, so the half weight does
not reduce the category total.

The grading criterion is therefore not raw response length. A response earns credit when
its level of detail is appropriate to the apparent information need, the context, and the
communicative situation. Every rubric in this category carries a heavily weighted
"answered the actual question" criterion, so an empty response cannot win on brevity and
a padded response cannot win on length.

## 3. The public and held-out split is content-balanced

*Supersedes the public and held-out clause in Part I, under "Contamination resistance".*

The 70/30 split is a target rather than an absolute numerical requirement.

The priority is that the held-out set adequately represents the benchmark's content and
categories. A mechanically exact 70/30 split matters less than ensuring that every
category has meaningful hidden evaluation material.

The two pools are therefore constructed deliberately rather than by partitioning the
complete item bank. The held-out pool may deviate from exactly 30 percent where that is
necessary to preserve category and construct coverage.

In practice the harness splits by *instance* rather than by template. The same generator
is instantiated under a public dataset seed and under an evaluator-controlled held-out
seed, which gives every category held-out coverage even where a category has only two
items.

The public pool remains the self-checking and development surface. Official comparative
claims continue to rely on held-out verification runs.

## 4. Parametrization is a principle, not an absolute requirement

*Supersedes the parametrized-items clause in Part I, under "Contamination resistance".*

The benchmark avoids dependence on fixed question strings wherever practical.

Objective items use parametrization, rotation, or equivalent variation where that can be
done without changing the capability being tested. The purpose is to prevent memorisation
of particular answers from becoming an effective strategy.

Not every item needs to be generated dynamically, however. Some tasks, particularly
writing tasks, are better represented by carefully authored prompt families than by
artificial parameterization.

The requirement is therefore conceptual rather than absolute:

> The benchmark should resist memorisation of exact instances wherever reasonably
> possible, while preserving the validity and quality of the underlying task.

Parametrization is an implementation feature of the applicable item classes rather than
something assumed to be free. Where an item is parametrized, its generation and its
scoring logic must both be reproducible, which is why expected answers are computed from
the seed rather than stored.

## 5. Model and judge replication are both repeated

*Supersedes the replication-protocol clause in Part I, under "Shared architecture".*

For judge-graded tasks, both sources of stochasticity are evaluated:

- the evaluated model is run twice on the item;
- each resulting response is judged twice by the pinned judge model.

The four observations are averaged into the item's final score. This separates model-side
variance from judge-side variance, and it replaces the vague phrase "three runs" with a
statement of what is actually being repeated.

Deterministic, programmatically scored tasks remain single-run unless the specification
for that task explicitly requires otherwise.

## 6. ESAC-GI remains deliberately small

*Supersedes the approximate item count in Part I, under "ESAC-GI".*

The benchmark's shortness is a core design requirement, not an incidental optimisation.
The response to the item-count concern is therefore to make the count explicit rather
than to expand the suite for statistical volume.

The ESAC-GI distribution is:

| Category | Items |
|---|---:|
| Logic & deduction | 5 |
| Math reasoning | 5 |
| Factual knowledge | 10 |
| Reading comprehension | 5 |
| Abstraction / pattern recognition | 5 |
| Instruction-following | 5 |
| Writing quality | 2 |
| Response-depth calibration | 5 |
| **Total** | **42** |

This preserves the intended low-cost execution profile while making the item count
internally verifiable. The harness asserts both totals at load time, so a drift in either
is a hard failure rather than a silently wrong score.

## 7. Writing remains small but is evaluated repeatedly

*Clarifies the writing row in Part I, under "ESAC-GI".*

Writing quality remains a 10-point category based on two distinct constrained-writing
tasks.

The category is intentionally small, because expanding it substantially would work
against the central short-and-cheap objective. The two tasks should therefore differ
meaningfully in their writing demands rather than being near-duplicates.

The replication protocol for judge-graded tasks provides additional response and judgment
observations without requiring a much larger authored item set.

The writing category should be read as a relatively small sample of writing behaviour.
Two prompts do not constitute a comprehensive evaluation of general writing ability.

## 8. Model failures and infrastructure failures are separate

*Clarifies the failure handling implied throughout Part I.*

The harness distinguishes between a model response that fails the task and an evaluation
that could not be completed at all.

A returned empty answer, an ordinary refusal, or a model-generated statement of inability
is a model response and is scored according to the task. On a normally answerable item,
such a response is incorrect. Where the benchmark explicitly allows an abstention or a
decline, the task's own scoring rules determine whether it is valid.

The same applies to a model that reaches the item's output budget without producing an
answer. That budget is part of the benchmark definition, like the time budget, and is set
generously enough that it is not what decides a score. Such a response is a model failure,
and it is not retried, because repeating the request under the same budget reaches the same
conclusion.

By contrast, API errors, transport failures, rate limits, evaluator-side failures,
mock-environment failures, and any other case where a valid model response was never
obtained are infrastructure failures. They are not scored as model errors, and they are
retried under identical benchmark conditions. If an infrastructure failure persists, the
run aborts rather than reporting an outage as a low score.

The benchmark therefore never turns an evaluation-system failure into an artificial zero.

## 9. Versioning separates content changes from scoring changes

*Clarifies tenet 5.*

Version numbers are meaningful.

**Minor releases** cover changes to content and organisation that preserve the measurement
and the scoring philosophy. This includes item replacement or rotation, new parametrized
instances, prompt and content changes, and changes to the internal structure of a section
that do not alter what the resulting score means.

**Major releases** cover changes that alter the measurement itself. This includes changes
to scoring methodology, judging methodology, scoring criteria, category definitions, pass
criteria, and any other rule that makes results meaningfully non-equivalent to previous
versions.

Results must always be associated with their exact benchmark version. Scores are
comparable across minor releases of the same major version, and never comparable across
major versions.

## 10. Passing criteria are defined from the beginning

*Clarifies the reporting requirements in Part I, under "Shared architecture".*

The passing threshold is defined from the initial release rather than introduced after
observing model results.

The threshold is **60 percent in every capability category and 60 percent overall**. For a
10-point category that is 6 out of 10; for a 5-point category it is 3 out of 5. Both
conditions are required, so a strong average does not rescue a weak category.

The ESAC-AG efficiency modifier is not itself a capability category, and therefore has no
independent passing threshold.

The passing threshold is part of the scoring protocol, so a change to it is a
major-version change.

## Supersession map

| Amendment | Supersedes or clarifies in Part I |
|---|---|
| 1 | the efficiency modifier paragraph under "ESAC-AG" |
| 2 | the "Calibration" row under "ESAC-GI" |
| 3 | the public and held-out clause under "Contamination resistance" |
| 4 | the parametrized-items clause under "Contamination resistance" |
| 5 | the replication-protocol clause under "Shared architecture" |
| 6 | the approximate item count under "ESAC-GI" |
| 7 | clarifies the writing row under "ESAC-GI" |
| 8 | clarifies failure handling across the suites |
| 9 | clarifies tenet 5 |
| 10 | clarifies the reporting format under "Shared architecture" |

## Result

The amendment preserves the original philosophy rather than turning ESAC into a
conventional large-scale benchmark. The benchmark remains short, cheap, deterministic
wherever possible, and designed around compressed difficulty. The public pool remains
useful for self-checking, while the held-out pool supports stronger comparative claims.
Efficiency is rewarded without allowing cheap failure to masquerade as capability, and
response-depth calibration measures contextual communication rather than instruction
compliance.
