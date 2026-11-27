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

- A hook runs a script, not the model. The script writes one small file per event and prints nothing (except at session start).
- The lead blocks inside `wait` or `follow` (a file watch with a slow check every 15 seconds). No model call happens while it is blocked.
- A wake is a digest: events after the lead's cursor, one line each, at most 12 lines, then `+N more`. The wake moves the cursor.

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
- **Session id.** Hooks receive `session_id`, not the session's name. `join` records the pair once. Claude Code sets `CLAUDE_CODE_SESSION_ID` for shell commands (seen in 2.1.325); `join` and `init` read it. Inside a subagent it is the parent's id.
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

**Pin the script.** These hooks are user-level: they run `session-sync.mjs` at every session start, turn end and session end, in every project on the computer. The installed copy sits inside the workspace, a folder agents edit as part of normal work, so an edited copy would run in every later session with your rights and no permission prompt. Run `session-sync.mjs snippet --pin` instead: it copies the script to `~/.session-sync/bin/` (outside the workspace, under the sync home), writes its SHA-256 beside it, prints the hash, and prints hooks that point at that copy. Compare the printed hash with the skill copy before you apply the hooks. `doctor` D12 warns when a hook runs a script inside the workspace, when the pinned copy no longer matches its recorded hash, and when the pinned copy differs from the skill copy in the workspace. After you update the skill, read the change and run `snippet --pin` again. This protects against a change made from the workspace. It does not protect against anything that can write to your home folder, because that can change the copy and its hash together.

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

If a settings file already has entries for these events, add to the list; do not replace it. The `hook` command prints nothing on `Stop`, `StopFailure` and `SessionEnd`, always exits 0, and returns in milliseconds when no run is open or the session joined none. Only `SessionStart` may print: a digest of unread events, one line telling a reopened lead that no wait is armed, or one line with the session's id while a run is open.

## 7. Symptom to cause

| Symptom | Likely cause | Check |
|---|---|---|
| The lead is never woken | no wait or follow armed, or armed and ended after its first wake; the lead never re-arms; the lead session was reopened and did not join and arm again | `doctor` D10; `status` |
| Hooks write nothing | the snippet is not applied, the folder is not trusted, the session did not `join` (no session id), the session started before the hooks were applied and did not load them, or the worker is another tool | `doctor` D4 (WARN: no hook command in the settings files, or hook commands of which none runs `session-sync.mjs hook`) and D9; `status` shows `by=none` or no hook events |
| A report never arrives | the worker ends without a `SYNC` line, so the event says `unknown`; or the turn was interrupted (no `Stop`); or hooks are not applied and the worker does not `post` (tier B) | `inbox --peek`; `status` beat age |
| A message was sent but nothing happened | the receiver held it and it expired, refuses inbound, or the name changed | `doctor` D2; list the sessions in the sender |
| The worker waits though the person approved | the approval was written where the worker does not look; a `pointer` event was never posted | `inbox --peek` in the worker |
| The board shows old state | the worker ended, hit a usage limit or the computer slept; two sessions write the board | `status` (STALE); `doctor` D6, D8 |
| Two sessions report different rules | command, brief and role files disagree; another tool reads only some | `doctor` D5 |
| It works on one computer only | a hook or script path of the other computer; a tool that is not installed | `doctor` D4, D1 |
| Times do not add up | a time copied from another session's text | `doctor` D7 (events dated ahead) |

## 8. Self-checks, in order

1. Run `doctor`, then `status` (it shows stale members and unread counts). Read each WARN and FAIL against the table in section 7. A D4 WARN means the snippet was never applied on this computer: apply the hook entries from `snippet`, or use tier B (`post` at the end of every turn). On a tier B computer the WARN is expected and can be ignored.
2. In the lead, run `status`; in one worker, run `join`, then `post --kind note --text test`, then `inbox --peek` in the lead.
3. Start `wait` as a background command in the lead, end one worker turn with a `SYNC: done` line, and see whether the lead starts a turn on its own.
4. Kill one worker and run `status`: its beat should show STALE after the stale limit.
5. Read the `SYNC` rule in the lead's command and in one worker's brief.

## 9. Sending the result back

`doctor` prints check ids, names, counts and ages, never event text or a full home path. Save its output as a note and bring it with the next visit.
