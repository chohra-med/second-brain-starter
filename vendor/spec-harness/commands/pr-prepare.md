# Command: `pr-prepare`, checklist before a pull request is written, pushed or updated

> Procedure only. Following it grants no permission to commit, push, open, edit, merge or mark a
> pull request ready. Each of those effects needs its own explicit authorization at the action boundary.

## Invocation

```text
spec-harness pr-prepare        # manual instructions only; no external action is performed
spec-harness pr-packet PR_BODY.md [--test-names FILE] [--repo DIR --base REF --head REF]
```

Run the steps in order. Do not skip a step because it looks unchanged from an earlier run; a
remembered rule is not a reading of the current rule. Where the project's own pull request rules
(its PR template, contribution guide or decisions file) differ from a step below, the project's rule
wins; record the difference in the report.

## Steps

1. **Pending PRs.** List every open PR packet whose text or evidence depends on the changed behavior,
   with its head, base and status. Update every pending one in the same task. Leave a PR that you did
   not update as PENDING and name its owner.
2. **Read the skills first.** Read the project's instructions, PR template and contribution rules.
   Invoke the project's branch-name, commit-message and PR-description skills before writing a branch
   name, a commit message or PR text. Record that the skill was read in this session.
3. **Branch and commits.** Confirm the branch name follows the repository convention. Split commits by
   purpose with the commit-message skill. A local development checkpoint is not publication history;
   keep the two apart.
4. **Rebase and ship checks.** Rebase onto the current base branch. Run the project's pre-push checks
   on the exact HEAD that will be pushed, and record that commit hash with each result. Do not push
   when a required check is missing, failed or ran on another commit. A check the project leaves to CI
   follows `commands/ship.md`.
5. **Evidence.** Capture the Before from a real run on the base branch; a reading of source code is
   source evidence and must be labelled as such. Capture the After on the exact head. For a bundler-served app, restart the bundler with its cache cleared before each capture and after any branch switch, stash or patch apply, so the served bundle matches the checked-out source. Combine the two
   into one captioned Before/After image. Do not attach separate screenshots or a video. After a fix,
   retake the captures on the new head and delete the superseded images; do not keep both.
6. **Text.** Write Summary (one outcome sentence and the smallest accurate visual), Evidence (the
   Before/After image and the checks actually run, by their real test names) and, only when there is a
   concrete risk, Merge Danger with at most three bullets. Copy test names from the branch's test diff.
7. **Claims.** Check every statement in the text against the Before/After image and the check output.
   Remove any claim the evidence does not show. Mark anything not run as UNVERIFIED or PENDING.
8. **Packet check.** Run `spec-harness pr-packet` on the saved PR body, passing the real test names
   with `--test-names`, or `--repo`, `--base` and `--head` to collect them from the branch's test diff.
   It must report no FAIL. Its PASS covers only the packet structure; it does not prove the claims in
   step 7.
9. **Merge gate.** When the change will be merged in this task, the merger role applies its PR packet
   gate (see `agents/sdd-merger.md`) before any merge effect.
10. **After a push.** Confirm that a pipeline ran on the pushed commit and passed. A pipeline that
    reports no builds did not start; re-trigger it, then confirm a passing run before reporting the PR
    as checked.
11. **Report.** State the changed outcome, the checks actually run with their results, the open gates
    and one next action. Give the full path of every file named.
