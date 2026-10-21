import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const read = (relative) => readFile(path.join(sourceRoot, relative), 'utf8');
const exists = (relative) => access(path.join(sourceRoot, relative)).then(() => true, () => false);

// The skill must name the procedure it follows, and that procedure must exist in the template.
async function skillProblems(skill, text, procedure) {
  const problems = [];
  if (!new RegExp(`^name: ${skill}$`, 'm').test(text)) problems.push(`front matter name is not ${skill}`);
  if (!text.includes(`\`03-Resources/Procedures/${procedure}\``)) problems.push(`does not name ${procedure}`);
  if (!(await exists(`template/03-Resources/Procedures/${procedure}`))) problems.push(`${procedure} is missing from the template`);
  if (text.includes('\u2014')) problems.push('contains an em dash');
  return problems;
}

// today.md must read only records the template really has, and carry its three rules.
async function todayProblems(text) {
  const problems = [];
  for (const record of ['00-Meta/Profile.md', '00-Meta/Daily-Task-Plan.md', '05-Daily/daily-template.md']) {
    if (!text.includes(record)) problems.push(`does not name ${record}`);
    if (!(await exists(`template/${record}`))) problems.push(`${record} is missing from the template`);
  }
  if (!/stale plan dated YYYY-MM-DD/.test(text)) problems.push('has no stale-plan rule');
  if (!/List all of them/.test(text)) problems.push('does not require every open item');
  if (!/writes no file/.test(text)) problems.push('does not say it writes no file');
  if (text.includes('\u2014')) problems.push('contains an em dash');
  return problems;
}

test('the today skill names its procedure, and the procedure reads only records the template has', async () => {
  assert.deepEqual(await skillProblems('today', await read('template/shared-skills/today/SKILL.md'), 'today.md'), []);
  assert.deepEqual(await todayProblems(await read('template/03-Resources/Procedures/today.md')), []);
});

test('the context skill is a second name for context-modes: it reads the same procedure', async () => {
  assert.deepEqual(await skillProblems('context', await read('template/shared-skills/context/SKILL.md'), 'context-modes.md'), []);
  const older = await read('template/shared-skills/context-modes/SKILL.md');
  assert.ok(older.includes('`03-Resources/Procedures/context-modes.md`'), 'context-modes still reads the same procedure');
});

test('positive control: each planted fault is caught', async () => {
  const skill = await read('template/shared-skills/today/SKILL.md');
  assert.deepEqual(await skillProblems('today', skill.replace('03-Resources/Procedures/today.md', 'x'), 'today.md'), ['does not name today.md']);
  assert.deepEqual(await skillProblems('today', skill, 'missing-procedure.md'), ['does not name missing-procedure.md', 'missing-procedure.md is missing from the template']);
  assert.ok((await skillProblems('today', skill.replace('name: today', 'name: tomorrow'), 'today.md')).includes('front matter name is not today'));
  assert.ok((await skillProblems('today', `${skill}\u2014`, 'today.md')).includes('contains an em dash'));
  const procedure = await read('template/03-Resources/Procedures/today.md');
  assert.ok((await todayProblems(procedure.replaceAll('stale plan dated YYYY-MM-DD', 'old'))).includes('has no stale-plan rule'));
  assert.ok((await todayProblems(procedure.replace('List all of them', 'List a few'))).includes('does not require every open item'));
  assert.ok((await todayProblems(procedure.replaceAll('00-Meta/Profile.md', '00-Meta/Nope.md'))).includes('does not name 00-Meta/Profile.md'));
});
