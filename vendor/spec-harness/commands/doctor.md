# Command: `doctor`, a read-only report on one target's setup

> Doctor changes nothing. It reports facts about the setup and never calls a setup READY on its own.
> The shell runs it (`spec-harness doctor <target>`); it needs Python 3.11 or newer.

## Invocation

```text
spec-harness doctor <target>
```

It prints one JSON report. Exit 0 when `structural` is `READY`, 1 when it is not, 2 for a bad target.
Guards (below) never change `structural` or the exit code.

## Fields

| Field | Meaning |
|---|---|
| `structural` | The staged files are present and filled, a startup route is written down and `generate-agents --check` prints READY. |
| `semantic` | Always `NOT_ASSESSED`. Only a separate fresh reviewer can say whether the generated rules are true. |
| `client` | Always `NOT_ASSESSED`. Doctor sees that a route is written down, not that a client follows it. |
| `guards` | Six checks that keep the setup from breaking quietly. Each value is `OK`, `MISSING` or `NOT_APPLICABLE`; `guards_notes` gives one line of reason for each. |
| `paths`, `synthesis_check`, `prerequisites`, `platform` | The evidence behind the fields above. |

## Guards

| Guard | `OK` when | `MISSING` when | `NOT_APPLICABLE` when |
|---|---|---|---|
| `claude_imports_agents` | `CLAUDE.md` contains `@AGENTS.md`, so Claude Code loads the same rules. | `CLAUDE.md` is absent, unsafe or has no import. | There is no `AGENTS.md`. |
| `hook_registered` | `.claude/settings.local.json` has the edit guard entry with the expected matcher (the registrar's own value: the four edit tools) and `.claude/spec-harness/hooks/sdd-gate.sh` is a regular, executable file that is byte-identical to the hook this harness ships (the registrar's own check). | The settings file is absent, unreadable or not valid JSON, has no such entry, the entry's matcher differs from the expected one (some edit tools are then not guarded), or the script is absent, linked or not executable, or differs from the shipped hook (changed, or brought by the repository); the note is then the registrar's refusal, with the steps that fix it. | There is no `.claude/commands/sdd.md`, so the target does not use the Claude Code route. |
| `lens_present` | `ai_rules/review-lens.md` exists. Whether it is filled in is a review matter. | The file is absent or unsafe to read. | Never. |
| `hook_python` | `python3` is on `PATH`, so the hook can decide. | `python3` is not on `PATH`: the hook cannot decide and fails open, allowing every edit. | There is no `.claude/commands/sdd.md`. |
| `runs_current` | No run-state or MICRO `ticket.md` has expired. The note lists the open ones (they allow source edits). | A run-state or an open ticket has not been modified for more than 7 days. The hook ignores it; the note lists it. Close it with the `summary` stage, or delete it. | There is no `.claude/commands/sdd.md`. |
| `memory_complete` | The ten core `.memory/` files are present and are not scaffolds. | Any of them is absent, unsafe or still a scaffold; the note names them. | Never. |

A `MISSING` guard is a to-do for the person, not a failure of the install. Fix the cause (for example
rerun `spec-harness install <target>` to register the hook, or follow the steps in the note when the script
differs from the shipped hook or is not executable, because install keeps an existing file), then run doctor again.

## What doctor does not do

- It does not run the hook or any gate, and it does not write a file.
- It does not prove that Claude Code loaded the hook in a session. A session started in another
  folder loads that folder's settings, not the target's.
- It does not cover Codex or any other client; `client` stays `NOT_ASSESSED`.
