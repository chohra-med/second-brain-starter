# Review a pull request

This page is for the maintainer, and for anyone who wants to know how their pull request (PR) is judged. [Contribute a fix or a skill](contribute.md) is the other half.

The rule behind every step: a green test run is the start of a review, not the end. A past batch of changes arrived with all tests green and still held unrecorded rule changes, writes before approval, a corrupted non-UTF-8 file and tests that could not fail. The author's own tests only show what the author thought of.

## Run it in this order

Work in a separate clone or worktree of the PR branch. Never review in your own working copy.

1. **Size and shape.** One concern? A PR that mixes a fix, a new command and a release bump is split first, before anything else is read.
2. **Rules first.** Read the PR's "Rules this touches" section, then check it yourself: search [CHANGELOG.md](../CHANGELOG.md) design decisions, [PRIVACY.md](../PRIVACY.md) read scopes and the README for the behaviour the change touches. A change that lists "none" while contradicting a recorded decision is a defect in the PR, however good the code is. Example: a command that lists the repositories under a folder breaks a recorded "never lists or searches for repositories" decision, and needs that decision reversed in the open, with a new entry.
3. **Run the suite.** `node --test` on the PR branch, on a clean checkout with no `.DS_Store` files. Note the count. The suite counts one extra test, as [CONTRIBUTING.md](../CONTRIBUTING.md#counting-the-suite) explains.
4. **Break it on purpose.** Revert one line of the fix, or flip one condition in the new code. At least one test must go red. If none does, the tests do not cover the change, and the verdict is fix first. Do this for every safety claim in the PR text.
5. **Check what the code writes.** For any code that writes a file: nothing is written before approval; an existing file is never overwritten silently; a symbolic link is not followed; a file that is not valid UTF-8 or uses CRLF is kept byte-safe or reported as a conflict, not rewritten.
6. **Check what the words promise.** Search the diff for absolute claims ("never", "no command", "always", "nothing is written") and check each against the code. A new feature often makes an old sentence false; search the other documents for that sentence too.
7. **Privacy.** The package scanner runs inside the suite. Also search the added lines yourself for company or client names, home-folder paths, email addresses, and real project records. Ask the author to rewrite an example rather than redact it.
8. **Skills.** The registration matches the files: run `node tools/add-skill.mjs <name>` on the branch and confirm it changes nothing. The skill says what it reads and writes. The counts agree in the README, the two docs and `test/installer.test.mjs`. Version carriers are untouched.
9. **Existing installs.** What does `upgrade` do for a workspace that already has these paths, or edited them? The answer must be one of the states the plan already shows (for example `PERSONALIZED` or `CONFLICT` with a proposal), never a silent overwrite.
10. **Third-party files.** Anything copied from elsewhere keeps its licence and is listed in [ATTRIBUTION.md](../ATTRIBUTION.md), with the commit it came from.

## Verdicts

| Verdict | When | What you send |
|---|---|---|
| Merge | Steps 1 to 10 pass. | A one-line summary of what you ran. |
| Fix first | A defect with a clear fix. | A numbered list, most severe first, each with the file, the observed problem and the fix you expect. |
| Split | Two concerns, or one part is not ready. | Which part lands now and which becomes its own PR. |
| Decline | It reverses a recorded decision without saying so, or it adds an automation with no design decision. | The decision it conflicts with and what would change the answer. |

Severity words: CRITICAL breaks a recorded rule or loses data; HIGH writes unexpectedly or makes a false claim; MEDIUM is a test that cannot fail or a missing carrier; LOW is wording.

## Merge and release

- Merge only when the verdict is merge and the suite is green on the merge result, not only on the branch.
- The maintainer sets the version. Bump `VERSION`, `package.json`, the manifest's `templateVersion`, the CLI help line, the README line, and add the CHANGELOG and UPGRADING entries from the lines in the PR. `test/docs-contract.test.mjs` fails until all carriers agree.
- Tag and publish the release only after the version commit is on `main`.
