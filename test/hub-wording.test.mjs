import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { planInstall, stableStringify } from '../lib/installer.mjs';
import { cleanup, consumerRoot, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const profileQuestions = [
  'What is your role?',
  'What is your stack?',
  'How do you want answers given?',
  'What must never be touched (paths or systems)?',
];

function profileEntries(manifest) {
  return manifest.entries.filter((entry) => entry.destination === '00-Meta/Profile.md');
}

function assertProfileSeed(manifest) {
  const entries = profileEntries(manifest);
  assert.equal(entries.length, 1, 'manifest must have exactly one 00-Meta/Profile.md entry');
  assert.equal(entries[0].mergeKind, 'seed-file', 'Profile.md must be a seed-file');
}

function assertFirstUseProfile(text) {
  for (const question of profileQuestions) assert.ok(text.includes(question), `first-use is missing the Profile question: ${question}`);
  assert.ok(text.includes('Unknown'), 'first-use must record unknowns as Unknown');
  assert.ok(text.includes('## 2a. Profile: only what is missing'), 'first-use is missing the Profile section');
}

test('manifest ships Profile.md exactly once as a seed file', async () => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  assertProfileSeed(manifest);
});

test('a Profile.md entry marked managed-file or duplicated is rejected', async () => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const managed = structuredClone(manifest);
  profileEntries(managed)[0].mergeKind = 'managed-file';
  assert.throws(() => assertProfileSeed(managed), /must be a seed-file/);
  const duplicated = structuredClone(manifest);
  duplicated.entries.push(structuredClone(profileEntries(manifest)[0]));
  assert.throws(() => assertProfileSeed(duplicated), /exactly one/);
});

test('first-use asks the four Profile questions and records unknowns', async () => {
  assertFirstUseProfile(await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8'));
});

test('first-use without the Profile section or any question is rejected', async () => {
  const text = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  const start = text.indexOf('## 2a. Profile');
  const end = text.indexOf('## 3. Approve');
  assert.ok(start > 0 && end > start);
  assert.throws(() => assertFirstUseProfile(text.slice(0, start) + text.slice(end)), /missing the Profile/);
  for (const question of profileQuestions) {
    assert.throws(() => assertFirstUseProfile(text.replace(question, 'omitted')), /missing the Profile question/);
  }
});

function assertProfileSeedBody(profile) {
  for (const heading of ['# Profile', '## Role', '## Stack', '## How I want answers', '## Never touch', '## Unknown']) {
    assert.ok(profile.includes(heading), `Profile.md is missing ${heading}`);
  }
  for (const heading of ['Role', 'Stack', 'How I want answers', 'Never touch']) {
    const body = profile.split(`## ${heading}\n`)[1]?.split('\n## ')[0].trim() ?? '';
    assert.ok(body.startsWith('Unknown'), `Profile.md section ${heading} must be seeded as Unknown`);
  }
}

function assertNoInventing(firstUse) {
  assert.ok(firstUse.includes('Do not invent a role, stack, preference or boundary'), 'first-use must forbid inventing Profile values');
  assert.ok(firstUse.includes('Do not record credentials, tokens, client names or anything confidential'), 'first-use must forbid recording secrets');
}

test('Profile seed has every section seeded as Unknown, and the hub points at it', async () => {
  assertProfileSeedBody(await readFile(path.join(sourceRoot, 'template/00-Meta/Profile.md'), 'utf8'));
  const home = await readFile(path.join(sourceRoot, 'template/Home.md'), 'utf8');
  assert.ok(home.includes('(00-Meta/Profile.md)'));
  const route = await readFile(path.join(sourceRoot, 'template/00-Meta/AGENTS.md'), 'utf8');
  assert.ok(route.includes('`00-Meta/Profile.md`'));
});

test('a seeded Profile value or a missing no-invent or no-secrets instruction is rejected', async () => {
  const profile = await readFile(path.join(sourceRoot, 'template/00-Meta/Profile.md'), 'utf8');
  assert.throws(() => assertProfileSeedBody(profile.replace(/## Role\n\nUnknown\./, '## Role\n\nSenior engineer.')), /Role must be seeded as Unknown/);
  const firstUse = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  assertNoInventing(firstUse);
  assert.throws(() => assertNoInventing(firstUse.replace('Do not invent a role, stack, preference or boundary', 'Guess a sensible default')), /forbid inventing/);
  assert.throws(() => assertNoInventing(firstUse.replace('Do not record credentials, tokens, client names or anything confidential', 'Record whatever helps')), /forbid recording secrets/);
});

test('an existing user Profile.md plans a named CONFLICT and is never overwritten', async (t) => {
  const root = await consumerRoot('second-brain-profile-');
  cleanup(t, root);
  const target = path.join(root, 'existing');
  await mkdir(path.join(target, '00-Meta'), { recursive: true });
  await writeFile(path.join(target, '00-Meta', 'Profile.md'), 'my own profile\n');
  const planned = await runCli(['init', '--target', target]);
  assert.match(planned.stdout, /^CONFLICT\t00-Meta\/Profile\.md\tundo=none$/m, planned.stdout);
  const rejected = await runCli(['init', '--target', target, '--apply', planDigest(planned.stdout)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.equal(await readFile(path.join(target, '00-Meta', 'Profile.md'), 'utf8'), 'my own profile\n');
});

// R03-12: the sentence that tells the assistant to record unanswered Profile items as Unknown is pinned.
const UNKNOWN_RULE = 'Record anything the person cannot or will not answer as `Unknown` and list it under `## Unknown`.';

function assertUnknownRule(firstUse) {
  assert.ok(firstUse.includes(UNKNOWN_RULE), 'first-use must record unanswered Profile items as Unknown');
}

test('first-use pins the Unknown rule, so replacing it with a default is caught (R03-12)', async () => {
  const firstUse = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  assertUnknownRule(firstUse);
  assert.throws(() => assertUnknownRule(firstUse.replace(UNKNOWN_RULE, 'Fill any gap with a sensible default.')), /record unanswered Profile items as Unknown/);
});

// R03-13: the same Profile CONFLICT rule holds for an upgrade of the real v1.2.0 install, not only for init.
async function putFile(root, posixPath, content) {
  const destination = path.join(root, ...posixPath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

test('an upgrade of the real v1.2.0 install plans a named CONFLICT for a user Profile.md and never overwrites it (R03-13)', async (t) => {
  const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
  const target = await consumerRoot('second-brain-upgrade-profile-');
  cleanup(t, target);
  for (const [destination, content] of Object.entries(fixture.files)) await putFile(target, destination, content);
  await putFile(target, '.second-brain/installed-state.json', `${stableStringify(fixture.state)}\n`);
  await putFile(target, fixture.receiptPath, `${stableStringify(fixture.receipt)}\n`);
  await putFile(target, '00-Meta/Profile.md', 'my own profile\n');
  const manifestBytes = await readFile(path.join(sourceRoot, 'template-manifest.json'));
  const plan = await planInstall({ manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot, targetPath: target, operation: 'upgrade' });
  const profile = plan.entries.find((entry) => entry.destination === '00-Meta/Profile.md');
  assert.ok(profile, 'the upgrade plan lists the Profile seed');
  assert.equal(profile.status, 'CONFLICT');
  assert.equal(profile.undo.action, 'none');
  assert.equal(await readFile(path.join(target, '00-Meta', 'Profile.md'), 'utf8'), 'my own profile\n');
});

// R03-14: a managed template file may only name a CLI command the CLI exposes. The allowed set is read from bin.
const CLI_COMMAND_PATTERN = /\bsecond-brain(?:\.mjs)?\s+([a-z][a-z-]*)/g;

function exposedCommands(binSource) {
  const declared = binSource.match(/COMMANDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(declared, 'the argument module declares its commands in one Set literal');
  return declared[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean);
}

function namedCommands(text) {
  return [...text.matchAll(CLI_COMMAND_PATTERN)].map((match) => match[1]);
}

test('no managed template file names a CLI command the CLI does not expose, and the scan really sees command mentions (R03-14)', async () => {
  // The command set is declared once, in the argument module the bin imports; read it from there.
  const exposed = new Set(exposedCommands(await readFile(path.join(sourceRoot, 'lib', 'cli-arguments.mjs'), 'utf8')));
  assert.ok(exposed.has('connect') && exposed.has('verify') && exposed.has('init'), 'the derived set is the CLI command set');
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const named = [];
  for (const entry of manifest.entries) {
    named.push(...namedCommands(await readFile(path.join(sourceRoot, entry.source), 'utf8')).map((command) => ({ file: entry.destination, command })));
  }
  assert.ok(named.length > 0, 'the scan found command mentions in the managed files, so the guard is not a no-op');
  assert.deepEqual(named.filter((item) => !exposed.has(item.command)), [], 'every named command is exposed by the CLI');
});

test('the R03-14 scan fires on a planted command the CLI does not expose (positive control)', () => {
  const exposed = new Set(exposedCommands('export const COMMANDS = new Set([\'init\', \'connect\']);'));
  assert.deepEqual(namedCommands('Run `node ./bin/second-brain.mjs frobnicate --target x`.'), ['frobnicate']);
  assert.equal(exposed.has('frobnicate'), false);
});

test('the connect wording defines the harness where Home first uses it', async () => {
  const home = await readFile(path.join(sourceRoot, 'template/Home.md'), 'utf8');
  assert.ok(home.includes('(the harness is the set of agent rules and commands that Spec Harness installs)'), 'Home defines the harness at first use');
  assert.ok(home.indexOf('(the harness is') > home.indexOf('Spec Harness files'), 'the definition sits at the first use');
});

// R03-11: the context procedure calls the seeded folder the seeded project, not an example.
test('the context procedure names the seeded project, not an example (R03-11)', async () => {
  const context = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/context.md'), 'utf8');
  assert.ok(context.includes('the seeded project lives under `01-Projects/Selected-Project/`'), 'context names the seeded project');
  assert.equal(context.includes('the seeded example lives under'), false, 'the example wording is gone');
});
