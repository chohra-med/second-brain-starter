# Method: Skill Finder

Portable adaptation of skill discovery, dated 2026-10-05. Run after reading project structure, rules and already-installed skills.

1. Inventory project-local installed skills and capabilities explicitly exposed by the active client. Let the inspected project structure and task define a small search scope. Open only relevant candidate instructions; do not scan unrelated global skill stores. Match only skills that address an evidenced need and fit runtime and package boundaries.
2. When Vercel Skills discovery is available, use its Find Skills route (`npx skills find <query>`), then open each candidate's actual instructions. Inspect provenance (pin the inspected revision or content hash when available), license, supported runtime and project scope. A listing, popularity or source link is not proof of compatibility.
3. Record selected and excluded candidates with evidence in the existing initialization or feature research/plan artifact. Mark unavailable tooling, unknown revision, unreadable content or uncertain license/runtime/scope PENDING. Discovery never installs a third-party skill; installation is separate and requires target policy and collision review.

References: https://github.com/vercel-labs/skills and https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md (checked 2026-10-05). Native discovery and live search are unverified unless actually exercised.
