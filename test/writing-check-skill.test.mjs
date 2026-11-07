// Tests for template/shared-skills/writing-check: the SKILL.md shape (the testable writing-skills checklist points), the
// channel rules, the companions table, the Brand and Voice DNA templates, and the review page, which is run with a small
// stand-in for the browser so each Copy button is clicked for real.
//   node --test test/writing-check-skill.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(sourceRoot, 'template', 'shared-skills');
const SKILL_DIR = path.join(SKILLS, 'writing-check');
const CHECK = path.join(SKILLS, 'security-check', 'check.mjs');
const STEPS = ['In', 'Load', 'Check', 'Rewrite', 'Diagram', 'Data check', 'Review', 'Out', 'Learn'];
const CHANNELS = ['Chat', 'Email', 'Ticket comment', 'PR text', 'Post', 'Document'];

const read = (rel) => readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8');
const section = (text, heading) => text.split(`\n## ${heading}\n`)[1].split('\n## ')[0];
const frontOf = (text) => text.match(/^---\n([\s\S]*?)\n---/)[1];

// The rows of the first Markdown table in a block of text, as arrays of trimmed cells, header row left out.
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

// Runs the page's script against a small stand-in for the browser and returns what it built and copied. `block`
// replaces the data block's text, for example with what a browser reads of it.
function runPage(html, { clipboard = true, block } = {}) {
  const json = html.match(/<script type="application\/json" id="(\w+)">\n([\s\S]*?)\n<\/script>/);
  const code = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
  const content = block ?? json[2];
  const copied = [];
  let selected = null;
  class Element {
    constructor(tag) {
      Object.assign(this, { tagName: tag, children: [], textContent: '', className: '', style: {}, attributes: {}, listeners: {} });
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      return child;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    }
    select() {
      selected = this.value;
    }
  }
  const ids = Object.fromEntries(['title', 'meta', 'count', 'counts', 'list', 'status'].map((id) => [id, new Element('div')]));
  ids[json[1]] = Object.assign(new Element('script'), { textContent: content });
  const document = {
    getElementById: (id) => ids[id] ?? null,
    createElement: (tag) => new Element(tag),
    body: new Element('body'),
    execCommand: (command) => {
      copied.push({ via: 'fallback', text: selected });
      return command === 'copy';
    },
  };
  const navigator = clipboard ? { clipboard: { writeText: (text) => (copied.push({ via: 'clipboard', text }), Promise.resolve()) } } : {};
  vm.runInNewContext(code, { document, navigator });
  let data = null;
  try {
    data = JSON.parse(content);
  } catch {
    data = null;
  }
  return { ids, copied, document, data };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('SKILL.md passes the testable writing-skills checklist points', () => {
  const text = read('SKILL.md');
  const front = frontOf(text);
  assert.equal(front.match(/^name:\s*(.+)$/m)[1].trim(), 'writing-check');
  const description = front.match(/^description:\s*(.+)$/m)[1];
  assert.match(description, /Use when /);
  assert.ok(description.length <= 1024, `${description.length} characters`);
  assert.match(front, /^metadata:\n {2}scope: oss$/m);
  assert.match(text, /^## Do not use this when$/m);
  assert.equal(text.includes('—'), false, 'no em dashes');
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/, 'no personal paths and no dates');
  const items = section(text, 'Steps').split(/\n(?=\d+\. )/).filter((item) => /^\d+\. /.test(item));
  assert.deepEqual(items.map((item) => item.match(/^\d+\. \*\*(.+?)\.\*\*/)[1]), STEPS);
  for (const item of items) assert.match(item, /Check:/, item.slice(0, 40));
  assert.match(text, /^## Example$/m);
  assert.ok(text.split('\n').length < 500, 'the body stays under 500 lines');
});

test('the description says when to use it, and sends skill writing to writing-skills and plain AI-tell removal to humanizer', () => {
  const description = frontOf(read('SKILL.md')).match(/^description:\s*(.+)$/m)[1];
  for (const phrase of ['Checks and rewrites a text before it goes to people', 'check, tighten, review or rewrite a message, comment, post or PR text', 'Not for writing a skill (use writing-skills)', 'not for removing AI tells alone (use humanizer)', 'this skill never sends']) {
    assert.ok(description.includes(phrase), `the description is missing: ${phrase}`);
  }
  const writingSkills = frontOf(readFileSync(path.join(SKILLS, 'writing-skills', 'SKILL.md'), 'utf8')).match(/^description:\s*(.+)$/m)[1];
  assert.match(writingSkills, /SKILL\.md/, 'writing-skills stays the skill for writing skills');
  assert.doesNotMatch(writingSkills, /message|ticket comment|PR text/i, 'writing-skills does not claim texts that go to people');
});

test('the steps follow the spec: two rewrites, a diagram only when the text explains a flow, the data check, one Copy button per text, the person sends, learning only after a yes', () => {
  const text = read('SKILL.md');
  const step = (name) => section(text, 'Steps').split(`**${name}.**`)[1].split(/\n\d+\. /)[0];
  assert.match(step('Load'), /`00-Meta\/Voice-DNA\.md`/);
  assert.match(step('Load'), /the project's `Brand\.md`, else `00-Meta\/Brand\.md`/);
  for (const part of ['AI tells', 'voice match', 'clarity', 'length']) assert.ok(step('Check').includes(part), `step 3 scores ${part}`);
  assert.match(step('Check'), /`humanizer`/);
  assert.match(step('Check'), /Before\/After evidence/);
  assert.match(step('Check'), /listed as unchecked, never kept silently/);
  assert.match(step('Rewrite'), /two versions/);
  assert.match(step('Diagram'), /a flow, a process, a structure or a comparison/);
  assert.match(step('Diagram'), /Mermaid block/);
  assert.match(step('Diagram'), /Set no colours, so it reads in light and dark/);
  for (const kind of ['keys', 'email addresses', 'phone numbers', 'diagram labels']) assert.ok(step('Data check').includes(kind), `step 6 covers ${kind}`);
  assert.match(step('Review'), /one Copy button per text/);
  assert.match(step('Review'), /`git check-ignore -q`/);
  assert.match(step('Out'), /You never send, post or publish it/);
  assert.match(step('Learn'), /Only after a yes/);
});

test('step 3 maps the humanizer score (0 to 100, higher is worse) to the AI tells score (0 to 10, higher is better), with a worked example', () => {
  const check = section(read('SKILL.md'), 'Steps').split('**Check.**')[1].split(/\n\d+\. /)[0];
  for (const phrase of ['its score runs from 0 to 100 and higher is worse', 'every score here runs from 0 to 10 and higher is better', 'AI tells = round((100 - humanizer score) / 10)', 'a humanizer score of 30 gives AI tells 7']) {
    assert.ok(check.includes(phrase), `step 3 is missing: ${phrase}`);
  }
  const humanizer = readFileSync(path.join(SKILLS, 'humanizer', 'SKILL.md'), 'utf8');
  assert.ok(humanizer.includes('0 = pristine human, 100 = maximum AI smell'), 'the humanizer score direction this mapping relies on');
  assert.equal(Math.round((100 - 30) / 10), 7, 'the worked example');
});

test('the channel rules cover the six channels with a length and a format each, and the bullets rule', () => {
  const block = section(read('SKILL.md'), 'Rules per channel');
  const rows = tableRows(block);
  assert.deepEqual(rows.map((row) => row[0]), CHANNELS);
  for (const [channel, length, format] of rows) {
    assert.match(length, /\d/, `${channel} has a length`);
    assert.ok(format.length > 10, `${channel} has format rules`);
  }
  assert.match(block, /a bullet holds one fact in a short sentence/);
  assert.match(block, /The format rules in your `Brand\.md` win over this table\./);
});

test('the companions table names source, pinned commit, licence, verdict and when each runs; outside companions run only when installed and approved in the lock', () => {
  const block = section(read('SKILL.md'), 'Companions');
  const rows = tableRows(block);
  assert.deepEqual(rows.map((row) => row[0]), ['`humanizer`', '`diagram-design`']);
  const [humanizer, diagram] = rows;
  const attribution = readFileSync(path.join(sourceRoot, 'ATTRIBUTION.md'), 'utf8');
  const bundled = attribution.split('## Bundled third-party skill: humanizer')[1].split('\n## ')[0];
  assert.equal(humanizer[2], `\`${bundled.match(/commit `([0-9a-f]{40})`/)[1]}\``, 'the humanizer pin matches ATTRIBUTION.md');
  assert.ok(humanizer[1].includes(bundled.match(/https:\/\/github\.com\/\S+?(?=,|\s)/)[0]), 'the humanizer source matches ATTRIBUTION.md');
  assert.equal(diagram[1].match(/https:\/\/\S+/)[0], 'https://github.com/cathrynlavery/diagram-design');
  assert.equal(diagram[2], '`e57eda6102a19444538ebd611d39534fad65b663`');
  for (const row of rows) {
    assert.equal(row[3], 'MIT', `${row[0]} licence`);
    assert.equal(row[4], 'FLAG, 0 BLOCK', `${row[0]} verdict`);
    assert.match(row[5], /^Step \d/, `${row[0]} says when it is invoked`);
  }
  assert.match(diagram[5], /Otherwise step 5 writes a Mermaid block\./);
  for (const phrase of ['`.claude/skills/` or `.agents/skills/`', '`.skill-sync/skills.lock.json`', 'an `approved` date', 'PASS or FLAG, never BLOCK', 'checked each time before it is invoked']) {
    assert.ok(block.includes(phrase), `the companion rule is missing: ${phrase}`);
  }
  const sources = readFileSync(path.join(SKILLS, 'skill-sync', 'SKILL.md'), 'utf8');
  assert.ok(sources.includes('"address": "https://github.com/cathrynlavery/diagram-design"'), 'skill-sync tracks the same address');
});

test('the brand template has a Voice part for this skill and a Visual part for design-check, with empty slots only', () => {
  const brand = read('assets/Brand.md');
  const voice = section(brand, 'Voice');
  for (const heading of ['Words to use', 'Words to avoid', 'Tone per audience', 'Format rules']) assert.match(voice, new RegExp(`^### ${heading}$`, 'm'));
  assert.deepEqual(tableRows(voice.split('### Tone per audience')[1]).map((row) => row[0]), ['Team', 'Partner or client', 'Public']);
  const visual = section(brand, 'Visual');
  for (const heading of ['Colours', 'Type', 'Spacing', 'Controls', 'Themes']) assert.match(visual, new RegExp(`^### ${heading}$`, 'm'));
  assert.match(brand, /`00-Meta\/Brand\.md`/);
  assert.match(brand, /`01-Projects\/<project>\/Brand\.md`/);
  assert.ok(brand.includes('(empty)'));
  assert.ok(brand.split('\n').length < 100, 'no contents list needed');
  assert.equal(brand.includes('—'), false);
  assert.doesNotMatch(brand, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/);
});

test('the voice DNA template has slots for 3 to 5 texts, the traits the spec names, and a capped learning log', () => {
  const dna = read('assets/Voice-DNA.md');
  const slots = section(dna, 'Your texts').split(/\n(?=### Text \d)/).filter((part) => part.startsWith('### Text'));
  assert.deepEqual(slots.map((slot) => slot.split('\n')[0]), ['### Text 1', '### Text 2', '### Text 3', '### Text 4 (optional)', '### Text 5 (optional)']);
  for (const slot of slots) {
    assert.match(slot, /^- Channel: \(empty\)$/m);
    assert.match(slot, /^- Audience: \(empty\)$/m);
    assert.match(slot, /```text\n\(empty: paste a text you wrote\)\n```/);
  }
  const traits = tableRows(section(dna, 'What your texts show')).map((row) => row[0]);
  for (const trait of ['Sentence length', 'How you open', 'Words you use often', 'Words you never use']) assert.ok(traits.includes(trait), trait);
  assert.match(section(dna, 'Learned from edits'), /At most 10 lines/);
  assert.match(dna, /take out names, email addresses, phone numbers, keys and anything confidential/);
  assert.ok(dna.split('\n').length < 100);
  assert.equal(dna.includes('—'), false);
  assert.doesNotMatch(dna, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/);
});

test('SKILL.md links each asset directly and says where the filled copies live', () => {
  const text = read('SKILL.md');
  for (const link of ['[the brand template](assets/Brand.md)', '[the voice DNA template](assets/Voice-DNA.md)', '[the review page](assets/review-page.html)']) assert.ok(text.includes(link), link);
  const files = tableRows(section(text, 'Your files')).map((row) => row[0]);
  assert.deepEqual(files, ['`00-Meta/Brand.md`', '`01-Projects/<project>/Brand.md`', '`00-Meta/Voice-DNA.md`']);
  assert.deepEqual(filesUnder(SKILL_DIR), ['SKILL.md', 'assets/Brand.md', 'assets/Voice-DNA.md', 'assets/review-page.html']);
});

test('the review page draws one Copy button per text, and each button copies exactly its text', async () => {
  const html = read('assets/review-page.html');
  const page = runPage(html);
  const cards = page.ids.list.children;
  assert.equal(cards.length, page.data.texts.length);
  assert.ok(page.data.texts.length >= 2, 'the sample holds two versions');
  for (const [index, card] of cards.entries()) {
    const buttons = card.children.filter((child) => child.tagName === 'button');
    assert.equal(buttons.length, 1, `card ${index + 1} has one Copy button`);
    assert.equal(card.children.find((child) => child.tagName === 'pre').textContent, page.data.texts[index].text, 'the text is shown as plain text');
    buttons[0].listeners.click();
    await settle();
    assert.equal(page.copied.at(-1).text, page.data.texts[index].text);
    assert.equal(page.ids.status.textContent, `Copied: ${page.data.texts[index].title}`);
  }
  assert.ok(page.data.texts.some((item) => item.text.includes('<')), 'the sample shows a text with a < in it');
  assert.equal(page.ids.count.textContent.startsWith(`${page.data.texts.length} texts`), true);
});

test('without the clipboard interface the review page copies through its fallback, and the page loads nothing from elsewhere', async () => {
  const html = read('assets/review-page.html');
  const page = runPage(html, { clipboard: false });
  const button = page.ids.list.children[1].children.find((child) => child.tagName === 'button');
  button.listeners.click();
  await settle();
  assert.deepEqual({ ...page.copied.at(-1) }, { via: 'fallback', text: page.data.texts[1].text });
  assert.equal(page.document.body.children.length, 0, 'the helper field is removed again');
  const json = html.match(/<script type="application\/json" id="texts">\n([\s\S]*?)\n<\/script>/)[1];
  assert.equal(json.includes('<'), false, 'the texts block writes every < as \\u003c');
  assert.doesNotMatch(html, /\bhttps?:\/\//, 'no outside address');
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});

test('the review page keeps each text inside its texts block: step 7 writes every < as \\u003c, the page runs only its own script, and a cut block shows a notice', async () => {
  const review = section(read('SKILL.md'), 'Steps').split('**Review.**')[1].split(/\n\d+\. /)[0];
  assert.ok(review.includes('write every `<` in that block as `\\u003c`, so no text can end the block'), 'step 7 states the rule');
  assert.ok(review.includes('the texts block holds no `<`'), 'step 7 checks the rule');
  const html = read('assets/review-page.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'one page script');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1].split(';').map((part) => part.trim());
  assert.ok(policy.includes("default-src 'none'"));
  assert.deepEqual(policy.filter((part) => part.startsWith('script-src')), [`script-src 'sha256-${createHash('sha256').update(scripts[0][1]).digest('base64')}'`], 'only the page script runs, by its hash; no inline handler and no other script');

  const hostile = j('</scr', 'ipt><img src=x one', 'rror=alert(1)><scr', 'ipt>alert(2)</scr', 'ipt>');
  const data = { title: `Check ${hostile}`, channel: 'Chat', audience: 'Team', texts: [{ title: 'Version A', note: 'Data check: nothing found.', text: `Quoted from the draft: ${hostile}` }] };
  const json = JSON.stringify(data, null, 2);
  const filled = html.replace(/(<script type="application\/json" id="texts">\n)[\s\S]*?(\n<\/script>)/, (all, open, close) => `${open}${json.replaceAll('<', '\\u003c')}${close}`);
  const block = browserBlock(filled, 'texts');
  assert.equal(block.includes('<'), false, 'the filled block holds no <');
  assert.deepEqual(JSON.parse(block), data, 'a browser reads the whole block, hostile text included, as data');
  assert.equal((filled.match(/<\/script/gi) ?? []).length, 2, 'only the data block and the page script close a script element');
  const page = runPage(filled, { block });
  assert.equal(page.ids.title.textContent, `Check ${hostile}`);
  const card = page.ids.list.children[0];
  assert.equal(card.children.find((child) => child.tagName === 'pre').textContent, data.texts[0].text, 'shown as text');
  card.children.find((child) => child.tagName === 'button').listeners.click();
  await settle();
  assert.equal(page.copied.at(-1).text, data.texts[0].text, 'Copy gives exactly the text');

  const raw = html.replace(/(<script type="application\/json" id="texts">\n)[\s\S]*?(\n<\/script>)/, (all, open, close) => `${open}${json}${close}`);
  const cut = browserBlock(raw, 'texts');
  assert.ok(cut.length < json.length, 'without the rule a browser ends the block at the quoted </script>');
  const broken = runPage(raw, { block: cut });
  assert.equal(broken.data, null);
  assert.equal(broken.ids.list.children.length, 0, 'a cut block builds no card and no Copy button');
  assert.match(broken.ids.count.textContent, /^The texts block could not be read, so no text is shown\./);
});

test('the privacy block in .gitignore ignores the voice DNA and the writing-check page folders, and SKILL.md says so; step 7 still asks before writing where git would track', (t) => {
  const block = readFileSync(path.join(sourceRoot, 'template', 'privacy-gitignore.txt'), 'utf8');
  const lines = block.split('\n');
  const start = lines.indexOf('# second-brain:privacy:start');
  const end = lines.indexOf('# second-brain:privacy:end');
  for (const line of ['00-Meta/Voice-DNA.md', '**/local/writing-check/']) {
    const at = lines.indexOf(line);
    assert.ok(start !== -1 && start < at && at < end, `${line} sits inside the privacy block`);
  }
  const text = read('SKILL.md');
  assert.ok(text.includes('The privacy block in `.gitignore` lists this file and the `local/writing-check/` folders'));
  assert.equal(text.includes('does not list this file'), false);
  assert.match(text.split('**Review.**')[1].split(/\n\d+\. /)[0], /`git check-ignore -q`[^.]*; when git would track it, ask the person where to write instead\./);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) {
    t.diagnostic('git is not available; the pattern was checked as text only');
    return;
  }
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'writing-check-privacy-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(path.join(dir, '.gitignore'), block);
  const ignored = (relative) => spawnSync('git', ['check-ignore', '-q', relative], { cwd: dir }).status === 0;
  assert.ok(ignored('00-Meta/Voice-DNA.md'));
  assert.ok(ignored('01-Projects/demo/local/writing-check/2026-01-01-topic.html'));
  assert.ok(ignored('local/writing-check/2026-01-01-topic.html'));
  assert.equal(ignored('00-Meta/Brand.md'), false, 'the brand file stays tracked');
  assert.equal(ignored('01-Projects/demo/Voice-DNA.md'), false, 'only the voice DNA in 00-Meta is listed');
  assert.equal(ignored('01-Projects/demo/local/notes.md'), false, 'only the page folders are ignored');
});

test('the security check gives writing-check PASS, with best practices PASS', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'writing-check-')));
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
    const source = `template/shared-skills/writing-check/${file}`;
    const digest = createHash('sha256').update(readFileSync(path.join(SKILL_DIR, ...file.split('/')))).digest('hex');
    for (const client of ['.agents', '.claude']) {
      const entry = manifest.entries.find((item) => item.destination === `${client}/skills/writing-check/${file}`);
      assert.deepEqual(entry, { source, destination: `${client}/skills/writing-check/${file}`, sha256: digest, mergeKind: 'managed-file' });
    }
    assert.ok(allowlist.includes(source), `${source} is allowlisted`);
  }
  assert.ok(allowlist.includes('test/writing-check-skill.test.mjs'));
  assert.equal(existsSync(path.join(sourceRoot, 'template', '00-Meta', 'Voice-DNA.md')), false, 'the voice DNA is copied by the person, never installed as a seed');
});
