import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  InstallPlanError,
  applyApprovedChange,
  applyInstall,
  planApprovedChange,
  planInstall,
  rollbackReceipt,
  sha256,
} from '../lib/installer.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-transaction-'));
  const sourceRoot = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(path.join(sourceRoot, 'template', '00-Meta'), { recursive: true });
  await mkdir(target);
  const home = Buffer.from('# Home\n');
  const rules = Buffer.from('# Rules\n');
  await writeFile(path.join(sourceRoot, 'template', 'Home.md'), home);
  await writeFile(path.join(sourceRoot, 'template', '00-Meta', 'Rules.md'), rules);
  const manifest = {
    schemaVersion: 1,
    entries: [
      { source: 'template/Home.md', destination: 'Home.md', sha256: sha256(home), mergeKind: 'managed-file' },
      { source: 'template/00-Meta/Rules.md', destination: '00-Meta/Rules.md', sha256: sha256(rules), mergeKind: 'managed-file' },
    ],
  };
  return { root, sourceRoot, target, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)) };
}

async function rejects(code, action) {
  await assert.rejects(action, (error) => error instanceof InstallPlanError && error.code === code);
}

async function inventory(root) {
  const result = {};
  async function visit(directory, relative = '') {
    for (const name of await readdir(directory)) {
      const filePath = path.join(directory, name);
      const child = relative ? `${relative}/${name}` : name;
      const bytes = await readFile(filePath).catch(() => null);
      if (bytes !== null) result[child] = sha256(bytes);
      else await visit(filePath, child);
    }
  }
  await visit(root);
  return result;
}

async function loaderFixture() {
  const subject = await fixture();
  const loader = Buffer.from('<!-- second-brain:loader:start -->\nnew loader\n<!-- second-brain:loader:end -->\n');
  await writeFile(path.join(subject.sourceRoot, 'template', 'AGENTS.md'), loader);
  subject.manifest.entries.push({
    source: 'template/AGENTS.md',
    destination: 'AGENTS.md',
    sha256: sha256(loader),
    mergeKind: 'managed-block',
  });
  subject.manifestBytes = Buffer.from(JSON.stringify(subject.manifest));
  return { ...subject, loader };
}

test('requires the current complete plan digest and writes receipt/state only after managed bytes', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  await rejects('PLAN_DIGEST_MISMATCH', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: '0'.repeat(64) }));
  assert.deepEqual(await inventory(subject.target), {});

  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), '# Home\n');
  const state = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(path.join(subject.target, applied.receiptPath), 'utf8'));
  assert.equal(state.transactionId, applied.receiptId);
  assert.equal(receipt.receiptId, applied.receiptId);
  assert.equal(receipt.writes.at(-1).destination, '.second-brain/installed-state.json');
  assert.equal(Object.keys(state.managedPaths).join(','), '00-Meta/Rules.md,Home.md');

  const second = await planInstall({ ...subject, targetPath: subject.target });
  const noOp = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: second.digest });
  assert.equal(noOp.plan.entries.every((entry) => entry.status === 'IDENTICAL'), true);
});

test('a conflict produces no receipt, state, or overwrite', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await writeFile(path.join(subject.target, 'Home.md'), '# Personal workspace\n');
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  await rejects('PLAN_CONFLICT', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest }));
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), '# Personal workspace\n');
  assert.deepEqual(await inventory(subject.target), { 'Home.md': sha256(Buffer.from('# Personal workspace\n')) });
});

test('injected failures restore the pretransaction tree for every write position', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const before = await inventory(subject.target);
  for (const position of [1, 2, 3, 4]) {
    await rejects('INJECTED_WRITE_FAILURE', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest, injectFailureAfterWrite: position }));
    assert.deepEqual(await inventory(subject.target), before, `write position ${position} must restore every byte`);
  }
});

test('receipt rollback restores only its owned preimages and refuses user-modified postimages', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await writeFile(path.join(subject.target, 'custom.md'), 'custom');
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  await writeFile(path.join(subject.target, 'Home.md'), '# User edit\n');
  await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.equal(await readFile(path.join(subject.target, 'custom.md'), 'utf8'), 'custom');
  assert.equal(await readFile(path.join(subject.target, 'Home.md'), 'utf8'), '# User edit\n');
});

test('rollback removes created files while preserving pre-existing custom files', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await writeFile(path.join(subject.target, 'custom.md'), 'custom');
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  const rollback = await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.deepEqual(rollback.rolledBackPaths, ['00-Meta/Rules.md', 'Home.md', '.second-brain/installed-state.json']);
  await assert.rejects(readFile(path.join(subject.target, 'Home.md')));
  await assert.rejects(readFile(path.join(subject.target, '00-Meta', 'Rules.md')));
  assert.equal(await readFile(path.join(subject.target, 'custom.md'), 'utf8'), 'custom');
});

test('approved owner changes require a single allowlisted owner, exact hashes, digest, and non-secret bytes', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await mkdir(path.join(subject.target, 'workflows'), { recursive: true });
  const original = Buffer.from('before\n');
  const proposed = Buffer.from('after\n');
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), original);
  const common = {
    targetPath: subject.target,
    owner: 'workflows/owner.md',
    allowedOwners: ['workflows/owner.md'],
    preimageSha256: sha256(original),
    postimage: proposed,
    postimageSha256: sha256(proposed),
    evidenceDigest: sha256(Buffer.from('reproduced evidence')),
  };
  const planned = await planApprovedChange(common);
  await rejects('PLAN_DIGEST_MISMATCH', () => applyApprovedChange({ ...common, approvedDigest: '0'.repeat(64) }));
  await rejects('UNDECLARED_OWNER', () => planApprovedChange({ ...common, owner: 'outside.md' }));
  await rejects('AMBIGUOUS_OWNER', () => planApprovedChange({ ...common, allowedOwners: ['workflows/owner.md', 'workflows/owner.md'] }));
  await rejects('SECRET_BEARING_CONTENT', () => planApprovedChange({ ...common, postimage: 'API_KEY=not-a-secret', postimageSha256: sha256(Buffer.from('API_KEY=not-a-secret')) }));
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), 'changed\n');
  await rejects('STALE_PREIMAGE', () => planApprovedChange(common));
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), original);
  const applied = await applyApprovedChange({ ...common, approvedDigest: planned.digest });
  assert.equal(await readFile(path.join(subject.target, 'workflows', 'owner.md'), 'utf8'), 'after\n');
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal(await readFile(path.join(subject.target, 'workflows', 'owner.md'), 'utf8'), 'before\n');
});

test('a symlink inserted after planning is rejected without writing an outside sentinel', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const outside = path.join(subject.root, 'outside');
  const sentinel = path.join(outside, 'Home.md');
  await mkdir(outside);
  await writeFile(sentinel, 'unchanged');
  await symlink(outside, path.join(subject.target, '00-Meta'));
  await rejects('SYMLINK_PATH', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest }));
  assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
});

test('nonempty unmanaged loaders and malformed markers fail closed without a receipt', async (t) => {
  const subject = await loaderFixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await writeFile(path.join(subject.target, 'AGENTS.md'), '# Existing project rules\n');
  const unmanaged = await planInstall({ ...subject, targetPath: subject.target });
  assert.equal(unmanaged.entries.find((entry) => entry.destination === 'AGENTS.md').status, 'CONFLICT');
  await rejects('PLAN_CONFLICT', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: unmanaged.digest }));
  assert.equal(await readFile(path.join(subject.target, 'AGENTS.md'), 'utf8'), '# Existing project rules\n');

  for (const malformed of [
    '<!-- second-brain:loader:start -->\nmissing end\n',
    '<!-- second-brain:loader:start -->\na\n<!-- second-brain:loader:start -->\nb\n<!-- second-brain:loader:end -->\n',
  ]) {
    await writeFile(path.join(subject.target, 'AGENTS.md'), malformed);
    const plan = await planInstall({ ...subject, targetPath: subject.target });
    assert.equal(plan.entries.find((entry) => entry.destination === 'AGENTS.md').status, 'CONFLICT');
    await rejects('PLAN_CONFLICT', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest }));
    assert.equal(await readFile(path.join(subject.target, 'AGENTS.md'), 'utf8'), malformed);
  }
});

test('compatible loader block update preserves surrounding bytes and receipt rollback restores the full preimage', async (t) => {
  const subject = await loaderFixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const original = Buffer.from('prefix\r\n<!-- second-brain:loader:start -->\r\nold loader\r\n<!-- second-brain:loader:end -->\r\nsuffix\r\n');
  await writeFile(path.join(subject.target, 'AGENTS.md'), original);
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const loaderEntry = plan.entries.find((entry) => entry.destination === 'AGENTS.md');
  assert.equal(loaderEntry.status, 'MANAGED-UPDATE');
  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  const updated = await readFile(path.join(subject.target, 'AGENTS.md'));
  assert.equal(updated.subarray(0, Buffer.from('prefix\r\n').length).equals(Buffer.from('prefix\r\n')), true);
  assert.equal(updated.subarray(updated.length - Buffer.from('\r\nsuffix\r\n').length).equals(Buffer.from('\r\nsuffix\r\n')), true);
  assert.equal(updated.includes(Buffer.from('new loader')), true);
  assert.equal(updated.includes(Buffer.from('old loader')), false);
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal((await readFile(path.join(subject.target, 'AGENTS.md'))).equals(original), true);
});

test('loader change after approval invalidates the digest and a loader symlink is rejected', async (t) => {
  const subject = await loaderFixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await writeFile(path.join(subject.target, 'AGENTS.md'), '<!-- second-brain:loader:start -->\nold\n<!-- second-brain:loader:end -->\n');
  const approved = await planInstall({ ...subject, targetPath: subject.target });
  await writeFile(path.join(subject.target, 'AGENTS.md'), '<!-- second-brain:loader:start -->\nconcurrent edit\n<!-- second-brain:loader:end -->\n');
  await rejects('PLAN_DIGEST_MISMATCH', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: approved.digest }));
  await rm(path.join(subject.target, 'AGENTS.md'));
  await symlink(path.join(subject.target, 'missing-loader.md'), path.join(subject.target, 'AGENTS.md'));
  await rejects('SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target }));
});
