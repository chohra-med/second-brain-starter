# Contributing

The public source repository is `chohra-med/second-brain-starter`. Use the repository's current contribution route and include the affected file, the observed problem, a reproducible example, and the safer wording or change you propose.

The starter's own files are MIT-licensed under [LICENSE](LICENSE). Bundled third-party folders keep their own licences, listed in [ATTRIBUTION.md](ATTRIBUTION.md): `icm-architect`, `humanizer` and `api-anything` (all MIT, by other authors) and the vendored Spec Harness (MIT). Contributions intended for the starter must be compatible with those terms and retain required attribution. Do not add copied course material, proprietary templates, or code without clear permission and attribution.

Before proposing a feature, check whether the documented initializer and the manual workflow already solve the need. A new automation, integration, or multi-project layer needs an explicit design decision, not a hopeful checkbox. Changes to the initializer must preserve its complete-plan, exact-digest approval, conflict, receipt, and rollback boundaries. The multi-repository `connect` layer is such a decision; it is recorded in [CHANGELOG.md](CHANGELOG.md) under the version that introduced it.

Do not include credentials, client data, private journals, unpublished product material, or private application files in a suggestion or shared copy.

## Guidelines for code changes

Behavioural guidelines for code changes (think before coding, simplicity first, surgical changes, goal-driven execution): see the upstream rules at https://github.com/multica-ai/andrej-karpathy-skills. Apply them only where they do not conflict with this file.

## Re-pinning the vendored Spec Harness

The bundled copy lives in `vendor/spec-harness/`. It is a byte-for-byte copy of one upstream commit. [vendor/SPEC-HARNESS-PIN.json](vendor/SPEC-HARNESS-PIN.json) records that commit, its tree, the harness version, the SHA-256 of `LICENSE`, and for every vendored file its path, byte count and SHA-256. Files with the executable bit also carry `"executable": true`. `test/vendor.test.mjs` checks the folder against the pin. `lib/connect.mjs` refuses a pin that lacks `schemaVersion: 1`, a full commit, a full tree, or the manifest's `harnessVersion`.

The pin file itself stays on the allowlist. It is listed as `vendor/SPEC-HARNESS-PIN.json`, next to one `vendor/spec-harness/<path>` line for each file in the inventory.

Run the steps in order from the repository root, in bash or zsh (step 6 uses `<(...)`). Every scratch path lives under one folder, so nothing is written inside the repository except the vendored folder, its pin, and the ATTRIBUTION.md and FILE-ALLOWLIST.txt lines it names.

1. Choose one full 40-character commit `C` on `chohra-med/spec-harness-oss`.
2. Name one scratch folder, once: `S=$(mktemp -d)`. Every path below starts with `$S/`.
3. Clone the upstream repository: `git clone https://github.com/chohra-med/spec-harness-oss "$S/UPSTREAM"`.
4. Record the tracked files and the tree: `git -C "$S/UPSTREAM" ls-tree -r C > "$S/LS-TREE.txt"`, then `git -C "$S/UPSTREAM" rev-parse C^{tree}`. The second value is `TREE`.
5. Export `C` into an empty folder: `mkdir "$S/EXPORT" && git -C "$S/UPSTREAM" archive C | tar -x -C "$S/EXPORT"`.
6. Prove the export holds exactly the tracked files: `diff <(cut -f2 "$S/LS-TREE.txt" | sort) <(cd "$S/EXPORT" && find . -type f | sed 's|^\./||' | sort)`. It must print nothing. If it prints anything, stop.
7. Dry-run the pin tool. It recomputes the git tree hash from the exported bytes, refuses an export that does not match `TREE`, and writes nothing: `node tools/update-harness-pin.mjs --source "$S/EXPORT" --commit C --tree TREE --dry-run`. It prints the file count, the tree and the license hash it checked.
8. Run the same command without `--dry-run`. It replaces `vendor/spec-harness/`, writes `vendor/SPEC-HARNESS-PIN.json`, rewrites the `vendor/` lines of [FILE-ALLOWLIST.txt](FILE-ALLOWLIST.txt) and the commit in [ATTRIBUTION.md](ATTRIBUTION.md), and writes nothing else. Do not edit the pin by hand. Add `--accept-license-change` only when the upstream `LICENSE` changed on purpose; the tool refuses a changed license without it.
9. Read the diff of [ATTRIBUTION.md](ATTRIBUTION.md). The Spec Harness section may name only the pinned commit.
10. Read the diff of [FILE-ALLOWLIST.txt](FILE-ALLOWLIST.txt). Only the `vendor/` lines change, and `vendor/SPEC-HARNESS-PIN.json` stays on the list.
11. Run `node --test test/vendor.test.mjs`. It must report `# fail 0`. Then run `node --test` for the whole suite.

Two traps apply inside this repository:

- **Nested ignore and attribute files are live.** `vendor/spec-harness/.gitignore` ignores `.DS_Store`, `*.log`, `_run-logs/` and `node_modules/`. A blanket `git add` skips an untracked file that matches it, without a message. After copying, run `git status --ignored vendor/spec-harness` and confirm that no file from the upstream tree is missing.
- **Line endings are normalised on add.** The root and vendored `.gitattributes` both say `* text=auto eol=lf`. A file that arrives with CRLF bytes is stored as LF, so the copy in the repository no longer matches the upstream bytes. Check with `git ls-files --eol vendor/spec-harness` before committing. Every vendored file must show `i/lf`.

## Local files that break the real-tree tests

Finder creates a `.DS_Store` file in any folder it opens. The root `.gitignore` lists it, so git does not track it, but the tests do not skip it. A stray `.DS_Store` at the repository root turns the test "the real source root, vendored bytes included, passes the package scanner" red, because the scanner rejects every file that is not in the allowlist. A stray `.DS_Store` inside `vendor/spec-harness/` also turns red the test that checks the vendored inventory. Delete it before you run `node --test`:

```sh
find . -name .DS_Store -not -path './.git/*' -delete
```

## Counting the suite

`node --test` also runs `test/helpers/consumer-cli.mjs` as a test file. It has no tests of its own, but it reports one passing test, so a full run counts one more than the test files add up to. The change that keeps the count honest is to say so here rather than change the test glob.
