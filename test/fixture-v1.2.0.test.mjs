import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyInstall, planInstall, rollbackReceipt, sha256, stableStringify, verifyInstall } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

// test/fixtures/v1.2.0-install.json is the exact tree a real v1.2.0 `init` wrote
// (source commit recorded inside it): managed files, the v1.2.0 manifest bytes,
// .second-brain/installed-state.json and the init receipt. It was produced by the
// v1.2.0 CLI, not assembled by hand. The test recomputes every hash from the
// materialised bytes; it never copies an installed hash into the assertion side.

const STATE_KEYS = ['edition', 'managedPaths', 'manifestSha256', 'operation', 'planDigest', 'publicDependency', 'schemaVersion', 'templateVersion', 'transactionId', 'writeSetDigest'];
const STATE_PATH = '.second-brain/installed-state.json';

const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));

function rel(root, posixPath) {
  return path.join(root, ...posixPath.split('/'));
}

async function put(root, posixPath, content) {
  const destination = rel(root, posixPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function temp(t, prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// Plain writeFile into a fresh temp directory: the engine's own symlink guards are
// exercised afterwards by verifyInstall/planInstall, not bypassed here.
async function materialise(t) {
  const target = await temp(t, 'second-brain-v120-target-');
  for (const [destination, content] of Object.entries(fixture.files)) await put(target, destination, content);
  await put(target, STATE_PATH, `${stableStringify(fixture.state)}\n`);
  await put(target, fixture.receiptPath, `${stableStringify(fixture.receipt)}\n`);
  return target;
}

// The v1.2.0 source rebuilt from the fixture: every manifest source is byte-identical
// to the installed destination it produced (no managed-block merge happens on a fresh init).
async function v120Source(t) {
  const root = await temp(t, 'second-brain-v120-source-');
  const manifestBytes = Buffer.from(fixture.manifestBytes, 'utf8');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  for (const entry of manifest.entries) await put(root, entry.source, fixture.files[entry.destination]);
  return { root, manifest, manifestBytes };
}

async function currentSource() {
  const manifestBytes = await readFile(path.join(sourceRoot, 'template-manifest.json'));
  return { manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot };
}

async function readState(target) {
  return JSON.parse(await readFile(rel(target, STATE_PATH), 'utf8'));
}

async function hashTree(target, destinations) {
  return Object.fromEntries(await Promise.all(destinations.map(async (d) => [d, sha256(await readFile(rel(target, d)))])));
}

test('the fixture regenerates byte-identical v1.2.0 records and is internally consistent', async (t) => {
  assert.equal(fixture.sourceVersion, 'v1.2.0');
  assert.match(fixture.sourceCommit, /^[a-f0-9]{40}$/);
  const target = await materialise(t);
  const state = await readState(target);
  const managed = Object.keys(state.managedPaths);

  assert.deepEqual(Object.keys(fixture.files).sort(), [...managed].sort());
  for (const destination of managed) {
    const actual = sha256(await readFile(rel(target, destination)));
    assert.equal(actual, state.managedPaths[destination].installedSha256, `hash mismatch: ${destination}`);
  }

  const stateWrite = fixture.receipt.writes.find((write) => write.destination === STATE_PATH);
  assert.equal(sha256(await readFile(rel(target, STATE_PATH))), stateWrite.postimageSha256, 'state bytes differ from the receipt postimage');
  assert.equal(fixture.receipt.receiptId, state.transactionId);
  assert.equal(fixture.receiptPath, `.second-brain/receipts/${fixture.receipt.receiptId}.json`);
  assert.deepEqual(fixture.receipt.writes.map((write) => write.destination).sort(), [...managed, STATE_PATH].sort());
  for (const write of fixture.receipt.writes.filter((item) => item.destination !== STATE_PATH)) {
    assert.equal(write.postimageSha256, sha256(await readFile(rel(target, write.destination))), `receipt postimage mismatch: ${write.destination}`);
  }
  assert.equal(sha256(Buffer.from(fixture.manifestBytes, 'utf8')), fixture.manifestSha256);
  assert.equal(state.manifestSha256, fixture.manifestSha256);
  assert.equal(state.templateVersion, '1.2.0');
});

test('the v1.2.0 installed-state schema keeps exactly its ten keys (guards D14)', async () => {
  const state = JSON.parse(JSON.stringify(fixture.state));
  assert.deepEqual(Object.keys(state).sort(), STATE_KEYS);
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.operation, 'init');
  for (const record of Object.values(state.managedPaths)) {
    const keys = Object.keys(record).sort();
    assert.deepEqual(keys, record.mergeKind === 'managed-block'
      ? ['installedSha256', 'managedBlockSha256', 'mergeKind', 'templateSha256']
      : ['installedSha256', 'mergeKind', 'templateSha256']);
  }
});

test('an extra state key is rejected by the engine as INVALID_STATE', async (t) => {
  const target = await materialise(t);
  await put(target, STATE_PATH, `${stableStringify({ ...fixture.state, connections: {} })}\n`);
  const result = await verifyInstall({ ...(await currentSource()), targetPath: target });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_STATE' && issue.path === STATE_PATH), true);
});

test('the fixture verifies against the manifest it was installed from', async (t) => {
  const target = await materialise(t);
  const source = await v120Source(t);
  for (const entry of source.manifest.entries) assert.equal(sha256(Buffer.from(fixture.files[entry.destination])), entry.sha256, `manifest hash: ${entry.destination}`);
  const result = await verifyInstall({ manifest: source.manifest, manifestBytes: source.manifestBytes, sourceRoot: source.root, targetPath: target });
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.manifestMatchesInstalled, true);
});

test('the current source verifies the v1.2.0 install, tolerating only a newer manifest', async (t) => {
  const target = await materialise(t);
  const current = await currentSource();
  const result = await verifyInstall({ ...current, targetPath: target });
  assert.deepEqual(result.entries.filter((entry) => ['MISSING', 'CORRUPT'].includes(entry.status)).map((entry) => `${entry.status} ${entry.destination}`), []);
  for (const entry of result.entries) {
    if (entry.status === 'UNMANAGED') assert.equal(Object.hasOwn(fixture.state.managedPaths, entry.destination), false, `fixture path reported UNMANAGED: ${entry.destination}`);
    else assert.equal(['VERIFIED', 'PERSONALIZED'].includes(entry.status), true, `${entry.status} ${entry.destination}`);
  }
  if (sha256(current.manifestBytes) === fixture.manifestSha256) {
    assert.deepEqual(result.issues, []);
    assert.equal(result.ok, true);
  } else {
    assert.equal(result.ok, false);
    assert.deepEqual([...new Set(result.issues.map((issue) => issue.code))].sort(), result.issues.some((i) => i.code === 'UNMANAGED')
      ? ['SOURCE_MANIFEST_MISMATCH', 'UNMANAGED'] : ['SOURCE_MANIFEST_MISMATCH']);
    for (const issue of result.issues.filter((i) => i.code === 'UNMANAGED')) assert.equal(Object.hasOwn(fixture.state.managedPaths, issue.path), false);
  }
});

test('the current source plans an upgrade of the v1.2.0 install with zero CONFLICT and applies it', async (t) => {
  const target = await materialise(t);
  const current = await currentSource();
  const before = await hashTree(target, Object.keys(fixture.files));
  const plan = await planInstall({ ...current, targetPath: target, operation: 'upgrade' });
  const byDestination = new Map(plan.entries.map((entry) => [entry.destination, entry.status]));

  assert.deepEqual(plan.entries.filter((entry) => entry.status === 'CONFLICT').map((entry) => entry.destination), []);
  const manifestDestinations = new Set(current.manifest.entries.map((entry) => entry.destination));
  const dropped = Object.keys(fixture.state.managedPaths).filter((destination) => !manifestDestinations.has(destination));
  assert.deepEqual(dropped.filter((d) => byDestination.get(d) !== 'DEPRECATED'), []);
  for (const destination of Object.keys(fixture.state.managedPaths).filter((d) => manifestDestinations.has(d))) {
    assert.equal(['IDENTICAL', 'MANAGED-UPDATE', 'PERSONALIZED'].includes(byDestination.get(destination)), true, `${byDestination.get(destination)} ${destination}`);
  }
  for (const destination of [...manifestDestinations].filter((d) => !Object.hasOwn(fixture.state.managedPaths, d))) {
    assert.equal(byDestination.get(destination), 'CREATE', `new path must be CREATE: ${destination}`);
  }

  const applied = await applyInstall({ ...current, targetPath: target, operation: 'upgrade', approvedDigest: plan.digest });
  assert.equal(applied.applied, plan.entries.some((entry) => entry.status !== 'IDENTICAL'));
  const after = await verifyInstall({ ...current, targetPath: target });
  assert.deepEqual(after.issues, []);
  assert.equal(after.ok, true);

  if (applied.applied) {
    await rollbackReceipt({ targetPath: target, receiptId: applied.receiptId });
    for (const [destination, hash] of Object.entries(before)) {
      assert.equal(sha256(await readFile(rel(target, destination))), hash, `rollback did not restore ${destination}`);
    }
    assert.deepEqual(await readState(target), fixture.state);
  }
});

test('an upgrade from a newer source updates managed files, keeps edits safe, and rolls back to the v1.2.0 bytes', async (t) => {
  const target = await materialise(t);
  const source = await v120Source(t);
  const probe = '00-Meta/AGENTS.md';
  const next = Buffer.from(`${fixture.files[probe]}\nupgrade probe\n`);
  await put(source.root, `template/${probe}`, next);
  const manifest = JSON.parse(JSON.stringify(source.manifest));
  manifest.metadata.templateVersion = '1.2.1';
  manifest.entries.find((entry) => entry.destination === probe).sha256 = sha256(next);
  const newer = { manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)), sourceRoot: source.root };
  const before = await hashTree(target, Object.keys(fixture.files));

  const plan = await planInstall({ ...newer, targetPath: target, operation: 'upgrade' });
  assert.equal(plan.entries.find((entry) => entry.destination === probe).status, 'MANAGED-UPDATE');
  assert.deepEqual(plan.entries.filter((entry) => entry.status === 'CONFLICT'), []);
  assert.equal(plan.entries.filter((entry) => entry.status === 'MANAGED-UPDATE').length, 1);

  const applied = await applyInstall({ ...newer, targetPath: target, operation: 'upgrade', approvedDigest: plan.digest });
  assert.equal(applied.applied, true);
  assert.equal((await readFile(rel(target, probe))).equals(next), true);
  assert.equal((await verifyInstall({ ...newer, targetPath: target })).ok, true);

  await rollbackReceipt({ targetPath: target, receiptId: applied.receiptId });
  assert.deepEqual(await hashTree(target, Object.keys(fixture.files)), before);
  const pristine = await v120Source(t);
  const restored = await verifyInstall({ manifest: pristine.manifest, manifestBytes: pristine.manifestBytes, sourceRoot: pristine.root, targetPath: target });
  assert.deepEqual(restored.issues, []);
  assert.equal(restored.ok, true);
});

test('a hand edit of a managed file that the newer source also changes is a named CONFLICT', async (t) => {
  const target = await materialise(t);
  const source = await v120Source(t);
  const probe = '00-Meta/AGENTS.md';
  const next = Buffer.from(`${fixture.files[probe]}\nupgrade probe\n`);
  await put(source.root, `template/${probe}`, next);
  const manifest = JSON.parse(JSON.stringify(source.manifest));
  manifest.entries.find((entry) => entry.destination === probe).sha256 = sha256(next);
  await put(target, probe, `${fixture.files[probe]}\nhand edit\n`);
  const plan = await planInstall({ manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)), sourceRoot: source.root, targetPath: target, operation: 'upgrade' });
  assert.deepEqual(plan.entries.filter((entry) => entry.status === 'CONFLICT').map((entry) => entry.destination), [probe]);
});
