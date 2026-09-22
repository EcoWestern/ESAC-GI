# The specs folder

Two different things used to live here. Now only one does.

## scoring.md

[scoring.md](scoring.md) is the operational reference for ESAC-GI: the structure of a run,
how each point is awarded, the check-level criteria for every item, and the full text of the
four judge rubrics. It belongs here because it describes this instrument, and it is the only
document this repository needs in order to explain its own scores.

## The specification

The design specification is **not** here. It lives in the program repository:

**https://github.com/EcoWestern/ESAC**

as a constitution plus numbered amendments. The constitution is the design basis, in numbered
sections, and each amendment is a separate file naming the provisions of the constitution it
supersedes. Where the two disagree, the amendment governs.

It moved there because it specifies both ESAC suites, and because citations have to keep
resolving. A document that is amended in place cannot offer that: a clause rewritten under a
citation silently changes what the citation means, which matters for a benchmark whose
numbers are quoted years later.

## How this repository cites it

| Citation | Refers to |
|---|---|
| `constitution §4` | section 4 of the constitution, in `EcoWestern/ESAC` |
| `amendment 001 §2` | section 2 of the first amendment, there |
| `ESAC-GI v1.0` | this suite's release tag |

Source comments cite it this way, and the numbers are stable on purpose. If a citation here
stops resolving to the clause it names, that is a defect in the amendment that moved it
rather than in the citation, and it is worth an issue: see [CONTRIBUTING.md](../CONTRIBUTING.md).
