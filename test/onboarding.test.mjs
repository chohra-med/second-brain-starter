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
];

async function contractReport(root) {
  const onboarding = await readFile(path.join(root, 'ONBOARDING.md'), 'utf8');
  const report = { onboarding, routers: [] };
  for (const member of routers) {
    const bytes = await readFile(path.join(root, member), 'utf8');
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
    'one exact existing project folder',
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
  return report;
}

async function disposableCopy(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-onboarding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const member of ['ONBOARDING.md', ...routers]) {
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
