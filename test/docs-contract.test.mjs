import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const execFile = promisify(execFileCallback);
const read = (relative) => readFile(path.join(sourceRoot, relative), 'utf8');

// ---------------------------------------------------------------------------
// (i) every command a document names exists in the CLI. The allowed set is read from the argument module, which
// the bin imports, and each one must also appear in the printed help.
// ---------------------------------------------------------------------------

const COMMAND_PATTERN = /\bsecond-brain(?:\.mjs)?\s+([a-z][a-z-]*)/g;
const COMMAND_DOCUMENTS = ['README.md', 'ONBOARDING.md', 'UPGRADING.md'];

function exposedCommands(argumentsSource) {
  const declared = argumentsSource.match(/COMMANDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(declared, 'the argument module declares its commands in one Set literal');
  return declared[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean);
}

function namedCommands(text) {
  return [...text.matchAll(COMMAND_PATTERN)].map((match) => match[1]);
}

// The check itself, as a function, so the positive control runs the real check on a planted document.
function commandProblems(document, text, exposed) {
  return namedCommands(text).filter((command) => !exposed.has(command)).map((command) => `${document} names a command the CLI does not expose: ${command}`);
}

// Flags the documents name must exist in the argument module. --force is named on purpose, to say it does not exist in V1.
// --version is Node's own flag (`node --version`, UPGRADING's Node check), not this CLI's.
const DELIBERATELY_ABSENT_FLAGS = ['--force', '--version'];
const FLAG_PATTERN = /(?<![\w-])--[a-z][a-z-]*/g;

function flagProblems(document, text, flags) {
  return [...new Set(text.match(FLAG_PATTERN) ?? [])].filter((flag) => !flags.has(flag) && !DELIBERATELY_ABSENT_FLAGS.includes(flag)).map((flag) => `${document} names a flag the CLI does not accept: ${flag}`);
}

test('every command and flag named in README, ONBOARDING and UPGRADING exists in the CLI', async () => {
  const exposed = new Set(exposedCommands(await read('lib/cli-arguments.mjs')));
  const flags = new Set([...(await read('lib/cli-arguments.mjs')).matchAll(/'(--[a-z-]+)'/g)].map((match) => match[1]));
  const printed = await execFile(process.execPath, [path.join(sourceRoot, 'bin', 'second-brain.mjs'), '--help'], { cwd: sourceRoot, windowsHide: true });
  for (const command of exposed) {
    assert.match(printed.stdout, new RegExp(`second-brain ${command} `), `the help prints the ${command} usage`);
  }
  let named = 0;
  const problems = [];
  for (const document of COMMAND_DOCUMENTS) {
    const text = await read(document);
    named += namedCommands(text).length;
    problems.push(...commandProblems(document, text, exposed), ...flagProblems(document, text, flags));
  }
  assert.ok(named >= 10, `the scan found the command mentions (${named}), so the check is not a no-op`);
  assert.deepEqual(problems, []);
});

test('the command and flag checks fire on a planted document (positive control)', () => {
  const exposed = new Set(exposedCommands('export const COMMANDS = new Set([\'init\', \'connect\']);'));
  const flags = new Set(['--target', '--apply']);
  const planted = 'Run `node ./bin/second-brain.mjs frobnicate --target /absolute/path --bogus-flag x`.';
  assert.deepEqual(commandProblems('PLANTED.md', planted, exposed), ['PLANTED.md names a command the CLI does not expose: frobnicate']);
  assert.deepEqual(flagProblems('PLANTED.md', planted, flags), ['PLANTED.md names a flag the CLI does not accept: --bogus-flag']);
  assert.deepEqual(flagProblems('PLANTED.md', 'See --force.', flags), [], 'a deliberately absent flag is not reported');
});

// T07-6: every line prefix verify can print is in the README table. The prefixes are read from the code.
function verifyPrefixes(binSource, installerSource) {
  const verifyBody = installerSource.slice(installerSource.indexOf('export async function verifyInstall'));
  const fromEntries = [...verifyBody.slice(0, verifyBody.indexOf('\n}\n')).matchAll(/status = '([A-Z_]+)'/g)].map((match) => match[1]);
  const fromIssues = [...verifyBody.slice(0, verifyBody.indexOf('\n}\n')).matchAll(/code: '([A-Z_]+)'/g)].map((match) => match[1]);
  const fromCli = [...binSource.matchAll(/output\.write\(`([A-Z]+)\\t/g)].map((match) => match[1]);
  return new Set([...fromEntries, ...fromIssues, ...fromCli, 'Connections', 'Verification']);
}

function tablePrefixes(readme) {
  return new Set([...readme.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1].replace(/ .*$/, '').replace(/:$/, '')));
}

test('every line prefix verify can print has a row in the README verify table (T07-6)', async () => {
  const prefixes = verifyPrefixes(await read('bin/second-brain.mjs'), await read('lib/installer.mjs'));
  const documented = tablePrefixes(await read('README.md'));
  const missing = [...prefixes].filter((prefix) => !documented.has(prefix));
  assert.ok(prefixes.size >= 10, `the scan found the prefixes (${prefixes.size}), so the check is not a no-op`);
  assert.deepEqual(missing, [], 'verify prints a prefix the README table does not name');
});

test('the verify prefix check fires when verify gains a prefix the table lacks (positive control)', () => {
  const planted = verifyPrefixes('output.write(`NEWPREFIX\\t${x}`);', '');
  assert.ok(planted.has('NEWPREFIX'));
  assert.ok(!tablePrefixes('| `VERIFIED` | ok |').has('NEWPREFIX'));
});

// ---------------------------------------------------------------------------
// (ii) the version is the same in every carrier.
// ---------------------------------------------------------------------------

function versionCarriers({ version, packageVersion, templateVersion, helpFirstLine, readme, changelog, upgrading }) {
  const bare = version.slice(1);
  const problems = [];
  if (!/^v\d+\.\d+\.\d+$/.test(version)) problems.push(`VERSION is not vX.Y.Z: ${version}`);
  if (packageVersion !== bare) problems.push(`package.json says ${packageVersion}`);
  if (templateVersion !== bare) problems.push(`template-manifest.json says ${templateVersion}`);
  if (helpFirstLine !== `Second Brain Starter ${bare}`) problems.push(`the CLI help says ${helpFirstLine}`);
  if (!readme.includes(`identifies these source bytes as \`${version}\``)) problems.push('README.md does not name the same version');
  const changelogHeading = changelog.match(/^## (v\d+\.\d+\.\d+)\b/m)?.[1];
  if (changelogHeading !== version) problems.push(`the first CHANGELOG heading is ${changelogHeading}`);
  const upgradingHeading = upgrading.match(/^## Upgrading to (v\d+\.\d+\.\d+)$/m)?.[1];
  if (upgradingHeading !== version) problems.push(`the first UPGRADING section is ${upgradingHeading}`);
  return problems;
}

test('the version is the same in every carrier: VERSION, package.json, the manifest, the CLI help, README, CHANGELOG and UPGRADING', async () => {
  const printed = await execFile(process.execPath, [path.join(sourceRoot, 'bin', 'second-brain.mjs'), '--help'], { cwd: sourceRoot, windowsHide: true });
  const problems = versionCarriers({
    version: (await read('VERSION')).trim(),
    packageVersion: JSON.parse(await read('package.json')).version,
    templateVersion: JSON.parse(await read('template-manifest.json')).metadata.templateVersion,
    helpFirstLine: printed.stdout.split(/\r?\n/)[0],
    readme: await read('README.md'),
    changelog: await read('CHANGELOG.md'),
    upgrading: await read('UPGRADING.md'),
  });
  assert.deepEqual(problems, []);
});

test('the version check fires when one carrier disagrees (positive control)', async () => {
  const base = {
    version: 'v1.3.0',
    packageVersion: '1.3.0',
    templateVersion: '1.3.0',
    helpFirstLine: 'Second Brain Starter 1.3.0',
    readme: 'identifies these source bytes as `v1.3.0`',
    changelog: '## v1.3.0 (2026-10-09)\n',
    upgrading: '## Upgrading to v1.3.0\n',
  };
  assert.deepEqual(versionCarriers(base), []);
  assert.notDeepEqual(versionCarriers({ ...base, packageVersion: '1.2.0' }), []);
  assert.notDeepEqual(versionCarriers({ ...base, templateVersion: '1.2.0' }), []);
  assert.notDeepEqual(versionCarriers({ ...base, helpFirstLine: 'Second Brain Starter 1.2.0' }), []);
  assert.notDeepEqual(versionCarriers({ ...base, changelog: '## Unreleased\n' }), []);
  assert.notDeepEqual(versionCarriers({ ...base, upgrading: '## Upgrading to v1.2.0\n' }), []);
});

// ---------------------------------------------------------------------------
// (iii) every relative link in the changed documents resolves to a file, and every in-page anchor resolves to a heading.
// ---------------------------------------------------------------------------

const LINKED_DOCUMENTS = ['README.md', 'ONBOARDING.md', 'PRIVACY.md', 'CONTRIBUTING.md', 'UPGRADING.md', 'CHANGELOG.md', 'ATTRIBUTION.md', 'AGENTS.md'];

// GitHub's heading slug: lower case, punctuation removed, spaces become hyphens.
function slug(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-');
}

function headingSlugs(text) {
  return new Set([...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => slug(match[1])));
}

function linksIn(text) {
  return [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

async function brokenLinks(document, text) {
  const broken = [];
  const folder = path.dirname(path.join(sourceRoot, document));
  for (const target of linksIn(text)) {
    const [file, anchor] = target.split('#');
    const resolved = file ? path.resolve(folder, decodeURI(file)) : path.join(sourceRoot, document);
    const stat = await lstat(resolved).catch(() => null);
    if (!stat) {
      broken.push(`${document} -> ${target}: no such file`);
      continue;
    }
    if (anchor !== undefined && anchor !== '' && resolved.endsWith('.md')) {
      const slugs = headingSlugs(await readFile(resolved, 'utf8'));
      if (!slugs.has(anchor)) broken.push(`${document} -> ${target}: no heading with that anchor`);
    }
  }
  return broken;
}

test('every relative link and in-page anchor in the changed documents resolves', async () => {
  const broken = [];
  let checked = 0;
  for (const document of LINKED_DOCUMENTS) {
    const text = await read(document);
    checked += linksIn(text).length;
    broken.push(...(await brokenLinks(document, text)));
  }
  assert.ok(checked > 40, `the scan found the links (${checked}), so the check is not a no-op`);
  assert.deepEqual(broken, []);
});

test('the link check fires on a planted missing file and a planted missing anchor (positive control)', async () => {
  const text = '[gone](NO-SUCH-FILE.md) and [nowhere](README.md#no-such-heading)';
  const broken = await brokenLinks('README.md', text);
  assert.equal(broken.length, 2, broken.join('\n'));
});

// ---------------------------------------------------------------------------
// (iv) PRIVACY.md states the amended connection-record fact and no longer states the false one.
// ---------------------------------------------------------------------------

const PRIVACY_AMENDED = [
  'Connection records, connect receipts and connect pending records also hold the absolute path of the workspace and of each repository you explicitly connected with `connect`',
  'The remote is the `origin` URL with credentials, query and fragment removed',
  'the rule-file names found',
  'It never reads a sibling folder, a parent folder or another repository',
  'reads the `origin` URL from it',
  'It never prints or stores those bytes',
];
const PRIVACY_FALSE = 'should not contain home paths';

function privacyProblems(text) {
  const problems = PRIVACY_AMENDED.filter((sentence) => !text.includes(sentence)).map((sentence) => `missing: ${sentence}`);
  if (text.includes(PRIVACY_FALSE)) problems.push(`still states: ${PRIVACY_FALSE}`);
  return problems;
}

test('PRIVACY.md contains the amended connection-record and repository-read statements and no longer the false home-path statement', async () => {
  assert.deepEqual(privacyProblems(await read('PRIVACY.md')), []);
});

test('the PRIVACY check fires when the amendment is removed or the false statement comes back (positive control)', async () => {
  const amended = await read('PRIVACY.md');
  assert.ok(privacyProblems(amended.replace(PRIVACY_AMENDED[0], 'omitted')).length > 0);
  assert.ok(privacyProblems(`${amended}\nRecords ${PRIVACY_FALSE}.\n`).length > 0);
});

// T07-8: PRIVACY and README say a remote the parser does not recognise is recorded as `unknown`. This runs the real reader.
test('a remote URL with a fragment, which git quotes in .git/config, is recorded as unknown; a plain one keeps its host and path only (T07-8)', async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { readRemote } = await import('../lib/connect.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'sb-remote-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = "https://user:secret@example.com/acme/app.git?token=q1#frag"\n');
  assert.equal(await readRemote({ repoReal: root }), 'unknown');
  await writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://user:secret@example.com/acme/app.git?token=q1\n');
  assert.equal(await readRemote({ repoReal: root }), 'https://example.com/acme/app.git');
});

// The starter's product code (lib and bin) starts no process and opens no network connection. Documents rely on this:
// "the vendored shell scripts are never executed" and "sends nothing anywhere". The scan reads every shipped source file.
const PROCESS_OR_NETWORK = /(?:from|import\(|require\()\s*['"](?:node:)?(child_process|net|http|https|dgram|tls|dns)['"]|\bfetch\(|\bexecFile\b|\bspawn\(|\bexec\(/;

async function sourceFiles(directory) {
  const { readdir } = await import('node:fs/promises');
  const found = [];
  for (const entry of await readdir(path.join(sourceRoot, directory), { withFileTypes: true })) {
    if (entry.isFile() && /\.mjs$/.test(entry.name)) found.push(path.join(directory, entry.name));
  }
  return found;
}

test('no code in lib or bin starts a process or opens a network connection (the vendored scripts are never executed)', async () => {
  const offenders = [];
  let scanned = 0;
  for (const file of [...(await sourceFiles('lib')), ...(await sourceFiles('bin'))]) {
    scanned += 1;
    const text = await read(file);
    if (PROCESS_OR_NETWORK.test(text)) offenders.push(file);
  }
  assert.ok(scanned >= 4, `the scan read the shipped source files (${scanned}), so the check is not a no-op`);
  assert.deepEqual(offenders, []);
});

test('the process and network scan fires on a planted import (positive control)', () => {
  assert.ok(PROCESS_OR_NETWORK.test("import { spawn } from 'node:child_process';"));
  assert.ok(PROCESS_OR_NETWORK.test("import http from 'node:http';"));
  assert.ok(PROCESS_OR_NETWORK.test('await fetch(url);'));
  assert.equal(PROCESS_OR_NETWORK.test("import { readFile } from 'node:fs/promises';"), false);
});
