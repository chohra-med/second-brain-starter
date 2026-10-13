import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROCEDURES = 'template/03-Resources/Procedures';
const CLOSING_QUESTION = 'What should I focus on this week?';
const ANSWER_RULE = 'A point with no saved evidence is not made.';
// The three procedures in the order Home lists them, with the line limit each one carries in the brief.
const WAYS = [
  { file: 'quick-start.md', maxLines: 70 },
  { file: 'init.md', maxLines: 90 },
  { file: 'complete-init.md', maxLines: 150 },
];
const CREDENTIAL_WORDS = /\b(password|passcode|api key|token|secret|credential)s?\b/i;

// Numbered question blocks: each numbered line and the lines under it, up to the next numbered line or heading.
export function questionBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^\d+\. /.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (/^#{1,6} /.test(line)) {
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return blocks.map((block) => block.join('\n'));
}

export function ownerProblems(text) {
  return questionBlocks(text)
    .filter((block) => !block.includes('Saved to:'))
    .map((block) => `question without an owner file: ${block.split('\n')[0]}`);
}

export function closingProblems(text) {
  const problems = [];
  if (!text.includes(CLOSING_QUESTION)) problems.push(`missing closing prompt: ${CLOSING_QUESTION}`);
  if (!text.includes(ANSWER_RULE)) problems.push('missing the rule for answering the closing prompt');
  const headings = text.split('\n').filter((line) => /^## /.test(line));
  if (headings.at(-1) !== '## Closing prompt') problems.push('the closing prompt is not the last section');
  return problems;
}

export function credentialProblems(text) {
  return text.split('\n')
    .filter((line) => line.includes('?') && CREDENTIAL_WORDS.test(line))
    .map((line) => `question asks for a credential: ${line.trim()}`);
}

export function dashProblems(text) {
  return text.split('\n').filter((line) => line.includes('—')).map((line) => `em dash: ${line.trim()}`);
}

export function limitProblems(text, maxLines, name) {
  const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
  return lines < maxLines ? [] : [`${name} has ${lines} lines, the limit is under ${maxLines}`];
}

async function read(relative) {
  return readFile(path.join(sourceRoot, relative), 'utf8');
}

test('init.md has exactly five numbered questions, each with an owner file', async () => {
  const init = await read(`${PROCEDURES}/init.md`);
  assert.equal(questionBlocks(init).length, 5, 'init.md must have exactly five numbered questions');
  assert.deepEqual(ownerProblems(init), []);
});

test('init.md names the words skip and stop, and says what each one saves or ends', async () => {
  const init = await read(`${PROCEDURES}/init.md`);
  assert.match(init, /`skip`[^\n]*save `Unknown`/);
  assert.match(init, /`stop`[^\n]*end the questions at once/);
});

test('each procedure saves every answer to a named owner file and ends with the closing prompt', async () => {
  for (const { file } of WAYS) {
    const text = await read(`${PROCEDURES}/${file}`);
    assert.deepEqual(closingProblems(text), [], file);
    // quick-start numbers its steps, not its questions, so only the two question procedures carry owner lines per question.
    if (file !== 'quick-start.md') assert.deepEqual(ownerProblems(text), [], file);
  }
  const quick = await read(`${PROCEDURES}/quick-start.md`);
  for (const owner of ['FACTS.md', 'roadmap.md', 'progress.md']) assert.ok(quick.includes(owner), `quick-start names ${owner}`);
  const complete = await read(`${PROCEDURES}/complete-init.md`);
  for (const owner of ['00-Meta/Profile.md', '02-Areas/Areas.md', 'FACTS.md', 'roadmap.md', '00-Meta/Decisions.md']) {
    assert.ok(complete.includes(owner), `complete-init names ${owner}`);
  }
});

test('no procedure asks for a password, key, token, secret or credential in a question line', async () => {
  for (const { file } of WAYS) assert.deepEqual(credentialProblems(await read(`${PROCEDURES}/${file}`)), [], file);
});

test('each procedure stays under its line limit', async () => {
  for (const { file, maxLines } of WAYS) assert.deepEqual(limitProblems(await read(`${PROCEDURES}/${file}`), maxLines, file), [], file);
});

test('the three procedures and the Home start section have no em dash', async () => {
  for (const { file } of WAYS) assert.deepEqual(dashProblems(await read(`${PROCEDURES}/${file}`)), [], file);
  const home = await read('template/Home.md');
  assert.deepEqual(dashProblems(home.slice(home.indexOf('## Start here'), home.indexOf('## Start my first result'))), []);
});

test('Home lists the three ways in order, above the existing sections, and says each can be stopped', async () => {
  const home = await read('template/Home.md');
  const start = home.indexOf('## Start here');
  const next = home.indexOf('## Start my first result');
  assert.ok(start > 0 && next > start, 'Home has a Start here section above the first-result section');
  const section = home.slice(start, next);
  const positions = ['quick-start.md', 'init.md', 'complete-init.md'].map((file) => section.indexOf(`(03-Resources/Procedures/${file})`));
  assert.ok(positions.every((position) => position > 0), 'each way links to its procedure');
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'Home lists quick start, init and complete init in that order');
  assert.match(section, /You can stop any of them at any point and continue later/);
});

test('the three ways are in the manifest and the allowlist as managed files', async () => {
  const manifest = JSON.parse(await read('template-manifest.json'));
  const allowlist = (await read('FILE-ALLOWLIST.txt')).split('\n');
  for (const { file } of WAYS) {
    const destination = `03-Resources/Procedures/${file}`;
    const entry = manifest.entries.find((item) => item.destination === destination);
    assert.ok(entry, `manifest lists ${destination}`);
    assert.equal(entry.mergeKind, 'managed-file', destination);
    assert.ok(allowlist.includes(`template/${destination}`), `allowlist lists template/${destination}`);
  }
});

test('the closing prompt check fires on a planted procedure (positive control)', () => {
  assert.ok(ownerProblems('1. Ask a question.\n- Example.\n').length === 1, 'an owner-less question is caught');
  assert.ok(closingProblems('## Steps\n\nNo prompt here.\n').length >= 2, 'a missing prompt is caught');
  assert.ok(closingProblems(`## Closing prompt\n\n${CLOSING_QUESTION}\n\n${ANSWER_RULE}\n\n## Notes\n`).includes('the closing prompt is not the last section'));
});

test('the credential, dash and limit checks fire on planted text (positive control)', () => {
  assert.equal(credentialProblems('What is your password?\n').length, 1);
  assert.equal(credentialProblems('Paste your token here.\n').length, 0, 'a sentence without a question mark is a rule, not a question');
  assert.equal(dashProblems('Plain words — with a dash.\n').length, 1);
  assert.equal(limitProblems('a\nb\nc\n', 3, 'planted').length, 1);
  assert.equal(limitProblems('a\nb\n', 3, 'planted').length, 0);
});
