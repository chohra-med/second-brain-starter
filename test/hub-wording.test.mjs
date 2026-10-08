import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
