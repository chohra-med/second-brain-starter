# Memory: one home per fact

A project keeps what an agent must remember in `.memory/`. Each fact lives in exactly one file. Every other file links to that file and never copies it, so a change has one place to land and nothing contradicts itself.

## The five roles and their homes

| Role | What it holds | Its one home |
|---|---|---|
| Product | What the project is, who it is for, what it must do | `.memory/10-product.md` |
| Decisions | Choices made, with the reason and the date | `.memory/60-decisions.md` |
| Active | What is being worked on right now | `.memory/40-active.md` |
| Progress | What is done and what is next | `.memory/50-progress.md` |
| Lessons | What went wrong or right and the rule it produced | `.memory/80-feedback.md` |

Other core files: `00-description.md` and `01-brief.md` (what and why, in short), `20-system.md` (how the parts fit), `30-tech.md` (commands and tools), and `70-knowledge.md` (reference facts that other work depends on).

## Page shape

- Hot and Warm files have `## Current truth` first, then `## Log`.
- `## Current truth` is rewritten in place. It holds at most 12 lines of what is true now, and it cites the Log entries it rests on.
- `## Log` holds dated `### YYYY-MM-DD` entries, newest first. Append only.
- Cold files (`00-description.md`, `01-brief.md`, `10-product.md`) are short and have no Log.

## When a Hot file is full

- `doctor` reports the size of each Hot file in its `memory` object. It warns at 3,200 bytes and reports OVER above 4,000 bytes. The warning is advisory and does not change the exit code.
- When a Hot file is full, move settled Log entries out, unchanged and with their date heading. Lessons go to `70-knowledge.md`, decisions to `60-decisions.md`, and anything else to `.memory/archive/YYYY-MM.md`.
- Never delete a fact. Rewrite only `## Current truth`, so it stays true after the move.

## Index freshness

- The index record is `ai_rules/context_map.md`, when its integrity marker is valid: its `Scan complete` and `Source HEAD` lines. A hand-written map gets the JSON inventory instead (`ai_rules/project_inventory.json`).
- `doctor` compares the record's commit with the folder's git HEAD: CURRENT, or STALE when HEAD has moved since the index ran.
- A HEAD that moved only through the index's own two files, `ai_rules/context_map.md` and `ai_rules/project_inventory.json` (for example a commit that records the map), stays CURRENT. Any other change, including a commit that touches a rule module under `ai_rules/`, a source file, or a renamed file, makes it STALE. A commit that changes no files is also STALE, as after any commit.
- A rename counts as a delete and an add, so it stays CURRENT only if both paths are the index's own two files. A recorded commit that is missing from local history is STALE.
- A record whose commit is not a full commit id is UNKNOWN and is never sent to git. A repository with any partial-clone or promisor setting (git writes one for a clone made with a filter) is UNKNOWN when HEAD differs. The comparison runs only where git has no promisor remote to fetch missing objects from, so the doctor does not contact a remote. When HEAD differs, a repository whose git config cannot be read is also UNKNOWN. When HEAD differs, a repository converted back to a full clone keeps UNKNOWN until its promisor and partial-clone settings are removed.
- INCOMPLETE is reported before UNKNOWN when the record says the scan did not finish.
- `doctor` reports UNKNOWN when there is no commit to compare (not a git repository, or a folder inside a larger one), when a generated map has a broken marker and no JSON exists, or when the record has no commit, or when a generated map has no Scan complete line.
- Freshness uses git HEAD only. A change that is not committed yet is not seen, so CURRENT does not mean the working tree matches the index.

## Optional memory kinds

Code is the default and needs no extra file. Projects that are not only code can add kind files. The installer stages them under `.claude/spec-harness/memory-kinds/`; `/sdd init` asks which kinds fit and copies the chosen files into `.memory/`. Existing files are never overwritten.

| Kind | File | Holds |
|---|---|---|
| content | `voice-dna.md` | How the writing sounds, with examples |
| content | `audience.md` | Who the work is for and what they need |
| automation | `pipeline.md` | The steps of the automated flow, in order |
| research | `sources.md` | What the claims rest on, with dates and trust |

Each kind file is a PENDING template: it says what goes in it, and what it links to instead of copying. The core files do not change.

## The one-home rule

- Before you write a fact, find its home above. If the home has it, link to it.
- A rule a reviewer checks on every ticket goes in `ai_rules/review-lens.md` (the project lens), naming its source. It does not go in memory.
- Credentials and personal data are never written to memory.
