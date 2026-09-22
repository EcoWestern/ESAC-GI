# ESAC Benchmark — Design Spec

**EcoWestern Short and Cheap Benchmark**
Suites: **ESAC-GI** (General Intelligence) · **ESAC-AG** (Agentic)
Both scored out of **75**. Full names follow the pattern *"EcoWestern Short and Cheap [Suite] Benchmark, Version [#]"* — shortened as *ESAC-[Suite] v[#]*, e.g. **ESAC-GI v1.3**.

---

## Core tenets

1. **Short ≠ easy.** Cost and time come from token volume and wall-clock, not from difficulty. A single-line answer can require a huge amount of correct internal reasoning to reach. Optimize for *compressed difficulty* — small I/O, hard problem.
2. **Deterministic scoring wherever the task allows it.** Exact-match, regex, unit tests, state-diffs. Judgment-based grading is the exception, not the norm, and every exception is a cost and a reproducibility risk.
3. **No single vendor grades anyone.** Rubric-graded items are scored by a small, open-weight, self-hostable model (e.g. gpt-oss, GLM, DeepSeek), version-pinned per release. Anyone can rerun a score locally without an API key from the company being tested.
4. **The public item set is a self-check, not the scoreboard.** Vendors *will* see it and *will* be tempted to train toward it. Structure the benchmark so that doing so doesn't actually move the number that matters (see contamination resistance below).
5. **Every score is meaningless without a version tag.** "58/75" means nothing on its own — it means something as "58/75 on ESAC-GI v1.3."

---

## Shared architecture (both suites)

**Scoring format.** Report three things together, always:
- Total /75
- Per-category subscore, both raw and normalized to % (so a 10-pt category and a 5-pt category are visually comparable — raw points alone will mislead people into overweighting big categories)
- A version tag

A simple radar/bar chart of the eight category percentages next to the raw total is the whole point of doing this cheaply — the total tells you if a model is good, the breakdown tells you *why*.

**Run ordering.** Order items cheapest-and-fastest-first, categories interleaved rather than blocked. Two reasons:
- If the harness or the API connection is broken, you find out on item 1, not after burning through 40 items.
- A live running tally (score-so-far, printed after every item) gives you the progress feedback a 5-hour test can't — because each item resolves in seconds, "is this still working" is answered by watching the counter move, no special infra needed.

**Replication protocol.** Pin decoding params (temperature, top_p) in the spec itself, not per-run. Run each item some small fixed number of times (1 for deterministic tasks, 3 with majority-vote for anything with model-side stochasticity) — document which items get which treatment so a third party's rerun is comparable to yours, not just "close."

---

## Contamination resistance

This is the part that keeps the benchmark honest, and it needs to be load-bearing from v1.0, not bolted on later:

- **Parametrized items, not fixed strings.** Most items should be templates with swappable surface details (names, numbers, entity order, distractor content) so the *pattern* is public but the *exact instance* a model sees in any given run is regenerated. Memorizing "the answer to item 14" stops being possible; the model has to actually do the task class.
- **Public set vs. held-out verification set.** Split the bank roughly 70/30. The public 70% is what anyone downloads and runs for their own directional signal — expect it to get optimized against over time, and that's fine, that's not where the real claim comes from. The held-out 30% (plus its scoring keys) stays private, used only for runs you or a trusted third party execute directly against a vendor's model. Official comparative claims should always cite a held-out-set run, never a pure public-set run.
- **Rotation.** Each versioned release swaps some fraction (start with ~20%) of the public item pool. A model that scores suspiciously higher on the public set than the held-out set is a visible, publishable signal of overfitting to the benchmark itself — arguably one of the more useful things this project can surface.
- **Canary strings.** Embed a unique, greppable marker string in the public repo's raw item files. If a future model completes canary-adjacent text unprompted, that's evidence the item leaked into a training corpus — useful for flagging when a public item needs retiring, not just rotating.

---

## Keeping items hard despite being short

Concrete techniques, not just a principle:
- **Long-to-think, short-to-answer.** Modeled on GPQA-style design — the correct answer is one token or one line, but getting there requires real reasoning, not pattern-matching the surface form of the question.
- **Tight step/tool-call budgets in the agentic suite.** Fewer allowed steps is what makes a toy environment hard, not a bigger environment. A 5-step budget on a small mock filesystem is harder to satisfy cleanly than a 50-step budget on a big one, and it's still cheap.
- **Adversarial distractors, not just questions.** A short prompt with a well-placed wrong-but-plausible answer choice does more work than a longer prompt with an obvious answer.
- **Calibration items are difficulty for free.** A trick question a model *should* refuse to answer confidently costs nothing extra to run and directly tests something a plain accuracy score can't.

---

## ESAC-GI — General Intelligence, /75

| Category | Pts | Format | Grading |
|---|---|---|---|
| Logic & deduction | 10 | 5 items, constraint/syllogism puzzles | exact-match |
| Math reasoning | 10 | 5 items, arithmetic → moderate word problems | numeric exact-match |
| Factual knowledge | 10 | 10 items, broad domain spread | exact/regex |
| Reading comprehension | 10 | ~200-word passage + inference questions | exact-match |
| Abstraction / pattern recognition | 10 | small grid/analogy puzzles | exact-match |
| Instruction-following | 10 | precise format/constraint tasks | programmatic check |
| Writing quality | 10 | 2 constrained short-writing tasks | open-weight judge, fixed rubric |
| Calibration | 5 | trick/unanswerable questions | exact-match on hedge-vs-confabulate |

~42 items, each prompt/response well under 500 tokens. Full run: low tens-of-thousands of tokens, well under a dollar even against a frontier model's API pricing.

---

## ESAC-AG — Agentic Work & Capability, /75

Runs against a small, deterministic, redistributable *mock* environment (toy filesystem, mock API with canned/state-machine responses, mock shell) — never live services. This keeps runs cheap, flake-free, and fully reproducible from the repo alone, with no external dependency to go stale.

| Category | Pts | Format | Grading |
|---|---|---|---|
| Tool-call correctness | 10 | 5 mock-API tasks, right tool/right params first try | exact match on call |
| Bounded multi-step planning | 10 | 2–3 tasks, tight step budget to reach goal state | state-diff, partial credit |
| Code gen + execution | 15 | 3 tasks, write → run against hidden tests, limited fix attempts | test pass/fail |
| Error recovery | 10 | 2 tasks, given a failing script/trace, diagnose and fix | test pass/fail |
| State tracking across steps | 10 | 2 multi-turn tasks requiring correct recall of earlier tool output | exact/state-diff |
| Ambiguity handling | 5 | 3 underspecified tasks — ask vs. guess sensibly | open-weight judge, fixed rubric |
| Injection/safety resistance | 10 | 5 items, malicious instructions embedded in tool output | did it comply or flag |

That's 70 of 75 — leaving **5 points as an efficiency modifier** rather than a separate category: within the task categories that have a step/tool-call budget, full points require hitting the reference solution's step count; solving correctly but inefficiently earns partial credit within that task's own point allocation, rather than bolting on a redundant category. Cleaner than a standalone "efficiency" line and avoids double-counting the same run.

Each task capped at a small fixed number of tool-call turns (10–15 max) so no single item can silently balloon into a long-running loop — this is what keeps "agentic" from re-becoming "5-hour test" by accident.

---

## Open decisions for when the suites get built

- **Judge model pinning:** pick one fixed open-weight judge version per benchmark release (e.g. "ESAC v1.0 uses GLM-4.6 as judge, pinned") so rubric scores don't drift silently when the judge model itself gets updated upstream.
- **Ensemble judging:** worth deciding whether rubric items get scored by one judge model or two-out-of-three voting, to damp single-model idiosyncrasy on the writing/ambiguity categories specifically.
- **Held-out set custody:** who actually runs verification-set evaluations for published claims — a single maintainer, or a small trusted-third-party rotation? This affects how much people trust the numbers on release day.