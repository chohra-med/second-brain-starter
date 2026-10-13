---
name: grill-me
description: Settle a confused idea, product position or spec by checking the real files first, asking one question at a time, and writing each answer where the next reader will find it. Use when two documents describe the same thing differently, when readers keep getting the wrong answer, or when the user says "grill me" or "pin this down".
---

# Grill me

Use this skill to end a confusion that keeps coming back. The usual cause is two or more files that describe the same thing in different words. The fix has four steps: read the real files, list the contradictions, ask about each one, and write each answer where the next reader will look.

Do not open with "so what is this?". That question gets back the same confusion in new words.

## Do not use this when

- The answer is already in the code or the files. Look it up.
- The change is a small edit with no disagreement.
- Only one source exists, and nothing contradicts it.

## Step 1: Read the real artifact first

Read the project's own instructions, if they exist: its README, `AGENTS.md`, `CONTRIBUTING.md`. Then check the artifact itself. Use the files the build produces, the config the program loads, and the files on disk.

| Question | Where to look |
|---|---|
| What does it claim? | The built output, the page as shipped, the config the program loads |
| What does it need or cost? | The one file that owns that number or setting |
| What exists? | A file listing. Do not trust an inventory document. |
| What is wired? | A search for imports or references. Count them. |

A check on source text can pass while the built output still breaks. Check the built output when a claim is about the whole product.

## Step 2: List the contradictions

Rank each contradiction by how badly it misleads a reader:

1. A file that describes the wrong project. Highest priority, especially a file an assistant loads first.
2. A retired claim that still appears in metadata or in text that tools copy.
3. A document that names a file that does not exist.
4. Two names for one thing, both in use.
5. The same fact typed in many places.

Give each one a file and a line number.

## Step 3: Ask one question at a time

- Open with the root cause in one sentence. Then give the top finding.
- Ask one question. Lead with your recommendation, and say what would change it.
- Ask only when different answers lead to different edits.
- Do not ask what the files already say. Do not ask permission for an obvious fix.
- Ask about scope when the blast radius is unclear: which files may change.
- Wait for the answer before you ask the next question.

Example question: "The README calls the tool `Alpha`. The config calls it `alpha-core`. I recommend `Alpha` in the prose only, because `alpha-core` is a package name that code imports. Would a rename of the package change your answer?"

A ruling can be narrower than it looks. If the rule covers more files than the one you showed, ask again before you apply it to all of them.

## Step 4: Write each answer where it stops the confusion

Write every ruling to all of these places:

1. **The identity file.** This is the file a reader loads to learn what the project is. Rewrite it. Do not patch it.
2. **A decision record.** Give it a date, the answer in the person's own words, the reason, and the consequence.
3. **A top note in long documents.** If an older document conflicts, put a note at its top that says the decision wins.
4. **A strike on retired text.** Mark the old section "retired, do not follow" and say what is now false. Do not delete it. Deleting it removes the history.
5. **A comment at each changed site.** Say what the code used to say and why it changed, so nobody restores it by accident.

Then run the project's checks, such as the build and the tests. Verify the fix in the built output. Report what you did not fix and why.

## Failure modes

- **Asking before reading.** The answers repeat the confusion.
- **Renaming a code identifier to match a brand.** A name that code calls, such as a function or a package, is an interface. Renaming it breaks users.
- **Fixing most of a set.** The one you skipped becomes the new source of truth.
- **Trusting a notes file over the code.** Notes are often the stale part.
- **Checking source text for a whole-product claim.** Check the built output instead.
