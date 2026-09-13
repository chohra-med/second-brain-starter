import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstallPlanError, applyInstall, planInstall, rollbackReceipt, sha256, verifyInstall } from '../lib/installer.mjs';

const managedPaths = [
  'Home.md',
  '01-Projects/Selected-Project/FACTS.md',
  '01-Projects/Selected-Project/Decisions.md',
  '01-Projects/Selected-Project/roadmap.md',
  '01-Projects/Selected-Project/progress.md',
  '05-Daily/Today.md',
];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-upgrade-'));
  const sourceRoot = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(path.join(sourceRoot, 'template'), { recursive: true });
  await mkdir(target);
  const initial = Object.fromEntries(managedPaths.map((destination) => [destination, Buffer.from(`A ${destination}\n`)]));
  for (const [destination, bytes] of Object.entries(initial)) {
    const sourcePath = path.join(sourceRoot, 'template', ...destination.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, bytes);
  }
  return { root, sourceRoot, target, initial };
}

async function manifestFor(sourceRoot, destinations = managedPaths) {
  const entries = [];
  for (const destination of destinations) {
    const source = `template/${destination}`;
    const bytes = await readFile(path.join(sourceRoot, ...source.split('/')));
    entries.push({ source, destination, sha256: sha256(bytes), mergeKind: 'managed-file' });
  }
  const manifest = { schemaVersion: 1, metadata: { templateVersion: '1.1.0' }, entries };
  return { manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)) };
}

async function install(subject, options = {}) {
  const source = await manifestFor(subject.sourceRoot, options.destinations);
  const plan = await planInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, ...options });
  const result = await applyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, approvedDigest: plan.digest, ...options });
  return { ...source, plan, result };
}

async function rejects(code, action) {
  await assert.rejects(action, (error) => error instanceof InstallPlanError && error.code === code);
}

test('three-way upgrade preserves personalized managed records and updates only after conflicts are resolved', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await install(subject);
  const personalized = managedPaths.slice(1);
  const before = {};
  for (const destination of personalized) {
    const filePath = path.join(subject.target, ...destination.split('/'));
    const bytes = Buffer.from(`Personal ${destination}\n`);
    await writeFile(filePath, bytes);
    before[destination] = sha256(bytes);
  }
  await mkdir(path.join(subject.target, 'custom-skills'), { recursive: true });
  await writeFile(path.join(subject.target, 'custom-skills', 'keep.md'), 'personal custom skill\n');

  for (const destination of managedPaths) {
    await writeFile(path.join(subject.sourceRoot, 'template', ...destination.split('/')), `B ${destination}\n`);
  }
  const sourceB = await manifestFor(subject.sourceRoot);
  const planned = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  assert.deepEqual(planned.entries.map((entry) => [entry.destination, entry.status]), [
    ['01-Projects/Selected-Project/Decisions.md', 'CONFLICT'],
    ['01-Projects/Selected-Project/FACTS.md', 'CONFLICT'],
    ['01-Projects/Selected-Project/progress.md', 'CONFLICT'],
    ['01-Projects/Selected-Project/roadmap.md', 'CONFLICT'],
    ['05-Daily/Today.md', 'CONFLICT'],
    ['Home.md', 'MANAGED-UPDATE'],
  ]);
  await rejects('PLAN_CONFLICT', () => applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: planned.digest }));
  for (const destination of personalized) {
    assert.equal(sha256(await readFile(path.join(subject.target, ...destination.split('/')))), before[destination]);
  }
  assert.equal(await readFile(path.join(subject.target, 'custom-skills', 'keep.md'), 'utf8'), 'personal custom skill\n');

  for (const destination of personalized) {
    await writeFile(path.join(subject.target, ...destination.split('/')), subject.initial[destination]);
  }
  const resolved = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  assert.equal(resolved.entries.every((entry) => entry.status === 'MANAGED-UPDATE'), true);
  await applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: resolved.digest });
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), 'B Home.md\n');
  assert.equal(await readFile(path.join(subject.target, 'custom-skills', 'keep.md'), 'utf8'), 'personal custom skill\n');
});

test('deprecated paths are reported without deletion and an identical follow-up is a receipt-free no-op', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const legacy = '03-Resources/legacy.md';
  await mkdir(path.join(subject.sourceRoot, 'template', '03-Resources'), { recursive: true });
  await writeFile(path.join(subject.sourceRoot, 'template', '03-Resources', 'legacy.md'), 'legacy\n');
  await install(subject, { destinations: [...managedPaths, legacy] });
  const sourceB = await manifestFor(subject.sourceRoot);
  const plan = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  const deprecated = plan.entries.find((entry) => entry.destination === legacy);
  assert.equal(deprecated.status, 'DEPRECATED');
  assert.equal(deprecated.undo.action, 'none');
  const applied = await applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: plan.digest });
  assert.equal(await readFile(path.join(subject.target, ...legacy.split('/')), 'utf8'), 'legacy\n');
  const repeat = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  const noOp = await applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: repeat.digest });
  assert.equal(repeat.entries.every((entry) => entry.status === 'IDENTICAL'), true);
  assert.equal(noOp.applied, false);
  assert.equal(noOp.receiptId, null);
  assert.equal(applied.applied, true);
});

test('verify reports every missing or corrupt managed path and rejects a dangling installed-state symlink', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const source = await install(subject);
  await writeFile(path.join(subject.target, 'Home.md'), 'corrupt\n');
  await unlink(path.join(subject.target, '01-Projects', 'Selected-Project', 'FACTS.md'));
  const broken = await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.issues.filter((issue) => ['CORRUPT', 'MISSING'].includes(issue.code)).map((issue) => issue.path), [
    'Home.md',
    '01-Projects/Selected-Project/FACTS.md',
  ]);
  await writeFile(path.join(subject.target, 'Home.md'), subject.initial['Home.md']);
  await writeFile(path.join(subject.target, '01-Projects', 'Selected-Project', 'FACTS.md'), subject.initial['01-Projects/Selected-Project/FACTS.md']);
  assert.equal((await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target })).ok, true);

  const statePath = path.join(subject.target, '.second-brain', 'installed-state.json');
  await unlink(statePath);
  await symlink(path.join(subject.target, '.second-brain', 'missing-state.json'), statePath);
  const stateLink = await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(stateLink.ok, false);
  assert.equal(stateLink.issues.some((issue) => issue.code === 'SYMLINK_PATH' && issue.path === '.second-brain/installed-state.json'), true);
});

test('verify rejects unsupported state identity and separately reports a newer source manifest', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const sourceA = await install(subject);
  const statePath = path.join(subject.target, '.second-brain', 'installed-state.json');
  const originalState = JSON.parse(await readFile(statePath, 'utf8'));

  await writeFile(statePath, `${JSON.stringify({ ...originalState, schemaVersion: 99 })}\n`);
  const unsupported = await verifyInstall({ ...sourceA, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.issues.some((issue) => issue.code === 'INVALID_STATE' && issue.path === '.second-brain/installed-state.json'), true);

  await writeFile(statePath, `${JSON.stringify({ ...originalState, templateVersion: null })}\n`);
  const missingIdentity = await verifyInstall({ ...sourceA, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(missingIdentity.ok, false);
  assert.equal(missingIdentity.issues.some((issue) => issue.code === 'INVALID_STATE' && issue.message.includes('templateVersion')), true);

  await writeFile(statePath, `${JSON.stringify(originalState)}\n`);
  await writeFile(path.join(subject.sourceRoot, 'template', 'Home.md'), 'B Home.md\n');
  const sourceB = await manifestFor(subject.sourceRoot);
  sourceB.manifest.metadata.templateVersion = '1.1.1';
  sourceB.manifestBytes = Buffer.from(JSON.stringify(sourceB.manifest));
  const mismatch = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.issues.some((issue) => issue.code === 'SOURCE_MANIFEST_MISMATCH'), true);
  assert.equal(mismatch.entries.every((entry) => entry.status === 'VERIFIED'), true);
  assert.equal(mismatch.entries.some((entry) => entry.status === 'CORRUPT'), false);
});

test('an upgrade receipt restores only receipt-owned preimages and refuses later user edits', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await install(subject);
  await writeFile(path.join(subject.sourceRoot, 'template', 'Home.md'), 'B Home.md\n');
  const sourceB = await manifestFor(subject.sourceRoot);
  const plan = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  const upgraded = await applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: plan.digest });
  await writeFile(path.join(subject.target, 'Home.md'), 'later user edit\n');
  await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: subject.target, receiptId: upgraded.receiptId }));
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), 'later user edit\n');
  const preservedState = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  assert.equal(preservedState.transactionId, upgraded.receiptId);
  await writeFile(path.join(subject.target, 'Home.md'), 'B Home.md\n');
  await rollbackReceipt({ targetPath: subject.target, receiptId: upgraded.receiptId });
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), 'A Home.md\n');
});

test('free then paid state shares a namespace and paid rollback preserves pre-existing free files', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await install(subject, { edition: 'free' });
  const premium = 'premium/health.md';
  await mkdir(path.join(subject.sourceRoot, 'template', 'premium'), { recursive: true });
  await writeFile(path.join(subject.sourceRoot, 'template', 'premium', 'health.md'), 'paid health\n');
  const sourcePaid = await manifestFor(subject.sourceRoot, [...managedPaths, premium]);
  const plan = await planInstall({ ...sourcePaid, sourceRoot: subject.sourceRoot, targetPath: subject.target, edition: 'paid', publicDependency: 'public-candidate' });
  const paid = await applyInstall({ ...sourcePaid, sourceRoot: subject.sourceRoot, targetPath: subject.target, edition: 'paid', publicDependency: 'public-candidate', approvedDigest: plan.digest });
  const state = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  assert.equal(state.edition, 'paid');
  assert.equal(state.publicDependency, 'public-candidate');
  await rollbackReceipt({ targetPath: subject.target, receiptId: paid.receiptId });
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), 'A Home.md\n');
  await assert.rejects(readFile(path.join(subject.target, 'premium', 'health.md')));
});
