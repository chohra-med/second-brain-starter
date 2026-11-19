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
  // The docs count the skills the manifest installs. Counting api-anything as installed would give one more.
  const words = ['twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one', 'thirty-two'];
  const installed = new Set(JSON.parse(await read('template-manifest.json')).entries.map((entry) => entry.destination.match(/^\.claude\/skills\/([^/]+)\//)?.[1]).filter(Boolean)).size;
  const [count, oneMore] = [words[installed - 20], words[installed - 19]];
  for (const name of ['docs/free-and-builder-ai-os.md', 'docs/first-loop-and-projects.md']) {
    const text = await read(name);
    assert.match(text, new RegExp(`\\b${count} (?:shared )?skills\\b`), `${name} does not count the ${count} installed skills`);
    assert.doesNotMatch(text, new RegExp(`\\b${oneMore}\\b`), `${name} counts ${oneMore} skills, as if api-anything were installed`);
  }
});

// watch is offered, not installed: scripts/setup.py downloads an installer from astral.sh and runs it with sh (irm | iex on
// Windows), and the Gemini engine its SKILL.md recommends sends the video to Google. The files ship unmodified from
// upstream commit 03ceb42f7fa2c4439aca01752118044baabffb8f (SOURCE.md is the starter's own note and is not hashed).
const watchOptional = 'template/optional-skills/watch';
const watchUpstream = new Map([
  ['LICENSE', 'add78957ea8124a8ae6eccd7a55c948543a9f32ea26917bf562b8cafacb01d3e'],
  ['SKILL.md', '04bfa3b0d1240d5474b03869907202a3459879e9835e688149458a74320a55cb'],
  ['scripts/config.py', '3f660c726d4fcfd1e3c6fbbea4097ae1768460e2b7ce78c5c603984dcf5d2385'],
  ['scripts/download.py', 'aa4a01ff7fb61e05d5c97941cb9113205bc7600626ec68a732332128bd9e4fbb'],
  ['scripts/frames.py', 'c41071f65baf39e043c8ad8bf6895adf351e4da9ef9ce2a6237fc9e456bb2309'],
  ['scripts/gemini.py', 'e0f29cdfc1f64b6535b6c01a6f21e33493abc240ab18aeac2c85f2f24d3c850e'],
  ['scripts/local_whisperx.py', '123155ca69e188c44e2dcd1297c52558c477ae96be6238338f4f654c04b5e9cd'],
  ['scripts/runtime.py', '70f9741d7b863380840da602f9311eb118572c33e083cfdea99524bd282eadbd'],
  ['scripts/setup.py', '76d6f9e94918c01b8d9bb5210bb0e253ac96d3816e2db9e8a421248bd63eac9f'],
  ['scripts/transcribe.py', 'ceba832c36c0dd64cab8f3ef87d0a6dcc0472d8469c30dbc9e54f73028de4c3f'],
  ['scripts/watch.py', 'd6996d1afab2079ddd497fbbbde772f61fd86b5e71d93e6e8c55b9311cb4af94'],
  ['scripts/whisper.py', '0ea4910e093dda680267a1e99e98ccdc8d541c9e2a314260f5db90b330145ed3'],
]);

test('watch ships unmodified under template/optional-skills/ and no manifest entry installs it', async () => {
  const manifest = JSON.parse(await read('template-manifest.json'));
  assert.deepEqual(manifest.entries.filter((entry) => `${entry.source} ${entry.destination}`.includes('watch')), []);
  for (const [file, hash] of watchUpstream) {
    const bytes = await readFile(path.join(sourceRoot, watchOptional, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${file} differs from upstream`);
  }
  await assert.rejects(lstat(path.join(sourceRoot, 'template', 'shared-skills', 'watch')), { code: 'ENOENT' });
  const allow = (await read('FILE-ALLOWLIST.txt')).split('\n');
  assert.deepEqual(allow.filter((line) => line.includes('/watch/')), [...watchUpstream.keys(), 'SOURCE.md'].map((file) => `${watchOptional}/${file}`).sort());
});

test('the docs say watch is optional, not installed by init, and what its engines send out', async () => {
  const attribution = await read('ATTRIBUTION.md');
  for (const required of [`${watchOptional}/`, '03ceb42f7fa2c4439aca01752118044baabffb8f', 'The initializer does not install this skill']) {
    assert.ok(attribution.includes(required), `ATTRIBUTION.md is missing: ${required}`);
  }
  assert.ok(!attribution.includes('template/shared-skills/watch'), 'ATTRIBUTION.md still points at the old folder');
  const privacy = await read('PRIVACY.md');
  assert.ok(privacy.includes('optional outside skill `watch`'), 'PRIVACY.md does not call watch optional');
  assert.ok(privacy.includes('which `init` does not install'), 'PRIVACY.md does not say init does not install watch');
  assert.ok(!privacy.includes('shared-skills/watch'), 'PRIVACY.md still points at the old folder');
  assert.ok(!/bundled outside skill `watch`/.test(privacy), 'PRIVACY.md still calls watch bundled');
  const readme = await read('README.md');
  assert.ok(readme.includes('**Optional: `watch`.**'), 'README.md has no optional watch paragraph');
  assert.ok(readme.includes(`${watchOptional}/SKILL.md`), 'README.md does not say where the optional skill is');
  assert.doesNotMatch(readme, /^\| `watch` \|/m, 'README.md still lists watch with the installed skills');
});
