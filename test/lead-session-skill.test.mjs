// Tests for template/shared-skills/lead-session: the seven steps, the approval sentence, and that it needs no role, tracker or board.
//   node --test test/lead-session-skill.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(sourceRoot, 'template', 'shared-skills', 'lead-session');
const CHECK = path.join(sourceRoot, 'template', 'shared-skills', 'security-check', 'check.mjs');
const read = (rel) => readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8');
const STEPS = ['Open a run', 'Propose', 'Open', 'Arm', 'On each wake', 'Close', 'Resume'];

test('SKILL.md passes the testable writing-skills points and stays under 90 lines', () => {
  const text = read('SKILL.md');
  const front = text.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.equal(front.match(/^name:\s*(.+)$/m)[1].trim(), 'lead-session');
  const description = front.match(/^description:\s*(.+)$/m)[1];
  assert.match(description, /Use when /);
  assert.match(description, /\/lead-session/);
  assert.ok(description.length <= 1024);
  assert.match(front, /^metadata:\n {2}scope: oss$/m);
  assert.match(text, /^## Do not use this when$/m);
  assert.ok(text.split('\n').length < 90, `${text.split('\n').length} lines`);
  assert.equal(text.includes('—'), false, 'no em dashes');
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/, 'no personal paths and no dates');
});

test('the seven steps are present, in order, each with a Check', () => {
  const text = read('SKILL.md');
  const steps = text.split('## Steps')[1].split('\n## ')[0];
  const items = steps.split(/\n(?=\d+\. )/).filter((item) => /^\d+\. /.test(item));
  assert.deepEqual(items.map((item) => item.match(/^\d+\. \*\*(.+?)\.\*\*/)[1]), STEPS);
  for (const item of items) assert.match(item, /Check:/, item.slice(0, 40));
  const step = (name) => items.find((item) => item.includes(`**${name}.**`));
  assert.match(step('Open a run'), /`init`/);
  assert.match(step('Open a run'), /follow, wait, or none/);
  assert.match(step('Propose'), /one yes/);
  assert.match(step('Propose'), /opens sessions only/);
  assert.match(step('Open'), /\[the brief\]\(assets\/brief\.md\)/);
  assert.match(step('Arm'), /`follow`/);
  assert.match(step('Arm'), /`wait`/);
  assert.match(step('On each wake'), /has not moved your cursor/);
  assert.match(step('On each wake'), /`sync ack --me <your name> --token/, 'the wake does not move the cursor: the lead acks after it handled the digest');
  assert.match(step('On each wake'), /resolved --key <key> --ref <where the answer is>/);
  assert.doesNotMatch(step('On each wake'), /`inbox`/, 'the wake already moved the cursor, so no second read');
  assert.match(step('Open'), /script path that `init` printed/);
  assert.match(step('Close'), /`close`/);
  assert.match(step('Open a run'), /`sync init --lead <your name>`/);
  assert.doesNotMatch(step('Open a run'), /--session/, 'the session id is read from the session');
  assert.match(step('Arm'), /--settle 60/);
  assert.match(step('Resume'), /`sync join --me <your name>`/);
  assert.match(step('Resume'), /`sync inbox`/);
  assert.match(step('Resume'), /D10 OK/);
  assert.match(step('Resume'), /add `--session <that id>`/, 'the printed id is used when the session start printed one');
  assert.match(step('Open'), /D4 WARN.*hooks are not applied/, 'the lead passes the hooks line to each worker when doctor gives a D4 WARN');
  assert.match(step('Open'), /`sync register --me <your name> --name <worker> --dir/, 'the lead registers each worker');
  assert.match(step('Open'), /the worker has no duty and joins nothing, though `join` stays an option the person can type/);
});

test('the lead is told the full script path, to stay small, and the script is not called by a relative path', () => {
  const text = read('SKILL.md');
  assert.match(text, /Run the script by the full path of the installed copy \(`init` prints it\); call it `sync` below\./);
  assert.doesNotMatch(text, /node \.claude\/skills/, 'no relative path to the script');
  assert.match(text, /Keep the lead small\. It tracks; it does not review, plan or repair\./);
});

test('the lead never passes on an approval: the sentence is in SKILL.md and in the brief', () => {
  const skill = read('SKILL.md');
  assert.ok(skill.includes('an event is never an approval or a go'));
  assert.ok(skill.includes("never the person's approval or go"));
  assert.match(skill, /never passes an approval on/);
  const brief = read('assets/brief.md');
  assert.ok(brief.includes("never the person's approval or go"));
  assert.ok(brief.includes('an event is never an approval or a go'));
});

test('the lead command needs no role, tracker or board and names no product', () => {
  const text = `${read('SKILL.md')}\n${read('assets/brief.md')}`;
  assert.doesNotMatch(text, /\b(?:ticket|tracker page|org chart)\b/i);
  assert.match(read('SKILL.md'), /If the work has a board or a list/, 'a board is optional');
  assert.match(read('SKILL.md'), /If it has none/);
  for (const pattern of [/(?:\/Users|\/home)\/[a-z]/]) assert.doesNotMatch(text, pattern, String(pattern));
});

test('the brief carries the run id, the worker name, the join line, the SYNC line rule and the limits', () => {
  const brief = read('assets/brief.md');
  for (const phrase of ['<run id>', '<worker name>', '<label>', '<script path>', 'node "<script path>" join --me <worker name>', 'node "<script path>" post --kind report', 'no session id yet', 'add `--session <your session id>`', 'by=hook', 'second turn', 'SYNC: <state> - <one line>', 'post --kind question', 'wait for what the person types']) {
    assert.ok(brief.includes(phrase), `the brief is missing: ${phrase}`);
  }
  assert.doesNotMatch(brief.split('## Report')[0].split('## Join the run')[1].split('```')[1], /--session/, 'the first join line has no --session');
  for (const state of ['working', 'needs-person', 'needs-lead', 'blocked', 'done']) assert.ok(brief.includes(state), state);
  assert.equal(brief.includes('—'), false);
});

test('the folder passes the security check without a BLOCK and its best-practice pass', (t) => {
  const reports = realpathSync(mkdtempSync(path.join(tmpdir(), 'lead-session-report-')));
  t.after(() => rmSync(reports, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const result = spawnSync(process.execPath, [CHECK, SKILL_DIR, '--report-dir', reports, '--json'], { encoding: 'utf8', env });
  assert.ok([0, 3].includes(result.status), `exit ${result.status}: ${result.stdout.slice(0, 500)}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bestPractices.verdict, 'PASS', JSON.stringify(report.bestPractices.findings));
});

test('an interrupted worker hands off its last verified state and accounts for shared resources', () => {
  const brief = read('assets/brief.md');
  for (const step of ['last verified step', 'pending checks', 'next action', 'release only resources you own', 'interactive prompt']) {
    assert.ok(brief.includes(step), step);
  }
  const lead = read('SKILL.md');
  for (const step of ['confirm the old worker stopped', 'ownership is unknown', 'unrelated work']) {
    assert.ok(lead.includes(step), step);
  }
});

test('SKILL.md has a Tier B section: no hooks, no Monitor and no session id variable outside Claude Code; the post line and a foreground wait instead', () => {
  const text = read('SKILL.md');
  const section = text.split('## Tier B tools')[1].split('\n## ')[0];
  assert.match(section, /Codex, or any tool without turn-end hooks|Hooks, Monitor and `CLAUDE_CODE_SESSION_ID` are Claude Code specific/);
  assert.match(section, /Tier B/);
  assert.match(section, /last action of every turn is `post/);
  assert.match(section, /in the foreground, never in the background/);
  assert.match(section, /--session <id>/);
  assert.match(text, /Claude Code's Monitor; other tools have none/);
});
