#!/usr/bin/env node
// Regenerates template-bases.json: the frozen legacy set of managed and seed bytes that a
// merge needs for an install made before 1.5.0. From 1.5.0 an apply records its own base
// snapshots in the workspace, so this file is not extended by later releases.
//
// usage: node tools/build-release-bases.mjs --source LABEL=COMMIT=DIR [--source ...]
//   LABEL is one of the release labels below. COMMIT is the full commit that DIR exports; it is
//   recorded in the output, not checked, because the tool starts no process.
//   DIR is that commit exported with `git archive COMMIT | tar -x -C DIR`, holding its
//   template-manifest.json and template/ folder.
// The file is rebuilt from the named sources only. The existing template-bases.json is never
// read. Each source lists every managed-file and seed-file entry of its manifest (not
// managed-block). Every source file must hash to its manifest entry and be UTF-8 text. The
// bytes of an entry the current template does not provide are stored under their SHA-256.
// The tool starts no process and opens no network connection.
//
// Reproduce the file from fresh exports (run from the repository root, in bash or zsh):
//   S=$(mktemp -d)
//   mkdir "$S/1.1.0" && git archive d07369745c8d1f023d1c85f4cf949304df78adf8 | tar -x -C "$S/1.1.0"
//   mkdir "$S/1.2.0" && git archive 6fc244e9b72ba4beab3d57fe2676883b4b25e624 | tar -x -C "$S/1.2.0"
//   mkdir "$S/1.3.0" && git archive 250cfe58503098ac338cad57558e720cad72a128 | tar -x -C "$S/1.3.0"
//   mkdir "$S/1.4.0" && git archive 3f2e8992b98316ae320618509ae80585cc9242eb | tar -x -C "$S/1.4.0"
//   node tools/build-release-bases.mjs \
//     --source 1.1.0=d07369745c8d1f023d1c85f4cf949304df78adf8="$S/1.1.0" \
//     --source 1.2.0=6fc244e9b72ba4beab3d57fe2676883b4b25e624="$S/1.2.0" \
//     --source 1.3.0=250cfe58503098ac338cad57558e720cad72a128="$S/1.3.0" \
//     --source 1.4.0=3f2e8992b98316ae320618509ae80585cc9242eb="$S/1.4.0"
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'template-bases.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const byDestination = (left, right) => byText(left.destination, right.destination);
const usage = 'usage: node tools/build-release-bases.mjs --source LABEL=COMMIT=DIR [--source ...]\n';

// The release each label names. There is no source for the untagged 3c944c1 main build: installs made from it get no base.
const SOURCE_NOTES = {
  '1.1.0': 'tag v1.1.0',
  '1.2.0': 'no tag; the install commit UPGRADING.md names',
  '1.3.0': 'tag v1.3.0',
  '1.4.0': 'tag v1.4.0',
};
const DESCRIPTION = 'Frozen legacy set for installs made before 1.5.0: the managed and seed bytes of releases 1.1.0, 1.2.0, 1.3.0 and 1.4.0, keyed by SHA-256. Each source lists its commit and every managed-file and seed-file entry of its manifest. Regenerate with tools/build-release-bases.mjs.';

const args = process.argv.slice(2);
const requested = [];
for (let index = 0; index < args.length; index += 2) {
  if (args[index] !== '--source' || !args[index + 1]) {
    process.stderr.write(usage);
    process.exit(2);
  }
  const [label, commit, ...rest] = args[index + 1].split('=');
  const dir = rest.join('=');
  if (!SOURCE_NOTES[label] || !/^[0-9a-f]{40}$/.test(commit ?? '') || !dir) {
    process.stderr.write(`bad --source (label must be one of ${Object.keys(SOURCE_NOTES).join(', ')}; commit must be 40 lowercase hex): ${label}\n`);
    process.exit(2);
  }
  if (requested.some((source) => source.label === label)) throw new Error(`source ${label} is named twice`);
  requested.push({ label, commit, dir: path.resolve(dir) });
}

const current = JSON.parse(await readFile(path.join(root, 'template-manifest.json'), 'utf8'));
const currentHashes = new Set(current.entries.map((entry) => entry.sha256));
const sources = [];
const bases = new Map();

for (const { label, commit, dir } of requested) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'template-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`${label}: manifest schemaVersion must be 1`);
  const entries = [];
  for (const entry of manifest.entries) {
    if (entry.mergeKind !== 'managed-file' && entry.mergeKind !== 'seed-file') continue;
    const bytes = await readFile(path.join(dir, ...entry.source.split('/')));
    if (sha256(bytes) !== entry.sha256) throw new Error(`${label}: ${entry.source} does not match its manifest hash`);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label}: ${entry.source} is not UTF-8 text`);
    entries.push({ destination: entry.destination, mergeKind: entry.mergeKind, sha256: entry.sha256 });
    if (!currentHashes.has(entry.sha256)) bases.set(entry.sha256, text);
  }
  sources.push({ label, commit, note: SOURCE_NOTES[label], entries: entries.sort(byDestination) });
}

const document = {
  schemaVersion: 2,
  description: DESCRIPTION,
  sources,
  bases: Object.fromEntries([...bases.entries()].sort(([left], [right]) => byText(left, right))),
};
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`template-bases.json: ${sources.length} sources (${sources.map((source) => source.label).join(', ')}), ${bases.size} bases\n`);
