// Tests for template/shared-skills/factory: the SKILL.md shape (the testable writing-skills checklist points), the push
// rule, and the board file format of assets/board.md.
//   node --test test/factory-skill.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(sourceRoot, 'template', 'shared-skills', 'factory');
const CHECK = path.join(sourceRoot, 'template', 'shared-skills', 'security-check', 'check.mjs');
const LANES = ['To do', 'Plan', 'Build', 'Ready for review', 'Pushed', 'Done'];
const TASKS_HEADER = '| Id | Task | Lane | Packet | Next action | Updated |';
const APPROVALS_HEADER = '| Time | Task | Approval | Words |';

const read = (rel) => readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8');

// The rows of the Markdown table whose header line is given, as arrays of trimmed cells.
function tableRows(text, header) {
  const lines = text.split('\n');
  const start = lines.indexOf(header);
  if (start === -1) return null;
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.slice(1, -1).split('|').map((cell) => cell.trim()));
  }
  return { separator: lines[start + 1], rows };
}

// Every problem with a board file: tables present, lanes known, one row per id, who acts named, approvals linked.
function boardProblems(text) {
  const problems = [];
  const tasks = tableRows(text, TASKS_HEADER);
  const approvals = tableRows(text, APPROVALS_HEADER);
  if (!tasks) return ['no Tasks table'];
  if (!approvals) return ['no Approvals table'];
  if (tasks.separator !== '| --- | --- | --- | --- | --- | --- |') problems.push('Tasks separator line');
  if (approvals.separator !== '| --- | --- | --- | --- |') problems.push('Approvals separator line');
  const ids = new Set();
  for (const [id, title, lane, packet, next, updated] of tasks.rows) {
    if (!/^T\d+$/.test(id)) problems.push(`task id ${id}`);
    if (ids.has(id)) problems.push(`two rows for ${id}`);
    ids.add(id);
    if (!title) problems.push(`${id} has no title`);
    if (!LANES.includes(lane)) problems.push(`${id} lane ${lane}`);
    if (!packet) problems.push(`${id} has no packet cell`);
    if (!/\((?:person|assistant)\)$/.test(next ?? '')) problems.push(`${id} next action does not say who acts`);
    if (!/^(?:YYYY-MM-DD HH:MM|\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.test(updated ?? '')) problems.push(`${id} updated time`);
  }
  for (const [time, task, approval, words] of approvals.rows) {
    if (!/^(?:YYYY-MM-DD HH:MM|\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.test(time)) problems.push(`approval time ${time}`);
    if (!ids.has(task)) problems.push(`approval for unknown task ${task}`);
    if (!['approve plan', 'go'].includes(approval)) problems.push(`approval kind ${approval}`);
    if (!/^".+"$/.test(words ?? '')) problems.push(`approval words not quoted for ${task}`);
  }
  return problems;
}

test('SKILL.md passes the testable writing-skills checklist points', () => {
  const text = read('SKILL.md');
  const front = text.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.equal(front.match(/^name:\s*(.+)$/m)[1].trim(), 'factory');
  const description = front.match(/^description:\s*(.+)$/m)[1];
  assert.match(description, /Use when /);
  assert.ok(description.length <= 1024);
  assert.match(front, /^metadata:\n {2}scope: oss$/m);
  assert.match(text, /^## Do not use this when$/m);
  assert.equal(text.includes('—'), false, 'no em dashes');
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/, 'no personal paths and no dates');
  const steps = text.split('## Steps')[1].split('\n## ')[0];
  const items = steps.split(/\n(?=\d+\. )/).filter((item) => /^\d+\. /.test(item));
  assert.deepEqual(items.map((item) => item.match(/^\d+\. \*\*(.+?)\.\*\*/)[1]), ['Intake', 'Start', 'Plan checkpoint', 'Build and test', 'Ready for review', 'Go and push', 'Pull request', 'Pipeline and done']);
  for (const item of items) assert.match(item, /Check:/, item.slice(0, 40));
  assert.match(text, /^## Example$/m);
});

test('SKILL.md states the push rule and keeps every push with the person', () => {
  const text = read('SKILL.md');
  for (const phrase of [
    "Each push needs the person's own go for that push.",
    'A go covers one push only',
    'The assistant never pushes, never opens a pull request and never merges.',
    'exactly as printed. Never build or change a link.',
  ]) assert.ok(text.includes(phrase), `SKILL.md is missing: ${phrase}`);
  const goStep = text.split('6. **Go and push.**')[1].split('\n7. ')[0];
  assert.match(goStep, /The person runs it\./);
  assert.doesNotMatch(text, /git push/, 'the skill gives the command at run time; it holds no push command itself');
});

test('SKILL.md routes through Spec Harness /sdd when the repository has it, and a plain plan, build and test path when not', () => {
  const text = read('SKILL.md');
  const start = text.split('2. **Start.**')[1].split('\n3. ')[0];
  for (const phrase of ['`SPEC-HARNESS.md`', '`.claude/commands/sdd.md`', '`/sdd`', 'Without it', '`plan.md`', 'the test that proves the change']) {
    assert.ok(start.includes(phrase), `step 2 is missing: ${phrase}`);
  }
  assert.match(text.split('3. **Plan checkpoint.**')[1].split('\n4. ')[0], /No code changes before the person approves it\./);
  const build = text.split('4. **Build and test.**')[1].split('\n5. ')[0];
  for (const phrase of ['tester, verifier and reviewer', "run the project's tests"]) assert.ok(build.includes(phrase), `step 4 is missing: ${phrase}`);
  const checklist = text.split('## Ready-for-review checklist')[1].split('\n## ')[0];
  const lines = checklist.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(lines.length, 7);
  for (const phrase of ['ship check', 'exact commit', 'Summary and an Evidence part', 'Before/After image', '`/security-review`', '`security-check`']) {
    assert.ok(checklist.includes(phrase), `the checklist is missing: ${phrase}`);
  }
  assert.ok(text.includes('`01-Projects/<project>/factory/board.md`'), 'names the board file');
  assert.ok(text.includes('[the board template](assets/board.md)'), 'links the template directly');
});

test('the board template follows the board format: six lanes, one row per task, who acts, approvals with time and words', () => {
  const board = read('assets/board.md');
  assert.match(board, /^# Factory board$/m);
  assert.ok(board.includes(`Lanes, in order: ${LANES.slice(0, -1).join(', ')}, ${LANES.at(-1)}.`));
  assert.deepEqual(boardProblems(board), []);
  assert.equal(tableRows(board, TASKS_HEADER).rows.length, 1, 'one example task');
  assert.equal(board.includes('—'), false, 'no em dashes');
  assert.doesNotMatch(board, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/, 'generic: no personal paths and no dates');
  const skill = read('SKILL.md');
  assert.ok(skill.includes(`Lanes, in order: ${LANES.join(', ')}.`), 'SKILL.md names the same lanes');
});

test('the board format check catches an unknown lane, a second row for one task, a missing actor and an approval for no task', () => {
  const board = read('assets/board.md');
  const broken = board
    .replace('| Build |', '| Doing |')
    .replace('(assistant) |', '|')
    .replace('| T1 | approve plan |', '| T9 | approve plan |')
    .replace(/(\| T1 \|[^\n]*\n)/, '$1$1');
  const problems = boardProblems(broken);
  for (const expected of ['T1 lane Doing', 'two rows for T1', 'T1 next action does not say who acts', 'approval for unknown task T9']) {
    assert.ok(problems.includes(expected), `${expected}: ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(boardProblems(board.replace(TASKS_HEADER, '| Task | Lane |')), ['no Tasks table']);
});

test('the security check gives factory PASS, with best practices PASS', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'factory-check-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [CHECK, SKILL_DIR, '--report-dir', path.join(dir, 'reports'), '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, JSON.stringify(report.findings));
  assert.deepEqual(report.findings, []);
  assert.equal(report.bestPractices.verdict, 'PASS', JSON.stringify(report.bestPractices.findings));
});

test('the skill is registered: both manifest entries per file carry the file SHA-256, and the allowlist lists each file', () => {
  const manifest = JSON.parse(readFileSync(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const allowlist = readFileSync(path.join(sourceRoot, 'FILE-ALLOWLIST.txt'), 'utf8').split('\n');
  for (const file of ['SKILL.md', 'assets/board.md']) {
    const source = `template/shared-skills/factory/${file}`;
    const digest = createHash('sha256').update(readFileSync(path.join(SKILL_DIR, ...file.split('/')))).digest('hex');
    for (const client of ['.agents', '.claude']) {
      const entry = manifest.entries.find((item) => item.destination === `${client}/skills/factory/${file}`);
      assert.deepEqual(entry, { source, destination: `${client}/skills/factory/${file}`, sha256: digest, mergeKind: 'managed-file' });
    }
    assert.ok(allowlist.includes(source), `${source} is allowlisted`);
  }
  assert.ok(allowlist.includes('test/factory-skill.test.mjs'));
});

function assertPortableFactory(text) {
  for (const phrase of ['branch-security-review.md', 'native `/sdd` is unavailable', 'entire procedure manually', 'independent gates']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /Claude (?:never|runs|gives|passes)/);
}
test('factory routes to equivalent review and complete manual SDD, with a negative control', () => {
  const text = read('SKILL.md');
  assertPortableFactory(text);
  assert.throws(() => assertPortableFactory(text.replace('entire procedure manually', 'partial route')));
});

test('build step keeps the selected native or manual SDD procedure', () => {
  const text = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const build = text.split('4. **Build and test.**')[1].split('\n5. ')[0];
  function contract(value) { assert.match(value, /selected SDD procedure/); assert.match(value, /native or manual/); assert.match(value, /tester, verifier and reviewer/); }
  contract(build); assert.throws(() => contract(build.replace('native or manual', 'native')));
});
