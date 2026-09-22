# Contributing

ESAC-GI is published as a source-available benchmark. The source is here to be
read, run, audited, and forked. **Pull requests are not accepted**, and they are
closed without review.

That is a policy decision about the instrument, not a judgement of any individual
piece of work. It is load-bearing for the benchmark:

- **Auditable lineage.** A published score has to be traceable to a specific,
  trusted revision. If item generators, graders, or scoring rules could change
  through external pull requests, "58/75 on ESAC-GI v1.0" would not reliably mean
  the same thing twice.
- **Held-out custody.** Part II §3 of `specs/spec.md` puts hidden evaluation
  material under a small, accountable set of maintainers. An open merge path
  would weaken that control for no corresponding gain.
- **Version integrity.** Part II §9 makes any change to scoring, judging, or
  pass criteria a major-version change. Accepting external patches to those areas
  would force major-version increments for changes nobody asked to be made.

## What is welcome

### Bug reports

If you find a defect in the harness, a grader, the CLI, the adapters, or the
documentation, open an issue using the **Bug report** template.

### Item challenges

If an item is wrong, ambiguous, guessable, or measures something other than what
its category claims, open an issue using the **Item challenge** template. This is
the most valuable report the project can receive, and it is treated seriously.

Actionable evidence includes:

- the item id (run `npm run esac -- list` to see the full bank);
- the split and dataset seed you generated under (the public seed is disclosed in
  `src/version.ts`; never paste a held-out seed);
- the instance fingerprint from `esac inspect <itemId>` or the run output;
- the model, decoding parameters, and run command used;
- the response you got, the response you expected, and the derivation.

"This item feels easy" cannot be acted on. "This item has a shortcut, here is the
shortcut, here is a fingerprint it beats" usually can.

### Forks

The MIT licence permits forking, and forks are the intended path for anyone who
wants to change what the benchmark measures: different generators, different
rubrics, different categories, different thresholds.

If you publish results from a fork, do not label them ESAC-GI scores. The version
tag exists so a number can be traced to the instrument that produced it. Retarget
or rename your instrument, keep its own version tag meaningful, and cite this
repository as the origin.

## Running the project locally

Requires Node 22.6 or newer. There are no runtime dependencies; Node runs the
TypeScript directly through native type stripping.

```bash
npm install                # dev dependencies only (typescript, @types/node)
npm run typecheck          # tsc --noEmit
npm test                   # the full test suite, offline
npm run esac -- list       # the item bank and point allocation
npm run esac -- selftest   # harness self-check, offline
npm run esac -- inspect <itemId>
```

The `npm run esac --` form is the reliable way to invoke the CLI from a clone. A
global `esac` command only exists if you have linked the package yourself.

A dry run of the full pipeline, which measures nothing but exercises everything:

```bash
npm run esac -- run --model oracle --judge oracle
```

## Dependency updates

Automated dependency updates (Dependabot) are handled directly by the maintainers.
They do not go through the external contribution path, because they touch only the
dev toolchain. The suite has zero runtime dependencies, so this surface is small
by design.
