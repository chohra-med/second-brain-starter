import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstallPlanError, planInstall, sha256 } from '../lib/installer.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-plan-'));
  const sourceRoot = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(path.join(sourceRoot, 'template', '00-Meta'), { recursive: true });
  await mkdir(target);
  const home = Buffer.from('# Home\n');
  const facts = Buffer.from('# Facts\n');
  await writeFile(path.join(sourceRoot, 'template', 'Home.md'), home);
  await writeFile(path.join(sourceRoot, 'template', '00-Meta', 'FACTS.md'), facts);
  const manifest = {
    schemaVersion: 1,
    entries: [
      { source: 'template/Home.md', destination: 'Home.md', sha256: sha256(home), mergeKind: 'managed-file' },
      { source: 'template/00-Meta/FACTS.md', destination: '00-Meta/FACTS.md', sha256: sha256(facts), mergeKind: 'managed-file' },
    ],
  };
  return { root, sourceRoot, target, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)) };
}

async function rejects(code, action) {
  await assert.rejects(action, (error) => error instanceof InstallPlanError && error.code === code);
}

test('plans creates, identical entries, managed updates, conflicts, and deprecated files without writing', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const before = await planInstall({ ...subject, targetPath: subject.target });
  assert.deepEqual(before.entries.map(({ destination, status }) => [destination, status]), [['00-Meta/FACTS.md', 'CREATE'], ['Home.md', 'CREATE']]);
  assert.equal(await readFile(path.join(subject.sourceRoot, 'template', 'Home.md'), 'utf8'), '# Home\n');

  await mkdir(path.join(subject.target, '00-Meta'));
  await writeFile(path.join(subject.target, 'Home.md'), '# Home\n');
  await writeFile(path.join(subject.target, '00-Meta', 'FACTS.md'), '# Old facts\n');
  await mkdir(path.join(subject.target, '.second-brain'));
  await writeFile(path.join(subject.target, '.second-brain', 'installed-state.json'), JSON.stringify({ managedPaths: {
    '00-Meta/FACTS.md': { installedSha256: sha256(Buffer.from('# Old facts\n')), mergeKind: 'managed-file' },
    'retired.md': { installedSha256: sha256(Buffer.from('# Retired\n')), mergeKind: 'managed-file' },
  } }));
  await writeFile(path.join(subject.target, 'retired.md'), '# Retired\n');
  const planned = await planInstall({ ...subject, targetPath: subject.target });
  assert.deepEqual(planned.entries.map(({ destination, status }) => [destination, status]), [
    ['00-Meta/FACTS.md', 'MANAGED-UPDATE'], ['Home.md', 'IDENTICAL'], ['retired.md', 'DEPRECATED'],
  ]);
  assert.equal(planned.entries[0].undo.action, 'restore-preimage');
  assert.equal(planned.entries[2].undo.action, 'restore-deprecated-file');
  assert.equal(await readFile(path.join(subject.target, 'retired.md'), 'utf8'), '# Retired\n');
});

test('changes to named target bytes change the consent digest', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const first = await planInstall({ ...subject, targetPath: subject.target });
  await writeFile(path.join(subject.target, 'Home.md'), '# Personal copy\n');
  const second = await planInstall({ ...subject, targetPath: subject.target });
  assert.notEqual(first.digest, second.digest);
  assert.equal(second.entries.find((entry) => entry.destination === 'Home.md').status, 'CONFLICT');
});

test('rejects source symlinks, target traversal, duplicate destinations, and dangling state symlinks', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const sourceLink = path.join(subject.sourceRoot, 'template', 'linked.md');
  await symlink(path.join(subject.sourceRoot, 'template', 'Home.md'), sourceLink);
  const sourceManifest = structuredClone(subject.manifest);
  sourceManifest.entries[0] = { ...sourceManifest.entries[0], source: 'template/linked.md' };
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target, manifest: sourceManifest, manifestBytes: Buffer.from(JSON.stringify(sourceManifest)) }));

  const linkedDirectory = path.join(subject.sourceRoot, 'template', 'linked-directory');
  await symlink(path.join(subject.sourceRoot, 'template', '00-Meta'), linkedDirectory);
  const nestedSource = structuredClone(subject.manifest);
  nestedSource.entries[1] = { ...nestedSource.entries[1], source: 'template/linked-directory/FACTS.md' };
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target, manifest: nestedSource, manifestBytes: Buffer.from(JSON.stringify(nestedSource)) }));

  const traversal = structuredClone(subject.manifest);
  traversal.entries[0] = { ...traversal.entries[0], destination: '../outside.md' };
  await rejects('INVALID_PATH', () => planInstall({ ...subject, targetPath: subject.target, manifest: traversal, manifestBytes: Buffer.from(JSON.stringify(traversal)) }));

  const duplicate = structuredClone(subject.manifest);
  duplicate.entries[1] = { ...duplicate.entries[1], destination: 'Home.md' };
  await rejects('DUPLICATE_DESTINATION', () => planInstall({ ...subject, targetPath: subject.target, manifest: duplicate, manifestBytes: Buffer.from(JSON.stringify(duplicate)) }));

  const outside = path.join(subject.root, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(subject.target, '00-Meta'));
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target }));
  await rm(path.join(subject.target, '00-Meta'));

  await mkdir(path.join(subject.target, '.second-brain'));
  await symlink(path.join(subject.target, 'missing-state.json'), path.join(subject.target, '.second-brain', 'installed-state.json'));
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target }));
});

test('rejects root, installer checkout, and symlinked target ancestors without writing outside a sentinel', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const sentinel = path.join(subject.root, 'sentinel.txt');
  await writeFile(sentinel, 'unchanged');
  const before = sha256(await readFile(sentinel));
  await rejects('UNSAFE_TARGET', () => planInstall({ ...subject, targetPath: path.parse(subject.target).root }));
  await rejects('UNSAFE_TARGET', () => planInstall({ ...subject, targetPath: subject.sourceRoot }));
  const linkedParent = path.join(subject.root, 'linked-parent');
  await symlink(subject.target, linkedParent);
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: path.join(linkedParent, 'child') }));
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: linkedParent }));
  assert.equal(sha256(await readFile(sentinel)), before);
});
