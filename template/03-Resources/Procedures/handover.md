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
5. Show the whole draft. Write it only after the person says yes, to `00-Meta/Handovers/<session-name>-YYYY-MM-DD-part<N>.md`: the session's name (the name the person gave the chat, else a short slug), the date, and the next free part number for that session name, starting at `part1`. Never overwrite a note.
6. End your reply with the hand-off block below, filled in: the folder to start the new session in, and the restart prompt as one paste-ready line. The person keeps several sessions, so this block is what they copy; never make them build the line from a path.

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

## Decisions
- <decision>, because <reason>. The person's words: "<quote>"

## Next action
<one action, concrete enough to start without asking>

## Read first
1. <full path>
2. <full path>
```

Read first holds at most five paths, in reading order.

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
