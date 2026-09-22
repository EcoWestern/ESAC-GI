# Security policy

## Reporting a vulnerability

Do not open a public issue for a security concern. Report it privately through
GitHub's advisory channel:

https://github.com/EcoWestern/ESAC-GI/security/advisories/new

This is a best-effort project with no bug bounty and no response SLA. Reports are
read and taken seriously. Please allow a reasonable window for a fix before any
public disclosure.

## What counts as a security issue here

This repository ships an evaluation harness. It runs no servers and processes no
user data, so the realistic risks are not the usual web-application ones. The
following are genuine vulnerabilities:

- **Held-out seed or key disclosure.** The held-out pool is only meaningful while
  its seed stays private (`amendment 001 §3`). Any path that causes the
  held-out seed, a held-out scoring key, or held-out instance text to be written
  into a committed file, a log, or a public report.
- **Canary exposure.** The canary string in `src/version.ts` exists to detect
  benchmark contamination. Evidence that it, or adjacent item text, has entered a
  training corpus is worth reporting, and may justify retiring the affected item.
- **Score misreporting.** A defect that makes an infrastructure failure look like
  a model failure (or the reverse), that lets a response earn points without
  satisfying the check, or that misattributes a check to the wrong item.
  Resolution 8 is explicit that an evaluation-system failure must never be
  reported as a low score.
- **Judge manipulation.** A model response that talks the judge into inflated
  scores for a non-answer. If you have a working example, it is a vulnerability in
  the judging methodology rather than a curiosity.
- **Credential handling.** Adapter specs name an environment variable rather than
  holding a key inline. Anything that prints, logs, or writes an API key to a
  result file is a bug.

## Out of scope

- A model scoring badly. That is a result, not a vulnerability.
- Disagreement with the passing threshold, the category weights, or the item
  selection. Those are design decisions; use the **Methodology question** issue
  template instead.
- Vulnerabilities in Node.js, or in the models being evaluated. Report those
  upstream.
- A public pool item being inferable from the public pool. That is expected: the
  public pool is a self-check surface, not the scoreboard.

## What happens next

- The report is confirmed and assessed.
- If it is a benchmark-integrity issue, the maintainers decide whether items need
  rotating (a minor-version change) or scoring needs changing (a major-version
  change, per `amendment 001 §9`).
- Once a fix is available, it is released with a changelog entry. Reporters are
  credited unless they prefer otherwise.
