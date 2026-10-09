import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routers = [
  'AGENTS.md',
  'CLAUDE.md',
  '.agents/skills/second-brain-onboarding/SKILL.md',
  '.claude/skills/second-brain-onboarding/SKILL.md',
];
const stages = [
  'Confirm the setup request',
  'Select one exact project root',
  "Read the selected project's rules",
  'Check the required runtime',
  'Produce the canonical plan',
  'Obtain human approval',
  'Apply and verify',
  'Draft records and hand off',
  'Connect a repository',
];

// Wave 07: the stage that connects a repository, and each pinned promise it makes. Each one is removed in turn below.
const connectRequirements = [
  'one exact existing repository path',
  'never list or search for repositories',
  'one connect per repository',
  "Read that repository's rule files before planning",
  'exact workspace, repository and digest',
  'register only',
  'STAGED until',
  '/sdd init',
  'nothing was committed',
];

async function contractReport(root) {
  const onboarding = await readFile(path.join(root, 'ONBOARDING.md'), 'utf8');
  const report = { onboarding, routers: [] };
  for (const member of routers) {
    let bytes = await readFile(path.join(root, member), 'utf8');
    if (member === 'CLAUDE.md') {
      assert.equal(bytes, '@AGENTS.md\n', 'CLAUDE.md must contain only the shared owner import');
      bytes = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    }
    assert.match(bytes, /ONBOARDING\.md/, `${member} must route setup to the canonical contract`);
    assert.match(bytes, /maintenance/i, `${member} must distinguish setup from maintenance`);
    report.routers.push(member);
  }
  let previous = -1;
  for (const [indexNumber, stage] of stages.entries()) {
    const marker = `## ${indexNumber + 1}. ${stage}`;
    const index = onboarding.indexOf(marker);
    assert.ok(index > previous, `missing or unordered stage: ${stage}`);
    previous = index;
  }
  for (const requirement of [
    'one exact existing project folder or a new workspace at a path that does not exist yet',
    'Do not recursively search',
    'AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, `ai_rules/`, `.memory/`, and `README.md`',
    'version 22 or newer',
    'curl piped to a shell',
    'Do not install a project\'s dependencies just because it has a lockfile',
    'Do not write any workspace file before approval',
    'The user, not the agent, approves the plan',
    'unchanged full digest',
    'receipt ID',
    'Mark unknown facts as unknown',
    'installed `Home.md`',
  ]) assert.match(onboarding, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing contract requirement: ${requirement}`);
  for (const requirement of connectRequirements) assert.ok(onboarding.includes(requirement), `missing connect requirement: ${requirement}`);
  return report;
}

async function disposableCopy(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-onboarding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const member of ['ONBOARDING.md', 'template/03-Resources/Procedures/first-use.md', ...routers]) {
    const destination = path.join(root, member);
    await cp(path.join(sourceRoot, member), destination, { recursive: true });
  }
  return root;
}

test('static onboarding contract ships both client routers and every promised setup stage', async () => {
  const report = await contractReport(sourceRoot);
  assert.deepEqual(report.routers, routers);
  assert.equal(report.onboarding.includes('Node.js runtime'), true);
});

test('static onboarding contract rejects each independently removed router or setup stage', async (t) => {
  for (const member of routers) {
    const root = await disposableCopy(t);
    await unlink(path.join(root, member));
    await assert.rejects(() => contractReport(root), /ENOENT/);
  }
  for (const stage of stages) {
    const root = await disposableCopy(t);
    const contract = path.join(root, 'ONBOARDING.md');
    const bytes = await readFile(contract, 'utf8');
    await writeFile(contract, bytes.replace(stage, `removed ${stage}`));
    await assert.rejects(() => contractReport(root), new RegExp(`missing or unordered stage: ${stage}`));
  }
});

test('every connect requirement rejects an omitted promise and passes after restoring it (wave 07)', async (t) => {
  const root = await disposableCopy(t);
  const owner = path.join(root, 'ONBOARDING.md');
  const original = await readFile(owner, 'utf8');
  await contractReport(root);
  for (const requirement of connectRequirements) {
    await writeFile(owner, original.split(requirement).join('omitted promise'));
    await assert.rejects(() => contractReport(root), /missing connect requirement/, requirement);
    await writeFile(owner, original);
    await contractReport(root);
  }
});

test('static contract fixtures cover changed targets, stale digests, denied runtime approval, maintenance intent, and private-path boundaries', async () => {
  const { onboarding } = await contractReport(sourceRoot);
  const cases = [
    ['changed target', 'A changed path starts selection again'],
    ['stale digest', 'stale digest, changed target, conflict, or failed verification stops the route'],
    ['denied runtime approval', 'ask for approval before installing anything'],
    ['maintenance request', 'Do not hijack repository maintenance'],
    ['hidden and secret paths', 'hidden directories, symlinks, `.env` files, credentials'],
  ];
  for (const [fixture, expected] of cases) assert.equal(onboarding.includes(expected), true, fixture);
});

test('thin repository import rejects duplicate instructions and missing or wrong owner imports', async (t) => {
  for (const bytes of ['', '@missing.md\n', '@AGENTS.md\nextra instructions\n', '@AGENTS.md\n@AGENTS.md\n']) {
    const root = await disposableCopy(t);
    await writeFile(path.join(root, 'CLAUDE.md'), bytes);
    await assert.rejects(() => contractReport(root), /CLAUDE.md must contain only/);
  }
});

const firstUseRequirements = [
  'Ask only missing goal, current work, desired output and constraints',
  'obtain their confirmation of its goal and output',
  'exact personalized-record plan: file paths, proposed edits, evidence/source and unknowns',
  'Obtain approval for that exact plan before edits',
  'Preserve exact preimages and check current bytes for concurrent edits',
  'Existing personalized values stay intact unless the user explicitly approves a change',
  'one small artifact, its exact file, scope and falsifiable check',
  'Obtain approval for that artifact plan before producing it',
  'An offered task, blank template or promised result is not completed work',
  'learning-note.md',
  'PARA: the note belongs in Projects',
  'CODE: Capture the paragraph and task; Organize',
  'Done, Verified, Open and Next',
  'Start a new chat in the installed target',
  'Read root `AGENTS.md` manually',
  'Recover the goal, constraints, output evidence and Next',
  'A same-chat reread is rehearsal',
  'Fresh-client acceptance and authenticated discovery remain unverified',
  'It does not automatically undo later personalization or artifacts',
  'Repeated or interrupted setup fills only actual gaps',
];

async function firstUseReport(root) {
  const text = await readFile(path.join(root, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  for (const requirement of firstUseRequirements) assert.ok(text.includes(requirement), `missing first-use boundary: ${requirement}`);
}

test('installed first-use contract covers approvals, preservation, useful work and new-chat recovery', async () => {
  await firstUseReport(sourceRoot);
  const { onboarding } = await contractReport(sourceRoot);
  assert.ok(onboarding.includes('ask the user to confirm it before reading or writing'));
  assert.ok(onboarding.includes('Do not create a missing target before approval'));
  assert.ok(onboarding.includes('03-Resources/Procedures/first-use.md'));
});

test('every new first-use guard rejects an omitted boundary and passes after restoring it', async (t) => {
  const root = await disposableCopy(t);
  const owner = path.join(root, 'template/03-Resources/Procedures/first-use.md');
  const original = await readFile(owner, 'utf8');
  for (const requirement of firstUseRequirements) {
    await writeFile(owner, original.replace(requirement, 'omitted boundary'));
    await assert.rejects(() => firstUseReport(root), /missing first-use boundary/);
    await writeFile(owner, original);
    await firstUseReport(root);
  }
});

test('setup rejects omitted exact target confirmation, missing-target creation gate and first-use delegation', async (t) => {
  const root = await disposableCopy(t);
  const owner = path.join(root, 'ONBOARDING.md');
  const original = await readFile(owner, 'utf8');
  const boundaries = [
    'ask the user to confirm it before reading or writing',
    'Do not create a missing target before approval',
    'follow only the missing-question section',
    '03-Resources/Procedures/first-use.md',
  ];
  const check = async () => {
    const text = await readFile(owner, 'utf8');
    for (const boundary of boundaries) assert.ok(text.includes(boundary), `missing setup boundary: ${boundary}`);
  };
  for (const boundary of boundaries) {
    await writeFile(owner, original.split(boundary).join('omitted boundary'));
    await assert.rejects(check, /missing setup boundary/);
    await writeFile(owner, original);
    await check();
  }
});
