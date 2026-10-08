# Guided setup contract

Use this contract only after the user asks to set up, initialize, or get started with a copied workspace. The intended first message can be as short as: `Set this up for me`.

This is a guide for a local coding client. It does not grant filesystem, shell, network, or administrator access, and it cannot suppress the client's own permission prompts. Do not describe ordinary Claude chat or Cowork as local Code execution.

## 1. Confirm the setup request

Say what will happen: select one project folder, inspect only the needed project rules and runtime, show a complete initializer plan, wait for the user's target-bound approval, apply that exact plan, verify it, and open or point to Home.

Do not hijack repository maintenance, source edits, tests, release work, or an unrelated request. If intent is unclear, ask whether the user wants setup before using this route.

## 2. Select one exact project root

Ask for one exact existing project folder or a new workspace at a path that does not exist yet, outside the source copy. For a new path, confirm its selected existing parent and intended folder name. Do not guess from the clone location. If the user asks for help choosing, ask them to select one parent folder and list only its immediate child directory names. Do not recursively search parents, siblings, home directories, hidden directories, symlinks, `.env` files, credentials, client data, or unrelated projects.

For choosing the project, follow only the missing-question section in the source [first-use owner](template/03-Resources/Procedures/first-use.md#2-only-ask-what-is-missing). These are read-only questions, not permission to edit records. Reuse the answers after installation; the full installed procedure starts only after verification.

Repeat the exact selected path and ask the user to confirm it before reading or writing inside it. A changed path starts selection again.

Do not create a missing target before approval. The initializer plans through real ancestors and creates the target only within its approved transaction.

## 3. Read the selected project's rules

If the confirmed target does not exist, say that it has no project rules yet; do not create it to inspect it. For an existing target, before touching the selected project, read its applicable instructions in this order when present: `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, `ai_rules/`, `.memory/`, and `README.md`. Follow those project rules for any later project work. If they conflict with this contract, stop and explain the conflict before proceeding.

Only inspect the selected project and files required for this setup. A declared instruction path such as `.memory/` may be read when the project's rules require it. Do not browse unrelated hidden directories or open secrets, credentials, environment files, or unrelated files.

## 4. Check the required runtime

Check whether an existing Node.js runtime is version 22 or newer. The free starter has zero production dependencies. Do not install a project's dependencies just because it has a lockfile.

When Node is missing or too old, explain the need in plain language and ask for approval before installing anything. With approval, use a trusted version manager already present or the operating system's package manager. Never use curl piped to a shell, silent privilege escalation, disabled verification, arbitrary generated installers, or unrelated global packages. If no trusted route is available, link or point the user to the official Node installer and stop for them to finish that step.

## 5. Produce the canonical plan

Run the copied starter's canonical initializer only for the confirmed target: `node ./bin/second-brain.mjs init --target ABSOLUTE_TARGET`.

Translate its complete target-bound plan into plain language. Keep the full displayed plan digest unchanged. Do not write any workspace file before approval. If the plan reports a conflict, explain the named path and stop for a manual decision. Preserve existing loader instructions for manual review, or let the user separately select an empty workspace and produce a fresh plan and digest. Never rename, delete or append managed markers to instructions to bypass rejection. If the target changes or the plan changes, produce a new plan and discard the old digest.

## 6. Obtain human approval

Ask one clear question that names the exact target and asks approval for that displayed plan. The user, not the agent, approves the plan. Do not accept silence, an earlier approval, or approval for a different target or digest.

After the user approves, supply the unchanged full digest to the canonical initializer. Do not ask the user to type or copy a terminal command unless they ask for it; client permission prompts still apply.

## 7. Apply and verify

Run `node ./bin/second-brain.mjs init --target ABSOLUTE_TARGET --apply EXACT_PLAN_DIGEST`, then run `node ./bin/second-brain.mjs verify --target ABSOLUTE_TARGET`.

Report the initializer receipt ID and the verification result. A stale digest, changed target, conflict, or failed verification stops the route. Do not work around a failure with `--force`; it does not exist in V1.

## 8. Draft records and hand off

After successful verification, open or point the user to the installed `Home.md` and follow `03-Resources/Procedures/first-use.md` inside that target. That installed procedure owns missing-only questions, the exact personalization approval, the first useful artifact, its check, close and new-chat continuation. Mark unknown facts as unknown. Do not draft or overwrite records before its approval gate.

On repeated or interrupted setup, inspect the receipt and current installed state, verify, then fill only actual gaps through the same first-use owner. Do not replay completed writes or claim authenticated client discovery or universal client compatibility without separate observed evidence.
