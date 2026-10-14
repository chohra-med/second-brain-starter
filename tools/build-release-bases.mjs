#!/usr/bin/env node
// Regenerates template-bases.json: the managed template bytes of earlier releases
// that differ from the current template, keyed by SHA-256. upgrade uses them as
// the three-way merge base for an install made before .second-brain/base/ existed.
//
// usage: node tools/build-release-bases.mjs --release DIR [--release DIR ...]
//   DIR is an exported release tree (for example `git archive v1.3.0 | tar -x -C DIR`),
//   holding that release's template-manifest.json and template/ folder.
// The tool reads only the named folders and this checkout. It starts no process and
// opens no network connection. Existing entries are kept, so an older release need
// not be exported again. Entries equal to the current template are dropped, because
// upgrade finds those bytes in the template itself.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'template-bases.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const releases = [];
for (let index = 0; index < args.length; index += 2) {
  if (args[index] !== '--release' || !args[index + 1]) {
    process.stderr.write('usage: node tools/build-release-bases.mjs --release DIR [--release DIR ...]\n');
    process.exit(2);
  }
  releases.push(path.resolve(args[index + 1]));
}

const current = JSON.parse(await readFile(path.join(root, 'template-manifest.json'), 'utf8'));
const currentHashes = new Set(current.entries.map((entry) => entry.sha256));
let existing = { bases: {}, releases: [] };
try {
  existing = JSON.parse(await readFile(outputPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const bases = new Map(Object.entries(existing.bases ?? {}));
const versions = new Set(existing.releases ?? []);

for (const release of releases) {
  const manifest = JSON.parse(await readFile(path.join(release, 'template-manifest.json'), 'utf8'));
  versions.add(manifest.metadata.templateVersion);
  for (const entry of manifest.entries) {
    if (entry.mergeKind !== 'managed-file') continue;
    const bytes = await readFile(path.join(release, ...entry.source.split('/')));
    if (sha256(bytes) !== entry.sha256) throw new Error(`release ${manifest.metadata.templateVersion}: ${entry.source} does not match its manifest hash`);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`release ${manifest.metadata.templateVersion}: ${entry.source} is not UTF-8 text`);
    bases.set(entry.sha256, text);
  }
}
for (const hash of [...bases.keys()]) {
  if (currentHashes.has(hash)) bases.delete(hash);
  else if (sha256(Buffer.from(bases.get(hash), 'utf8')) !== hash) throw new Error(`stored base does not match its key: ${hash}`);
}
const sorted = Object.fromEntries([...bases.entries()].sort(([left], [right]) => left.localeCompare(right)));
const document = {
  schemaVersion: 1,
  description: 'Managed template bytes of earlier releases that differ from the current template, keyed by SHA-256. Merge bases for upgrade; regenerate with tools/build-release-bases.mjs.',
  releases: [...versions].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
  bases: sorted,
};
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`template-bases.json: ${Object.keys(sorted).length} bases from releases ${document.releases.join(', ')}\n`);
