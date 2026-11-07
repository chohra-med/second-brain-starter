// Tests for template/shared-skills/design-check: the SKILL.md shape (the testable writing-skills checklist points), the UI
// floor with its WCAG levels, the companions table, the shared brand template, contrast.mjs on known colour pairs, and the
// result page, which is run with a small stand-in for the browser.
//   node --test test/design-check-skill.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AA, contrast, parseColour } from '../template/shared-skills/design-check/contrast.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(sourceRoot, 'template', 'shared-skills');
const SKILL_DIR = path.join(SKILLS, 'design-check');
const CONTRAST = path.join(SKILL_DIR, 'contrast.mjs');
const CHECK = path.join(SKILLS, 'security-check', 'check.mjs');
const STEPS = ['Inputs', 'Capture', 'Review', 'Result', 'Decide'];
const SOURCE_LINE = 'Source: the W3C Recommendation Web Content Accessibility Guidelines (WCAG) 2.2, https://www.w3.org/TR/WCAG22/. The values above were checked against it on 2026-11-06.';

const read = (rel) => readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8');
const section = (text, heading) => text.split(`\n## ${heading}\n`)[1].split('\n## ')[0];
const frontOf = (text) => text.match(/^---\n([\s\S]*?)\n---/)[1];

function tableRows(block) {
  const lines = block.split('\n').filter((line) => line.startsWith('|'));
  return lines.slice(2).map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
}

function filesUnder(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? filesUnder(path.join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]));
}

const j = (...parts) => parts.join('');

// What a browser takes as a data block: everything up to the first </script, on whatever line it sits.
function browserBlock(html, id) {
  const open = `<script type="application/json" id="${id}">`;
  const start = html.indexOf(open) + open.length;
  return html.slice(start, start + html.slice(start).search(/<\/script[\s/>]/i));
}

// Runs the page's script against a small stand-in for the browser and returns what it built. `block` replaces the
// data block's text, for example with what a browser reads of it.
function runPage(html, { block } = {}) {
  const json = html.match(/<script type="application\/json" id="(\w+)">\n([\s\S]*?)\n<\/script>/);
  const code = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
  const content = block ?? json[2];
  class Element {
    constructor(tag) {
      Object.assign(this, { tagName: tag, children: [], textContent: '', className: '', style: {}, attributes: {} });
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
  }
  const ids = Object.fromEntries(['title', 'meta', 'counts', 'list'].map((id) => [id, new Element('div')]));
  ids[json[1]] = Object.assign(new Element('script'), { textContent: content });
  const document = { getElementById: (id) => ids[id] ?? null, createElement: (tag) => new Element(tag), body: new Element('body') };
  vm.runInNewContext(code, { document });
  let data = null;
  try {
    data = JSON.parse(content);
  } catch {
    data = null;
  }
  return { ids, data };
}

const withFindings = (html, data) => html.replace(/(<script type="application\/json" id="findings">\n)[\s\S]*?(\n<\/script>)/, (all, open, close) => `${open}${JSON.stringify(data, null, 2).replaceAll('<', '\\u003c')}${close}`);

test('SKILL.md passes the testable writing-skills checklist points', () => {
  const text = read('SKILL.md');
  const front = frontOf(text);
  assert.equal(front.match(/^name:\s*(.+)$/m)[1].trim(), 'design-check');
  const description = front.match(/^description:\s*(.+)$/m)[1];
  assert.match(description, /Use when /);
  assert.ok(description.length <= 1024, `${description.length} characters`);
  assert.match(description, /use writing-check/);
  assert.match(front, /^metadata:\n {2}scope: oss$/m);
  assert.match(text, /^## Do not use this when$/m);
  assert.equal(text.includes('—'), false, 'no em dashes');
  assert.doesNotMatch(text, /\/Users\/|\/home\//, 'no personal paths');
  const dated = text.split('\n').filter((line) => /\b20\d\d-\d\d-\d\d\b/.test(line));
  assert.deepEqual(dated, [SOURCE_LINE], 'no dates, apart from the day the WCAG values were checked at their source');
  const items = section(text, 'Steps').split(/\n(?=\d+\. )/).filter((item) => /^\d+\. /.test(item));
  assert.deepEqual(items.map((item) => item.match(/^\d+\. \*\*(.+?)\.\*\*/)[1]), STEPS);
  for (const item of items) assert.match(item, /Check:/, item.slice(0, 40));
  assert.match(text, /^## Example$/m);
});

test('the steps ask for dark mode and login before capture, capture at one width, rank findings with a fix each, and leave the pick to the person', () => {
  const text = read('SKILL.md');
  const step = (name) => section(text, 'Steps').split(`**${name}.**`)[1].split(/\n\d+\. /)[0];
  assert.match(step('Inputs'), /whether a dark mode should be checked too, and whether the page needs a login\. Ask all of these here, before any capture\./);
  assert.match(step('Capture'), /one screenshot per theme at that one width/);
  assert.match(step('Capture'), /you never type a password/);
  assert.match(step('Capture'), /Install nothing for this\./);
  assert.match(step('Capture'), /`git check-ignore -q`/);
  assert.match(step('Review'), /message, visual, UI floor/);
  assert.match(step('Review'), /`contrast\.mjs`/);
  assert.match(step('Result'), /first what stops the page's job, then UI floor failures at level AA, then what is off brand, then polish/);
  assert.match(step('Result'), /one fix the person can act on/);
  assert.match(step('Decide'), /Change nothing in the page's code/);
});

test('the UI floor names WCAG 2.2: contrast at AA, spacing, and touch-target size with the right level, with its source and the day it was checked', () => {
  const text = read('SKILL.md');
  const checklist = section(text, 'The page checklist');
  for (const part of ['Message:', 'Visual:', 'UI floor, built in, to WCAG 2.2']) assert.ok(checklist.includes(part), part);
  for (const phrase of [
    'WCAG 2.2 success criterion 1.4.3 Contrast (Minimum), level AA: at least 4.5:1, and at least 3:1 for large-scale text (at least 18 point, or 14 point bold: at least 24 CSS px, or 18.66 CSS px bold)',
    'WCAG 2.2 success criterion 1.4.11 Non-text Contrast, level AA: at least 3:1 against the adjacent colours',
    'Spacing:',
    'WCAG 2.2 success criterion 2.5.8 Target Size (Minimum), level AA: at least 24 by 24 CSS px, with exceptions',
    'Success criterion 2.5.5 Target Size (Enhanced), level AAA in WCAG 2.2: at least 44 by 44 CSS px',
    'Name the level in each finding',
    'platform guidance, not WCAG levels',
  ]) assert.ok(checklist.includes(phrase), `the checklist is missing: ${phrase}`);
  assert.ok(checklist.includes(`\n${SOURCE_LINE}\n`), 'the source line follows the UI floor');
  assert.equal(text.includes('WCAG 2.1'), false, 'the skill names one WCAG version');
  assert.equal(read('assets/result-page.html').includes('WCAG 2.1'), false, 'the sample finding names WCAG 2.2');
  assert.equal(read('contrast.mjs').includes('WCAG 2.1'), false, 'contrast.mjs names WCAG 2.2 in its output and comments');
});

test('the companions table lists Taste, UI UX Pro Max and Impeccable with source, pin, licence and verdict; a BLOCK companion is never invoked', () => {
  const block = section(read('SKILL.md'), 'Companions');
  const rows = tableRows(block);
  const expected = [
    ['Taste', 'https://github.com/Leonxlnx/taste-skill', '9b4bf937a1f69348126959c15d2f99a73e65699b', /^MIT/, 'FLAG, 0 BLOCK'],
    ['UI UX Pro Max', 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', 'b7d5353e0130feb8c5574ef1251f8a1db1873ccb', /^MIT/, 'BLOCK'],
    ['Impeccable', 'https://github.com/pbakaus/impeccable', 'c3bb418ee38ee49a6b999b7752c1368f3123a2bd', /^Apache-2\.0$/, 'BLOCK'],
  ];
  assert.equal(rows.length, expected.length);
  const sources = readFileSync(path.join(SKILLS, 'skill-sync', 'SKILL.md'), 'utf8');
  for (const [index, [name, address, commit, licence, verdict]] of expected.entries()) {
    const row = rows[index];
    assert.ok(row[0].startsWith(name), `${name} row`);
    assert.equal(row[1].match(/https:\/\/\S+/)[0], address, `${name} source`);
    assert.equal(row[2], `\`${commit}\``, `${name} pin`);
    assert.match(row[3], licence, `${name} licence`);
    assert.equal(row[4], verdict, `${name} verdict`);
    if (verdict === 'BLOCK') assert.match(row[5], /^Never while the BLOCK stands\./, `${name} is never invoked`);
    else assert.match(row[5], /only when the three conditions hold/, `${name} runs only when approved`);
    assert.ok(sources.includes(`"address": "${address}"`), `skill-sync tracks ${name}`);
  }
  for (const phrase of ['The built-in checks above are the baseline and always run.', '`.skill-sync/skills.lock.json`', 'an `approved` date', 'PASS or FLAG, never BLOCK', 'A companion whose verdict below is BLOCK is never invoked, even when it is installed and in the lock.']) {
    assert.ok(block.includes(phrase), `the companion rule is missing: ${phrase}`);
  }
});

test('the skill reuses the brand template of writing-check and keeps no copy of its own', () => {
  const text = read('SKILL.md');
  assert.ok(section(text, 'The brand file').includes('`assets/Brand.md` in the `writing-check` skill folder'));
  const brand = readFileSync(path.join(SKILLS, 'writing-check', 'assets', 'Brand.md'), 'utf8');
  assert.match(brand, /^## Visual$/m, 'the shared template has the Visual part this skill reads');
  assert.match(brand, /`design-check` skill reads both parts/);
  assert.deepEqual(filesUnder(SKILL_DIR), ['SKILL.md', 'assets/result-page.html', 'contrast.mjs']);
  assert.ok(text.includes('[the result page](assets/result-page.html)'));
});

test('contrast.mjs gives the known WCAG ratios, compares unrounded, and names the AA thresholds', () => {
  assert.deepEqual({ ...AA }, { text: 4.5, largeText: 3, nonText: 3 });
  assert.equal(contrast('#000', '#fff').shown, 21);
  assert.equal(contrast('#ffffff', '#000000').shown, 21, 'order does not matter');
  const grey = contrast('#767676', '#ffffff');
  assert.equal(grey.shown, 4.54);
  assert.equal(grey.text.pass, true);
  const lighter = contrast('#777777', '#ffffff');
  assert.ok(lighter.ratio > 4.47 && lighter.ratio < 4.5, String(lighter.ratio));
  assert.deepEqual([lighter.text.pass, lighter.largeText.pass, lighter.nonText.pass], [false, true, true]);
  const border = contrast('rgb(196, 196, 196)', '#fff');
  assert.equal(border.shown, 1.74);
  assert.equal(border.nonText.pass, false);
  assert.equal(border.nonText.criterion, '1.4.11');
  assert.equal(contrast('#949494', '#fff').shown, 3.03, 'the example in SKILL.md');
  assert.equal(contrast('#6b6b6b', '#fff').shown, 5.32, 'the fix in SKILL.md');
  assert.equal(contrast('#8a8a8a', '#fff').shown, 3.45, 'the border fix in SKILL.md');
  assert.deepEqual([...parseColour('#1a5fb4')], [26, 95, 180]);
  for (const bad of ['#12', 'red', 'rgb(300, 0, 0)', '', '#ggg']) assert.throws(() => parseColour(bad), /not a colour/, bad);
});

test('contrast.mjs on the command line: exit 0 with the result, 2 for usage errors; it imports no file, network or process module', () => {
  const run = (args) => spawnSync(process.execPath, [CONTRAST, ...args], { encoding: 'utf8' });
  const ok = run(['#777777', '#ffffff']);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^Contrast 4\.47:1 \(#777777 on #ffffff\)$/m);
  assert.match(ok.stdout, /^Text, WCAG 2\.2 SC 1\.4\.3 level AA, needs 4\.5:1: fails$/m);
  assert.match(ok.stdout, /needs 3:1: passes$/m);
  const json = run(['#000', '#fff', '--json']);
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).text.pass, true);
  for (const args of [[], ['#000'], ['#000', '#fff', '#111'], ['#000', 'blue'], ['--help', '#fff']]) assert.equal(run(args).status, 2, JSON.stringify(args));
  const source = read('contrast.mjs');
  assert.deepEqual([...source.matchAll(/^import\s.*?from\s+'([^']+)';$/gm)].map((match) => match[1]), ['node:url']);
  assert.doesNotMatch(source, /node:fs|node:child_process|node:net|node:http|fetch\(|eval\(|new Function/);
});

test('the result page lists findings most important first, numbered, each with its rule and fix, and shows only local screenshots', () => {
  const html = read('assets/result-page.html');
  const sample = runPage(html);
  assert.equal(sample.ids.list.children.length, sample.data.findings.length);
  const findings = [
    { rank: 'polish', title: 'Button corners differ', where: 'Footer', measured: '4 and 8 CSS px', rule: 'Brand.md: Controls', fix: 'Use 8 CSS px.', screenshot: 'https://cdn.example.invalid/shot.png' },
    { rank: 'floor', title: 'Hint text is too light', where: 'Form', measured: '#949494 on #ffffff: 3.03:1', rule: 'WCAG 2.2 SC 1.4.3, level AA', fix: 'Use #6b6b6b.', screenshot: 'light-390.png' },
    { rank: 'job', title: 'Main action below the first screen <b>', where: 'Form', measured: '120 CSS px below', rule: 'Message: one main action', fix: 'Move it up.', screenshot: '../outside.png' },
    { rank: 'brand', title: 'Heading in the wrong family', where: 'Top', measured: 'serif', rule: 'Brand.md: Type', fix: 'Use the body family.' },
  ];
  const page = runPage(withFindings(html, { page: 'Sample', job: 'Sign up.', width: '390 CSS px', themes: ['light'], findings }));
  const cards = page.ids.list.children;
  assert.deepEqual(cards.map((card) => card.children[1].textContent), ['Main action below the first screen <b>', 'Hint text is too light', 'Heading in the wrong family', 'Button corners differ']);
  assert.deepEqual(cards.map((card) => card.children[0].textContent), ['1. Stops the page job', '2. Fails the UI floor at level AA', '3. Off brand', '4. Polish']);
  for (const card of cards) {
    const details = card.children.find((child) => child.tagName === 'dl').children.map((child) => child.textContent);
    assert.deepEqual(details.filter((_, index) => index % 2 === 0), ['Where', 'Measured', 'Rule', 'Fix']);
  }
  const images = cards.map((card) => card.children.find((child) => child.tagName === 'img')?.src ?? null);
  assert.deepEqual(images, [null, 'light-390.png', null, null], 'a remote address and a path that leaves the folder are not shown');
  assert.match(page.ids.counts.textContent, /^4 findings, most important first\. Stops the page job: 1\. Fails the UI floor at level AA: 1\. Off brand: 1\. Polish: 1\.$/);
  const json = html.match(/<script type="application\/json" id="findings">\n([\s\S]*?)\n<\/script>/)[1];
  assert.equal(json.includes('<'), false);
  assert.doesNotMatch(html, /\bhttps?:\/\//, 'no outside address');
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});

test('the result page keeps quoted page text inside its findings block: step 4 writes every < as \\u003c, the page runs only its own script, and a cut block shows a notice', () => {
  const result = section(read('SKILL.md'), 'Steps').split('**Result.**')[1].split(/\n\d+\. /)[0];
  assert.ok(result.includes('Write every `<` in that block as `\\u003c`, so text quoted from the page cannot end the block'), 'step 4 states the rule');
  assert.ok(result.includes('the findings block holds no `<`'), 'step 4 checks the rule');
  const html = read('assets/result-page.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'one page script');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1].split(';').map((part) => part.trim());
  assert.ok(policy.includes("default-src 'none'"));
  assert.deepEqual(policy.filter((part) => part.startsWith('script-src')), [`script-src 'sha256-${createHash('sha256').update(scripts[0][1]).digest('base64')}'`], 'only the page script runs, by its hash; no inline handler and no other script');

  const hostile = j('</scr', 'ipt><img src=x one', 'rror=alert(1)><scr', 'ipt>alert(2)</scr', 'ipt>');
  const data = { page: `Sign-up ${hostile}`, job: 'Sign up.', width: '390 CSS px', themes: ['light'], findings: [{ rank: 'job', title: `Quoted heading ${hostile}`, where: 'Hero', measured: 'Read from the page', rule: 'Message: one main action', fix: `Replace ${hostile}`, screenshot: 'light-390.png' }] };
  const filled = withFindings(html, data);
  const block = browserBlock(filled, 'findings');
  assert.equal(block.includes('<'), false, 'the filled block holds no <');
  assert.deepEqual(JSON.parse(block), data, 'a browser reads the whole block, hostile text included, as data');
  assert.equal((filled.match(/<\/script/gi) ?? []).length, 2, 'only the data block and the page script close a script element');
  const page = runPage(filled, { block });
  assert.equal(page.ids.title.textContent, `Design check: Sign-up ${hostile}`);
  assert.equal(page.ids.list.children[0].children[1].textContent, `Quoted heading ${hostile}`, 'shown as text');

  const raw = html.replace(/(<script type="application\/json" id="findings">\n)[\s\S]*?(\n<\/script>)/, (all, open, close) => `${open}${JSON.stringify(data, null, 2)}${close}`);
  const cut = browserBlock(raw, 'findings');
  assert.ok(cut.length < JSON.stringify(data, null, 2).length, 'without the rule a browser ends the block at the quoted </script>');
  const broken = runPage(raw, { block: cut });
  assert.equal(broken.data, null);
  assert.equal(broken.ids.list.children.length, 0, 'a cut block builds no card');
  assert.match(broken.ids.counts.textContent, /^The findings block could not be read, so no finding is shown\./);
});

test('the privacy block in .gitignore ignores the design-check folders, and the capture step still asks before writing where git would track', (t) => {
  const block = readFileSync(path.join(sourceRoot, 'template', 'privacy-gitignore.txt'), 'utf8');
  const lines = block.split('\n');
  const start = lines.indexOf('# second-brain:privacy:start');
  const end = lines.indexOf('# second-brain:privacy:end');
  const at = lines.indexOf('**/local/design-check/');
  assert.ok(start !== -1 && start < at && at < end, 'the line sits inside the privacy block');
  const capture = read('SKILL.md').split('**Capture.**')[1].split(/\n\d+\. /)[0];
  assert.match(capture, /run `git check-ignore -q` on that folder, and when git would track it, ask the person where to save instead\./);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) {
    t.diagnostic('git is not available; the pattern was checked as text only');
    return;
  }
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'design-check-privacy-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(path.join(dir, '.gitignore'), block);
  const ignored = (relative) => spawnSync('git', ['check-ignore', '-q', relative], { cwd: dir }).status === 0;
  assert.ok(ignored('01-Projects/demo/local/design-check/2026-01-01-sign-up/light-390.png'));
  assert.ok(ignored('local/design-check/2026-01-01-sign-up/result.html'));
  assert.equal(ignored('01-Projects/demo/Brand.md'), false, 'the brand file stays tracked');
  assert.equal(ignored('01-Projects/demo/local/notes.md'), false, 'only the check folders are ignored');
});

test('the security check gives design-check PASS, with best practices PASS', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'design-check-')));
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
  for (const file of filesUnder(SKILL_DIR)) {
    const source = `template/shared-skills/design-check/${file}`;
    const digest = createHash('sha256').update(readFileSync(path.join(SKILL_DIR, ...file.split('/')))).digest('hex');
    for (const client of ['.agents', '.claude']) {
      const entry = manifest.entries.find((item) => item.destination === `${client}/skills/design-check/${file}`);
      assert.deepEqual(entry, { source, destination: `${client}/skills/design-check/${file}`, sha256: digest, mergeKind: 'managed-file' });
    }
    assert.ok(allowlist.includes(source), `${source} is allowlisted`);
  }
  assert.ok(allowlist.includes('test/design-check-skill.test.mjs'));
});
