# Contributing

The public source repository is `chohra-med/second-brain-starter`. Use the repository's current contribution route and include the affected file, the observed problem, a reproducible example, and the safer wording or change you propose.

This starter is MIT-licensed under [LICENSE](LICENSE). Contributions intended for the starter must be compatible with those terms and retain required attribution. Do not add copied course material, proprietary templates, or code without clear permission and attribution.

Before proposing a feature, check whether the documented initializer and the manual workflow already solve the need. A new automation, integration, or multi-project layer needs an explicit design decision, not a hopeful checkbox. Changes to the initializer must preserve its complete-plan, exact-digest approval, conflict, receipt, and rollback boundaries. The multi-repository `connect` layer is such a decision; it is recorded in [CHANGELOG.md](CHANGELOG.md) under the version that introduced it.

Do not include credentials, client data, private journals, unpublished product material, or private application files in a suggestion or shared copy.

## Re-pinning the vendored Spec Harness

The bundled copy lives in `vendor/spec-harness/`. It is a byte-for-byte copy of one upstream commit, and [vendor/SPEC-HARNESS-PIN.json](vendor/SPEC-HARNESS-PIN.json) records that commit. `test/vendor.test.mjs` checks the folder against the pin. To move the pin:

1. Pick one upstream commit `C` on `chohra-med/spec-harness-oss`, and export its tracked tree with `git archive C` into an empty temporary folder. Do not copy from a working tree that has local edits.
2. Replace `vendor/spec-harness/` with that export, so the folder holds the full tracked tree of `C` and nothing else.
3. Regenerate `vendor/SPEC-HARNESS-PIN.json` from `C`: `commit` is `C`, `tree` is `git rev-parse C^{tree}`, `harnessVersion` is the harness version in the vendored `install-manifest.json`, `license` holds the SHA-256 of the vendored `LICENSE`, and `sourceInventory` lists each file with its byte count, SHA-256, and `"executable": true` for each file whose mode is `100755` (`git ls-tree -r C` shows the mode).
4. Update the Spec Harness section of [ATTRIBUTION.md](ATTRIBUTION.md) to name the new commit and version. That section may name only the pinned commit.
5. Update the `vendor/` block of [FILE-ALLOWLIST.txt](FILE-ALLOWLIST.txt) so it lists exactly the files in the new inventory.
6. Run `node --test test/vendor.test.mjs`, then the full suite.

Two traps apply inside this repository:

- **Nested ignore and attribute files are live.** `vendor/spec-harness/.gitignore` ignores `.DS_Store`, `*.log`, `_run-logs/` and `node_modules/`. Git skips an untracked file that matches it without any message. After copying, run `git status --ignored vendor/spec-harness` and confirm that no file from the upstream tree is missing.
- **Line endings are normalised on add.** The root and vendored `.gitattributes` both say `* text=auto eol=lf`. A file that arrives with CRLF bytes is stored as LF, so a fresh clone holds different bytes from the upstream commit and the pin test fails there. Check with `git ls-files --eol vendor/spec-harness` before committing. Every vendored file must show `i/lf`.

## Local files that break the real-tree tests

Finder creates a `.DS_Store` file in any folder it opens. Git ignores it, and the repository ignores it too, but the tests do not. A stray `.DS_Store` at the repository root turns the test "the real source root, vendored bytes included, passes the package scanner" red, because the scanner rejects every file that is not in the allowlist. A stray `.DS_Store` inside `vendor/spec-harness/` also turns red the test that checks the vendored inventory. Delete it before you run `node --test`:

```sh
find . -name .DS_Store -not -path './.git/*' -delete
```
