import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planInstall, sha256, stableStringify } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

// template-bases.json holds the managed bytes of earlier releases that a merge needs as
// its base. An install made by 1.2.0 records the 1.2.0 template hash; if that hash is
// not in template-bases.json (or in the current template), its local edits cannot be
// merged and become CONFLICT. This test fails when a managed file of the real 1.2.0
// release has no base. The release is the pinned 1.2.0 manifest inside the fixture.
const bases = JSON.parse(await readFile(path.join(sourceRoot, 'template-bases.json'), 'utf8'));
const current = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
const release = JSON.parse(fixture.manifestBytes);
const currentHashes = new Set(current.entries.map((entry) => entry.sha256));
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('every managed file of the real 1.2.0 release has a merge base', () => {
  assert.equal(sha(fixture.manifestBytes), '012cf31cfe811fdb0f73523a119ac5c7fdd1ac115200a0f5c6fcd9392ce120b3');
  const missing = [];
  for (const entry of release.entries.filter((item) => item.mergeKind === 'managed-file')) {
    if (currentHashes.has(entry.sha256)) continue;
    if (typeof bases.bases[entry.sha256] !== 'string') missing.push(`${entry.destination} ${entry.sha256.slice(0, 12)}`);
    else assert.equal(sha(bases.bases[entry.sha256]), entry.sha256, `stored base does not hash to its key: ${entry.destination}`);
  }
  assert.deepEqual(missing, [], 'a 1.2.0 managed file has no merge base in template-bases.json');
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
