import assert from 'node:assert/strict';
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstallPlanError, applyAdopt, applyInstall, planAdopt, planInstall, rollbackReceipt, sha256, verifyInstall } from '../lib/installer.mjs';

const managedPaths = [
  'Home.md',
  '01-Projects/Selected-Project/FACTS.md',
  '01-Projects/Selected-Project/Decisions.md',
  '01-Projects/Selected-Project/roadmap.md',
  '01-Projects/Selected-Project/progress.md',
  '05-Daily/Today.md',
];

const seedFilePaths = new Set([
  '01-Projects/Selected-Project/FACTS.md',
  '01-Projects/Selected-Project/Decisions.md',
  '01-Projects/Selected-Project/roadmap.md',
  '01-Projects/Selected-Project/progress.md',
  '05-Daily/Today.md',
]);

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

async function manifestFor(sourceRoot, destinations = managedPaths, seedPaths = new Set()) {
  const entries = [];
  for (const destination of destinations) {
    const source = `template/${destination}`;
    const bytes = await readFile(path.join(sourceRoot, ...source.split('/')));
    entries.push({ source, destination, sha256: sha256(bytes), mergeKind: seedPaths.has(destination) ? 'seed-file' : 'managed-file' });
  }
  const manifest = { schemaVersion: 1, metadata: { templateVersion: '1.1.0' }, entries };
  return { manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)) };
}

async function install(subject, options = {}) {
  const source = await manifestFor(subject.sourceRoot, options.destinations, options.seedPaths);
  const plan = await planInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, ...options });
  const result = await applyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, approvedDigest: plan.digest, ...options });
  return { ...source, plan, result };
}

test('seed files remain user-owned across verify and upgrade while managed files remain exact', async (t) => {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  const sourceA = await install(subject, { seedPaths: seedFilePaths });
  const seed = '01-Projects/Selected-Project/FACTS.md';
  const seedPath = path.join(subject.target, ...seed.split('/'));
  const homePath = path.join(subject.target, 'Home.md');
  const personalizedBytes = Buffer.from('# Personal facts\n');
  await writeFile(seedPath, personalizedBytes);

  const personalized = await verifyInstall({ ...sourceA, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(personalized.ok, true);
  assert.equal(personalized.entries.find((entry) => entry.destination === seed).status, 'PERSONALIZED');

  await writeFile(homePath, '# Personal home\n');
  const managedDrift = await verifyInstall({ ...sourceA, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(managedDrift.ok, false);
  assert.deepEqual(managedDrift.issues.filter((issue) => issue.code === 'MODIFIED').map((issue) => issue.path), ['Home.md']);
  await writeFile(homePath, subject.initial['Home.md']);

  await writeFile(path.join(subject.sourceRoot, 'template', ...seed.split('/')), '# New facts template\n');
  await writeFile(path.join(subject.sourceRoot, 'template', 'Home.md'), '# New home template\n');
  const sourceB = await manifestFor(subject.sourceRoot, managedPaths, seedFilePaths);
  const plan = await planInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  assert.equal(plan.entries.find((entry) => entry.destination === seed).status, 'PERSONALIZED');
  assert.equal(plan.entries.find((entry) => entry.destination === 'Home.md').status, 'MANAGED-UPDATE');
  await applyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: plan.digest });
  assert.deepEqual(await readFile(seedPath), personalizedBytes);
  assert.equal(await readFile(homePath, 'utf8'), '# New home template\n');
  const upgraded = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.entries.find((entry) => entry.destination === seed).status, 'PERSONALIZED');

  await unlink(seedPath);
  const missing = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.issues.filter((issue) => issue.code === 'MISSING').map((issue) => issue.path), [seed]);
  await mkdir(seedPath);
  const directory = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(directory.ok, false);
  assert.deepEqual(directory.issues.filter((issue) => issue.code === 'NON_REGULAR_FILE').map((issue) => issue.path), [seed]);
  await rm(seedPath, { recursive: true });
  await writeFile(seedPath, personalizedBytes);

  if (process.platform !== 'win32') {
    const outside = path.join(subject.root, 'outside.md');
    await writeFile(outside, 'outside\n');
    await unlink(seedPath);
    await symlink(outside, seedPath);
    const escapingLink = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
    assert.equal(escapingLink.ok, false);
    assert.deepEqual(escapingLink.issues.filter((issue) => issue.code === 'SYMLINK_PATH').map((issue) => issue.path), [seed]);
    await unlink(seedPath);
    await symlink(path.join(subject.root, 'missing.md'), seedPath);
    const danglingLink = await verifyInstall({ ...sourceB, sourceRoot: subject.sourceRoot, targetPath: subject.target });
    assert.equal(danglingLink.ok, false);
    assert.deepEqual(danglingLink.issues.filter((issue) => issue.code === 'SYMLINK_PATH').map((issue) => issue.path), [seed]);
  }
});

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
  assert.deepEqual(broken.issues.filter((issue) => ['MODIFIED', 'MISSING'].includes(issue.code)).map((issue) => issue.path), [
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
  assert.equal(mismatch.entries.some((entry) => ['CORRUPT', 'MODIFIED'].includes(entry.status)), false);
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

// ---------------------------------------------------------------------------
// v1.4.0 three-way states. Synthetic files only.
// ---------------------------------------------------------------------------

const ROUTE = '00-Meta/Route.md';
const routeA = 'Use this for the selected project folder.\nRead the facts first.\nThen the roadmap.\nState the next action.\n';

async function routeFixture(t, { seedPaths = new Set(), destinations = [...managedPaths, ROUTE] } = {}) {
  const subject = await fixture();
  t.after(() => rm(subject.root, { recursive: true, force: true }));
  await mkdir(path.join(subject.sourceRoot, 'template', '00-Meta'), { recursive: true });
  await writeFile(path.join(subject.sourceRoot, 'template', ...ROUTE.split('/')), routeA);
  const installed = await install(subject, { destinations, seedPaths });
  return { subject, installed, destinations, seedPaths };
}

async function planUpgrade(subject, destinations, seedPaths = new Set()) {
  const source = await manifestFor(subject.sourceRoot, destinations, seedPaths);
  const plan = await planInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade' });
  return { source, plan, status: (destination) => plan.entries.find((entry) => entry.destination === destination).status };
}

async function applyUpgrade(subject, source, plan) {
  return applyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target, operation: 'upgrade', approvedDigest: plan.digest });
}

const at = (subject, destination) => path.join(subject.target, ...destination.split('/'));
const templateAt = (subject, destination) => path.join(subject.sourceRoot, 'template', ...destination.split('/'));

test('init records a base snapshot of every managed file, bound to the recorded template hash', async (t) => {
  const { subject } = await routeFixture(t);
  const state = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  for (const destination of [...managedPaths, ROUTE]) {
    const snapshot = await readFile(path.join(subject.target, '.second-brain', 'base', ...destination.split('/')));
    assert.equal(sha256(snapshot), state.managedPaths[destination].templateSha256, destination);
  }
});

test('CUSTOMIZED-KEEP: a local edit of a managed file the template did not change is kept, not a conflict', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  const local = routeA.replace('folder', 'folders');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, 'Home.md'), 'B Home.md\n');
  const { source, plan, status } = await planUpgrade(subject, destinations);
  assert.equal(status(ROUTE), 'CUSTOMIZED-KEEP');
  assert.equal(plan.entries.find((entry) => entry.destination === ROUTE).undo.action, 'none');
  assert.equal(status('Home.md'), 'MANAGED-UPDATE');
  const applied = await applyUpgrade(subject, source, plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local);
  // Approving the plan accepts the kept bytes: verify is clean and the next plan is a no-op.
  assert.equal((await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target })).ok, true);
  const again = await planUpgrade(subject, destinations);
  assert.equal(again.plan.entries.every((entry) => entry.status === 'IDENTICAL'), true);
  assert.deepEqual(again.plan.baseWrites, []);
  assert.equal((await applyUpgrade(subject, again.source, again.plan)).receiptId, null, 'a second upgrade is idempotent and writes no receipt');
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local, 'rollback never touched the kept file');
  assert.equal(await readFile(at(subject, 'Home.md'), 'utf8'), 'A Home.md\n');
});

test('MERGE: non-overlapping local and template edits merge, undo restores the local preimage, and a second upgrade is idempotent', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  const local = routeA.replace('Read the facts first.\n', 'Read the facts first.\nLocal rule: name the owner.\n');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('State the next action.', 'State one next action.'));
  const { source, plan, status } = await planUpgrade(subject, destinations);
  assert.equal(status(ROUTE), 'MERGE');
  const entry = plan.entries.find((item) => item.destination === ROUTE);
  assert.equal(entry.undo.action, 'restore-preimage');
  assert.equal(entry.baseSource, 'snapshot');
  const expected = 'Use this for the selected project folder.\nRead the facts first.\nLocal rule: name the owner.\nThen the roadmap.\nState one next action.\n';
  assert.equal(sha256(Buffer.from(expected)), entry.intendedSha256, 'the plan digest binds the merged bytes');
  assert.ok(plan.baseWrites.some((write) => write.destination === `.second-brain/base/${ROUTE}`), 'the new template becomes the next base');
  const applied = await applyUpgrade(subject, source, plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), expected);
  assert.equal((await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target })).ok, true);
  const again = await planUpgrade(subject, destinations);
  assert.equal(again.status(ROUTE), 'IDENTICAL');
  assert.equal((await applyUpgrade(subject, again.source, again.plan)).applied, false);
  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local);
  assert.equal(await readFile(path.join(subject.target, '.second-brain', 'base', ...ROUTE.split('/')), 'utf8'), routeA, 'rollback restores the previous base snapshot');
});

test('a merged file keeps merging on the next template change instead of being overwritten', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  await writeFile(at(subject, ROUTE), `${routeA}Local tail.\n`);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the open roadmap.'));
  const first = await planUpgrade(subject, destinations);
  assert.equal(first.status(ROUTE), 'MERGE');
  await applyUpgrade(subject, first.source, first.plan);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the open roadmap.').replace('Use this', 'Use this route'));
  const second = await planUpgrade(subject, destinations);
  assert.equal(second.status(ROUTE), 'MERGE', 'installed != template after a merge, so a later change is merged, never a blind update');
  await applyUpgrade(subject, second.source, second.plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), 'Use this route for the selected project folder.\nRead the facts first.\nThen the open roadmap.\nState the next action.\nLocal tail.\n');
});

test('CONFLICT only for overlapping edits: the plan refuses, names the path, and offers a marked proposal; managed files stay protected', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  const local = routeA.replace('Then the roadmap.', 'Then the local roadmap.');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the template roadmap.'));
  await writeFile(templateAt(subject, 'Home.md'), 'B Home.md\n');
  const { source, plan, status } = await planUpgrade(subject, destinations);
  assert.deepEqual(plan.entries.filter((entry) => entry.status === 'CONFLICT').map((entry) => entry.destination), [ROUTE]);
  assert.equal(status('Home.md'), 'MANAGED-UPDATE');
  const proposal = plan.entries.find((entry) => entry.destination === ROUTE).proposal.toString('utf8');
  assert.match(proposal, /^<<<<<<< local 00-Meta\/Route\.md\nThen the local roadmap\.\n\|\|\|\|\|\|\| base [a-f0-9]{12}\nThen the roadmap\.\n=======\nThen the template roadmap\.\n>>>>>>> template [a-f0-9]{12}\n/m);
  await assert.rejects(lstat(path.join(subject.target, '.second-brain', 'merge')), (error) => error.code === 'ENOENT', 'a plan writes no proposal file');
  assert.deepEqual(plan.proposalWrites, [], 'a CONFLICT proposal is printed on request, never planned as a write');
  await rejects('PLAN_CONFLICT', () => applyUpgrade(subject, source, plan));
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local);
  assert.equal(await readFile(at(subject, 'Home.md'), 'utf8'), 'A Home.md\n', 'nothing is applied while a conflict remains');
});

test('without a usable base the planner falls back to CONFLICT with a whole-file proposal, and a damaged snapshot is CORRUPT in verify', async (t) => {
  const { subject, destinations, installed } = await routeFixture(t);
  const snapshotPath = path.join(subject.target, '.second-brain', 'base', ...ROUTE.split('/'));
  await writeFile(snapshotPath, 'tampered base\n');
  const damaged = await verifyInstall({ ...installed, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.equal(damaged.ok, false);
  assert.deepEqual(damaged.issues.filter((issue) => issue.code === 'CORRUPT').map((issue) => issue.path), [`.second-brain/base/${ROUTE}`]);
  await writeFile(at(subject, ROUTE), `${routeA}Local tail.\n`);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Use this', 'Use this route'));
  for (const label of ['tampered snapshot', 'missing snapshot']) {
    const { plan, status } = await planUpgrade(subject, destinations);
    assert.equal(status(ROUTE), 'CONFLICT', `${label}: a merge needs a base whose hash is the recorded template hash`);
    const proposal = plan.entries.find((entry) => entry.destination === ROUTE).proposal.toString('utf8');
    assert.match(proposal, /^<<<<<<< local [^\n]+\nUse this for[\s\S]*=======\nUse this route for[\s\S]*>>>>>>> template [a-f0-9]{12}\n$/);
    assert.equal(proposal.includes('|||||||'), false, `${label}: no base section, because no base was used`);
    await rm(snapshotPath, { force: true });
  }
});

test('SEED-UPDATE: an unmodified older seed takes the new template; an edited seed stays PERSONALIZED', async (t) => {
  const { subject, destinations } = await routeFixture(t, { seedPaths: seedFilePaths });
  const edited = '01-Projects/Selected-Project/FACTS.md';
  await writeFile(at(subject, edited), '# My facts\n');
  for (const destination of seedFilePaths) await writeFile(templateAt(subject, destination), `B ${destination}\n`);
  const { source, plan, status } = await planUpgrade(subject, destinations, seedFilePaths);
  assert.equal(status(edited), 'PERSONALIZED');
  assert.equal(status('01-Projects/Selected-Project/roadmap.md'), 'SEED-UPDATE');
  await applyUpgrade(subject, source, plan);
  assert.equal(await readFile(at(subject, '01-Projects/Selected-Project/roadmap.md'), 'utf8'), 'B 01-Projects/Selected-Project/roadmap.md\n');
  assert.equal(await readFile(at(subject, edited), 'utf8'), '# My facts\n');
  const again = await planUpgrade(subject, destinations, seedFilePaths);
  assert.equal(again.status('01-Projects/Selected-Project/roadmap.md'), 'IDENTICAL');
});

test('an edited seed whose template changed since install gets a merge proposal, and the seed stays byte-identical', async (t) => {
  const { subject, destinations } = await routeFixture(t, { seedPaths: new Set([ROUTE]) });
  const local = routeA.replace('State the next action.\n', 'State the next action.\nMy own line.\n');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Read the facts first.', 'Read the facts first, then the decisions.'));
  const { source, plan, status } = await planUpgrade(subject, destinations, new Set([ROUTE]));
  assert.equal(status(ROUTE), 'PERSONALIZED');
  assert.deepEqual(plan.proposalWrites.map((write) => write.destination), [PROPOSAL_PATH]);
  const templateLine = (await readFile(templateAt(subject, ROUTE), 'utf8')).split('\n').find((line) => line.includes('then the decisions'));
  assert.ok(templateLine, 'the test template carries the new line');
  const applied = await applyUpgrade(subject, source, plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local, 'the seed is never changed by an upgrade');
  const proposal = await readFile(at(subject, PROPOSAL_PATH), 'utf8');
  assert.ok(proposal.includes(templateLine), 'the proposal carries the template line that is new');
  assert.ok(proposal.includes('My own line.\n'), 'the proposal keeps the line the user added');
  assert.ok(applied.receiptId, 'the proposal is recorded by a receipt');
});

test('an edited seed whose template did not change since install gets no proposal', async (t) => {
  const { subject, destinations } = await routeFixture(t, { seedPaths: new Set([ROUTE]) });
  await writeFile(at(subject, ROUTE), routeA.replace('State the next action.\n', 'State the next action.\nMy own line.\n'));
  const { plan, status } = await planUpgrade(subject, destinations, new Set([ROUTE]));
  assert.equal(status(ROUTE), 'PERSONALIZED');
  assert.equal(plan.entries.find((entry) => entry.destination === ROUTE).proposal, undefined);
  assert.deepEqual(plan.proposalWrites, []);
});

test('a second upgrade from the same template source offers no seed proposal again', async (t) => {
  const { subject, destinations } = await routeFixture(t, { seedPaths: new Set([ROUTE]) });
  await writeFile(at(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then my roadmap.'));
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the new roadmap.'));
  const first = await planUpgrade(subject, destinations, new Set([ROUTE]));
  assert.deepEqual(first.plan.proposalWrites.map((write) => write.destination), [PROPOSAL_PATH]);
  await applyUpgrade(subject, first.source, first.plan);
  const second = await planUpgrade(subject, destinations, new Set([ROUTE]));
  assert.equal(second.status(ROUTE), 'PERSONALIZED');
  assert.equal(second.plan.entries.find((entry) => entry.destination === ROUTE).proposal, undefined);
  assert.deepEqual(second.plan.proposalWrites, [], 'the recorded template hash is the new source, so nothing is offered twice');
});

test('a seed records a base snapshot of its template at install, and verify accepts it', async (t) => {
  const { subject, installed } = await routeFixture(t, { seedPaths: new Set([ROUTE]) });
  const state = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  const snapshot = await readFile(path.join(subject.target, '.second-brain', 'base', ...ROUTE.split('/')));
  assert.equal(sha256(snapshot), state.managedPaths[ROUTE].templateSha256);
  assert.equal((await verifyInstall({ ...installed, sourceRoot: subject.sourceRoot, targetPath: subject.target })).ok, true);
  await writeFile(path.join(subject.target, '.second-brain', 'base', ...ROUTE.split('/')), 'tampered base\n');
  const damaged = await verifyInstall({ ...installed, sourceRoot: subject.sourceRoot, targetPath: subject.target });
  assert.deepEqual(damaged.issues.filter((issue) => issue.code === 'CORRUPT').map((issue) => issue.path), [`.second-brain/base/${ROUTE}`]);
});

test('managed to seed migration merges a customized file once, then the file is user-owned', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  const local = routeA.replace('State the next action.\n', 'State the next action.\nMy own line.\n');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Read the facts first.', 'Read the facts first, then the decisions.'));
  const seeds = new Set([ROUTE]);
  const { source, plan, status } = await planUpgrade(subject, destinations, seeds);
  assert.equal(status(ROUTE), 'MERGE');
  assert.equal(plan.baseWrites.some((write) => write.managedDestination === ROUTE), true, 'a seed keeps a base snapshot so its later proposal has a base');
  await applyUpgrade(subject, source, plan);
  const state = JSON.parse(await readFile(path.join(subject.target, '.second-brain', 'installed-state.json'), 'utf8'));
  assert.equal(state.managedPaths[ROUTE].mergeKind, 'seed-file');
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), 'Use this for the selected project folder.\nRead the facts first, then the decisions.\nThen the roadmap.\nState the next action.\nMy own line.\n');
  await writeFile(templateAt(subject, ROUTE), 'Entirely new route.\n');
  const later = await planUpgrade(subject, destinations, seeds);
  assert.equal(later.status(ROUTE), 'PERSONALIZED', 'after migration the file is user-owned');
});

test('a managed to seed migration that cannot merge keeps the local file and only offers a proposal', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  const local = routeA.replace('Then the roadmap.', 'Then my roadmap.');
  await writeFile(at(subject, ROUTE), local);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the new roadmap.'));
  const { source, plan, status } = await planUpgrade(subject, destinations, new Set([ROUTE]));
  assert.equal(status(ROUTE), 'PERSONALIZED');
  assert.ok(plan.entries.find((entry) => entry.destination === ROUTE).proposal);
  await applyUpgrade(subject, source, plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local);
});

const PROPOSAL_PATH = `.second-brain/merge/1.1.0/${ROUTE}.proposed`;

async function seedMigrationFixture(t) {
  const { subject, destinations } = await routeFixture(t);
  await writeFile(at(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then my roadmap.'));
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the new roadmap.'));
  return { subject, destinations, seeds: new Set([ROUTE]) };
}

test('a seed migration proposal is written by the approved apply, listed in the receipt, removed by rollback, and verify is OK after each step', async (t) => {
  const { subject, destinations, seeds } = await seedMigrationFixture(t);
  const { source, plan, status } = await planUpgrade(subject, destinations, seeds);
  assert.equal(status(ROUTE), 'PERSONALIZED');
  assert.deepEqual(plan.proposalWrites.map((write) => write.destination), [PROPOSAL_PATH]);
  await assert.rejects(lstat(at(subject, '.second-brain/merge')), { code: 'ENOENT' }, 'the plan itself writes nothing');
  const applied = await applyUpgrade(subject, source, plan);
  const proposal = plan.entries.find((entry) => entry.destination === ROUTE).proposal;
  assert.equal(await readFile(at(subject, PROPOSAL_PATH), 'utf8'), proposal.toString('utf8'));
  const receipt = JSON.parse(await readFile(path.join(subject.target, applied.receiptPath), 'utf8'));
  const written = receipt.writes.find((write) => write.destination === PROPOSAL_PATH);
  assert.ok(written, 'the receipt lists the proposal write');
  assert.equal(written.preimageSha256, null);
  assert.equal(written.backupPath, null);
  assert.equal(written.postimageSha256, sha256(proposal));
  assert.equal((await verifyInstall({ ...source, sourceRoot: subject.sourceRoot, targetPath: subject.target })).ok, true);

  await rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId });
  await assert.rejects(lstat(at(subject, PROPOSAL_PATH)), { code: 'ENOENT' }, 'rollback removes the proposal');
  await assert.rejects(lstat(at(subject, '.second-brain/merge')), { code: 'ENOENT' }, 'rollback removes the folders the apply created');
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), routeA.replace('Then the roadmap.', 'Then my roadmap.'));
});

test('a tampered merge proposal entry in the receipt is refused before rollback', async (t) => {
  const { subject, destinations, seeds } = await seedMigrationFixture(t);
  const { source, plan } = await planUpgrade(subject, destinations, seeds);
  const applied = await applyUpgrade(subject, source, plan);
  const receiptPath = path.join(subject.target, applied.receiptPath);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const proposalWrite = receipt.writes.find((write) => write.destination === PROPOSAL_PATH);
  assert.ok(proposalWrite, 'the upgrade receipt records the proposal write');
  proposalWrite.destination = ROUTE;
  await writeFile(receiptPath, JSON.stringify(receipt));
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.equal(await readFile(at(subject, PROPOSAL_PATH), 'utf8'), plan.entries.find((entry) => entry.destination === ROUTE).proposal.toString('utf8'), 'nothing was rolled back');
});

test('an edited proposal already at the proposal path is kept: the plan says so, the apply never overwrites it, and it changes the digest', async (t) => {
  const { subject, destinations, seeds } = await seedMigrationFixture(t);
  const clean = await planUpgrade(subject, destinations, seeds);
  const edited = Buffer.from('My own notes on the template change.\n');
  await mkdir(path.dirname(at(subject, PROPOSAL_PATH)), { recursive: true });
  await writeFile(at(subject, PROPOSAL_PATH), edited);
  const { source, plan, status } = await planUpgrade(subject, destinations, seeds);
  assert.equal(status(ROUTE), 'PERSONALIZED');
  assert.deepEqual(plan.proposalWrites, [], 'an existing proposal is not planned as a write');
  assert.equal(plan.entries.find((entry) => entry.destination === ROUTE).proposalState, 'kept');
  assert.notEqual(plan.digest, clean.plan.digest, 'the digest records that the proposal write is absent');
  const applied = await applyUpgrade(subject, source, plan);
  assert.deepEqual(await readFile(at(subject, PROPOSAL_PATH)), edited, 'the edited proposal survives the apply byte for byte');
  const receipt = JSON.parse(await readFile(path.join(subject.target, applied.receiptPath), 'utf8'));
  assert.equal(receipt.writes.some((write) => write.destination === PROPOSAL_PATH), false, 'the receipt does not claim the kept file');
});

test('verify --adopt accepts a local edit under its own receipt, and rollback restores the previous record', async (t) => {
  const { subject, installed } = await routeFixture(t);
  const local = `${routeA}Adopted line.\n`;
  await writeFile(at(subject, ROUTE), local);
  const payload = { ...installed, sourceRoot: subject.sourceRoot, targetPath: subject.target };
  const before = await verifyInstall(payload);
  assert.deepEqual(before.issues.map((issue) => `${issue.code} ${issue.path}`), [`MODIFIED ${ROUTE}`]);
  const statePath = path.join(subject.target, '.second-brain', 'installed-state.json');
  const stateBefore = await readFile(statePath);

  await rejects('ADOPT_REFUSED', () => planAdopt({ ...payload, paths: ['01-Projects/Selected-Project/missing.md'] }));
  await rejects('ADOPT_REFUSED', () => planAdopt({ ...payload, paths: [ROUTE, ROUTE] }));
  const plan = await planAdopt({ ...payload, paths: [ROUTE] });
  await rejects('PLAN_DIGEST_MISMATCH', () => applyAdopt({ ...payload, paths: [ROUTE], approvedDigest: '0'.repeat(64) }));
  assert.deepEqual(await readFile(statePath), stateBefore);
  const adopted = await applyAdopt({ ...payload, paths: [ROUTE], approvedDigest: plan.digest });
  assert.equal(adopted.applied, true);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), local, 'adopt never changes the file');
  assert.equal((await verifyInstall(payload)).ok, true);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.operation, 'adopt');
  assert.equal(state.managedPaths[ROUTE].installedSha256, sha256(Buffer.from(local)));

  const repeat = await planAdopt({ ...payload, paths: [ROUTE] });
  assert.equal((await applyAdopt({ ...payload, paths: [ROUTE], approvedDigest: repeat.digest })).applied, false);

  await rollbackReceipt({ targetPath: subject.target, receiptId: adopted.receiptId });
  assert.deepEqual(await readFile(statePath), stateBefore);
  assert.deepEqual((await verifyInstall(payload)).issues.map((issue) => issue.code), ['MODIFIED']);
});

test('adopt after a resolved conflict moves the base to the new template, so the next upgrade does not conflict again', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  await writeFile(at(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the local roadmap.'));
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Then the roadmap.', 'Then the template roadmap.'));
  const conflicted = await planUpgrade(subject, destinations);
  assert.equal(conflicted.status(ROUTE), 'CONFLICT');
  const resolved = routeA.replace('Then the roadmap.', 'Then the local and template roadmap.');
  await writeFile(at(subject, ROUTE), resolved);
  const payload = { ...conflicted.source, sourceRoot: subject.sourceRoot, targetPath: subject.target };
  const plan = await planAdopt({ ...payload, paths: [ROUTE] });
  assert.equal(plan.entries[0].baseMoves, true);
  await applyAdopt({ ...payload, paths: [ROUTE], approvedDigest: plan.digest });
  const next = await planUpgrade(subject, destinations);
  assert.equal(next.status(ROUTE), 'IDENTICAL');
  assert.deepEqual(next.plan.entries.filter((entry) => entry.status === 'CONFLICT'), []);
  await applyUpgrade(subject, next.source, next.plan);
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), resolved);
});

test('adopt refuses a seed file and a path that is not managed', async (t) => {
  const { subject, installed } = await routeFixture(t, { seedPaths: seedFilePaths });
  const payload = { ...installed, sourceRoot: subject.sourceRoot, targetPath: subject.target };
  await rejects('ADOPT_REFUSED', () => planAdopt({ ...payload, paths: ['01-Projects/Selected-Project/FACTS.md'] }));
  await rejects('ADOPT_REFUSED', () => planAdopt({ ...payload, paths: [] }));
});

test('a receipt whose base snapshot write is not owned by the installed state is refused before rollback', async (t) => {
  const { subject, destinations } = await routeFixture(t);
  await writeFile(templateAt(subject, ROUTE), routeA.replace('Use this', 'Use this route'));
  const { source, plan } = await planUpgrade(subject, destinations);
  const applied = await applyUpgrade(subject, source, plan);
  const receiptPath = path.join(subject.target, applied.receiptPath);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const baseWrite = receipt.writes.find((write) => write.destination === `.second-brain/base/${ROUTE}`);
  assert.ok(baseWrite, 'the upgrade receipt records the base snapshot write');
  baseWrite.postimageSha256 = sha256(Buffer.from('not the template\n'));
  await writeFile(receiptPath, JSON.stringify(receipt));
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: subject.target, receiptId: applied.receiptId }));
  assert.equal(await readFile(at(subject, ROUTE), 'utf8'), routeA.replace('Use this', 'Use this route'), 'nothing was rolled back');
});
