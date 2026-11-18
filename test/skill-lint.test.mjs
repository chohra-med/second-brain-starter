// Lint for every shared skill, run by `node --test` in the existing CI, with no workflow file of its own.
//   node --test test/skill-lint.test.mjs
// It reuses the security check's best-practice pass (check 7: name, description, body length, references, paths,
// dates, scripts) instead of a second parser. Every sample skill is built in a fresh temporary folder.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(sourceRoot, 'template', 'shared-skills');
const CHECK = path.join(SKILLS, 'security-check', 'check.mjs');

// The bundled third-party skills ship as their authors wrote them (ATTRIBUTION.md: "copied unmodified"), so their
// best-practice FLAGs are not fixed here. Each known FLAG is pinned: a new FLAG, or one that goes away, fails the test.
const UNMODIFIED = {
  humanizer: ['bp-reference-toc README.md', 'bp-time-sensitive SKILL.md', 'bp-time-sensitive references/patterns.md'],
  'icm-architect': ['bp-reference-toc references/forms.md', 'bp-reference-toc references/system-map.md'],
};

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'skill-lint-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function checkAll(root, reports) {
  const result = spawnSync(process.execPath, [CHECK, '--all', root, '--report-dir', reports, '--json'], { encoding: 'utf8' });
  assert.ok([0, 3, 4].includes(result.status), result.stderr);
  return JSON.parse(result.stdout);
}

const findings = (skill) => skill.bestPractices.findings.map((finding) => `${finding.rule} ${finding.file}`).sort();

test('every shared skill passes the best-practice check; the bundled third-party skills keep only their known FLAGs', (t) => {
  const dir = sandbox(t);
  const report = checkAll(SKILLS, path.join(dir, 'reports'));
  const folders = readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(SKILLS, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(report.skills.map((skill) => skill.name).sort(), folders, 'every skill folder is checked');
  assert.deepEqual(report.skipped, []);
  const attribution = readFileSync(path.join(sourceRoot, 'ATTRIBUTION.md'), 'utf8');
  for (const name of Object.keys(UNMODIFIED)) {
    assert.ok(folders.includes(name), `${name} is still bundled`);
    assert.match(attribution, new RegExp(`The \`${name}\` skill in [^\\n]*copied unmodified from commit`), `${name} is still an unmodified copy`);
  }
  for (const skill of report.skills) {
    if (UNMODIFIED[skill.name]) assert.deepEqual(findings(skill), UNMODIFIED[skill.name], skill.name);
    else assert.equal(skill.bestPractices.verdict, 'PASS', `${skill.name}: ${JSON.stringify(skill.bestPractices.findings)}`);
  }
});

test('RED control: a name that differs from its folder, a description over 1,024 characters and an angle-bracket tag in the description each FLAG', (t) => {
  const dir = sandbox(t);
  const root = path.join(dir, 'skills');
  const when = 'Use when the person asks what is still open.';
  const samples = {
    'clean-sample': ['clean-sample', `Lists the open tasks in one project file. ${when}`],
    'folder-name': ['other-name', `Lists the open tasks in one project file. ${when}`],
    'long-description': ['long-description', `Lists the open tasks in one project file. ${when} ${'More detail. '.repeat(80)}`.slice(0, 1025)],
    'tag-description': ['tag-description', `Lists the open tasks in specs/<feature>/tasks.md. ${when}`],
  };
  for (const [folder, [name, description]] of Object.entries(samples)) {
    mkdirSync(path.join(root, folder), { recursive: true });
    writeFileSync(path.join(root, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n1. Read the file the person names.\n`);
  }
  assert.equal(samples['long-description'][1].length, 1025);
  const report = checkAll(root, path.join(dir, 'reports'));
  const byName = Object.fromEntries(report.skills.map((skill) => [skill.name, skill]));
  assert.equal(byName['clean-sample'].bestPractices.verdict, 'PASS', JSON.stringify(byName['clean-sample'].bestPractices.findings));
  for (const [folder, rule] of [['folder-name', 'bp-name-folder'], ['long-description', 'bp-description-length'], ['tag-description', 'bp-description-xml']]) {
    assert.equal(byName[folder].bestPractices.verdict, 'FLAG', folder);
    assert.deepEqual(findings(byName[folder]), [`${rule} SKILL.md`], folder);
  }
});
