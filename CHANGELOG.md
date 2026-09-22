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
  judge-graded items.
- **Failure taxonomy.** Infrastructure failures are retried and never scored; model
  failures and model timeouts are scored. An unrecoverable infrastructure failure
  aborts the run rather than reporting an outage as a score.
- **Scoring and reporting.** Total out of 75, per-category raw and normalised
  subscores, a version tag on every result, and the dual pass condition of 60 per
  category and 60 overall.
- **CLI.** `list`, `inspect`, `export`, `key`, `run`, `version`, and an offline
  `selftest`.
- **Tests.** 60 tests asserting the properties the benchmark's claims depend on,
  including that the shortcut answer for each trap item is genuinely wrong, that
  reference answers score 100 percent on their own checks, and that thresholds
  behave at exactly the boundary.
- **Public repository files.** MIT licence, contribution policy, security policy,
  code of conduct, issue templates, CI, and citation metadata.

[Unreleased]: https://github.com/EcoWestern/ESAC-GI/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/EcoWestern/ESAC-GI/releases/tag/v1.0.0
