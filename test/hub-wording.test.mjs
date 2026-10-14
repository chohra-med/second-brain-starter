import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { planInstall, stableStringify } from '../lib/installer.mjs';
import { cleanup, consumerRoot, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

// init.md owns the Profile questions for Role, How I want answers and Never touch. complete-init.md owns the question for Stack.
const profileSectionsInInit = ['section `## Role`', 'section `## How I want answers`', 'section `## Never touch`'];

function profileEntries(manifest) {
  return manifest.entries.filter((entry) => entry.destination === '00-Meta/Profile.md');
}

function assertProfileSeed(manifest) {
  const entries = profileEntries(manifest);
  assert.equal(entries.length, 1, 'manifest must have exactly one 00-Meta/Profile.md entry');
  assert.equal(entries[0].mergeKind, 'seed-file', 'Profile.md must be a seed-file');
}

function assertFirstUseProfile(text) {
  assert.ok(text.includes('## 2a. Profile: only what is missing'), 'first-use is missing the Profile section');
  assert.ok(text.includes('Unknown'), 'first-use must record unknowns as Unknown');
  assert.ok(text.includes('`init.md`'), 'first-use must point at init.md, which owns the Profile questions');
  assert.ok(text.includes('`complete-init.md`'), 'first-use must point at complete-init.md, which owns the Stack question');
}

function assertInitProfile(text) {
  for (const section of profileSectionsInInit) assert.ok(text.includes(section), `init.md is missing the Profile question for ${section}`);
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

test('first-use points at init for the Profile questions and records unknowns; init owns the questions', async () => {
  assertFirstUseProfile(await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8'));
  assertInitProfile(await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/init.md'), 'utf8'));
});

test('first-use without the Profile section, or init without a Profile question, is rejected', async () => {
  const text = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  const start = text.indexOf('## 2a. Profile');
  const end = text.indexOf('## 3. Approve');
  assert.ok(start > 0 && end > start);
  assert.throws(() => assertFirstUseProfile(text.slice(0, start) + text.slice(end)), /missing the Profile/);
  assert.throws(() => assertFirstUseProfile(text.replace('`init.md`', 'omitted')), /must point at init.md/);
  const init = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/init.md'), 'utf8');
  for (const section of profileSectionsInInit) {
    assert.throws(() => assertInitProfile(init.replace(section, 'omitted')), /missing the Profile question/);
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
  // Standing boundaries only; scoped, dated grants are recorded in Decisions.md, not in this section.
  assert.match(profile, /standing boundaries only/, 'Profile.md must limit Never touch to standing boundaries');
  assert.match(profile, /`Decisions\.md`/, 'Profile.md must send scoped, dated grants to Decisions.md');
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

// R03-11 (v1.4.0): the loop procedures route to `01-Projects/<project>/`. Selected-Project is named only as the seeded
// project or the seeded example of a link, never as the one project every run works in.
function routeProblems(name, text) {
  const problems = [];
  if (!text.includes('01-Projects/<project>/')) problems.push(`${name} does not route to 01-Projects/<project>/`);
  if (text.includes('the seeded example lives under')) problems.push(`${name} calls the seeded project an example folder`);
  for (const line of text.split('\n').filter((item) => item.includes('Selected-Project'))) {
    if (!/seeded/.test(line)) problems.push(`${name} names Selected-Project without calling it the seeded project: ${line}`);
  }
  return problems;
}

test('the loop procedures route to 01-Projects/<project>/ and name Selected-Project only as the seeded project (R03-11)', async () => {
  const context = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/context.md'), 'utf8');
  assert.ok(context.includes('the seeded project lives under `01-Projects/Selected-Project/`'), 'context names the seeded project');
  for (const name of ['context.md', 'capture.md', 'close.md', 'review.md']) {
    assert.deepEqual(routeProblems(name, await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures', name), 'utf8')), []);
  }
  assert.ok(context.includes('one block per selected project, followed by a cross-project line'), 'context returns one note per project and a cross-project line');
});

test('the R03-11 route check fires on the v1.3.0 single-project wording (positive control)', () => {
  const old = 'Capture an incoming task in the selected project\'s `roadmap.md`.\n- One new row in `01-Projects/Selected-Project/roadmap.md`.\n';
  assert.deepEqual(routeProblems('capture.md', old), [
    'capture.md does not route to 01-Projects/<project>/',
    'capture.md names Selected-Project without calling it the seeded project: - One new row in `01-Projects/Selected-Project/roadmap.md`.',
  ]);
});

// WP2: the route owns multi-project selection; the four loop skills stay route-neutral.
test('the operating route defines one, several and all, and the loop skills are route-neutral', async () => {
  const route = await readFile(path.join(sourceRoot, 'template/00-Meta/AGENTS.md'), 'utf8');
  for (const phrase of [
    '## Selecting projects',
    'Selection is explicit and may name one project, several, or `all`',
    '[project index](../01-Projects/Index.md) and nothing outside it',
    'One project: follow the read order below in full.',
    'Defer step 2 for each project until just before you diagnose or change that project\'s files.',
    'Every capture, close or decision is written to the one project that owns it.',
    'give one compact block per project, then any cross-project conflict or dependency',
    'A repository registered with `connect` is another project.',
  ]) assert.ok(route.includes(phrase), `route is missing: ${phrase}`);
  for (const skill of ['second-brain-context', 'second-brain-capture', 'second-brain-close', 'second-brain-review']) {
    const text = await readFile(path.join(sourceRoot, 'template/shared-skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(/one or more selected projects|one, several or all selected/.test(text), `${skill} is not route-neutral`);
    assert.equal(/Selected-Project|01-Projects\//.test(text), false, `${skill} names a route path, so a route edit would touch it`);
  }
});

// Each Profile question, with its exact wording and the procedure that owns the field. The old four-string pin
// moved here when the questions moved to init.md and complete-init.md; the guarantee is the same, in the owner files.
const profileQuestions = [
  { file: 'init.md', line: '1. What do you do?', field: 'Role' },
  { file: 'init.md', line: '4. How do you want answers: length, language, how much explanation?', field: 'How I want answers' },
  { file: 'init.md', line: '5. What must the assistant never touch or share: paths, systems, client work, anything private?', field: 'Never touch' },
  { file: 'complete-init.md', line: '1. Which tools and shared places do you use every day? Names only.', field: 'Stack' },
];
const profileOwner = Object.fromEntries(profileQuestions.map(({ field, file }) => [field, file]));
const PROFILE_SAVE = /Saved to:.*`00-Meta\/Profile\.md`, section `## ([^`]+)`/;

async function procedureFiles() {
  return {
    'init.md': await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/init.md'), 'utf8'),
    'complete-init.md': await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/complete-init.md'), 'utf8'),
    'first-use.md': await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8'),
  };
}

function profileQuestionProblems(files) {
  return profileQuestions
    .filter(({ file, line }) => !files[file].split('\n').includes(line))
    .map(({ file, field }) => `${file} does not ask the Profile question for ${field} with its exact wording`);
}

// Every "Saved to" line that names a Profile section, with the procedure file it came from.
function profileSaves(files) {
  return Object.entries(files).flatMap(([file, text]) => text.split('\n')
    .map((line) => line.match(PROFILE_SAVE))
    .filter(Boolean)
    .map((match) => ({ file, field: match[1] })));
}

function profileOwnerProblems(files) {
  const saves = profileSaves(files);
  const problems = [];
  for (const field of Object.keys(profileOwner)) {
    const owners = saves.filter((save) => save.field === field).map((save) => save.file);
    if (owners.length !== 1 || owners[0] !== profileOwner[field]) problems.push(`${field} is saved by ${owners.join(', ') || 'nothing'}; expected only ${profileOwner[field]}`);
  }
  for (const save of saves) {
    if (!(save.field in profileOwner)) problems.push(`${save.field} is a Profile section with no owner (${save.file})`);
  }
  return problems;
}

test('each Profile question is asked with its exact wording in the procedure that owns the field', async () => {
  const files = await procedureFiles();
  assert.deepEqual(profileQuestionProblems(files), []);
  const renamed = { ...files, 'init.md': files['init.md'].replace('1. What do you do?', '1. What is your role?') };
  assert.deepEqual(profileQuestionProblems(renamed), ['init.md does not ask the Profile question for Role with its exact wording']);
});

test('each Profile field is saved by exactly one question, in its owner procedure', async () => {
  assert.deepEqual(profileOwnerProblems(await procedureFiles()), []);
});

test('the owner check fires when a second question saves a Profile field (positive control)', async () => {
  const files = await procedureFiles();
  const doubled = { ...files, 'complete-init.md': `${files['complete-init.md']}\n   - Saved to: \`00-Meta/Profile.md\`, section \`## Role\`.\n` };
  assert.ok(profileOwnerProblems(doubled).some((problem) => problem.startsWith('Role is saved by')));
});

test('Profile.md names the procedure that fills each field', async () => {
  const profile = await readFile(path.join(sourceRoot, 'template/00-Meta/Profile.md'), 'utf8');
  for (const { field, file } of profileQuestions) {
    const body = profile.split(`## ${field}\n`)[1]?.split('\n## ')[0] ?? '';
    assert.ok(body.includes(file), `Profile.md section ${field} names ${file}`);
  }
});

test('first-use section 2a names both init.md and complete-init.md, and a missing pointer is rejected', async () => {
  const text = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/first-use.md'), 'utf8');
  const section = text.slice(text.indexOf('## 2a. Profile'), text.indexOf('## 3. Approve'));
  assert.ok(section.includes('`init.md`') && section.includes('`complete-init.md`'));
  assert.throws(() => assertFirstUseProfile(text.replace('`complete-init.md`', 'omitted')), /must point at complete-init.md/);
});

// Round 2 (E): first-use.md is one of the files the owner check reads. Its section 2a pointer names the owners but is not a save.
test('the owner check reads first-use.md, and the section 2a pointer is not counted as a save (E)', async () => {
  const files = await procedureFiles();
  assert.deepEqual(profileSaves({ 'first-use.md': files['first-use.md'] }), [], 'the 2a pointer must not count as a question');
  assert.deepEqual(profileOwnerProblems(files), []);
});

test('a second Profile question in first-use.md is caught by the owner check (E positive control)', async () => {
  const files = await procedureFiles();
  const second = '4. How do you want answers: length, language, how much explanation?\n   - Saved to: `00-Meta/Profile.md`, section `## How I want answers`.\n';
  const planted = { ...files, 'first-use.md': `${files['first-use.md']}\n${second}` };
  assert.ok(profileOwnerProblems(planted).some((problem) => problem.startsWith('How I want answers is saved by')), 'a second profile question in first-use is caught');
});
