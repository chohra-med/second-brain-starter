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
// Built from its code point so that this file holds no literal em dash.
const EM_DASH = '\u2014';

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
  return text.split('\n').filter((line) => line.includes(EM_DASH)).map((line) => `em dash: ${line.trim()}`);
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
  assert.equal(dashProblems(`Plain words ${EM_DASH} with a dash.\n`).length, 1);
  assert.equal(limitProblems('a\nb\nc\n', 3, 'planted').length, 1);
  assert.equal(limitProblems('a\nb\n', 3, 'planted').length, 0);
});

// Round 1 corrections. Each check reads the owner file and fails on the old wording or a missing guarantee.
const FALSE_QUICK_START = 'If the plan says the repository already has agent files, connect only registers it.';
const PRIVACY_FALSE_LINE = 'nothing from a repository is recorded, and no file contents are';
const QUICK_START_READS = ['`AGENTS.md`', '`RULES.md`', '`CONTRIBUTING.md`', '`ai_rules/`', '`.memory/`', '`README.md`'];
const QUICK_START_WRITES = ['`FACTS.md`', '`roadmap.md`', '`progress.md`'];
const DRAFT_FILES = ['FACTS.md', 'roadmap.md', 'progress.md'];
const CHANGED_FILES = ['PRIVACY.md', 'UPGRADING.md', 'CHANGELOG.md', 'README.md', 'template/00-Meta/Profile.md', 'template/03-Resources/Procedures/first-use.md'];

export function quickStartProblems(text) {
  const problems = [];
  if (text.includes(FALSE_QUICK_START)) problems.push('quick-start says agent files mean register only; the rule is the Detection line');
  for (const phrase of ['`Repository writes`', '`Detection: NONE`', 'uncommitted', '`ONBOARDING.md`, stage 9, step 4', 'Move that file aside by hand']) {
    if (!text.includes(phrase)) problems.push(`quick-start is missing: ${phrase}`);
  }
  return problems;
}

export function quickStartWarningProblems(text) {
  const problems = [];
  if (!text.includes('git tracks them')) problems.push('quick-start does not say that git tracks the three drafts');
  if (!text.includes('should not be approved if the repository is private and the workspace will be shared')) problems.push('quick-start does not say when not to approve');
  if (!text.includes('below the privacy block in `.gitignore`')) problems.push('quick-start does not say where to add the three paths');
  for (const name of DRAFT_FILES) {
    if (!text.includes(`01-Projects/<name>/${name}`)) problems.push(`quick-start does not list 01-Projects/<name>/${name}`);
  }
  return problems;
}

export function privacyQuickStartProblems(text) {
  const paragraph = text.split('\n').find((line) => line.startsWith('**Quick start.**'));
  if (!paragraph) return ['PRIVACY.md has no Quick start paragraph'];
  const problems = [...QUICK_START_READS, ...QUICK_START_WRITES]
    .filter((item) => !paragraph.includes(item))
    .map((item) => `Quick start paragraph does not name ${item}`);
  for (const phrase of ['sends nothing', 'not in the privacy block, so git tracks them', 'after you approve the exact text']) {
    if (!paragraph.toLowerCase().includes(phrase)) problems.push(`Quick start paragraph is missing: ${phrase}`);
  }
  return problems;
}

export function ignoredDrafts(block) {
  return DRAFT_FILES.filter((name) => block.includes(name));
}

export function skipProblems(text) {
  const problems = [];
  if (!/`skip`[^\n]*needs no yes/.test(text)) problems.push('a skip is not stated to need no yes');
  if (!text.includes('under `## Unknown` in `00-Meta/Profile.md`')) problems.push('a skipped question is not listed under ## Unknown in Profile.md');
  return problems;
}

export function nextActionProblems(text) {
  const question3 = questionBlocks(text).find((block) => block.startsWith('3. '));
  if (!question3) return ['init.md has no question 3'];
  const problems = [];
  if (!question3.includes('Next action')) problems.push('question 3 does not save a Next action');
  if (!question3.includes('only after the user says yes')) problems.push('question 3 does not save the Next action only after a yes');
  if (!question3.includes('not a sixth question')) problems.push('question 3 does not say the step is a proposal, not a sixth question');
  if (!text.includes('the Next action saved in question 3')) problems.push('the closing prompt does not name the saved Next action');
  return problems;
}

export function numberingProblems(text) {
  const numbers = text.split('\n').map((line) => line.match(/^(\d+)\. /)).filter(Boolean).map((match) => Number(match[1]));
  const consecutive = numbers.every((number, index) => number === index + 1);
  return consecutive ? [] : [`numbers run ${numbers.join(', ')}, not 1 to ${numbers.length}`];
}

export function upgradeProblems(text) {
  const problems = [];
  if (text.includes('It changes four managed files')) problems.push('UPGRADING still says four managed files change');
  if (!text.includes('It changes three managed files, which show as `MANAGED-UPDATE`')) problems.push('UPGRADING does not name the three managed files that change');
  if (!text.includes('The new seed text reaches new installs only.')) problems.push('UPGRADING does not say the new Profile seed reaches new installs only');
  if (!text.includes('`PERSONALIZED`')) problems.push('UPGRADING does not say the Profile seed shows PERSONALIZED');
  return problems;
}

test('quick start states the real connect rule and no longer the false one', async () => {
  assert.deepEqual(quickStartProblems(await read(`${PROCEDURES}/quick-start.md`)), []);
});

test('quick start says before the yes that git tracks the drafts, and where the three paths go', async () => {
  assert.deepEqual(quickStartWarningProblems(await read(`${PROCEDURES}/quick-start.md`)), []);
});

test('PRIVACY.md has a Quick start paragraph naming what is read and written, and no longer the false sentence', async () => {
  const privacy = await read('PRIVACY.md');
  assert.deepEqual(privacyQuickStartProblems(privacy), []);
  assert.equal(privacy.includes(PRIVACY_FALSE_LINE), false, 'the false sentence about repository records is gone');
});

test('the privacy block ignores none of the three quick-start drafts, as PRIVACY says', async () => {
  assert.deepEqual(ignoredDrafts(await read('template/privacy-gitignore.txt')), []);
});

test('init and complete-init say a skip needs no yes and is listed under Unknown', async () => {
  for (const file of ['init.md', 'complete-init.md']) assert.deepEqual(skipProblems(await read(`${PROCEDURES}/${file}`)), [], file);
});

test('init question 3 saves a Next action only after a yes, and the closing prompt names it', async () => {
  assert.deepEqual(nextActionProblems(await read(`${PROCEDURES}/init.md`)), []);
});

test('the numbered questions and steps run 1 to N in every procedure', async () => {
  for (const { file } of WAYS) assert.deepEqual(numberingProblems(await read(`${PROCEDURES}/${file}`)), [], file);
});

test('complete-init keeps its twelve questions, so a removed question fails here', async () => {
  assert.equal(questionBlocks(await read(`${PROCEDURES}/complete-init.md`)).length, 12);
});

test('UPGRADING names the three managed files and says the new Profile seed reaches new installs only', async () => {
  assert.deepEqual(upgradeProblems(await read('UPGRADING.md')), []);
});

test('the files this round changed have no em dash', async () => {
  for (const file of CHANGED_FILES) assert.deepEqual(dashProblems(await read(file)), [], file);
});

test('the new checks fire on planted text (positive control)', () => {
  assert.ok(quickStartProblems(`${FALSE_QUICK_START}\n`).length >= 2);
  assert.ok(quickStartWarningProblems('Nothing here.\n').length >= 4);
  assert.deepEqual(privacyQuickStartProblems('no paragraph here\n'), ['PRIVACY.md has no Quick start paragraph']);
  assert.ok(privacyQuickStartProblems('**Quick start.** Nothing.\n').length >= 4);
  assert.deepEqual(ignoredDrafts('01-Projects/**/roadmap.md\n'), ['roadmap.md']);
  assert.equal(skipProblems('`skip` saves `Unknown`.\n').length, 2);
  assert.equal(nextActionProblems('1. Ask a question.\n').length, 1);
  assert.equal(numberingProblems('1. a\n3. b\n').length, 1);
  assert.equal(upgradeProblems('It changes four managed files\n').length >= 1, true);
});
