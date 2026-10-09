# Contributing

The public source repository is `chohra-med/second-brain-starter`. Use the repository's current contribution route and include the affected file, the observed problem, a reproducible example, and the safer wording or change you propose.

This starter is MIT-licensed under [LICENSE](LICENSE). Contributions intended for the starter must be compatible with those terms and retain required attribution. Do not add copied course material, proprietary templates, or code without clear permission and attribution.

Before proposing a feature, check whether the documented initializer and the manual workflow already solve the need. A new automation, integration, or multi-project layer needs an explicit design decision, not a hopeful checkbox. Changes to the initializer must preserve its complete-plan, exact-digest approval, conflict, receipt, and rollback boundaries. The multi-repository `connect` layer is such a decision; it is recorded in [CHANGELOG.md](CHANGELOG.md) under the version that introduced it.

Do not include credentials, client data, private journals, unpublished product material, or private application files in a suggestion or shared copy.

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
7. Replace the vendored folder: `rm -rf vendor/spec-harness && mkdir vendor/spec-harness && cp -R "$S/EXPORT/." vendor/spec-harness/`.
8. Save the script below as `"$S/pin.mjs"`, then write the pin: `node "$S/pin.mjs" "$S/EXPORT" "$S/LS-TREE.txt" C TREE https://github.com/chohra-med/spec-harness-oss > vendor/SPEC-HARNESS-PIN.json`. Do not edit the pin by hand.
9. If the commit or the harness version changed, update the Spec Harness section of [ATTRIBUTION.md](ATTRIBUTION.md). That section may name only the pinned commit.
10. Update the `vendor/` lines of [FILE-ALLOWLIST.txt](FILE-ALLOWLIST.txt). Keep `vendor/SPEC-HARNESS-PIN.json`. Keep one `vendor/spec-harness/<path>` line for each file in the new inventory, remove the lines of files that are gone, and change nothing else.
11. Run `node --test test/vendor.test.mjs`. It must report `# fail 0`. Then run `node --test` for the whole suite.

The script `pin.mjs`:

```js
// Writes vendor/SPEC-HARNESS-PIN.json for one upstream commit.
// usage: node pin.mjs EXPORT_DIR LS_TREE_LISTING COMMIT TREE REPOSITORY_URL > vendor/SPEC-HARNESS-PIN.json
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const [exportDir, listing, commit, tree, repository] = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modes = new Map();
for (const line of readFileSync(listing, 'utf8').split('\n').filter(Boolean)) {
  const [meta, file] = line.split('\t');
  modes.set(file, meta.split(' ')[0]);
}
const paths = [...modes.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
const sourceInventory = paths.map((file) => {
  const bytes = readFileSync(path.join(exportDir, ...file.split('/')));
  const entry = { path: file, bytes: bytes.length, sha256: sha256(bytes) };
  if (modes.get(file) === '100755') entry.executable = true;
  return entry;
});
const manifest = JSON.parse(readFileSync(path.join(exportDir, 'install-manifest.json'), 'utf8'));
const pin = {
  schemaVersion: 1,
  repository,
  commit,
  tree,
  harnessVersion: manifest.harnessVersion,
  license: { spdx: 'MIT', path: 'LICENSE', sha256: sha256(readFileSync(path.join(exportDir, 'LICENSE'))) },
  sourceInventory,
};
process.stdout.write(`${JSON.stringify(pin, null, 2)}\n`);
```

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
