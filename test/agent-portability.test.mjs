// Every shared skill must load in any agent tool that reads the open SKILL.md folder format, not only in one.
//   node --test test/agent-portability.test.mjs
// Most tools read `.agents/skills`; Claude Code reads `.claude/skills`; most read AGENTS.md, and Claude Code reads it
// through the CLAUDE.md import. docs/other-agent-tools.md names the tools and the one setting some of them need.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(sourceRoot, rel), 'utf8');
const SKILL_ROOTS = ['template/shared-skills', 'template/optional-skills'];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Tool names that exist in one host only. A skill that names one must also say what to do where it is missing.
const HOST_ONLY = [/AskUserQuestion/, /\bArtifactData\b/, /\bArtifactComments\b/, /claude-in-chrome/, /subagent_type/, /\bSendMessage\b/, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/, /\bAgent tool\b/, /\bTeamCreate\b/];
const FALLBACK = /unavailable|not available|report it|report that|stop and report|examples, not requirements|if the host/i;
// Bundled third-party skills ship as their authors wrote them (ATTRIBUTION.md: "copied unmodified"); their known
// host-only names are pinned, so a new one, or one that goes away, fails the test.
const UNMODIFIED = { humanizer: ['AskUserQuestion'] };

// Strict front matter: what a strict YAML parser accepts, and the name and description rules the tools share.
function frontMatterProblems(folder, text) {
  const problems = [];
  if (!/^---\r?\n/.test(text)) return ['front matter does not start on line 1'];
  const end = text.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end < 0) return ['front matter has no closing line'];
  const fields = {};
  for (const line of text.slice(text.indexOf('\n') + 1, end).split(/\r?\n/)) {
    if (line.includes('\t')) problems.push('tab character in front matter');
    const m = line.match(/^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/);
    if (!m) continue;
    const raw = (m[2] ?? '').trim();
    let value = raw;
    if (raw.startsWith('"')) {
      try { value = JSON.parse(raw); } catch { problems.push(`${m[1]}: double-quoted value does not parse`); }
    } else if (raw.startsWith("'")) {
      value = raw.slice(1, -1).replace(/''/g, "'");
    } else if (/: | #/.test(raw)) {
      problems.push(`${m[1]}: plain value holds ": " or " #"; quote it`);
    }
    fields[m[1]] = value;
  }
  if (fields.name !== folder) problems.push(`name "${fields.name}" differs from the folder`);
  else if (!NAME.test(fields.name) || fields.name.length > 64) problems.push('name is not lowercase words joined by hyphens, 64 characters at most');
  if (!fields.description) problems.push('no description');
  else if (fields.description.length > 1024) problems.push(`description has ${fields.description.length} characters`);
  return problems;
}

function skills() {
  return SKILL_ROOTS.flatMap((root) => readdirSync(path.join(sourceRoot, root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, root, rel: `${root}/${entry.name}` })));
}

function filesUnder(rel, prefix = '') {
  return readdirSync(path.join(sourceRoot, rel)).sort().flatMap((name) => {
    const full = path.join(sourceRoot, rel, name);
    return statSync(full).isDirectory() ? filesUnder(`${rel}/${name}`, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

test('every shared and optional skill has front matter that strict parsers in every tool accept', () => {
  for (const skill of skills()) {
    assert.deepEqual(frontMatterProblems(skill.name, read(`${skill.rel}/SKILL.md`)), [], skill.rel);
  }
});

test('RED control: an unquoted colon, a tab, a wrong name and a long description are each refused', () => {
  const ok = '---\nname: sample\ndescription: "Does a task: one step. Use when asked."\n---\n';
  assert.deepEqual(frontMatterProblems('sample', ok), []);
  assert.match(frontMatterProblems('sample', ok.replace('"Does a task: one step. Use when asked."', 'Does a task: one step.'))[0], /quote it/);
  assert.match(frontMatterProblems('sample', ok.replace('name: sample', 'name:\tsample')).join(), /tab/);
  assert.match(frontMatterProblems('other', ok).join(), /differs from the folder/);
  assert.match(frontMatterProblems('sample', ok.replace('Use when asked.', 'x'.repeat(1030))).join(), /characters/);
  assert.match(frontMatterProblems('sample', `\n${ok}`).join(), /line 1/);
});

test('every shared skill file is installed to .agents/skills and .claude/skills with the bytes of its source', () => {
  const manifest = JSON.parse(read('template-manifest.json'));
  const byDestination = new Map(manifest.entries.map((entry) => [entry.destination, entry]));
  for (const skill of skills().filter((s) => s.root === 'template/shared-skills')) {
    for (const file of filesUnder(skill.rel)) {
      const source = `${skill.rel}/${file}`;
      const sha256 = createHash('sha256').update(readFileSync(path.join(sourceRoot, source))).digest('hex');
      for (const client of ['.agents', '.claude']) {
        const entry = byDestination.get(`${client}/skills/${skill.name}/${file}`);
        assert.ok(entry, `${client}/skills/${skill.name}/${file} is installed`);
        assert.equal(entry.source, source);
        assert.equal(entry.sha256, sha256, `${source} hash`);
      }
    }
  }
});

test('the rules reach every tool: AGENTS.md is installed, CLAUDE.md imports it, and both stay small', () => {
  const manifest = JSON.parse(read('template-manifest.json'));
  const destinations = new Set(manifest.entries.map((entry) => entry.destination));
  for (const file of ['AGENTS.md', 'CLAUDE.md', '00-Meta/AGENTS.md', '00-Meta/Working-Agreement.md']) assert.ok(destinations.has(file), file);
  assert.match(read('template/CLAUDE.md'), /^@AGENTS\.md$/m);
  // One tool truncates a rules file above 24,000 bytes; another reads 32 KiB by default.
  for (const file of ['template/AGENTS.md', 'template/00-Meta/AGENTS.md']) assert.ok(Buffer.byteLength(read(file)) <= 24000, file);
});

test('a skill that names a host-only tool also says what to do where that tool is missing', () => {
  const seen = {};
  for (const skill of skills()) {
    const text = read(`${skill.rel}/SKILL.md`);
    const hits = HOST_ONLY.filter((re) => re.test(text)).map((re) => re.source.replace(/\\b/g, ''));
    if (!hits.length) continue;
    if (UNMODIFIED[skill.name]) { seen[skill.name] = hits; continue; }
    assert.match(text, FALLBACK, `${skill.rel} names ${hits.join(', ')} without a fallback sentence`);
  }
  assert.deepEqual(seen, UNMODIFIED);
});

test('the learning procedure sends a new rule to a shared owner, never to one assistant\'s private memory', () => {
  const procedure = read('template/03-Resources/Procedures/learning-and-scaling.md');
  assert.match(procedure, /`00-Meta\/Working-Agreement\.md` for a rule that holds in every project/);
  assert.match(procedure, /Never keep a rule only in one assistant's private memory/);
  assert.match(read('template/shared-skills/second-brain-learning/SKILL.md'), /^description: .*a standing rule the person gives.*every agent tool reads/m);
});
