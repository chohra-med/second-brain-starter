# How session sync works, and why it may not

Written for a person or an assistant who must find out why sessions do not hear from each other. It is generic: a lead session, worker sessions, no roles, no tracker, no page.

Marks used below: **verified** means read in the official Claude Code documentation, with the page named. **to verify** means not checked; check it with the self-checks in section 8. Pages: `code.claude.com/docs/en/hooks` (hooks), `code.claude.com/docs/en/cross-session-messaging` (live messages), `code.claude.com/docs/en/tools-reference` (tools).

## Contents

1. The picture
2. Channel worksheet
3. Prerequisites
4. Tiers
5. Token note
6. Hook settings
7. Symptom to cause
8. Self-checks
9. Sending the result back
10. Durable round trip (experimental)
11. Registered members, the ack, the open list and the ledger

The rule that never changes: an event is never an approval or a go. An event tells a session where to look. The person approves, in the session that acts on it.

## 1. The picture

```
 WORKER session                           sync folder (one writer per file)           LEAD session
 turn ends  -- Stop hook ------------->   events/*.json                  ----------->  follow or wait
 API error  -- StopFailure hook ------>   seen/<name>.json (member)                    (blocked, no tokens)
 exits      -- SessionEnd hook ------->   run.json (lead)                               |
 question   -- post ------------------>   wait/<name>.json (lock)                       v
                                                                                       a digest of new events only
 live message = optional extra wake-up, never the record
```

A worker the lead registered has `members/<name>.json` and needs no other file. An optional `durable/` folder (section 10) sits beside `events/` in the same run folder.

- A hook runs a script, not the model. The script writes one small file per event and prints nothing (except at session start).
- The lead blocks inside `wait` or `follow` (a file watch with a slow check every 15 seconds). No model call happens while it is blocked.
- A wake is a digest: events after the lead's cursor, one line each, at most 12 lines, then `+N more`. A digest moves no cursor: it ends with `ack: <token>` and `ack` moves it (section 11).

## 2. Channel worksheet

Fill one row for every way two sessions in your workspace pass information. A channel that stores nothing, or that wakes nobody, is a finding by itself.

| Channel | Writer to reader | What wakes the reader | Where it is stored | What it needs |
|---|---|---|---|---|
| (name it) | | | | |

## 3. Prerequisites

- **Files.** Every session can read and write the sync folder: same computer, not a cloud-synced folder (it makes conflict copies). Node.js 22 or newer. `doctor` D8 checks file permissions only; a sandboxed tool (Codex) can still refuse the write, so the proof is one `post` from that tool.
- **Hooks.** The four hook entries of section 6 are applied in a settings file the session reads, and the session's folder is trusted. verified (hooks page): Claude Code holds back hooks from every settings file, your own user settings included, until the workspace trust dialog is accepted for the folder. A session in a folder you never trusted runs no hook.
- **Hook inputs.** verified (hooks page): `Stop` input carries `last_assistant_message`; `StopFailure` carries `error`; `SessionEnd` carries `reason`; `SessionStart` carries `source`. `Stop` does not run when the person interrupts a turn. API errors fire `StopFailure` instead. Whether `SessionEnd` runs on a killed terminal or a crash: to verify.
- **Hook timing.** verified (hooks page): `SessionEnd` hooks share a 1.5 second budget unless a longer `timeout` is set; the snippet sets 5. An `async` command hook does not delay the session.
- **Session id.** Hooks receive `session_id`, not the session's name. `join` records the pair once; a worker the lead registered is matched by its folder or its session label instead (section 11). Claude Code sets `CLAUDE_CODE_SESSION_ID` for shell commands (seen in 2.1.325); `join` and `init` read it. Inside a subagent it is the parent's id.
- **Background wake.** The assistant's own tool description says a background command re-invokes the session when it exits, and a monitor tool feeds each output line back. Both are to verify on your computer (self-check 3).
- **Live messages** (optional extra). verified (cross-session-messaging page): both sessions on the same machine; the receiver's inbound setting is not `refuse` or `hold`; no deny rule on the send and list tools; the same permission class on both sides or the confirmation is answered within its expiry, else the message is dropped; the session name is the one set with `--name` or `/rename`, and a rename changes the address. A message never counts as the person's consent.
- **Project hooks in another folder.** Whether a hook from a project settings file applies to a session started in a different folder is to verify. User-level settings avoid the question.

## 4. Tiers

The file format is the same in every tier, so tools can share one run. `doctor` D9 shows which members report by hook.

| Tier | The tool has | What records a turn end | What wakes the lead |
|---|---|---|---|
| Tier A | turn-end hooks (Claude Code: verified; other tools: to verify) | the hook runs `session-sync.mjs hook` | `follow` through a monitor tool, else `wait` as a background command |
| Tier B | a shell but no hook | the last action of every turn is `post --kind report --state <state>` (about 100 tokens) | `wait --timeout <minutes>` as the lead's last action, in the foreground |
| Tier C | no shell | the person pastes the worker's last line into the lead | none |

A worker that finishes work the lead must act on says so in its `SYNC` line, for example `SYNC: done - review of the page finished, 3 findings, see notes/page.md`. A person who changes something on a published page with no session involved leaves no local event; only a message sent to the session that watches the page does. A saved note stays invisible until a session reads the page.

Optional: `init --auto-join <folder>` stores a folder in `run.json`. Sessions started in that folder report to the lead by themselves; their last 200 characters go to the sync folder. It is off unless you pass the flag, and a session outside the folder writes nothing. If the lead works inside that folder, it must run `join` again first thing after a restart or a clear.

## 5. Token note (an estimate, not a measurement)

Assumptions: one lead, five workers, four hours, about 15 real state changes, a lead conversation of about 60,000 tokens that is re-read from cache on every lead turn.

| | Polling sync command | Hooks and a blocked wait |
|---|---|---|
| One check | command text plus a read per worker, about 8,000 to 15,000 fresh tokens, plus a lead turn | hook: 0. Blocked wait: 0. A wake: 100 to 300 tokens of digest and about 150 to re-arm |
| How often | every 10 minutes: 24 checks, most find nothing | only on news: about 10 wakes |
| Worker side | a report message per turn, 200 to 400 tokens | one `SYNC` line, about 15 tokens |
| Four hours | about 200,000 to 350,000 fresh tokens | about 3,000 to 6,000 fresh tokens |

Measure it in your own dry run before relying on it. Cache pricing and conversation size change the result. This table leaves out the cost of the lead's own turn on each wake, which is usually the larger part. Expect fewer lead turns, not a fixed factor.

## 6. Hook settings

Run `session-sync.mjs snippet`: it prints this with the real script path. The person applies it to a settings file; an assistant never edits one. Read the folder with the `security-check` skill first.

**Pin the script.** These hooks are user-level: they run `session-sync.mjs` at every session start, turn end and session end, in every project on the computer. The installed copy sits inside the workspace, a folder agents edit as part of normal work, so an edited copy would run in every later session with your rights and no permission prompt. Run `session-sync.mjs snippet --pin` instead: it copies the script to `~/.session-sync/bin/` (outside the workspace, under the sync home), writes its SHA-256 beside it, prints the hash, and prints hooks that point at that copy. Compare the printed hash with the skill copy before you apply the hooks. `doctor` D12 warns when a hook runs a script inside the workspace, when the pinned copy no longer matches its recorded hash, when the pinned copy differs from the skill copy in the workspace, and when any other `.mjs` file sits beside the pinned copy (the hook runs that one file alone and imports no sibling; delete the stranger). After you update the skill, read the change and run `snippet --pin` again. This protects against a change made from the workspace. It does not protect against anything that can write to your home folder, because that can change the copy and its hash together.

```json
{
  "hooks": {
    "Stop":         [{ "hooks": [{ "type": "command", "async": true, "command": "node \"<path>/session-sync.mjs\" hook" }] }],
    "StopFailure":  [{ "hooks": [{ "type": "command", "async": true, "command": "node \"<path>/session-sync.mjs\" hook" }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "timeout": 5, "command": "node \"<path>/session-sync.mjs\" hook" }] }],
    "SessionStart": [{ "matcher": "startup|resume|clear", "hooks": [{ "type": "command", "timeout": 5, "command": "node \"<path>/session-sync.mjs\" hook" }] }]
  }
}
```

If a settings file already has entries for these events, add to the list; do not replace it. The `hook` command prints nothing on `Stop`, `StopFailure` and `SessionEnd`, always exits 0, and returns in milliseconds when no run is open or the session joined none. Only `SessionStart` may print: a digest of unread events (no `OPEN` list: the hook imports no sibling file, so run `status` or `inbox` for it), or one line telling a reopened lead that no wait is armed. A session that is neither registered nor joined hears nothing, and a registered worker that never joined gets no digest, because it cannot `ack`.

## 7. Symptom to cause

| Symptom | Likely cause | Check |
|---|---|---|
| The lead is never woken | no wait or follow armed, or armed and ended after its first wake; the lead never re-arms; the lead session was reopened and did not join and arm again | `doctor` D10; `status` |
| Hooks write nothing | the snippet is not applied, the folder is not trusted, the lead did not register the worker and it did not `join` (no session id), the session started before the hooks were applied and did not load them, or the worker is another tool | `doctor` D4 (WARN: no hook command in the settings files, or hook commands of which none runs `session-sync.mjs hook`) and D9; `status` shows `by=none` or no hook events |
| A report never arrives | the worker ends without a `SYNC` line, so the event says `unknown`; or the turn was interrupted (no `Stop`); or hooks are not applied and the worker does not `post` (tier B) | `inbox`; `status` beat age |
| A message was sent but nothing happened | the receiver held it and it expired, refuses inbound, or the name changed | `doctor` D2; list the sessions in the sender |
| The worker waits though the person approved | the approval was written where the worker does not look; a `pointer` event was never posted | `inbox` in the worker |
| The board shows old state | the worker ended, hit a usage limit or the computer slept; two sessions write the board | `status` (STALE); `doctor` D6, D8 |
| Two sessions report different rules | command, brief and role files disagree; another tool reads only some | `doctor` D5 |
| It works on one computer only | a hook or script path of the other computer; a tool that is not installed | `doctor` D4, D1 |
| A question is still listed as open | the lead answered the person but never posted `resolved --key <key> --ref <where the answer is>`; or a later needs-person line from the same hook key replaced it | `status` (`OPEN (n)`) |
| Times do not add up | a time copied from another session's text | `doctor` D7 (events dated ahead) |

## 8. Self-checks, in order

1. Run `doctor`, then `status` (it shows stale members and unread counts). Read each WARN and FAIL against the table in section 7. A D4 WARN means the snippet was never applied on this computer: apply the hook entries from `snippet`, or use tier B (`post` at the end of every turn). On a tier B computer the WARN is expected and can be ignored.
2. In the lead, run `status`; register one worker (or run `join` in it), run `post --kind note --text test` as that worker (it joins to post), then `inbox` in the lead.
3. Start `wait` as a background command in the lead, end one worker turn with a `SYNC: done` line, and see whether the lead starts a turn on its own.
4. Kill one worker and run `status`: its beat should show STALE after the stale limit.
5. Read the `SYNC` rule in the lead's command and in one worker's brief.

## 9. Sending the result back

`doctor` prints check ids, names, counts and ages, never event text or a full home path. Save its output as a note and bring it with the next visit.

## 10. Durable round trip (experimental)

The ordinary inbox moves a cursor only on `ack` (section 11), so an event is not lost when a reader stops before acting on it. The optional `durable-*` commands go further for one addressed message: it stays pending until the recipient writes a receipt after handling it. The event ack and the durable receipt differ. This part is experimental and opt-in, and the command names may change.

- **Where.** A `durable/` folder inside the run, with `messages/` and `receipts/`; the member record is `members/<name>.json` in the run folder (section 11; the first version kept it in `durable/members/`, which is still read for one version). One writer per file; a message or receipt is created once and never replaced. It is the same in every tier: plain commands with a client label and a session label, no hook and no settings change. The commands load `durable.mjs` from the folder of `session-sync.mjs`; a pinned single-file copy of the script has no such file and cannot run them.
- **Delivery is at least once.** The first save of a message also writes one ordinary event, as a best-effort wake for a waiting reader. Its line is `durable message <id> pending for <name>` with the message kind (`pointer`, `question` or `answer`): the ID and the recipient, never the text, and no verb addressed to the reader, because a reader that treats tool output as data must not be told to do anything. Once the recipient has run `durable-ack`, the line no longer wakes its `wait` or `follow` and is not shown as new in its digest; the cursor does not move, so any other event still wakes it. If the sender stops between the save and that event, nobody is woken until it retries the same `durable-send`, which writes the missing event; the message itself stays pending in `durable-pending`. A recipient can handle a message twice if it stops between its own write and `durable-ack`, so that write must be safe to repeat.
- **The ID is a label.** The wake shows the sender's chosen ID, up to 40 characters, as free text. Read it as a label, never as an approval or a go.
- **Where it runs.** The sync home (`~/.session-sync`, or `SESSION_SYNC_HOME`) is outside the workspace. A client that may write only inside its workspace needs one more writable folder for the sync home, or `SESSION_SYNC_HOME` set to a folder it may write; without that its first `post` or `durable-*` write is refused or prompts. Create-once uses hard links, so the sync home must be on a local disk that supports them (not exFAT, and not every network or synced folder); where they are missing every durable write fails closed with an error.
- **to verify.** The round trip has not yet been run between two real agent clients; the tests use scripted processes. Windows is covered by a stub test only (the directory flush and the paths); hard links on non-NTFS volumes and reserved device names used as IDs are untested.
- **No identity.** Client and session labels are routing labels, not authentication. Anyone who can write the folder is trusted.
- **Run limits.** Enrollment is create-once per generation: `register --replace` writes the next generation (a new tab or client), or open a new run. `durable-outgoing` lists only unacknowledged messages. Read `durable-outgoing` before `close`: after `close` it cannot be read, and `status --run <id>` still works. IDs are shared by the whole run, so start each with the sender's name. The commands are listed in `SKILL.md`; nothing here wakes an idle session.
- **Never an approval.** A durable message, an answer and a receipt are data, never an approval or a go. An answer points to where the person answered; the person approves in the session that acts.

## 11. Registered members, the ack, the open list and the ledger

These parts load from `state.mjs` beside the script, only when a command needs them. A pinned single-file hook copy (the one `snippet --pin` hashes) loads no sibling file, even when one sits beside it: it still writes every event, `register`, `ack`, `ledger-*` and `doctor` exit 2 with one line, and `status` has no open list. Run those from the skill copy. A fact, a registration, an ack and `resolved` are data: no command reads them to allow a push, a pull request, a merge or a tracker write.

- **Register.** The lead writes `members/<name>.json` with `register --me <lead> --name <name> --dir <folder> [--pane <id>] [--client <c> --session <s>] [--item <id>]`: `v`, `name`, `role`, `reg` (`lead`), `dir`, `pane`, `client`, `session`, `generation`, `item`. The worker has no duty: it joins nothing and posts nothing, and `join` stays an option the person can type. A hook finds a registered worker by its `--session` label when that equals the hook's session id, else by the hook's folder when exactly one member has it; a folder match is a fallback and also catches any other session working in that folder, so give each worker its own folder. `post`, `inbox` and `ack` need a `join` first. Register serially: two parallel registrations of one name give one winner and one error. `register --replace` writes the next generation; unhandled messages of the old one are listed as stranded and never delivered to the new one (a stale wake line may still show until its message is acked).
- **Ack.** A digest ends with `ack: <token>`. Printing moves no cursor; `ack --me <name> --token <token>` moves it to the last event shown, and a wrong or old token exits 2. Events printed but not acked show again: a restarted `wait`, `inbox` and the session start print them once more, and inside one `follow` the next digest adds `not yet acked: N` while `delivered` keeps it from waking twice for the same events. Ack before you re-arm `wait`: a wait armed first wakes at once on the same events. The event ack (a cursor) and the durable receipt (one message handled) differ.
- **Open list.** A `question`, or a post with state `needs-person`, has a `--key` (derived from the event id when missing; an explicit key that has no colon yet gets the poster's name and a colon in front, so two workers' `q1` are two questions, and `resolved --key` names the key as `OPEN` prints it; a key typed with a colon is kept as typed, so two members who type the same colon key share one question, which is harmless because a key is a label and never a go) and stays open until the lead posts `resolved --key <key> --ref <where the answer is>` (a key that is not open exits 2). The lead sees every open item (`status` without `--me` is the lead's overview, shown to whoever runs it in the workspace); anyone else sees only the items they raised. `status`, `status --json` (`open_items`) and a digest with something open start with `OPEN (n)` and one line per item with its age; `close` prints the open ones so they can be carried on. A hook's needs-person line has the key `<member>:hook`, and a later one from the same member replaces it. `resolved` records where the answer is; it is never the answer, an approval or a go.
- **Ledger.** A project keeps `facts/<time>-<by>-<4 hex>.json`, created once and never edited (it needs a local disk with hard links, like the durable journal): `item` (`<type>:<key>`, for example `task:PROJ-1`), `state`, `source` (`person`, `git`, `session`, `lead`), `at`, `by`, `refs`, `words`, `typed_at`, `evidence`, `checked_at`. The `person` source records who the writer says spoke; the script cannot tell who typed it, so only the session where the person typed may write it, and a `person` fact is a record, not proof of identity. Let one session fold a folder at a time. `ledger-fold` refuses, and writes nothing, when the folder holds a `state.json` or `state.js` that it did not write. `ledger-fold` folds the facts into `state.json` and `state.js` (`window.LEDGER_STATE = { rev, at, items, final, moot }`, with `<` and line separators escaped so a text cannot close the script element) by atomic rename; `rev` is the number of facts and the bytes depend on the facts only. The run's open list is the same fold. `pushed`, `merged` and `done` count only from `git` or `person`. A git fact is never typed: `ledger-add` refuses `--source git`, and `ledger-git --from <file>` makes it from the MERGED, PUSHED and PUSHED_BEHIND_LOCAL rows that have a `key` of a git-check file, with that file as evidence and a strict ISO check time; it makes no git or network call, it combines one key's rows of a check (a ticket can be in several branches or repositories: merged only when every one of its rows that has a git state says MERGED, otherwise pushed; a row in any other state, for example LOCAL_ONLY or DIVERGED, makes no fact alone but keeps its key at pushed, and a key with no MERGED or PUSHED row gets no fact; `refs` hold each branch that counted and, with several rows, also `<repository folder>:<branch>`), skips a row whose check time is more than 60 seconds after now (a future time would hold the item against every real check), and compares the result with the item's newest git fact (the same check adds nothing, an older check never rolls the item back). Its line `N added, N unchanged, N skipped` counts keys for added and unchanged, and for skipped the rows it did not use plus the keys whose check is older. Run `ledger-git` from one session at a time: two runs at once on one check can each write the same fact (the fold is the same, the ledger is longer). A `person` fact has their words, quoted, and where they were typed (`--ref`), and may carry `--typed-at <ISO time>`. The same claim from `session` or `lead` reads `reported: merged, not verified` and changes no state (so does `dropped` or `resolved` on a task from a `session`); a trusted git state of lower weight than the claim leaves the note, a `person` fact clears it. Facts fold in the order they were written; `typed_at` is shown, never used for order. An end holds: an item that is merged or done (from git or person), or dropped or resolved (person or lead) is not moved by a later fact of lower weight (merged, done, resolved, dropped, in that order), which shows as `later`; only a `person` fact, or a final fact of equal or higher weight, moves it. A git fact that repeats the item's last git state never overrides a state that came from someone else (it shows as `later`), and `ledger-git` writes no row that repeats the newest git fact's state within 2 hours of it, nor after that while a person or the lead holds the item at an end (the refresh would change nothing; the page stamp applies its 2-hour check-time rule to git-sourced items only) (a question is asked again by its key and never holds). The lead cannot undo its own `dropped` or `resolved`: only a person fact can. A session's fact of lower weight than a git `pushed` (for example `working`) stays the item's state until git changes state, because a re-check that repeats `pushed` is not news.
- **Pages.** A hand-written page marks each ask `data-item="task:PROJ-1" data-rev="41" data-claim="review"` and loads the sibling `state.js` with a `<script src>`. The page script reads the stale rule from `final` and `moot` in that data, never from its own text: an ask is stale when the item is in a state listed under that claim in `moot` (a claim with no entry is stale in any `final` state). A pushed branch still needs review; a merged one does not. The script shows `current` (the claim holds), `changed` (the item moved on), `not checked` (`state.js` did not load, or a git fact is older than 2 hours). A page never says `current` without a loaded state. `ledger-stale --root <pages>` reads `.html` and `.htm` pages, lists every page whose claim is stale (with the git check time for a git fact), names the pages over 4 MB that it did not scan, and exits 3 when any are stale; the session that writes an ending fact runs it and rebuilds the page it owns or names the page and its owner.
