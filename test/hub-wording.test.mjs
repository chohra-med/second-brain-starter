import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sourceRoot } from './helpers/consumer-cli.mjs';

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

test('Profile seed has every section, no invented values, and the hub points at it', async () => {
  const profile = await readFile(path.join(sourceRoot, 'template/00-Meta/Profile.md'), 'utf8');
  for (const heading of ['# Profile', '## Role', '## Stack', '## How I want answers', '## Never touch', '## Unknown']) {
    assert.ok(profile.includes(heading), `Profile.md is missing ${heading}`);
  }
  const home = await readFile(path.join(sourceRoot, 'template/Home.md'), 'utf8');
  assert.ok(home.includes('(00-Meta/Profile.md)'));
  const route = await readFile(path.join(sourceRoot, 'template/00-Meta/AGENTS.md'), 'utf8');
  assert.ok(route.includes('`00-Meta/Profile.md`'));
});

test('managed hub wording never calls a connected repository initialised', async () => {
  for (const file of ['template/Home.md', 'template/00-Meta/AGENTS.md', 'template/01-Projects/README.md']) {
    const text = await readFile(path.join(sourceRoot, file), 'utf8');
    assert.ok(!/initiali[sz]ed/i.test(text), `${file} must say staged, not initialised`);
  }
});
