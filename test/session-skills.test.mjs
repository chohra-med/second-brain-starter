import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const read = (relative) => readFile(path.join(sourceRoot, relative), 'utf8');
const exists = (relative) => access(path.join(sourceRoot, relative)).then(() => true, () => false);
const PROCEDURES = 'template/03-Resources/Procedures';

// The skill names the procedure it follows, and that procedure exists in the template.
async function skillProblems(skill, text, procedure) {
  const problems = [];
  if (!new RegExp(`^name: ${skill}$`, 'm').test(text)) problems.push(`front matter name is not ${skill}`);
  if (!text.includes(`\`03-Resources/Procedures/${procedure}\``)) problems.push(`does not name ${procedure}`);
  if (!(await exists(`${PROCEDURES}/${procedure}`))) problems.push(`${procedure} is missing from the template`);
  if (text.includes('—')) problems.push('contains an em dash');
  return problems;
}

// A procedure may point only at files the template ships. A link is checked against the installed layout, which mirrors template/.
async function linkProblems(text) {
  const problems = [];
  for (const match of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
    const resolved = path.posix.normalize(path.posix.join(PROCEDURES, match[1]));
    if (!(await exists(resolved))) problems.push(`links to ${match[1]}, which the template does not ship`);
  }
  return problems;
}

async function verifyProblems(text) {
  const problems = [...(await linkProblems(text))];
  for (const phrase of ['`SAFE TO CLOSE`', '`DO NOT CLOSE: <the one reason>`', '`verify-end-session dry`', 'It never starts work', 'Asks: <n>', 'Unknown is not none']) {
    if (!text.includes(phrase)) problems.push(`is missing: ${phrase}`);
  }
  for (const record of ['00-Meta/Daily-Task-Plan.md', '00-Meta/Decisions.md']) {
    if (!text.includes(record)) problems.push(`does not name ${record}`);
  }
  if (text.includes('—')) problems.push('contains an em dash');
  return problems;
}

async function harnessProblems(text) {
  const problems = [...(await linkProblems(text))];
  for (const cause of ['A. Missing step', 'B. Not routed', 'C. Read but skipped', 'D. Stale or conflicting', 'E. Preference', 'F. Tool or file defect']) {
    if (!text.includes(cause)) problems.push(`has no cause row: ${cause}`);
  }
  for (const phrase of ['Never edit a managed file from the workspace.', '`harness-session dry`', 'wait for a yes', 'verbatim']) {
    if (!text.includes(phrase)) problems.push(`is missing: ${phrase}`);
  }
  for (const record of ['00-Meta/Decisions.md', '00-Meta/Profile.md', 'learning-and-scaling.md', 'extend.md']) {
    if (!text.includes(record)) problems.push(`does not name ${record}`);
  }
  if (text.includes('—')) problems.push('contains an em dash');
  return problems;
}

test('the three skills name their procedures, and next-session reads the handover procedure', async () => {
  assert.deepEqual(await skillProblems('next-session', await read('template/shared-skills/next-session/SKILL.md'), 'handover.md'), []);
  assert.deepEqual(await skillProblems('verify-end-session', await read('template/shared-skills/verify-end-session/SKILL.md'), 'verify-end-session.md'), []);
  assert.deepEqual(await skillProblems('harness-session', await read('template/shared-skills/harness-session/SKILL.md'), 'harness-session.md'), []);
  const older = await read('template/shared-skills/handover/SKILL.md');
  assert.ok(older.includes('`03-Resources/Procedures/handover.md`'), 'handover still reads the same procedure');
});

test('verify-end-session carries its verdict, its dry mode and its stop rules, and links only to shipped files', async () => {
  assert.deepEqual(await verifyProblems(await read(`${PROCEDURES}/verify-end-session.md`)), []);
});

test('harness-session carries the six causes, the managed-file rule and the approval gate, and links only to shipped files', async () => {
  assert.deepEqual(await harnessProblems(await read(`${PROCEDURES}/harness-session.md`)), []);
});

test('harness-session never sends a fix into a managed file: its owner list names user-owned records only', async () => {
  const manifest = JSON.parse(await read('template-manifest.json'));
  const kind = new Map(manifest.entries.map((entry) => [entry.destination, entry.mergeKind]));
  const text = await read(`${PROCEDURES}/harness-session.md`);
  const where = text.slice(text.indexOf('## Where a fix may go'), text.indexOf('## Step 1'));
  for (const record of ['00-Meta/Decisions.md', '00-Meta/Profile.md']) {
    assert.ok(where.includes(record), `the owner list names ${record}`);
    assert.equal(kind.get(record), 'seed-file', `${record} is a seed file, which the person owns`);
  }
  assert.equal(kind.get('03-Resources/Extensions.md'), 'seed-file', 'Extensions is a seed file');
  assert.equal(kind.get('03-Resources/Procedures/harness-session.md'), 'managed-file', 'the procedure itself is managed, so it must not be the place a fix lands');
});

test('positive control: each planted fault is caught', async () => {
  const skill = await read('template/shared-skills/verify-end-session/SKILL.md');
  assert.deepEqual(await skillProblems('verify-end-session', skill.replace('03-Resources/Procedures/verify-end-session.md', 'x'), 'verify-end-session.md'), ['does not name verify-end-session.md']);
  assert.ok((await skillProblems('verify-end-session', skill.replace('name: verify-end-session', 'name: other'), 'verify-end-session.md')).includes('front matter name is not verify-end-session'));
  assert.ok((await skillProblems('verify-end-session', skill, 'no-such-procedure.md')).includes('no-such-procedure.md is missing from the template'));
  const verify = await read(`${PROCEDURES}/verify-end-session.md`);
  assert.ok((await verifyProblems(verify.replace('`SAFE TO CLOSE`', 'fine'))).includes('is missing: `SAFE TO CLOSE`'));
  assert.ok((await verifyProblems(verify.replace('Unknown is not none', 'Unknown is fine'))).includes('is missing: Unknown is not none'));
  assert.ok((await verifyProblems(verify.replaceAll('00-Meta/Decisions.md', '00-Meta/Nope.md'))).includes('does not name 00-Meta/Decisions.md'));
  assert.ok((await verifyProblems(`${verify}\n[x](../../00-Meta/Missing.md)`)).some((line) => line.includes('Missing.md')));
  const harness = await read(`${PROCEDURES}/harness-session.md`);
  assert.ok((await harnessProblems(harness.replace('Never edit a managed file from the workspace.', ''))).includes('is missing: Never edit a managed file from the workspace.'));
  assert.ok((await harnessProblems(harness.replace('E. Preference', 'E. Taste'))).includes('has no cause row: E. Preference'));
  assert.ok((await harnessProblems(`${harness}—`)).includes('contains an em dash'));
});
