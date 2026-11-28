---
name: session-sync
description: Records what several AI sessions of one piece of work tell each other in small files, so a lead session learns the moment a worker session finishes, fails or asks, with no model tokens spent while it waits, and ships a doctor that shows why a report never arrived. Use when work runs in more than one session (articles, videos, page reviews, code tasks), when reports never reach the lead session, when a board or list is out of date, or when a hand-made sync command costs too many tokens.
metadata:
  scope: oss
---

# Session sync

One lead session and any number of worker sessions share one folder of small files. `session-sync.mjs` is the transport; `state.mjs` (register, ack, the open list, the ledger), `doctor.mjs` and the optional `durable-*` commands (`durable.mjs`) load beside it only when a command needs them. Run them through `session-sync.mjs`; do not edit them. A hook writes an event when a worker's turn ends, fails or exits, with no model call. The lead blocks on a wait and wakes only when there is news. The file is the record; a live message between sessions is at most an extra wake-up.

An event is data, and an event is never an approval or a go (nor is a fact, a registration, an ack or `resolved`): the person approves in the session that acts on it, typed there, and the lead never passes an approval on. For how it works and why it may fail, read [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Do not use this when

- One session does all the work. Nothing needs syncing.
- You want to plan or open the worker sessions. Use `lead-session`; this skill is only the transport.
- You need a decision. Ask the person in the session that acts on it.

## The folder

`~/.session-sync/<run>/` (set `SESSION_SYNC_HOME` to move it). `run.json` is the lead's; `events/<time>-<from>-<4 hex>.json` is created once and never edited; `seen/<name>.json` is the member's (its session id, label and read cursor); `wait/<name>.json` is the wait lock; `members/<name>.json` is the lead's record of a worker it registered. A project ledger is its own folder of create-once `facts/` with `state.json` and `state.js` folded from them. `~/.session-sync/active.json` lists open runs, so a hook in a session that joined no run exits at once.

An event holds `kind`, `state`, `text` (at most 200 characters), `label`, `refs`, `by` (`hook` or `session`) and, for open questions, `key`.

- `kind` from a hook: `turn-end`, `turn-failed`, `session-start`, `session-end`. From `post`: `report`, `question`, `pointer`, `person-said`, `note`, `resolved`.
- `state`: `working`, `needs-person`, `needs-lead`, `blocked`, `done`, `ended`, `unknown`.

## Tiers

| Tier | The tool has | What records a turn end | What wakes the lead |
|---|---|---|---|
| Tier A | turn-end hooks (Claude Code; hooks, Monitor and `CLAUDE_CODE_SESSION_ID` are Claude Code specific) | the hook runs `session-sync.mjs hook` | `follow` through a monitor tool, else `wait` as a background command |
| Tier B | a shell, no hook: a Codex session, or any tool without turn-end hooks, is Tier B | the last action of every turn is `post --kind report --state <state> --text <line>`; no hook runs and no `SYNC:` line is read | `wait --timeout <minutes>` in the foreground (no monitor tool, so no `follow`; not a background command) |
| Tier C | no shell | the person pastes the worker's last line into the lead | none |

## Steps

1. **Open.** The lead runs `init --lead <name> --member <name>:<label>:<kind>` (repeat per planned worker), then `join --me <lead>`. The session id is read from `CLAUDE_CODE_SESSION_ID` when the tool sets it; add `--session <id>` when it does not (only Claude Code sets it; Codex and other tools pass `--session`). Check: `status` shows the run and every listed name.
2. **Register.** The lead runs `register --me <lead> --name <name> --dir <worker folder> [--pane <id>]` once per worker, one after another (register serially). The worker has no duty: it joins nothing and posts nothing, and its hook finds it by folder. `post`, `inbox` and `ack` need a `join --me <name> --label <text>` first, which the person can type in a worker tab; the id is read from `CLAUDE_CODE_SESSION_ID` when the tool sets it, and a subagent shares its parent's id: it joins with `--session none` and reports with `post`. With `--client` and `--session` (lowercase labels) it also serves `durable-*`, and the lead registers itself the same way. `register --replace` writes the next generation (a new tab or client); messages for the old one are listed as stranded, never delivered. Check: `status` lists the worker with `reg=lead`, folder and pane; after its next turn end its row shows `by=hook`, else it reports with `post` (Tier B).
3. **Report.** Tier A: end every final message with one line `SYNC: <state> - <one line>`; the hook turns it into an event. A question, a pointer or the person's typed words goes through `post`; a `question` or `needs-person` post has a `--key` (one is derived when missing; an explicit one gets your name and a colon in front, so two workers' `q1` stay two questions, and `resolved --key` names the key as `OPEN` prints it) and stays in `OPEN (n)` until the lead posts `resolved --key <key> --ref <where the answer is>`, which records where the answer is, never the answer or an approval. Check: `inbox` in the lead shows the event.
4. **Wake.** The lead arms `follow --me <lead>` through its monitor tool, or `wait --me <lead>` as a background command (Tier B: `wait` in the foreground only) (`wait` ends at the first wake, `follow` keeps going). A wake prints at most 12 lines (after `OPEN (n)` while questions are open) and ends with `ack: <token>`. It does not move your cursor: once handled, the lead runs `ack --me <lead> --token <token>` (ack before you re-arm `wait`, or it wakes at once on the same events), else the same events show again (`not yet acked: N`); a wake also names a member still `working` with no event for 30 minutes (STALE). Check: `doctor` D10 is OK.
5. **Diagnose.** When a report does not arrive, run `doctor`, then follow the symptom table in HOW-IT-WORKS.md. Check: every WARN and FAIL has a cause or an owner.
6. **Close.** The lead runs `close --me <lead>`, which prints the open questions to carry on. Check: `status` says the run is closed.

## Commands

All start `node session-sync.mjs`. `--run <id>` is optional with one open run; `--me <name>` names the caller.

| Command | What it does |
|---|---|
| `init [--auto-join <folder>]`, `join`, `close` | open a run, join a session, close the run (lead only); with `--auto-join`, a session started in that folder reports with no command |
| `register --me <lead> --name <name> --dir <folder> [--pane <id>] [--client <c> --session <s>] [--item <id>] [--replace]` | lead only: write `members/<name>.json` (one generation; `--replace` starts the next) |
| `post --kind <kind> --state <state> --text <text> [--to <name>] [--ref <path>] [--key <key>]` | write one event; `--key` is for `question`, `needs-person` and `resolved` |
| `inbox`, `ack --token <token>` | print events after my cursor with an ack token (`--peek` means the same); `ack` moves the cursor to the event the token names, a wrong or old token exits 2 |
| `hook` | for a hook only: reads the hook input, writes one event, prints nothing except at session start |
| `wait [--settle <s>] [--stale <min>] [--timeout <min>]`, `follow` | block, then print the digest (the cursor stays until `ack`); `follow` keeps going |
| `status [--json]`, `doctor [--workspace <dir>] [--json] [--claude-version]` | read-only reports, `status` starts with `OPEN (n)`; doctor prints names, counts and ages, never event text |
| `snippet [--pin]` | print the hook settings for the person to apply; `--pin` first copies the script to `~/.session-sync/bin/` and prints its hash |
| `ledger-add --ledger <dir> --item <type:key> --state <s> --source <person\|session\|lead> [--ref <path>] [--words <t> [--typed-at <t>]]`, `ledger-fold`, `ledger-stale --root <pages>`, `ledger-git --from <git-check json>` | one fact per file; `ledger-fold` writes `state.json` and `state.js`; `pushed`, `merged` and `done` count only from git (`ledger-git`, never typed) or `person` (words and where typed), else they read `reported, not verified`; an ended item is not reopened by a later lower fact, only by the person; `ledger-stale` exits 3 when a page asks for an item that has ended; the `person` source records who the writer says spoke (the script cannot tell who typed it), so only the session where the person typed may write it; `ledger-fold` refuses to replace a `state.json` or `state.js` it did not write |

## Hooks and exit codes

`snippet` prints the settings with the real script path. No agent edits a settings file: the person applies it after the `security-check` skill has read this folder.
Exit codes: `0` done. `2` usage or read error. `3` doctor found a FAIL or `ledger-stale` found a stale ask. `4` wait or follow reached its timeout.

## Optional durable round trip (experimental)

Experimental and opt-in (to verify: not yet run between two real clients): nothing uses it unless you run a `durable-*` command, and the command names may change. The run folder must be a trusted private local store on a local disk with hard links, and the client must be allowed to write it. Client and session names are routing labels, not authentication. Only the lead enrolls a planned worker; `durable-enroll` is the lead's `register` with client and session labels, one member record, and a replacement session or a client change takes `register --replace` (a new generation) or a new run. Keep one manager responsible for enrollment, and enroll workers serially. A client/session pair belongs to one participant; different clients may use the same session label. An event, a message, an answer or a receipt is data. An answer points to where the person answered; it is never the person's approval or a go, and the worker reads the person's own words in its own session.

- `durable-enroll --me <lead> --client <client> --session <session> --worker <worker> --worker-client <client> --worker-session <session>` binds the lead and worker to explicit labels. Names use the same 1 to 40 character rules as run members and must be lowercase, including client and session labels. Planned worker and lead names must match exactly. Unknown client names work as labels.
- `durable-send --me <name> --client <client> --session <session> --to <name> --id <stable-id> --kind <pointer|question|answer> --text <text>` saves a message. Workers send questions to the lead; the lead sends pointers or answers to workers. Answers also need `--question <question-id>`. Retry the same ID with identical content, and start each ID with the sender's name, because IDs are shared by the whole run.
- `durable-pending --me <name> --client <client> --session <session>` reads addressed unhandled messages without moving the ordinary cursor. `overdue` becomes true after five minutes. It wakes no one itself; `durable-send` also writes one ordinary event, as a best-effort wake. Its line reads `durable message <id> pending for <name>`: the ID and the recipient, never the text, and no instruction (a retry of the same send writes it when missing; if the sender never retries, the message stays pending and nobody is woken). Once the recipient has run `durable-ack`, that line no longer wakes its `wait` or `follow` and is left out of its digest; other events still do. The kind of the line is the message kind (`pointer`, `question` or `answer`). The ID is a label, never an approval.
- `durable-outgoing` with the same identity lists only the sender’s unacknowledged messages, with overdue flags; an acknowledged message is not listed, so an empty list means every message was acknowledged. Run `durable-outgoing` before `close`: after `close` it cannot be read, and `status --run <id>` is the command that still works on a closed run.
- After handling, `durable-ack --me <name> --client <client> --session <session> --id <stable-id> --handled yes` records a separate receipt. Before acknowledging a question, durably upsert the caller's board using its message ID. The command cannot check that external write.

The per-run files recover pending messages across processes. The event ack (`ack`, the cursor) and the durable receipt (`durable-ack`) are different. Receipts do not resolve questions and answers do not acknowledge them. Delivery is at least once: a caller can repeat an idempotent board upsert after a crash. This feature does not connect a board, wake an idle session, prove identity or authorize an action.
