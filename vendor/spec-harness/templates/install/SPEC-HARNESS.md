# Spec Harness: {{PROJECT_NAME}}

Status: **PENDING**. This deterministic install stages the harness; it does not inspect this
project, derive rules or skills, bind roles, or create feature-specific acceptance.

## SDD entry
- A code ticket is any change to a tracked file outside `specs/` and `.memory/`. It goes through `/sdd` before the first source edit, even when it looks small: the light route is still `/sdd`. Keep the ticket's code inside this repository: no worktree, clone or copy elsewhere unless the user asks for one.
- Claude: `/sdd init` or `/sdd <ticket text or connected reference>` → `.claude/commands/sdd.md`.
- Codex: use `.agents/skills/sdd/SKILL.md` when project skills are available, or follow the same
  procedure manually. File presence does not prove native discovery or delegation.
- Shell: `spec-harness sdd ...` (with no install, `npx -y github:chohra-med/spec-harness-oss sdd ...`)
  prints the shared procedure and exits 2/PENDING; no model stage or independent gate ran.

## Next work
- Read this project's existing policies and preserve their authority.
- Fill the memory bank and ai_rules/rules/frequent_rules.md from project evidence.
- Bind each installed role and the project skills to cited package evidence; have a separate
  fresh reviewer confirm the claims after the structural check.
- Keep each ticket's acceptance in `specs/<feature>/goal.md`; preserve the root goal scaffold.
- Re-run the relevant checks before calling this setup READY.
