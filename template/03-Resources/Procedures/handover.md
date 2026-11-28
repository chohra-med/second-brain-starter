# Handover

Write one short note that lets a fresh chat continue the work, then clear the old chat.

Two things make an assistant worse as a chat grows:

1. **A nearly full context window.** It loses track of earlier decisions and fills the gaps with guesses. That is how hallucination starts.
2. **A window full of material the task no longer needs.** Dead ends, old drafts and long tool output bury the part that matters.

A fresh chat that reads one clean note beats a long chat that remembers everything.

## Signs it is time

- The chat is long and the assistant repeats itself, contradicts an earlier decision or forgets a rule you gave it.
- You corrected the same thing twice.
- The chat holds several finished side trails that the next step does not need.
- You are about to stop for a while and want to restart without rereading.

## Steps

1. State the goal in one sentence. If you cannot, stop and ask the person what the work is for.
2. Collect from this chat only what the next chat needs, in the five parts below. Keep each part short.
3. Check every line of State against the file or output it rests on. A line you cannot check is written as `unverified`. Never write `done` because it was discussed.
4. Leave out dead ends, tool output, old drafts, long logs and anything a workspace record already holds. Point to that record by its full path instead of copying it. Never write a secret, a key or a password.
5. Write the note at once. Asking for a handover is the yes, so do not stop at a draft. Save it to `00-Meta/Handovers/<session-name>-YYYY-MM-DD-part<N>.md`: the session's name (the name the person gave the chat, else a short slug), the date, and the next free part number for that session name, starting at `part1`. Never overwrite a note.
6. Check the file: run `test -s "<full absolute path of the note>"`. If it fails, write the note again and check again. Never give the hand-off block for a note that is not on disk: the person clears the chat after copying it, and the work is lost.
7. For a session with work to save, run [bounded end-session closeout](end-session.md) before handing over. Reconcile the work, decisions and open tasks in their workspace records. If the person corrected the work, use [harness-session](harness-session.md) within closeout to trace each correction to its owner, apply authorized fixes and record any pending decisions. Use the current session evidence and keep the closeout bounded. Update the same handover note with the reconciled state and next action, and list the saved records in its Closeout section as full absolute evidence paths. For a chat with no work, omit the Closeout section. Two exits skip the closeout: the context window is nearly full, or the person asks for the note only. On either exit do not run it: write `- Closeout: not run (<reason>)` under `## Closeout`, make running the closeout the first item under Next, skip step 8 and go to step 9.
8. Check each closeout evidence path is absolute and points to a nonempty regular file with `test -f` and `test -s`. Quote paths that contain spaces. Evidence must point to a saved workspace record other than the handover note. Keep the restart prompt pending if the required closeout records cannot be written or verified. Report what is missing and retain the saved note.
9. Show the note, then end your reply with the hand-off block below, filled in: the folder to start the new session in, and the restart prompt as one paste-ready line. The person keeps several sessions, so this block is what they copy; never make them build the line from a path. If they want changes, edit the same file. This hand-off is the closing recap when you ran closeout.

## The note

Keep it under 60 lines.

```
# Handover: <short name>

Start the new session in: <full folder path>

## Goal
<one sentence>

## State
- Done: <what, and the file or output that shows it>
- Not done: <what is left>

## Closeout
- Evidence: <full absolute path to a saved closeout record>
- Closeout: not run (<reason>)

## Decisions
- <decision>, because <reason>. The person's words: "<quote>"

## Next action
<one action, concrete enough to start without asking>

## Read first
1. <full path>
2. <full path>
```

Read first holds at most five paths, in reading order.
Closeout appears only for a work session. After a closeout, list the records this session saved or updated; after an exit from step 7, write only the line `Closeout: not run (<reason>)`.

## The hand-off block

Give it at the end of the reply, in this shape:

1. Type `/clear` or open a new session in `<full folder path>`.
2. Paste this line:

```
Read "<full absolute path of the note>" and continue from its Next action. Ask before reading anything it does not name.
```

To look at the note first: `open "<full absolute path of the note>"`.

Always use the full absolute path in double quotes, because workspace paths can contain spaces. A bare file name or a relative path is wrong: the new session may start in another folder.

## In the fresh chat

1. Read the note, then only the paths it names.
2. Say the goal back in one line.
3. If the note and a file disagree, the file wins. Say so, and correct the note.
4. Do the Next action.

When the work is finished, use `end-session` to write the results into the workspace records. The handover note is a one-time pass and is not a record of the project.
