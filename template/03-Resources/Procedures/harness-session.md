# Harness session

Turn this chat's corrections into fixes at the source. A correction is a defect in the system, not only in the session. Fixing the artifact the person pointed at is the session's job. This procedure fixes the thing that produced the artifact, so the next session cannot make the same miss. It applies [learning and scaling](learning-and-scaling.md) to every correction in the chat, instead of one.

## Modes

- `harness-session`: run the steps and apply the fixes the person approves.
- `harness-session dry`: steps 1 to 3 only. Print the table and write nothing.
- When `end-session` runs this first, cover only the corrections made since the last run in this chat.

## Where a fix may go

The installed shared skills, the procedures in `03-Resources/Procedures/`, `00-Meta/AGENTS.md` and the root loaders are managed files. An edited one is planned by the next `upgrade` as `CUSTOMIZED-KEEP`, or as a `CONFLICT` that blocks the whole upgrade when the starter changed the same lines, so do not edit them from the workspace. A fix goes to a file the person owns:

- a fact, in the project's `FACTS.md`;
- a choice or a standing rule, in the project's `Decisions.md`, or in [00-Meta/Decisions.md](../../00-Meta/Decisions.md) when it spans projects;
- a taste or working preference, in [00-Meta/Profile.md](../../00-Meta/Profile.md);
- a repeatable method, in the person's own procedure under `03-Resources/Procedures/`, added by [extend.md](extend.md) and linked from [Extensions](../Extensions.md).

If the defect is in a shipped file itself (a wrong step in a shared skill, for example), do not patch it here. Describe it as a fix to send to the Second Brain Starter repository, with the file, the observed problem and the wording you propose.

## Step 1: Harvest the corrections

Read the whole chat. If earlier turns are not visible, label that part instead of claiming full coverage. A row is any message from the person that:

- says something is wrong, missing, forgotten, stale or not what they asked;
- repeats a request they already made;
- shows a screenshot of a defect;
- reverses a choice the session made.

Write each row with their words verbatim, what the session had done and what they wanted. A new request is not a correction.

## Step 2: Trace each row to its cause

For each row ask one question: which file, if it had been followed, would have produced the right result the first time? Route it as a fresh session would, from Home and the selected project's rules. Open that owner and check whether the step exists. Classify the cause as exactly one:

| Cause | Meaning | Fix |
|---|---|---|
| A. Missing step | No owner says to do it. | Add the step to the person's own procedure or to the project's `Decisions.md`. |
| B. Not routed | The step exists, but the session never reached it. | Add a route in [Extensions](../Extensions.md) or Home that points to it. Point, do not copy. |
| C. Read but skipped | The step was in context and still missed. | A check that fails: a test, a script, a gate. A second sentence will be skipped too. |
| D. Stale or conflicting | Two owners disagree, or a rule no longer matches the person or the files. | Supersede the old text with a dated entry and archive it. Never delete it. |
| E. Preference | A taste with no workflow home. | [00-Meta/Profile.md](../../00-Meta/Profile.md), with its scope. |
| F. Tool or file defect | The product or a shipped file is wrong. | The project's backlog, or a fix to send upstream. |

One row, one owner. If two seem to own it, the deeper one wins: fix the generator, not the artifact.

## Step 3: Pick the smallest fix

Prefer, in order: a check that fails (C), a route that points to the step (B), one step in the owner (A). A paragraph of advice is the last resort. Do not turn a one-off taste into a universal rule: that is cause E, with its scope.

## Step 4: Apply and prove

Show the exact edits and the files they land in, and wait for a yes. Then, for each approved row:

1. Make the edit at the owner. Check the file's current bytes first, and stop if they changed.
2. Prove it. Plant the miss, watch the check fail, restore it. For a route fix, start from Home and show the route reaches the step.
3. Fix the artifact too, if the session has not already.
4. Record the row where the rule lives: the date, their words verbatim, the cause, the owner file, the check and the status. Status is `applied` until a later real session runs the changed owner without the miss. Only then write `verified`.

## Step 5: Report

One table, one row per correction:

| Their words | Cause (A to F) | Owner fixed (full path) | Check | Status |
|---|---|---|---|---|

Then list any row left `proposed`, and why.

## Hard rules

- Their typed words are the evidence. Never paraphrase them into a stronger claim.
- A record is not a fix. A row with no edited owner stays `proposed`.
- Do not stack a second rule beside an old one. Supersede the old one where it lives.
- Do not re-fix a row this chat already traced and fixed. Cite it.
- Never edit a managed file from the workspace.
