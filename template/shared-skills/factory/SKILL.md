---
name: factory
description: Takes one coding task from the person's pasted text to a branch that is ready for review, through Spec Harness /sdd when the repository has it and a plain plan, build and test path when it does not, and keeps one local board file with each task's lane and next action. The person approves the plan and pushes themselves. Use when the person pastes a coding task to work through, or asks where a task stands on the board.
metadata:
  scope: oss
---

# Factory

This skill takes one coding task from "to do" to a branch that is ready for review, then hands the push to the person. It keeps one board file per project. It needs no tracker, no published page and no token, and it works with any git host. The person acts at two points: approving the plan, and giving the go for each push.

## Do not use this when

- The task is not a code change in a repository. Record it with `second-brain-capture` instead.
- You are asked to push, open a pull request or merge on the person's behalf. This skill never does any of these.
- The repository's own rules give a different delivery route. Follow those rules; the board only records what happened.

## The board

- One file per project: `01-Projects/<project>/factory/board.md`. Copy [the board template](assets/board.md) there the first time.
- Lanes, in order: To do, Plan, Build, Ready for review, Pushed, Done.
- One row per task: its id, a short title, its lane, its packet folder, the next action with who acts, and the time of the last change.
- Approvals: each "approve plan" and each "go" the person says in chat, written with the time and their words.

## The push rule

Each push needs the person's own go for that push. A go covers one push only: a later push needs a new go. Claude never pushes, never opens a pull request and never merges. Claude runs the checks, gives the exact command, and the person runs it.

## Steps

1. **Intake.** The person types or pastes the task. Give it the next free id (T1, T2 and so on), add one row in To do with a short title, and name the project and the repository. Check: the board has exactly one row for the task, in To do.
2. **Start.** In the task's repository, look for Spec Harness: a `SPEC-HARNESS.md` file or `.claude/commands/sdd.md`. With it, run `/sdd` with the task text; it classifies the task and pins a packet folder. Without it, create the packet folder `01-Projects/<project>/factory/<id>/` and write `plan.md` there: the goal, the files to change, the test that proves the change, and the risks. Move the row to Plan and write the packet folder into it. Check: the packet folder holds the plan, and the row names the folder.
3. **Plan checkpoint.** Show the plan and wait. No code changes before the person approves it. When they approve, write the time and their words into Approvals, and move the row to Build. Check: Approvals has an "approve plan" line for the task, and nothing in the repository changed before that time.
4. **Build and test.** With Spec Harness, `/sdd` builds the change and runs its independent gates: tester, verifier and reviewer. Without it, make the change on a new branch, add or update the test that proves it, and run the project's tests. Check: every gate passed, or every project test passed, on the current commit.
5. **Ready for review.** Run the checklist below on the exact commit that will be pushed, and write its hash on the board. Move the row to Ready for review, with the next action "Give the go for the push (person)". Check: every checklist line holds for that commit hash.
6. **Go and push.** Wait for the person's go. Write it into Approvals with the time, then give the exact push command for this branch and remote. The person runs it. Check: the "go" line is on the board, with a time before the push.
7. **Pull request.** When the person shares the push output, pass on the host's "create pull request" link exactly as printed. Never build or change a link. The person opens the draft pull request with the PR text. Move the row to Pushed and put the link in it. Check: the row holds the link from the push output, unchanged.
8. **Pipeline and done.** Ask the person to check the first pipeline run for that commit, and write its result on the row. When the pull request is merged, move the row to Done and add one line about the task to today's note in `05-Daily/`. Check: the row is in Done, and today's note names the task.

## Ready-for-review checklist

Run it on the exact commit that will be pushed.

- The ship check passes on this commit: with Spec Harness, its `pr-prepare` checklist and the project's pre-push checks; without it, the project's tests, lint and build.
- With Spec Harness, the tester, verifier and reviewer gates passed on this commit.
- The diff holds only this task's change: no stray files, no secrets, no personal paths.
- The PR text is written, with a Summary and an Evidence part, and each claim in it matches the evidence.
- The evidence is one Before/After image for a change people can see, or the test output for one they cannot.
- The branch name and the commit messages follow the repository's rules.
- The built-in `/security-review` ran on the branch's changes. A new skill, hook or config file under `.claude/`, `.agents/` or `hooks/` also passed the `security-check` skill.

## Example

The person pastes "The invoice page shows dates as month/day; show day.month.year". The board gets T1 in To do. The repository has `SPEC-HARNESS.md`, so `/sdd` pins the packet and writes the plan. The person says "yes" to the plan at 10:12, which goes into Approvals, and T1 moves to Build. The gates pass, the checklist holds for commit `abc1234`, and T1 moves to Ready for review. The person says "go" at 15:40; Claude gives the push command, the person runs it and pastes the output, and Claude passes on the "create pull request" link. T1 moves to Pushed.

To add Spec Harness to a repository, use the starter's `connect` command, described on Home.
