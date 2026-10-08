# Method: Ponytail

Portable adaptation of Malik Chohra's Ponytail method, dated 2026-10-05. Apply at full intensity throughout code and mixed-product work. Keep it active for the whole wave unless the user says `stop ponytail` or `normal mode`.

Understand the actual request and trace its callers before choosing a change. Stop at the first rung that works:

1. Confirm the need is real.
2. Reuse an existing project helper or procedure.
3. Use the standard library.
4. Use a native platform feature.
5. Use an already-installed dependency.
6. Make the smallest new change.

Preserve input validation, trust boundaries, data-loss protections and explicit user constraints. Do not add abstractions, dependencies or configuration without evidence. Record the highest successful rung, what was reused, what was excluded and the evidence that would justify reopening an exclusion. Keep unrelated source untouched. If a deliberate simplification has a known ceiling, document the ceiling and the evidence needed to upgrade it.
