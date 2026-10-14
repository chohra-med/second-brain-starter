import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planInstall, sha256, stableStringify } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

// template-bases.json is the FROZEN legacy set of managed and seed bytes for installs made before
// 1.5.0. `sources` names each release (label and commit) and lists every managed-file and
// seed-file entry of that release's manifest. `bases` holds the bytes of each listed sha256 that
// the current template does not provide, keyed by that sha256. An install made by 1.2.0 records
// the 1.2.0 template hash; without a stored base its local edits cannot be merged. The 1.2.0
// source must list exactly the entries of the real 1.2.0 manifest the fixture was installed from.
const bases = JSON.parse(await readFile(path.join(sourceRoot, 'template-bases.json'), 'utf8'));
const current = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
const release = JSON.parse(fixture.manifestBytes);
const currentHashes = new Set(current.entries.map((entry) => entry.sha256));
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const byDestination = (left, right) => (left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0);

// The four sources, in order, with the commit each label names. There is no 3c944c1 source.
const EXPECTED_SOURCES = [
  ['1.1.0', 'd07369745c8d1f023d1c85f4cf949304df78adf8'],
  ['1.2.0', '6fc244e9b72ba4beab3d57fe2676883b4b25e624'],
  ['1.3.0', '250cfe58503098ac338cad57558e720cad72a128'],
  ['1.4.0', '3f2e8992b98316ae320618509ae80585cc9242eb'],
];

// One line per listed entry the current template does not provide whose base is missing or does not hash to its key.
function unresolvedBases(document, hashes) {
  const problems = [];
  for (const source of document.sources ?? []) {
    for (const entry of source.entries ?? []) {
      if (hashes.has(entry.sha256)) continue;
      const text = document.bases?.[entry.sha256];
      if (typeof text !== 'string') problems.push(`${source.label} ${entry.destination} ${entry.sha256.slice(0, 12)} has no base`);
      else if (sha(text) !== entry.sha256) problems.push(`${source.label} ${entry.destination} base does not hash to its key`);
    }
  }
  return problems;
}

test('template-bases.json names the four sources in order, and every base a listed entry needs is stored and hashes to its key', () => {
  assert.equal(sha(fixture.manifestBytes), 'e40baf119b921df58a5178aae37394b44813d4e5495961ddb0970da174c9d7c4');
  assert.equal(bases.schemaVersion, 2);
  assert.deepEqual(bases.sources.map((source) => [source.label, source.commit]), EXPECTED_SOURCES);
  const realRelease = release.entries
    .filter((item) => item.mergeKind !== 'managed-block')
    .map(({ destination, mergeKind, sha256: hash }) => ({ destination, mergeKind, sha256: hash }))
    .sort(byDestination);
  const listed = bases.sources.find((source) => source.label === '1.2.0').entries.slice().sort(byDestination);
  assert.deepEqual(listed, realRelease, '1.2.0 source entries differ from the real 1.2.0 manifest');
  assert.deepEqual(unresolvedBases(bases, currentHashes), [], 'a listed entry has no stored base, or its base does not hash to its key');
});

test('the base check names a deleted base and a base with altered bytes (positive control)', () => {
  const target = bases.sources.find((source) => source.label === '1.2.0').entries.find((entry) => !currentHashes.has(entry.sha256));
  assert.ok(target, 'the 1.2.0 source has an entry the current template lacks');
  const deleted = structuredClone(bases);
  delete deleted.bases[target.sha256];
  assert.ok(unresolvedBases(deleted, currentHashes).some((line) => line.startsWith(`1.2.0 ${target.destination} `) && line.endsWith('has no base')), 'a deleted base is not reported');
  const altered = structuredClone(bases);
  altered.bases[target.sha256] = `${altered.bases[target.sha256]}altered\n`;
  assert.ok(unresolvedBases(altered, currentHashes).some((line) => line.startsWith(`1.2.0 ${target.destination} `) && line.endsWith('does not hash to its key')), 'an altered base is not reported');
});

test('a 1.2.0 install with a local edit to a file the release changed merges, and keeps the edit', async (t) => {
  const target = await mkdtemp(path.join(tmpdir(), 'second-brain-release-bases-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  const put = async (posixPath, content) => {
    const destination = path.join(target, ...posixPath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  for (const [destination, content] of Object.entries(fixture.files)) await put(destination, content);
  await put('.second-brain/installed-state.json', `${stableStringify(fixture.state)}\n`);
  await put(fixture.receiptPath, `${stableStringify(fixture.receipt)}\n`);
  // A line at the end of the file, away from the sentence the 1.3.0 template rewrote.
  const edited = '00-Meta/AGENTS.md';
  await appendFile(path.join(target, ...edited.split('/')), '\nLocal note the template does not have.\n');

  const manifestBytes = await readFile(path.join(sourceRoot, 'template-manifest.json'));
  const plan = await planInstall({ manifest: current, manifestBytes, sourceRoot, targetPath: target, operation: 'upgrade' });
  const entry = plan.entries.find((item) => item.destination === edited);
  assert.equal(entry.status, 'MERGE', `${edited} is ${entry.status}, expected MERGE`);
  assert.equal(plan.entries.filter((item) => item.status === 'CONFLICT').length, 0);
  assert.match(entry.postimage.toString('utf8'), /Local note the template does not have\./);
  assert.equal(sha256(Buffer.from(fixture.files[edited])) !== sha256(entry.postimage), true);
});
