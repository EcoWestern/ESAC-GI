# ESAC Benchmark — Pre-Build Design Resolutions

The pre-build review identified several issues worth resolving before implementation. The following decisions clarify the intended design without changing the benchmark's central purpose: a short, cheap benchmark that measures difficult capabilities while remaining reproducible and resistant to contamination.

## 1. ESAC-AG remains a 75-point benchmark

The seven ESAC-AG capability categories intentionally total 70 points. The remaining 5 points are an **efficiency modifier**, rather than an additional capability category.

The modifier is deliberately separate from the task scores. A model's capability score reflects whether it successfully completed the task; the efficiency modifier provides a limited additional boost for models that accomplish successful tasks economically.

Efficiency therefore cannot compensate for an unsuccessful task. A task that is not successfully completed receives no efficiency score for that task.

The purpose of the modifier is not simply to reward the fewest possible steps. The desired behavior is **efficient, correct execution without creating downstream problems that require additional work to repair**. An agent that reaches the correct state quickly and cleanly should receive more efficiency credit than one that reaches the same state through unnecessary actions, redundant tool calls, avoidable corrections, or rework.

Each eligible task defines its own internal efficiency scale from 1–6. The benchmark author specifies what efficient successful execution means for that particular task and defines the acceptable solution envelope. The harness performs the objective portions of the calculation, including measurable action/tool usage, token usage, and detectable rework or redundant activity.

Action efficiency is weighted more heavily than token efficiency. The current allocation is 3.5 of the 5 modifier points for action efficiency and 1.5 for token efficiency.

The local 1–6 task score is normalized into the common modifier scale. The task-specific rubric is authored in advance; individual model runs are not manually graded for efficiency.

This allows different types of agentic tasks to have different definitions of efficient behavior without pretending that a universal number of tool calls constitutes efficiency across every environment.

## 2. Calibration is actually response-depth calibration

The original description of calibration was too close to conventional uncertainty calibration and did not reflect the intended construct.

The category instead measures **whether a model can infer the appropriate depth of response from contextual cues**.

Real-world communication does not always explicitly state how much explanation is wanted. A short prompt can require a substantial explanation, while a long prompt can ultimately call for a very short answer. The benchmark therefore tests whether a model can recognize the communicative demands of the situation rather than simply matching response length to prompt length or following an explicit instruction to “be detailed” or “be concise.”

The category contains five items:

* 2 items where a substantive, in-depth response is appropriate;
* 2 items where a concise response is appropriate;
* 1 boundary-case item where either a concise or substantive response can reasonably satisfy the task.

The first four items establish the primary directional test, while the boundary case carries half the weight of a normal item because both response styles may be valid. The category is normalized to its full 5-point allocation when reported.

The grading criterion is therefore not raw response length. A response receives credit when its level of detail is appropriate to the apparent information need, context, and communicative situation.

## 3. The public/held-out split is content-balanced

The 70/30 split is a target rather than an absolute numerical requirement.

The priority is that the held-out set adequately represents the benchmark's content and categories. A mechanically exact 70/30 split is less important than ensuring that every category has meaningful hidden evaluation material.

The public and held-out pools will therefore be constructed deliberately rather than by blindly partitioning the complete item bank. The held-out set may deviate somewhat from exactly 30% when necessary to preserve category and construct coverage.

The public set remains the self-checking and development surface. Official comparative claims continue to rely on held-out verification runs.

## 4. Parametrization is a contamination-resistance principle, not an absolute requirement

The benchmark should avoid dependence on fixed question strings wherever practical.

Objective items should use parametrization, rotation, or equivalent variation when that can be done without changing the underlying capability being tested. The purpose is to prevent memorization of particular answers from becoming an effective strategy.

However, not every item needs to be generated dynamically. Some tasks, particularly writing tasks, may be better represented by carefully authored prompt families than by artificial parameterization.

The requirement is therefore conceptual rather than absolute:

**The benchmark should resist memorization of exact instances wherever reasonably possible while preserving the validity and quality of the underlying task.**

This also means that parametrization should be treated as an implementation feature of applicable item classes rather than assumed to be free. Where an item is parametrized, its generation and scoring logic must be reproducible.

## 5. Model and judge replication are both repeated

For judge-graded tasks, the original replication language is being made explicit.

Both sources of stochasticity are evaluated:

* the evaluated model is run twice on the item;
* each resulting response is judged twice by the pinned judge model.

The resulting scores are averaged into the item's final score.

This separates model-side variance from judge-side variance and avoids using the vague phrase “three runs” without specifying what is actually being repeated.

Deterministic, programmatically scored tasks remain single-run unless the benchmark specification for that task explicitly requires otherwise.

## 6. GI remains deliberately small

The benchmark's shortness is a core design requirement, not an incidental optimization. The solution to the item-count concern is therefore to make the existing approximate count explicit rather than expand the suite simply to increase statistical volume.

The baseline ESAC-GI distribution is:

| Category                          |  Items |
| --------------------------------- | -----: |
| Logic & deduction                 |      5 |
| Math reasoning                    |      5 |
| Factual knowledge                 |     10 |
| Reading comprehension             |      5 |
| Abstraction / pattern recognition |      5 |
| Instruction-following             |      5 |
| Writing quality                   |      2 |
| Response-depth calibration        |      5 |
| **Total**                         | **42** |

This preserves the intended low-cost execution profile while making the item count internally verifiable.

## 7. Writing remains small, but receives repeated evaluation

Writing quality remains a 10-point category based on two distinct constrained-writing tasks.

The category is intentionally small because expanding it substantially would work against ESAC's central short-and-cheap objective. The two tasks should therefore be meaningfully different in their writing demands rather than being near-duplicates.

The replication protocol for judge-graded tasks provides additional response/judgment observations without requiring a much larger authored item set.

The benchmark should treat the writing category as a relatively small sample of writing behavior rather than implying that two prompts constitute a comprehensive evaluation of general writing ability.

## 8. Model failures and infrastructure failures are separate

The harness will distinguish between a valid model response that fails the task and an evaluation that could not actually be completed.

A returned empty answer, ordinary refusal, or model-generated inability response is a model response and is scored according to the task. On a normal answerable item, such a response is incorrect. Where the benchmark explicitly allows an abstention or decline response, the task's scoring rules determine whether it is valid.

By contrast, API errors, transport failures, rate limits, evaluator-side failures, mock-environment failures, or other cases where a valid model response was never obtained are infrastructure failures and are not scored as model errors. They are retried under the same benchmark conditions.

The benchmark therefore does not turn an evaluation-system failure into an artificial zero.

## 9. Versioning is separated into content changes and scoring changes

Versioning is intentionally meaningful.

**Minor releases** cover changes to the benchmark's content and organization that preserve the same underlying measurement and scoring philosophy. This includes item replacement or rotation, new parameterized instances, prompt/content changes, and changes to the internal structure of a section that do not alter how the resulting score fundamentally means.

**Major releases** cover changes that alter the measurement itself. This includes changes to scoring methodology, judging methodology, scoring criteria, category definitions, pass criteria, or other rules that make results meaningfully non-equivalent to previous versions.

Accordingly, results must always be associated with their exact benchmark version.

## 10. Minimum passing criteria are defined from the beginning

ESAC will define a minimum passing threshold from its initial release rather than introducing one after observing model results.

The initial threshold will be **60% for each capability category and 60% overall**.

For a 10-point category, that corresponds to 6/10. For a 5-point category, it corresponds to 3/5. The ESAC-AG efficiency modifier is not itself a capability category and therefore does not have an independent passing threshold.

A model must satisfy both the applicable category thresholds and the overall threshold on the relevant official evaluation to be considered passing.

The passing threshold is part of the benchmark's scoring protocol. A change to the passing standard therefore constitutes a major-version change.

## Result

These resolutions preserve the original ESAC philosophy rather than turning it into a conventional large-scale benchmark.

The benchmark remains short, cheap, deterministic wherever possible, and designed around compressed difficulty. The public set remains useful for self-checking while the held-out set supports stronger comparative claims. Efficiency is rewarded without allowing cheap failure to masquerade as capability, and response-depth calibration measures contextual communication rather than simple instruction compliance.
