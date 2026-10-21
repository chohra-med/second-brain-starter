# Method: repository conventions

Use this during initialization, and in planning when a ticket touches branch names, commits, pull
requests, how work is split into tasks, or code style. The target repository's own explicit policy
always wins over anything this method suggests.

This method is usable before a synthesis receipt or feature goal exists.

## Inspect before recording

1. Read the root and nearest `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, any pull-request template,
   the CI configuration and the relevant `.memory/` decision files.
2. If Git is available, read `git status --short --branch`, a small sample of recent local branch
   names and a small sample of recent commit subjects that touch the area. Use read-only commands.
   Do not fetch, switch, create, commit or push anything during discovery.
3. Compare repeated patterns across several examples and record where each was seen. A branch name
   or commit seen once is an example, not a convention.
4. For a choice the source cannot settle (ticket prefix, issue-key shape, merge style, branch
   lifetime), ask it through the Grill Me method (`grill-me.md` next to this file), with a
   recommended answer, only when it affects this project. Record the accepted answer, who gave it
   and its scope.

## Branch names

Use the existing branch pattern, and the repository's own branch-naming skill when it has one.
With no stable pattern in evidence, propose a short type/scope/ticket form such as
`feat/<short-scope>-<ticket>` and label it `PROPOSED` until someone accepts it. Take a ticket key
only from the supplied ticket; never invent one. Check the proposal against the repository's rules
without creating or switching a branch.

## Commits and pull requests

Follow the repository's instructions and any installed commit-message or pull-request skill. Ground
a commit message in the staged diff, keep one purpose per commit, and keep the existing commit style
where history shows one. A pull-request description states the problem, the behaviour change, the
scope and the checks that actually ran; it never claims a check that did not run. This method drafts
text only. It grants no commit, push, pull-request or merge authority.

## Split work into tasks

- Split by independently checkable behaviour and explicit dependency order, not by file count or
  by role name.
- Prefer vertical tasks that each leave a useful, testable result. Put shared interfaces and
  migrations before the code that uses them.
- Give each task exact paths, at least one literal goal check, a real test command, its
  dependencies and its authority boundary. Merge tiny inseparable edits; split unrelated ones.
- Keep tests, docs and callers with the behaviour they protect. A task whose acceptance is untested
  is not complete because its code compiles.

## Where the result goes

Label every statement `EXPLICIT` (written policy), `OBSERVED` (repeated in history or source),
`ADOPTED BASELINE` (a general default the project accepted) or `PROPOSED` (not yet accepted), and
cite its source or the decision that accepted it. Record it in the project's own conventions file
when it has one; otherwise in a `Conventions` subsection of the root `RULES.md` during init, or in
the ticket's `plan.md` during planning. Record missing Git history and unsupported clients
explicitly. Preserve human-authored text. When no stable rule exists, leave the proposal visibly
unaccepted instead of presenting it as history.

During initialisation, code-consistency patterns (where errors are reported, how data is fetched,
where new screens go, naming) follow the same path: show each `OBSERVED` pattern to the owner as a
proposal with a recommended answer. An accepted one becomes one project rule line and one `DEC-` line
in `.memory/60-decisions.md` with who accepted it and when (`rules.md`, Rule layers). A schema 4
receipt refuses READY while a rule is still marked `PROPOSED`.
