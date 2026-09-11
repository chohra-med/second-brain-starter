import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  InstallPlanError,
  applyApprovedChange,
  applyInstall,
  planApprovedChange,
  planInstall,
  rollbackReceipt,
  sha256,
} from '../lib/installer.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    metadata: { templateVersion: '1.1.0' },
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

async function treeInventory(root) {
  const result = {};
  async function visit(directory, relative = '') {
    for (const name of (await readdir(directory)).sort()) {
      const filePath = path.join(directory, name);
      const child = relative ? `${relative}/${name}` : name;
      const stat = await lstat(filePath);
      if (stat.isDirectory()) {
        result[child] = 'directory';
        await visit(filePath, child);
      } else if (stat.isFile()) result[child] = `file:${sha256(await readFile(filePath))}`;
      else if (stat.isSymbolicLink()) result[child] = 'symlink';
      else result[child] = 'other';
    }
  }
  await visit(root);
  return result;
}

function encodedCredentialForms() {
  const key = ['api', '_key'].join('');
  const value = ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('');
  const material = `${key}=${value}`;
  const unicode = (text) => [...text].map((character) => `${String.fromCharCode(92)}u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const utf16be = Buffer.from(material, 'utf16le');
  utf16be.swap16();
  const ordinaryBase64 = Buffer.from(material).toString('base64');
  return [
    Buffer.from(material),
    Buffer.from([...material].map((character) => `&#${character.charCodeAt(0)};`).join('')),
    Buffer.from(`{"${unicode(key)}":"${unicode(value)}"}`),
    Buffer.from(material, 'utf16le'),
    utf16be,
    Buffer.from([...material].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')),
    Buffer.from(ordinaryBase64),
    Buffer.from(Buffer.from(material).toString('base64url')),
    Buffer.from(ordinaryBase64.match(/.{1,8}/g).join('\n')),
  ];
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

async function replaceLoaderSource(subject, text) {
  const loader = Buffer.from(`<!-- second-brain:loader:start -->\n${text}\n<!-- second-brain:loader:end -->\n`);
  await writeFile(path.join(subject.sourceRoot, 'template', 'AGENTS.md'), loader);
  const entry = subject.manifest.entries.find((item) => item.destination === 'AGENTS.md');
  entry.sha256 = sha256(loader);
  subject.manifestBytes = Buffer.from(JSON.stringify(subject.manifest));
  subject.loader = loader;
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
  await mkdir(path.join(subject.target, 'pre-existing-empty'), { recursive: true });
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const before = await treeInventory(subject.target);
  for (const position of [1, 2, 3, 4]) {
    await rejects('INJECTED_WRITE_FAILURE', () => applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest, injectFailureAfterWrite: position }));
    assert.deepEqual(await treeInventory(subject.target), before, `write position ${position} must restore every file and directory`);
  }
});

test('actual manifest failures restore its complete pretransaction directory tree at every write position', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-transaction-manifest-'));
  const target = path.join(root, 'target');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(target, '.second-brain'), { recursive: true });
  await mkdir(path.join(target, 'pre-existing-empty'), { recursive: true });
  const manifestBytes = await readFile(path.join(packageRoot, 'template-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const plan = await planInstall({ manifest, manifestBytes, sourceRoot: packageRoot, targetPath: target });
  const before = await treeInventory(target);
  const positions = plan.entries.filter((entry) => ['CREATE', 'MANAGED-UPDATE'].includes(entry.status)).length + 2;
  for (let position = 1; position <= positions; position += 1) {
    await rejects('INJECTED_WRITE_FAILURE', () => applyInstall({
      manifest,
      manifestBytes,
      sourceRoot: packageRoot,
      targetPath: target,
      approvedDigest: plan.digest,
      injectFailureAfterWrite: position,
    }));
    assert.deepEqual(await treeInventory(target), before, `actual manifest write position ${position}`);
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

test('corrupted install receipts reject before rollback mutation', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  const receiptPath = path.join(subject.target, applied.receiptPath);
  const original = await readFile(receiptPath, 'utf8');

  async function rejectCorruption(mutate) {
    const receipt = JSON.parse(original);
    await mutate(receipt);
    await writeFile(receiptPath, JSON.stringify(receipt));
    const before = await treeInventory(subject.target);
    await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
    assert.deepEqual(await treeInventory(subject.target), before);
    await writeFile(receiptPath, original);
  }

  await rejectCorruption((receipt) => {
    receipt.writes.push({ ...receipt.writes.find((write) => write.destination === 'Home.md') });
  });
  await writeFile(path.join(subject.target, 'unrelated.md'), 'keep me\n');
  await rejectCorruption((receipt) => {
    const bytes = Buffer.from('keep me\n');
    receipt.writes.push({ destination: 'unrelated.md', preimageSha256: null, postimageSha256: sha256(bytes), backupPath: null });
  });
  await rejectCorruption((receipt) => {
    receipt.operation = 'not-an-install';
  });
  await rejectCorruption((receipt) => {
    receipt.operation = 'upgrade';
  });

  await writeFile(path.join(subject.target, 'Home.md'), '# later user edit\n');
  const beforeLatePostimage = await treeInventory(subject.target);
  await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.deepEqual(await treeInventory(subject.target), beforeLatePostimage);
});

test('approved-change receipts bind their owner, target, allowlist, one write, and own backup subtree', async (t) => {
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
    evidenceDigest: sha256(Buffer.from('evidence')),
  };
  const plan = await planApprovedChange(common);
  const applied = await applyApprovedChange({ ...common, approvedDigest: plan.digest });
  const receiptPath = path.join(subject.target, applied.receiptPath);
  const originalReceipt = await readFile(receiptPath, 'utf8');

  async function rejectCorruption(mutate) {
    const receipt = JSON.parse(originalReceipt);
    mutate(receipt);
    await writeFile(receiptPath, JSON.stringify(receipt));
    const before = await treeInventory(subject.target);
    await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
    assert.deepEqual(await treeInventory(subject.target), before);
    await writeFile(receiptPath, originalReceipt);
  }

  await rejectCorruption((receipt) => { receipt.owner = 'workflows/other.md'; });
  await rejectCorruption((receipt) => { receipt.allowedOwners = []; });
  await rejectCorruption((receipt) => { receipt.targetIdentitySha256 = '0'.repeat(64); });
  await rejectCorruption((receipt) => { receipt.writes.push({ ...receipt.writes[0] }); });

  await writeFile(path.join(subject.target, 'workflows', 'other.md'), 'other before\n');
  const secondCommon = {
    ...common,
    owner: 'workflows/other.md',
    allowedOwners: ['workflows/other.md'],
    preimageSha256: sha256(Buffer.from('other before\n')),
    postimage: Buffer.from('other after\n'),
    postimageSha256: sha256(Buffer.from('other after\n')),
  };
  const secondPlan = await planApprovedChange(secondCommon);
  const secondApplied = await applyApprovedChange({ ...secondCommon, approvedDigest: secondPlan.digest });
  const secondReceipt = JSON.parse(await readFile(path.join(subject.target, secondApplied.receiptPath), 'utf8'));
  const crossBackup = JSON.parse(originalReceipt);
  crossBackup.writes[0].backupPath = secondReceipt.writes[0].backupPath;
  await writeFile(receiptPath, JSON.stringify(crossBackup));
  const beforeCrossBackup = await treeInventory(subject.target);
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.deepEqual(await treeInventory(subject.target), beforeCrossBackup);
});

test('transaction namespace regular files and symlinks reject before a transaction creates managed paths', async (t) => {
  for (const [relative, expectedCode] of [
    ['.second-brain', 'INVALID_NAMESPACE'],
    ['.second-brain/receipts', 'INVALID_NAMESPACE'],
    ['.second-brain/backups', 'INVALID_NAMESPACE'],
  ]) {
    for (const kind of ['file', 'symlink']) {
      const subject = await fixture();
      t.after(() => rm(subject.root, { recursive: true, force: true }));
      const namespacePath = path.join(subject.target, ...relative.split('/'));
      await mkdir(path.dirname(namespacePath), { recursive: true });
      if (kind === 'file') await writeFile(namespacePath, 'not a directory\n');
      else await symlink(path.join(subject.target, 'missing-namespace'), namespacePath);
      const before = await treeInventory(subject.target);
      await rejects(kind === 'file' ? expectedCode : 'SYMLINK_PATH', () => planInstall({ ...subject, targetPath: subject.target }));
      assert.deepEqual(await treeInventory(subject.target), before, `${relative} ${kind}`);
      await mkdir(path.join(subject.target, 'workflows'), { recursive: true });
      const owner = Buffer.from('before\n');
      const postimage = Buffer.from('after\n');
      await writeFile(path.join(subject.target, 'workflows', 'owner.md'), owner);
      const beforeApproved = await treeInventory(subject.target);
      await rejects(kind === 'file' ? expectedCode : 'SYMLINK_PATH', () => planApprovedChange({
        targetPath: subject.target,
        owner: 'workflows/owner.md',
        allowedOwners: ['workflows/owner.md'],
        preimageSha256: sha256(owner),
        postimage,
        postimageSha256: sha256(postimage),
        evidenceDigest: sha256(Buffer.from('evidence')),
      }));
      assert.deepEqual(await treeInventory(subject.target), beforeApproved, `${relative} ${kind} approved change`);
    }
  }
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
  const passwordAssignment = ['pass', 'word=', 'SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('');
  await rejects('SECRET_BEARING_CONTENT', () => planApprovedChange({ ...common, postimage: passwordAssignment, postimageSha256: sha256(Buffer.from(passwordAssignment)) }));
  for (const bytes of encodedCredentialForms()) {
    await rejects('SECRET_BEARING_CONTENT', () => planApprovedChange({ ...common, postimage: bytes, postimageSha256: sha256(bytes) }));
  }
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), 'changed\n');
  await rejects('STALE_PREIMAGE', () => planApprovedChange(common));
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), original);
  const applied = await applyApprovedChange({ ...common, approvedDigest: planned.digest });
  assert.equal(await readFile(path.join(subject.target, 'workflows', 'owner.md'), 'utf8'), 'after\n');
  const receipt = await readFile(path.join(subject.target, applied.receiptPath), 'utf8');
  assert.equal(receipt.includes(subject.target), false);
  assert.equal(receipt.includes(homedir()), false);
  assert.match(receipt, /"targetIdentitySha256":"[a-f0-9]{64}"/);
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal(await readFile(path.join(subject.target, 'workflows', 'owner.md'), 'utf8'), 'before\n');
});

test('approved owner approval cannot be replayed in another canonical project and rejects symlinked ancestors', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const otherTarget = path.join(subject.root, 'other-target');
  await mkdir(path.join(subject.target, 'workflows'), { recursive: true });
  await mkdir(path.join(otherTarget, 'workflows'), { recursive: true });
  const original = Buffer.from('before\n');
  const proposed = Buffer.from('after\n');
  for (const target of [subject.target, otherTarget]) await writeFile(path.join(target, 'workflows', 'owner.md'), original);
  const shared = {
    owner: 'workflows/owner.md', allowedOwners: ['workflows/owner.md'], preimageSha256: sha256(original),
    postimage: proposed, postimageSha256: sha256(proposed), evidenceDigest: sha256(Buffer.from('evidence')),
  };
  const first = await planApprovedChange({ ...shared, targetPath: subject.target });
  const second = await planApprovedChange({ ...shared, targetPath: otherTarget });
  assert.notEqual(first.digest, second.digest);
  await rejects('PLAN_DIGEST_MISMATCH', () => applyApprovedChange({ ...shared, targetPath: otherTarget, approvedDigest: first.digest }));
  assert.equal(await readFile(path.join(otherTarget, 'workflows', 'owner.md'), 'utf8'), 'before\n');

  const outside = path.join(subject.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'owner.md'), original);
  await symlink(outside, path.join(subject.target, 'linked'));
  await rejects('SYMLINK_PATH', () => planApprovedChange({ ...shared, targetPath: subject.target, owner: 'linked/owner.md', allowedOwners: ['linked/owner.md'] }));
  assert.equal(await readFile(path.join(outside, 'owner.md'), 'utf8'), 'before\n');
});

test('approved-change rollback rechecks a replacement symlink ancestor before reading outside target', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await mkdir(path.join(subject.target, 'workflows'), { recursive: true });
  const original = Buffer.from('before\n');
  const proposed = Buffer.from('after\n');
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), original);
  const common = {
    targetPath: subject.target, owner: 'workflows/owner.md', allowedOwners: ['workflows/owner.md'], preimageSha256: sha256(original),
    postimage: proposed, postimageSha256: sha256(proposed), evidenceDigest: sha256(Buffer.from('evidence')),
  };
  const plan = await planApprovedChange(common);
  const applied = await applyApprovedChange({ ...common, approvedDigest: plan.digest });
  const outside = path.join(subject.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'owner.md'), 'outside sentinel\n');
  await rm(path.join(subject.target, 'workflows'), { recursive: true, force: true });
  await symlink(outside, path.join(subject.target, 'workflows'));
  await rejects('SYMLINK_PATH', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.equal(await readFile(path.join(outside, 'owner.md'), 'utf8'), 'outside sentinel\n');
});

test('approved changes share install target rejection and preflight the complete transaction namespace', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await mkdir(path.join(subject.target, 'workflows'), { recursive: true });
  const original = Buffer.from('before\n');
  const proposed = Buffer.from('after\n');
  await writeFile(path.join(subject.target, 'workflows', 'owner.md'), original);
  const common = {
    owner: 'workflows/owner.md', allowedOwners: ['workflows/owner.md'], preimageSha256: sha256(original),
    postimage: proposed, postimageSha256: sha256(proposed), evidenceDigest: sha256(Buffer.from('evidence')),
  };
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const targetPath of [path.parse(subject.target).root, homedir(), projectRoot, `${subject.target}/../target`]) {
    await rejects(targetPath.includes('..') ? 'TARGET_TRAVERSAL' : 'UNSAFE_TARGET', () => planApprovedChange({ ...common, targetPath }));
  }

  for (const namespace of ['installed-state.json', 'receipts', 'backups']) {
    const second = await fixture();
    t.after(() => rm(second.root, { recursive: true, force: true }));
    await mkdir(path.join(second.target, 'workflows'), { recursive: true });
    await writeFile(path.join(second.target, 'workflows', 'owner.md'), original);
    await mkdir(path.join(second.target, '.second-brain'), { recursive: true });
    await symlink(path.join(second.target, 'missing'), path.join(second.target, '.second-brain', namespace));
    await rejects('SYMLINK_PATH', () => planApprovedChange({ ...common, targetPath: second.target }));
    assert.equal(await readFile(path.join(second.target, 'workflows', 'owner.md'), 'utf8'), 'before\n');
  }
});

test('receipt rollback rejects a symlinked namespace before receipt ingestion', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const plan = await planInstall({ ...subject, targetPath: subject.target });
  const applied = await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: plan.digest });
  const backups = path.join(subject.target, '.second-brain', 'backups');
  await rm(backups, { recursive: true, force: true });
  await symlink(path.join(subject.target, 'missing-backups'), backups);
  await rejects('SYMLINK_PATH', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
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
  const initial = await planInstall({ ...subject, targetPath: subject.target });
  await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: initial.digest });
  const original = Buffer.from('prefix\r\n<!-- second-brain:loader:start -->\nnew loader\n<!-- second-brain:loader:end -->\r\nsuffix\r\n');
  await writeFile(path.join(subject.target, 'AGENTS.md'), original);
  await replaceLoaderSource(subject, 'updated loader');
  const plan = await planInstall({ ...subject, targetPath: subject.target, operation: 'upgrade' });
  const loaderEntry = plan.entries.find((entry) => entry.destination === 'AGENTS.md');
  assert.equal(loaderEntry.status, 'MANAGED-UPDATE');
  const applied = await applyInstall({ ...subject, targetPath: subject.target, operation: 'upgrade', approvedDigest: plan.digest });
  const updated = await readFile(path.join(subject.target, 'AGENTS.md'));
  assert.equal(updated.subarray(0, Buffer.from('prefix\r\n').length).equals(Buffer.from('prefix\r\n')), true);
  assert.equal(updated.subarray(updated.length - Buffer.from('\r\nsuffix\r\n').length).equals(Buffer.from('\r\nsuffix\r\n')), true);
  assert.equal(updated.includes(Buffer.from('updated loader')), true);
  assert.equal(updated.includes(Buffer.from('new loader')), false);
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal((await readFile(path.join(subject.target, 'AGENTS.md'))).equals(original), true);
});

test('an edited managed loader block is contradictory and fails closed even with valid markers', async (t) => {
  const subject = await loaderFixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const initial = await planInstall({ ...subject, targetPath: subject.target });
  await applyInstall({ ...subject, targetPath: subject.target, approvedDigest: initial.digest });
  const edited = '<!-- second-brain:loader:start -->\n# Local restriction: never load this route\n<!-- second-brain:loader:end -->\n';
  await writeFile(path.join(subject.target, 'AGENTS.md'), edited);
  await replaceLoaderSource(subject, 'updated loader');
  const upgrade = await planInstall({ ...subject, targetPath: subject.target, operation: 'upgrade' });
  assert.equal(upgrade.entries.find((entry) => entry.destination === 'AGENTS.md').status, 'CONFLICT');
  await rejects('PLAN_CONFLICT', () => applyInstall({ ...subject, targetPath: subject.target, operation: 'upgrade', approvedDigest: upgrade.digest }));
  assert.equal(await readFile(path.join(subject.target, 'AGENTS.md'), 'utf8'), edited);
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
