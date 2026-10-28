# End session

End-of-session closeout. Run the phases in order and fix what you find. This procedure writes: it corrects the records, it does not only report. Scope is everything that happened in this session: every ask, every file touched, every decision made and all feedback given.

## Mode selection

The closeout is bounded by default. Do not run a broad context reload, and do not write a second recap after the closeout. `end-session full` is the explicit audited mode. Only then may the procedure run the Phase 9 context reload. Phase 10 is the one closing recap in either mode.

## Completion contract

The core closeout works on any assistant and in any folder structure, and must finish even when an optional tool is missing:

1. audit the whole conversation;
2. reconcile the workspace and each affected project;
3. capture and apply durable learning;
4. verify every claimed result and every surviving gap;
5. leave one prioritized next-action queue and one closing recap.

Memory connectors and reminder tools are optional capabilities around that core. Detect them before you use them. Never claim that one ran when it did not, and never hold back the workspace write-back because an optional tool is missing.

## Daily-Task-Plan writes

Change a task row in [00-Meta/Daily-Task-Plan.md](../../00-Meta/Daily-Task-Plan.md) only when the person names that row and asks for the change. Then follow these rules:

1. Re-read the target row and the whole file immediately before you write.
2. Change only that one row. Keep its checkbox state, its priority, its nested tasks and its existing notes. Keep the one-line shape the plan's own map describes. Evidence and narrative go in the project record that owns them, not in the row.
3. Before you replace the row, check that the file still matches what you read. If it changed, re-read it and report the change. Do not overwrite it.
4. After you write, read the row back and confirm it holds the expected text.
5. If any step fails, stop and report what actually happened. Do not claim a partial success. Never delete a historical row, a note or evidence. Move it or mark it instead.

## Memory index check (always)

Run this check in every mode, also when the session had no work. After a session with no work it is the only step, followed by a one-line recap.

1. If the assistant keeps a memory index that loads into every session (for Claude Code, `MEMORY.md` in its project memory folder), measure its size in bytes and report the figure.
2. The budget is the one the [Working Agreement](../../00-Meta/Working-Agreement.md) sets. Without one, it is 3,200 bytes.
3. Over budget: propose concrete merges or removals, and change nothing without a yes from the person.
4. No such index, or it cannot be read: say so in one line, and say the check did not run. Never claim it ran when it did not.

## Phase 0: Whole-conversation audit (before write-back)

Read the complete conversation, from the first ask to the final message. Build a scratch ledger with one row for every request, correction, preference, decision, mistake, blocker and reversal. Do not rely on the last turn or on a summary alone. If earlier turns are no longer available, build the ledger from the available conversation and the durable evidence, and label the missing coverage. Do not call it a whole-session audit.

Mark each row **delivered**, **user-owned**, **blocked** or **needs reconciliation**. Carry each row into the phase that writes it. A mistake the assistant made is a learning, even when the person only asks "why did you do that?". Record the cause, the check that would have prevented it, and the file where that check now applies.

## Phase 1: Workspace write-back check (fix, don't list)

Check that each convention was followed for this session's work, and make the missing writes now:

- **Daily note.** Add one dated block per work block to the daily notes folder, in the shape of its daily template. Several work blocks in one session make one note, or extend the existing one.
- **Progress entries.** Add a dated entry to `progress.md` of every project the session's work touched. "Touched" means every project the work affected, including work done by subagents or reported from parallel sessions. A change that lands in four repositories needs four entries.
- **Decisions.** A decision that affects more than one project goes in [00-Meta/Decisions.md](../../00-Meta/Decisions.md). A decision for one project goes in that project's `Decisions.md`.
- **Roadmap.** Update the status of each roadmap item the session changed, in that project's `roadmap.md`.
- **Daily-Task-Plan.** Add one consolidated pointer line for anything that needs the person's hands. Write it only under the rules in the section above, and only when the person asked for that write.
- **Open decisions.** Add only NEW open decisions the person must rule on, to the open decisions or blockers section of the plan.
- **Stale premises.** If the session disproved a recorded assumption, correct every record that carries it, in this session.

## Phase 2: Learning capture (evidence, owner and authorized application)

Capture every correction, preference and improvement the person gave in this session. Keep their wording and context. Separate what you observed from what you inferred. Use [learning-and-scaling.md](learning-and-scaling.md) as the owner of the learning method.

- **Capture and classify.** For each item, record the date, the source, the candidate rule and the file it would be applied to. An inferred lesson stays **proposed** until it is applied and a fresh session follows it. Capturing feedback does not make every item a standing rule.
- **Explicit current preference.** A standing preference the person states applies immediately, within the scope they already authorized. An effect that needs approval keeps its gate. If application is blocked, record the owner and the next action. Do not claim it happened.
- **One owner per lesson.** Put each rule in the one place it belongs: facts for values that change, decisions for choices, procedures for repeatable work. Route a code lesson to the owner file that the target project's own rules name, after you read those rules. Do not send it to a `CLAUDE.md` by default, because those files are import-only adapters.
- **Contradicted records.** Supersede the obsolete rule, or archive it with its date and a link. Keep the old text and its evidence. Do not delete them, and do not leave two competing current rules.
- **Decision and mistake ledger.** For each Phase 0 row, keep each durable decision with its date, the person's words when you have them, the source session and its status. For each mistake, record what happened, why the check failed, the proposed prevention, the owner and the evidence that it was applied. An unapplied candidate stays proposed. A log entry alone does not prove that a rule was applied.
- **Required record.** For each lesson, record the trigger, the observation, the failure or decision, the mechanism, the prevention, the file applied to, the acceptance test, the owner, the status, the evidence and a review date. Use the status words proposed, applied, verified, superseded or parked. A claim you cannot verify stays **UNVERIFIED**.
- **Closing a guard.** A written change, a read-back or a passing positive control does not close a guard as verified. Keep it at applied, marked **UNVERIFIED**, until the changed rule is exercised, its acceptance test rejects a planted weak case, a follow-up has an owner, and a later real output shows no recurrence. If the miss recurs, reopen it.

## Phase 3: Records check (fix, don't list)

- **Search before you create.** Before you create any record, search the decisions and facts for one on the same subject. If one exists, refine it or supersede it. Never add a second file that contradicts the first.
- **Write rulings with the person's words.** A ruling the person gave this session is written with their words and the session date. A true ruling with no written source cannot be told apart from an invented one.
- **Correct what was proven wrong.** Supersede or archive the wrong record, with its provenance. Do not delete it.
- **Check each affected project.** Check the records of each affected project, not only the primary one.
- **Save only what the repository or workspace does not already record.** A record is for what existed only in the conversation.

## Phase 4: Drift reconciliation (fold, prune, dedupe)

Workspace policy changes go to [00-Meta/AGENTS.md](../../00-Meta/AGENTS.md). The `CLAUDE.md` files are import-only adapters, and they never get substantive rules.

Dated notes and progress entries keep growing, but the canonical files do not update themselves from them. Close that loop every session:

- **Fold this session's durable knowledge into its canonical home.** The dated note records what happened. The canonical file records what is true now. Update both. A changed project state goes into that project's roadmap and its project map, not only into `progress.md`.
- **Prune and dedupe in place.** If the session superseded something, cut or supersede the old text where it lives. Never leave two versions of the truth. Collapse a plan item that is now done. Merge a duplicate.
- **Promote repeated lessons.** When the same mechanism appears in three or more captured misses, promote it into one standing rule in the canonical file, and link the supporting records.
- **Detect drift, and offer the bigger pass.** This procedure makes only the small folds above. If the logs have clearly outrun the structure, for example a project map that has been stale for weeks while its progress grew, name it in the summary and offer a dedicated cleanup pass. Do not run that pass here.

## Phase 5: Session gap analysis (verify, then reconcile)

Build the honest diff: every ask the person made in this session, against what was delivered. Do not build the gap table from memory of the conversation. Memory goes stale: an item that was already finished still reads as pending. For every candidate gap, confirm its actual state first, then write the records to match, then present it.

1. **Confirm before you list.** The person may run several agents or sessions at once, so state can change under you. For each candidate gap, re-check fresh state from the source the item depends on: the repository's state against its remote, the package or deploy status, or the live address. Check the sibling repositories and surfaces the item touches, because a fix often lands in a different place from where the work started. Re-read the record that tracks the item, in case a parallel session already ticked or logged it. If fresh state contradicts what this session assumed, trust the fresh state and reconcile the records to it.
2. **Reconcile the records to the findings.** When a check shows an item is already done, update the record in the same step. Tick the plan line, update the progress entry, and correct the session note. A finding that changes state must be written, not only mentioned.
3. **Classify only what survives.** Give each verified-open item a fix plan, not just a label: the exact next action, who does it, the rough effort, and what it waits on.
   - **CAN DO NOW**: the assistant can do it in this session. Give the effort and offer to do it.
   - **NEEDS USER**: an exact manual step, such as a click, an authorization, a ratification or a send, written so the person can do it in one pass.
   - **DEFERRED or PARKED**: with the trigger that wakes it, such as a date, a result or a dependency. Never a bare "later".
   If you cannot verify an item because only the person can see it, mark it **UNVERIFIED, assumed pending**, and say exactly what to check.

The gap table the person sees must already match the git, disk and record state. Do not list an item that a quick check would show as done.

## Phase 6: Session summary inputs (do not print a second recap)

Prepare these inputs for the one Phase 10 recap. Do not print a separate summary here:

- what shipped, what was learned, the decisions made and still open;
- the reconciled gap table and the drift flag;
- tomorrow's prioritized queue and the do-now offers.

The complete file list goes in Phase 10, once. Do not repeat it here.

## Phase 7: Tomorrow's prioritized queue and reminders

Take the verified-open items from Phase 5: every NEEDS USER item, every CAN DO NOW item the person did not run, and any DEFERRED item whose trigger falls tomorrow. Carry over plan items due tomorrow as well, not only items born in this session.

1. **Rank by urgency, not by when the item came up.** Score each item on these signals, highest first: **blocks a release, a submission or a handoff**; **a hard external date**, such as a deadline or a review window; **decaying**, such as a time window that is closing; **unblocks other work**; **quick and high-leverage**; everything else. Break ties by effort, with cheap wins first in the same band. Name the reason each item sits where it does.
2. **Output the queue** as a numbered list, `#1` to `#N`. For each item give the task, the reason for its rank, the first concrete action, who does it and the time it takes. Item `#1` is what the person should open first tomorrow.
3. **Create reminders only with a durable tool.** Check which reminder tools the active runtime offers. Use one only when it outlives this process. A session-only timer serves only a nudge within this same session.
   - List the existing reminders before you create one, so you do not duplicate it.
   - The reminder text is the item's first concrete action, plus the record that holds it, so that the reminder works without this chat.
   - Reserve reminders for the top three to five urgent, time-sensitive items. The rest stay in the plan.
   - Check the date before you schedule it against any hard external date. If it collides, move it and say that you moved it.
   - If no durable tool is available, record the item in the plan and say that the timed reminder was not created.
4. **Confirm what was scheduled**, item by item, in the summary. Offer to re-time or drop any of them.

## Phase 8: Session artifacts (harvest, don't delete)

Before the closeout ends, move each durable artifact this session produced into its real home: a render or report into its project folder, a script worth keeping into the project it belongs to. Nothing that matters may be left only in a temporary or work folder. Read each destination back to confirm it. This procedure deletes nothing, and it does not sweep the folders of other sessions.

## Phase 9: Reload fresh context (audited mode only)

Run this phase only for an explicit `end-session full`. In that mode, after Phases 1 to 8 and before Phase 10, run the [context modes](context-modes.md) procedure in its default mode, to reload the current state from the reconciled records. The reload must honor what the person said in this conversation over the files.

In default mode, record `context reload: skipped, bounded mode`, and continue.

## Phase 10: Whole-session recap (the one closing message)

Close with a recap of the whole session, from the first ask to now, not only the closeout phases. In full mode, place it after the context report. In default mode, use the Phase 6 inputs directly. Print one recap only.

- **Chronological "what we did".** Each ask the person made, what was delivered for it, in order, in plain language. Include work from before any handoff or compaction if this session continued one.
- **Every file with its full absolute path.** For each piece of work, give the full absolute path of every file it lives in. Include code repositories, workspace records, pull requests with their links, and deploys. One file per line. Do not group them, and do not abbreviate a path with an ellipsis.
- **Where things stand.** One line: what is live, what waits for the person, and the single next action.

Format: `## Session recap: [date]`, then numbered chronological blocks shaped as ask, done, files, then a closing `**Now:**` line. This recap ends the closeout.
