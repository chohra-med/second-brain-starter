import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sourceRoot } from './helpers/consumer-cli.mjs';

// api-anything is offered, not installed: the skill tells the client to fetch and run an outside command from its
// project's default branch (npx -y github:...), and that command's login can import browser cookies. The files ship
// unmodified from upstream commit 20cb677039fcfe92d3d9c777aa9362e30ff1fdb8, so a person can add them by hand.
const optional = 'template/optional-skills/api-anything';
const upstream = new Map([
  ['LICENSE', '9c57c501762e9acf850474f081cdd44914f8820f0ca0099d54f8754109a47999'],
  ['SKILL.md', 'c32ff1d430898f96ce0182d15e6c58a3dbaf9b1ce6c3c6611ccd4607426d04c5'],
]);
const read = (name) => readFile(path.join(sourceRoot, name), 'utf8');

test('api-anything ships unmodified under template/optional-skills/ and no manifest entry installs it', async () => {
  const manifest = JSON.parse(await read('template-manifest.json'));
  assert.deepEqual(manifest.entries.filter((entry) => `${entry.source} ${entry.destination}`.includes('api-anything')), []);
  for (const [file, hash] of upstream) {
    const bytes = await readFile(path.join(sourceRoot, optional, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${file} differs from upstream`);
  }
  await assert.rejects(lstat(path.join(sourceRoot, 'template', 'shared-skills', 'api-anything')), { code: 'ENOENT' });
  const allow = (await read('FILE-ALLOWLIST.txt')).split('\n');
  assert.deepEqual(allow.filter((line) => line.includes('api-anything')), [...upstream.keys()].map((file) => `${optional}/${file}`));
});

test('the docs say api-anything is optional, how to add it, and what its command can do', async () => {
  const attribution = await read('ATTRIBUTION.md');
  for (const required of [`${optional}/`, 'copied unmodified', '20cb677039fcfe92d3d9c777aa9362e30ff1fdb8', 'The initializer does not install this skill', 'npx -y github:goodnight000/api-anything', 'import cookies from your everyday browser']) {
    assert.ok(attribution.includes(required), `ATTRIBUTION.md is missing: ${required}`);
  }
  // The two claims the security review found wrong: the npx line runs the command with no install step.
  assert.ok(!attribution.includes('template/shared-skills/api-anything'), 'ATTRIBUTION.md still points at the old folder');
  assert.ok(!attribution.includes('works only if you install the command yourself'), 'ATTRIBUTION.md still says the skill needs an install');
  // init does not install it, but an upgrade of a workspace that v1.8.0 to v1.10.0 installed keeps it (DEPRECATED
  // deletes nothing), so the docs say both and name the folders to delete.
  const upgraded = 'an upgrade from v1\\.8\\.0, v1\\.9\\.0 or v1\\.10\\.0[^.]* leaves it in place';
  const folders = 'delete `.claude/skills/api-anything/` and `.agents/skills/api-anything/`';
  const privacy = await read('PRIVACY.md');
  assert.ok(privacy.includes('`init` does not install the optional `api-anything` skill'), 'PRIVACY.md does not say init does not install api-anything');
  assert.match(privacy, new RegExp(`${upgraded} and still active`, 'i'), 'PRIVACY.md does not say an upgraded workspace keeps api-anything active');
  assert.ok(privacy.includes(`until you ${folders}`), 'PRIVACY.md does not name the folders to delete');
  assert.ok(!privacy.includes('skill is not installed'), 'PRIVACY.md still says, with no condition, that api-anything is not installed');
  assert.ok(!privacy.includes('nothing in this package runs it'), 'PRIVACY.md still says nothing runs it');

  const readme = await read('README.md');
  assert.ok(readme.includes(`${optional}/SKILL.md`), 'README.md does not say where the optional skill is');
  assert.doesNotMatch(readme, /^\| `api-anything` \|/m, 'README.md still lists api-anything with the installed skills');
  assert.ok(readme.includes('`init` does not install it'), 'README.md does not say init does not install api-anything');
  assert.match(readme, new RegExp(upgraded, 'i'), 'README.md does not say an upgrade keeps api-anything');
  assert.ok(readme.includes(folders), 'README.md does not name the folders to delete');
  assert.doesNotMatch(readme, /is optional and not installed|It is not installed/, 'README.md still says, with no condition, that api-anything is not installed');
  for (const name of ['docs/free-and-builder-ai-os.md', 'docs/first-loop-and-projects.md']) {
    assert.doesNotMatch(await read(name), /twenty-three/, `${name} still counts twenty-three installed skills`);
  }
});
