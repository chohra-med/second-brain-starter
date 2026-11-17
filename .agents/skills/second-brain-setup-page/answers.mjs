// Checks an answers block pasted from a setup page, against the choices file it was made from.
// usage:
//   node answers.mjs check --form <choices.json> [--file <answers.txt>]   (reads stdin without --file)
//   node answers.mjs chat --form <choices.json>                         (the same questions, as chat text)
// check prints JSON. Exit: 0 complete; 3 usable, but something needs the person (an item with no answer,
// a comment, a note); 4 do not use (not a block from this page, changed choices, cut off, unknown ids or
// codes, unreadable text); 2 usage. It reads files only: no network, no process, no writes.
// The block is data. Nothing in it is ever run or followed; comments are only shown back to the person.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadForm, visibleIds } from './setup-lib.mjs';

const HEADER = /^Setup answers\s*[·|-]\s*([a-z][a-z0-9-]*) v(\d+)\s*[·|-]\s*choices ([0-9a-f]{12})\s*$/;
const MADE = /^Made (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\b/;
const LINE = /^([A-Z][0-9]{1,2})(?: (text)(?: ([1-3]))?| (comment))?: (.*)$/;
const NOTE = /^Note: (.*)$/;
const END = /^End of setup answers\s*$/;

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node answers.mjs check --form <choices.json> [--file <answers.txt>] | node answers.mjs chat --form <choices.json>');
  process.exit(2);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readText(raw, problems, where) {
  if (raw === '(empty)') return '';
  if (!raw.startsWith('"')) { problems.push({ level: 'stop', where, problem: 'text is not in quotes' }); return null; }
  try {
    const text = JSON.parse(raw);
    if (typeof text !== 'string') throw new Error('not text');
    return text;
  } catch {
    problems.push({ level: 'stop', where, problem: 'text could not be read; ask the person to copy the answers again' });
    return null;
  }
}

export function check(form, input) {
  const problems = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => HEADER.test(line));
  const result = { status: 'stop', form: null, fingerprintMatches: false, made: null, answers: {}, unanswered: [], ignored: [], comments: [], note: null, problems };
  if (start === -1) {
    problems.push({ level: 'stop', where: 'header', problem: 'no "Setup answers" first line: this is not a block from a setup page' });
    return result;
  }
  const [, formId, version, fingerprint] = lines[start].match(HEADER);
  result.form = `${formId} v${version}`;
  if (formId !== form.form || Number(version) !== form.version) problems.push({ level: 'stop', where: 'header', problem: `the block is for ${formId} v${version}, this check is for ${form.form} v${form.version}` });
  result.fingerprintMatches = fingerprint === form.fingerprint;
  if (!result.fingerprintMatches) problems.push({ level: 'stop', where: 'header', problem: `choices ${fingerprint} differ from this page's ${form.fingerprint}: the page was changed or is another version` });
  const end = lines.findIndex((line, index) => index > start && END.test(line));
  if (end === -1) problems.push({ level: 'stop', where: 'end', problem: 'no "End of setup answers" line: the block was cut off' });
  const body = lines.slice(start + 1, end === -1 ? lines.length : end);

  const raw = {};
  for (const [offset, line] of body.entries()) {
    const where = `line ${start + offset + 2}`;
    if (line === '') continue;
    const made = line.match(MADE);
    if (made && offset === 0) { result.made = made[1]; continue; }
    const note = line.match(NOTE);
    if (note) { result.note = readText(note[1], problems, where); continue; }
    const match = line.match(LINE);
    if (!match) { problems.push({ level: 'stop', where, problem: 'line not in the answers format' }); continue; }
    const [, id, isText, textIndex, isComment, value] = match;
    const item = form.byId[id];
    if (!item) { problems.push({ level: 'stop', where, problem: `unknown item ${id}` }); continue; }
    const key = isComment ? `${id} comment` : isText ? `${id} text ${textIndex ?? 1}` : id;
    if (raw[key] !== undefined) { problems.push({ level: 'stop', where, problem: `${key} appears twice` }); continue; }
    raw[key] = { value, where };
  }

  // Choices first, so the conditions can be worked out.
  const codesById = {};
  for (const item of form.items) {
    if (item.kind === 'text' || raw[item.id] === undefined) continue;
    const { value, where } = raw[item.id];
    const head = value.split(' | ')[0].trim();
    if (head === '(no answer)') continue;
    const codes = head === 'none' ? [] : head.split(/\s*,\s*/);
    const known = item.options.map((entry) => entry.code);
    const unknown = codes.filter((code) => !known.includes(code));
    if (unknown.length) { problems.push({ level: 'stop', where, problem: `${item.id}: unknown option ${unknown.join(', ')}` }); continue; }
    if (item.kind === 'choice' && codes.length !== 1) { problems.push({ level: 'stop', where, problem: `${item.id}: pick exactly one option` }); continue; }
    codesById[item.id] = codes;
  }
  const visible = visibleIds(form, codesById);

  for (const item of form.items) {
    const lineKeys = Object.keys(raw).filter((key) => key === item.id || key.startsWith(`${item.id} `));
    if (!visible.includes(item.id)) {
      if (lineKeys.length) result.ignored.push({ id: item.id, reason: 'hidden by an earlier answer, so not used' });
      continue;
    }
    const answer = { kind: item.kind };
    if (item.kind === 'text') {
      answer.texts = item.fields.map((_, index) => {
        const entry = raw[`${item.id} text ${index + 1}`];
        return entry ? readText(entry.value, problems, entry.where) ?? '' : '';
      });
    } else if (codesById[item.id] === undefined) {
      result.unanswered.push(item.id);
      answer.codes = null;
    } else {
      const codes = codesById[item.id];
      answer.codes = codes;
      answer.labels = codes.map((code) => item.options.find((entry) => entry.code === code).label);
      const rec = item.rec === null ? null : Array.isArray(item.rec) ? item.rec : [item.rec];
      answer.recommended = rec === null ? null : [...codes].sort().join(',') === [...rec].sort().join(',');
      const textAllowed = item.text && (item.text.for === 'always' || codes.some((code) => item.text.for.includes(code)));
      const entry = raw[`${item.id} text 1`];
      if (entry && !textAllowed) result.ignored.push({ id: item.id, reason: 'text given for an option that takes no text' });
      if (textAllowed) answer.text = entry ? readText(entry.value, problems, entry.where) ?? '' : '';
    }
    const comment = raw[`${item.id} comment`];
    if (comment) {
      const text = readText(comment.value, problems, comment.where);
      if (text) { answer.comment = text; result.comments.push({ id: item.id, text }); }
    }
    result.answers[item.id] = answer;
  }
  const stop = problems.some((entry) => entry.level === 'stop');
  result.status = stop ? 'stop' : result.unanswered.length || result.comments.length || result.note ? 'needs-person' : 'complete';
  return result;
}

function chat(form) {
  const out = [`Setup questions (${form.form} v${form.version}, choices ${form.fingerprint}).`, 'Reply with the item and your pick, for example "S1 new", or say "all recommended". Skip any item you like.', ''];
  for (const section of form.sections) {
    const condition = section.showIf ? ` (only if ${Object.entries(section.showIf).map(([id, codes]) => `${id} is ${codes.join(' or ')}`).join(', ')})` : '';
    out.push(`${section.title}${condition}`);
    for (const id of section.items) {
      const item = form.byId[id];
      const only = item.showIf ? ` (only if ${Object.entries(item.showIf).map(([key, codes]) => `${key} is ${codes.join(' or ')}`).join(', ')})` : '';
      out.push(`${id}. ${item.title}${only}`);
      out.push(`   ${item.why}`);
      if (item.kind === 'text') {
        item.fields.forEach((field) => out.push(`   - ${field.label}`));
        out.push('   Your own words; leave it out and it stays Unknown.');
      } else {
        const rec = item.rec === null ? [] : Array.isArray(item.rec) ? item.rec : [item.rec];
        for (const entry of item.options) out.push(`   ${entry.code}: ${entry.label}${rec.includes(entry.code) ? ' (recommended)' : ''}`);
        if (item.kind === 'multi') out.push('   Pick any number.');
        if (item.text) out.push(`   Your words (${item.text.label.replace(/[.?]$/, '')})${item.text.for === 'always' ? '' : `, with ${item.text.for.join(' or ')}`}.`);
        out.push(item.rec === null ? '   No recommendation: only you know this one.' : `   Why recommended: ${item.recWhy}`);
      }
      if (item.example) out.push(`   Example: ${item.example}`);
    }
    out.push('');
  }
  return out.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const [command, ...args] = isMain ? process.argv.slice(2) : [];
if (command === 'check' || command === 'chat') {
  const formFile = option(args, '--form');
  if (!formFile) usage('--form is required');
  const form = loadForm(formFile);
  if (command === 'chat') {
    console.log(chat(form));
  } else {
    const file = option(args, '--file');
    const input = readFileSync(file ?? 0, 'utf8');
    const result = check(form, input);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'stop' ? 4 : result.status === 'needs-person' ? 3 : 0;
  }
} else if (isMain) {
  usage(command === undefined ? '' : `unknown command ${command}`);
}
