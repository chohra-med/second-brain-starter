## What and why

<!-- Two or three sentences. What does this change, and what went wrong or was missing without it? -->

## How I found it

<!-- Where you hit the problem, and the smallest steps that show it in a fresh, empty folder. Say if an assistant wrote any of the code or tests. -->

## Evidence

- [ ] `node --test` passes on this branch. Paste the last lines of the output.
- [ ] Each new behaviour has a test that was red before the change. Name it:
- [ ] I broke the change on purpose once (for example reverted one line) and a test went red. Name the test:
- [ ] A new skill was registered with `node tools/add-skill.mjs <name>`, and the counts it printed were updated by hand.

## Rules this touches

<!-- Name every recorded decision, CHANGELOG design decision, PRIVACY.md read scope or README claim this change relies on or changes. Write "none" only after you searched for them. -->

## Existing installs

<!-- What happens on `upgrade` to someone who already has the files this touches? Say how to undo it. -->

## Proposed changelog lines

<!-- The maintainer writes the release entry. Put your lines here, including a "Design decision" line if you add a skill or change what a command reads or writes. -->

## Checklist

- [ ] I did not change `VERSION`, `package.json`, the manifest's `templateVersion`, or the CHANGELOG and UPGRADING headings. The maintainer sets the version at release.
- [ ] No company or client names, personal paths, credentials, or private records in the diff, the tests or this description.
- [ ] One concern in this PR. A second idea is a second PR.
