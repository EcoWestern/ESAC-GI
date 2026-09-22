# Changelog

All notable changes to ESAC-GI are recorded here.

Two version numbers appear in this project and they are not the same thing:

- the **benchmark version** (`ESAC-GI v1.0`, see `src/version.ts`), which is what a
  score is reported against and which governs cross-version comparability; and
- the **repository/package version** in `package.json`, which tracks the code.

Per `specs/spec.md` (Part II §9), a minor benchmark change alters content or
organisation without changing what the score measures; a major change alters the
measurement itself, and scores stop being comparable across it.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Repository rulesets as code.** `.github/rulesets/` carries the default-branch and
  release-tag rulesets as JSON. Pushing them applies nothing: GitHub does not read this
  directory, so each is imported once per repository. The instructions, and the reasoning
  behind the admin bypass that keeps direct pushes to `main` working, are alongside them.
- **A release check.** `.github/workflows/release.yml` runs on a version tag and refuses a
  tag that disagrees with `package.json` or with `src/version.ts`, or that has no changelog
  section, and re-checks that the tagged tree still reproduces the published public pool.
  A published tag cannot be moved, so this is the last point at which a mistake is cheap.
- **`CODEOWNERS`.** Every path is owned by the maintainer, so a fork pull request requests
  review automatically and a ruleset can require it if the policy ever changes.
- **A repository settings checklist** in the README, covering the guarantees that live in
  GitHub rather than in the repository: rulesets, the security features, and private
  vulnerability reporting, without which the reporting link in `SECURITY.md` does not work.
- **The pull request policy is enforced, not just stated.**
  `.github/workflows/close-pull-requests.yml` answers a pull request from outside the
  organisation with the notice in `.github/pull-request-notice.md` and closes it. Members,
  collaborators, and maintainers are exempt. Until now `CONTRIBUTING.md` said pull requests
  were closed without review while nothing actually closed them.

## [1.0.0] - 2026-09-22

The first public source release of ESAC-GI.

### Added

- **Benchmark bank.** 42 items across 8 categories, totalling 75 points: logic and
  deduction, math reasoning, factual knowledge, reading comprehension, abstraction,
  instruction-following, writing quality, and response-depth calibration.
- **Generators rather than stored questions.** Items produce an instance and its
  checks from a deterministic seed, so expected answers are computed. The public
  repository is therefore the distributable artifact.
- **Content-balanced split.** Templates are instantiated under a disclosed public
  seed and an evaluator-controlled held-out seed, so every category has held-out
  coverage without hand-partitioning a small bank.
- **Deterministic harness.** Instance identity depends only on the dataset seed and
  item id, never on the run, so every model in a comparison sees byte-identical
  instances.
- **Grading.** Exact, numeric, regex, contains, programmatic, and judge graders, with
  weights normalised per item and per category.
- **Judge discipline.** Version-pinned rubrics, a tolerant-but-strict response
  parser, and the 2x2 replication protocol (2 model runs, 2 judgments each) for
  judge-graded items. The judge pinned for this release is `xiaomi/mimo-v2.6-pro`,
  an open-weight model chosen for general capability and for an absence of bias in
  its chain of thought in the maintainers' private testing.
- **Pinned-judge enforcement.** The judge pinned for the release is defined in
  `version.ts`, reported by `esac version`, and enforced. A run whose judge is not the
  pinned judge is refused unless `--allow-unpinned-judge` is passed, and such a run
  carries no verdict: it is reported as `NOT VALID` rather than pass or fail, because
  the judge decides a whole category, and it exits with status code 3. Every report
  records whether the pinned judge was used.
- **Output budget handling.** A response cut off by the output cap with no answer produced
  is now reported as a truncated model failure rather than as an unparseable body, and it
  is not retried, since the same budget reaches the same conclusion. The default cap is
  generous enough for models that reason before answering, and `--max-tokens` overrides
  it. Reports say when a cap was reached, and the tokens a capped call did consume are
  still counted rather than dropped from the cost report.
- **Local `.env` support.** A `.env` file in the working directory is loaded before any
  API key is read, and a variable already exported in the environment wins over the file,
  so a CI secret is never shadowed. The file itself is gitignored, and `.env.example`
  documents the shape.
- **OpenAI-compatible client.** Models and judges are both driven through the
  chat-completions shape, so any compatible endpoint works with no provider-specific
  code. An aggregator such as OpenRouter is the recommended route to a hosted
  open-weight judge, since it serves the judge and the model under test behind one key.
- **Failure taxonomy.** Infrastructure failures are retried and never scored; model
  failures and model timeouts are scored. An unrecoverable infrastructure failure
  aborts the run rather than reporting an outage as a score.
- **Scoring and reporting.** Total out of 75, per-category raw and normalised
  subscores, a version tag on every result, and the dual pass condition of 60 per
  category and 60 overall.
- **CLI.** `list`, `inspect`, `export`, `key`, `run`, `auto`, `version`, and an offline
  `selftest`. `auto` is a guided setup that asks for the model, judge, pool, and
  categories, runs the benchmark, reports each section as it completes, and finishes
  with a summary of the overall score, every section, and the notes that qualify the
  number.
- **Separate thinking budget.** `--thinking-tokens <n>` sets the model's reasoning
  allowance where the provider supports one, so thinking stops competing with the answer
  for a single cap. `--extra-body` merges any other JSON object into each model request.
  Both apply to the model under test only; the judge's parameters remain part of the
  pinned configuration.
- **Held-out seed generation.** `esac seed` generates a 256-bit seed, writes it to
  `.heldout/seed` (gitignored, mode 0600), and prints the fingerprint that is safe to
  publish. `esac seed show` reports the path and fingerprint without printing the seed, and
  refuses to replace an existing seed unless `--force` is passed, since replacing one stops
  earlier runs citing it from being reproducible. A held-out run resolves its seed from
  `--seed`, then `ESAC_HELD_OUT_SEED`, then the stored file, and refuses when there is none
  rather than inventing one. Guided `auto` mode offers to generate one where the pool is
  chosen.
- **Tests.** 80 tests asserting the properties the benchmark's claims depend on,
  including that the shortcut answer for each trap item is genuinely wrong, that
  reference answers score 100 percent on their own checks, that thresholds behave at
  exactly the boundary, that a pool name selects no items of its own, and that a generated
  held-out seed produces a complete pool which is not the public one.
- **Written documentation.** `specs/spec.md` carries the design in two parts, the original
  basis and the first amendment that governs. `specs/scoring.md` is the operational
  companion: the structure of a run, how every point is awarded, the check-level criteria
  for all forty-two items, and the full text of the four judge rubrics.
- **Public repository files.** MIT licence, contribution policy, security policy,
  code of conduct, issue templates, CI, and citation metadata.

### Changed

- **`--split both` is gone.** A combined mode could not mean anything: both pools come from
  the same 42 templates, so under one seed the two pools are the same instances, and the
  mode asked every question twice while counting every point twice. One run is now one pool,
  one seed, and one set of instances, so a public-versus-held-out comparison is two runs.
  `--split both` is refused by name, with that explanation, rather than silently treated as
  public, and a pool name now selects which seed a run must resolve.

### Fixed

- **The text renderer no longer throws on an out-of-range fraction.** A category scoring
  above 100 percent overflowed the fraction bar and raised `RangeError: Invalid count
  value` instead of printing the number that explained the problem. Fractions are clamped
  now, so a scoring bug shows up as a wrong figure rather than a crash.

[Unreleased]: https://github.com/EcoWestern/ESAC-GI/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/EcoWestern/ESAC-GI/releases/tag/v1.0.0
