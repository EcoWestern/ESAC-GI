# Rulesets as code

Two rulesets, kept here so the settings are reviewable and versioned rather than living
only in a web form. GitHub does not apply them automatically: nothing in this directory
takes effect on push. Apply them once, by hand, per repository.

## What they do

`main.json` protects the default branch:

| Rule | Effect |
|---|---|
| `deletion` | The branch cannot be deleted. |
| `non_fast_forward` | Force pushes are refused, so a rewritten history cannot silently replace what CI verified. |
| `required_linear_history` | Merge commits are refused, so history stays a readable sequence of one commit per change. |
| `required_status_checks` | The three CI jobs must have passed for the commit. |

`tags.json` protects release tags:

| Rule | Effect |
|---|---|
| `deletion` | A published `v*` tag cannot be deleted. |
| `update` | A published tag cannot be moved to a different commit, so a version tag keeps meaning one specific tree. |

Both rulesets carry a bypass for the repository admin role (`actor_id: 5`). That is
deliberate and it is the part to think about:

- **With the bypass**, the maintainer can still push to `main` directly, which is how this
  project is developed, and CI stays advisory for that role while remaining binding for
  anyone else.
- **Without the bypass**, `required_status_checks` blocks direct pushes entirely, because a
  check cannot have passed on a commit that does not exist yet. That effectively requires a
  pull-request flow, which contradicts the policy in `CONTRIBUTING.md`. Removing the
  `bypass_actors` block is therefore a policy change, not a tightening of one.

Delete the `bypass_actors` array only if the project adopts pull requests.

## Applying them

The check names in `main.json` are the CI job names from `.github/workflows/ci.yml`,
including the matrix value, so they read `Verify on Node 22.x` and `Verify on Node 24.x`.
They must match exactly, and they are only selectable once CI has run on the branch at
least once. To print the real names:

```bash
gh api repos/EcoWestern/ESAC-GI/commits/main/check-runs --jq '.check_runs[].name'
```

Then, with the GitHub CLI authenticated as a repository admin:

```bash
gh api --method POST repos/EcoWestern/ESAC-GI/rulesets --input .github/rulesets/main.json

gh api --method POST repos/EcoWestern/ESAC-GI/rulesets --input .github/rulesets/tags.json
```

Both are single lines on purpose: a trailing backslash is a bash continuation, and pasting
one into PowerShell is a parse error that runs nothing at all.

Or through the interface: **Settings**, then **Rules**, then **Rulesets**, then **New
ruleset**, then **Import a ruleset** and choose the file. The interface also shows the
resulting diff before saving, which is the safer way to do it once.

Verify afterwards, and confirm the enforcement level reads `active` rather than `evaluate`,
which would only report violations instead of preventing them:

```bash
gh api repos/EcoWestern/ESAC-GI/rulesets --jq '.[] | "\(.name) \(.enforcement)"'
```

If the API rejects a rule type, it is the rule, not the file: remove that rule and re-run.
The interface names the equivalent checkbox.
