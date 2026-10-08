# Method: Package Finder

Portable adaptation of source-grounded package discovery, dated 2026-10-05. Run after inspecting target structure and applicable rules.

1. Enumerate package paths, manifests, workspace declarations, lockfiles, declared dependency ranges and scripts. Open representative imports and source to establish actual use; a bare dependency-name match is not proof. Record declared range separately from resolved lockfile and installed versions; never infer one from another.
2. Prefer an already-installed package when it satisfies the need. For a new or version-dependent recommendation, identify the target version plus runtime, native-platform and peer constraints before documentation lookup.
3. Use Context7 when available: resolve with `resolve-library-id(libraryName, query)` using those target constraints, then retrieve docs with `query-docs(libraryId, query)`. The CLI route is `ctx7 library <name> <query>` then `ctx7 docs <libraryId> <query>`. Confirm returned library identity and documentation version match the target. Missing access, version identity or documentation coverage means the affected recommendation is PENDING, not a guess based on latest docs.
4. Record each candidate's package boundary and need, considered version, declared/resolved/installed version evidence, runtime/native/peer constraints, docs source and access date, and selected/excluded/PENDING reason. Do not edit manifests or claim compatibility from a search result alone. Do not install packages as part of discovery.

Context7 references: https://github.com/upstash/context7 (checked 2026-10-05). Live Context7 access is not implied by this method.
