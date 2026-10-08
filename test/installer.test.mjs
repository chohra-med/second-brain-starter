import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { appliedReceipt, cleanup, consumerRoot, fixtureBytes, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const expectedSeedDestinations = [
  '00-Meta/Daily-Task-Plan.md',
  '00-Meta/Decisions.md',
  '01-Projects/Selected-Project/FACTS.md',
  '01-Projects/Selected-Project/Decisions.md',
  '01-Projects/Selected-Project/progress.md',
  '01-Projects/Selected-Project/roadmap.md',
  '02-Areas/Areas.md',
  '03-Resources/Extensions.md',
  '05-Daily/daily-template.md',
];

const indexDestinations = [
  "00-Meta/README.md",
  "01-Projects/README.md",
  "01-Projects/Selected-Project/README.md",
  "03-Resources/README.md",
  "03-Resources/Procedures/README.md"
];

const inlineLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const referenceDefinitionPattern = /^\[([^\]]+)\]:\s*(\S+)/gm;
const referenceLinkPattern = /\[([^\]]+)\]\[([^\]]*)\]/g;

async function validateDashboardLinks(markdown, root, containmentRoot = root) {
  const definitions = new Map([...markdown.matchAll(referenceDefinitionPattern)].map((match) => [match[1].toLowerCase(), match[2]]));
  const rawDestinations = [...markdown.matchAll(inlineLinkPattern)].map((match) => match[1]);
  const usedDefinitions = new Set();
  for (const match of markdown.matchAll(referenceLinkPattern)) {
    const label = (match[2] || match[1]).toLowerCase();
    assert.ok(definitions.has(label), `Dashboard reference link has no destination: ${label}`);
    rawDestinations.push(definitions.get(label));
    usedDefinitions.add(label);
  }
  const markdownWithoutDefinitions = markdown.replace(referenceDefinitionPattern, '');
  for (const [label, destination] of definitions) {
    if (usedDefinitions.has(label)) continue;
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\[${escapedLabel}\\](?!\\s*[[(])`, 'i').test(markdownWithoutDefinitions)) {
      rawDestinations.push(destination);
    }
  }
  assert.ok(rawDestinations.length > 0, 'Home.md must contain Markdown links');
  const canonicalRoot = await realpath(containmentRoot);
  const destinations = [];

  for (const rawDestination of rawDestinations) {
    if (rawDestination.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(rawDestination)) continue;
    const destination = rawDestination.split(/[?#]/, 1)[0];
    assert.match(destination, /\.md$/i, `Dashboard local link is not Markdown: ${rawDestination}`);
    destinations.push(destination);
    const resolved = path.resolve(root, destination);
    const relative = path.relative(containmentRoot, resolved);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `Dashboard link escapes its root: ${destination}`);
    const actual = await realpath(resolved).catch(() => null);
    const actualRelative = actual ? path.relative(canonicalRoot, actual) : null;
    assert.ok(!actual || (actualRelative && !actualRelative.startsWith(`..${path.sep}`) && actualRelative !== '..' && !path.isAbsolute(actualRelative)), `Dashboard link resolves outside its root: ${destination}`);
    const destinationStat = actual ? await stat(actual) : null;
    assert.ok(destinationStat?.isFile(), `Dashboard link is not a regular file: ${destination}`);
  }

  return destinations;
}

function assertIcmContract(markdown) {
  for (const field of ['Owner', 'Context', 'Effects', 'Evidence', 'Continuity', 'Learning']) {
    assert.match(markdown, new RegExp(`^- ${field}: .+$`, 'm'), `ICM contract is missing ${field}`);
  }
  assert.match(markdown, /only files the task needs/i, 'ICM context must be bounded');
  assert.match(markdown, /recovery path/i, 'ICM continuity must name recovery');
  assert.match(markdown, /failure case/i, 'ICM evidence must be falsifiable');
}

const icmSource = 'template/shared-skills/second-brain-icm/SKILL.md';
const icmDestinations = ['.agents/skills/second-brain-icm/SKILL.md', '.claude/skills/second-brain-icm/SKILL.md'];

function assertIcmProjection(manifest, hash) {
  const entries = manifest.entries.filter((entry) => entry.source === icmSource || icmDestinations.includes(entry.destination));
  assert.deepEqual(entries.map((entry) => entry.destination).sort(), [...icmDestinations].sort(), 'ICM destination set must be exact');
  for (const entry of entries) assert.deepEqual(entry, { source: icmSource, destination: entry.destination, sha256: hash, mergeKind: 'managed-file' });
}

function assertIcmRoute(meta, skill) {
  assert.match(meta, /For system architecture changes.*use `second-brain-icm` before editing/);
  assert.match(meta, /If native skill invocation is unavailable, manually read/);
  assert.match(meta, /Ordinary note work uses the selected-project route above without loading architecture safeguards/);
  assert.match(skill, /The method owner is the bundled `icm-architect` skill/);
}

test('the ICM contract installs exactly, stays bounded, and rejects missing inputs or evidence', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const entry = manifest.entries.find((candidate) => candidate.destination === '03-Resources/Procedures/context.md');
  assert.ok(entry, 'context procedure must be in the install manifest');
  const source = await readFile(path.join(sourceRoot, entry.source));
  assert.equal((await import('node:crypto')).createHash('sha256').update(source).digest('hex'), entry.sha256);
  const skill = await readFile(path.join(sourceRoot, icmSource));
  const skillHash = (await import('node:crypto')).createHash('sha256').update(skill).digest('hex');
  assertIcmProjection(manifest, skillHash);
  for (const destination of icmDestinations) {
    assert.throws(() => assertIcmProjection({ entries: manifest.entries.filter((entry) => entry.destination !== destination) }, skillHash), /ICM destination set must be exact/);
  }
  const contextProcedure = source.toString('utf8');
  const contract = skill.toString('utf8');
  assertIcmContract(contract);
  assert.match(contextProcedure, /use the `second-brain-icm` skill/, 'context procedure must point at the bindings skill');
  assert.doesNotMatch(contextProcedure, /^- Owner: /m, 'the change contract has one home, the bindings skill');

  const metaRoute = await readFile(path.join(sourceRoot, 'template/00-Meta/AGENTS.md'), 'utf8');
  assertIcmRoute(metaRoute, skill.toString('utf8'));
  assert.throws(() => assertIcmRoute(metaRoute.replace('use `second-brain-icm` before editing', 'skip maintenance'), skill.toString('utf8')), /AssertionError/);
  assert.throws(() => assertIcmRoute(metaRoute.replace('If native skill invocation is unavailable, manually read', 'No manual route'), skill.toString('utf8')), /AssertionError/);
  assert.throws(() => assertIcmRoute(metaRoute, skill.toString('utf8').replace('The method owner is the bundled `icm-architect` skill', 'No method owner')), /AssertionError/);
  const projectPrerequisite = /The selected project's own `AGENTS\.md`, `RULES\.md`, `CONTRIBUTING\.md`, relevant `ai_rules\/`, memory bank, and `README\.md` before diagnosing or changing its files/;
  assert.match(metaRoute, projectPrerequisite, 'selected-project rules must precede project facts');
  assert.ok(metaRoute.search(projectPrerequisite) < metaRoute.indexOf('`01-Projects/Selected-Project/FACTS.md`'));
  assert.throws(() => assert.match(metaRoute.replace(projectPrerequisite, ''), projectPrerequisite), /AssertionError/);

  const route = await readFile(path.join(sourceRoot, 'template/shared-skills/second-brain-context/SKILL.md'), 'utf8');
  assert.match(route, /03-Resources\/Procedures\/context\.md/);

  const root = await consumerRoot('second-brain-icm-');
  cleanup(t, root);
  const target = path.join(root, 'Project Space');
  await mkdir(target);
  const planned = await runCli(['init', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const applied = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, undefined, applied.stdout);
  const installed = await readFile(path.join(target, entry.destination));
  assert.deepEqual(installed, source);
  assertIcmContract((await readFile(path.join(target, icmDestinations[0]))).toString('utf8'));
  for (const destination of icmDestinations) assert.deepEqual(await readFile(path.join(target, destination)), skill);
  assertIcmRoute(await readFile(path.join(target, '00-Meta/AGENTS.md'), 'utf8'), skill.toString('utf8'));
  await validateDashboardLinks(contextProcedure, path.join(target, '03-Resources/Procedures'), target);
  const installedRoute = await readFile(path.join(target, '.agents/skills/second-brain-context/SKILL.md'), 'utf8');
  assert.equal(installedRoute, route);
  const learningSource = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures/learning-and-scaling.md'));
  const learningTarget = await readFile(path.join(target, '03-Resources/Procedures/learning-and-scaling.md'));
  assert.deepEqual(learningTarget, learningSource);
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);

  for (const field of ['Owner', 'Context', 'Effects', 'Evidence', 'Continuity', 'Learning']) {
    assert.throws(() => assertIcmContract(contract.replace(new RegExp(`^- ${field}:.*\\n`, 'm'), '')), new RegExp(`ICM contract is missing ${field}`));
  }
  for (const destination of icmDestinations) {
    await writeFile(path.join(target, destination), 'changed skill\n');
    const corrupt = await runCli(['verify', '--target', target]);
    assert.equal(corrupt.code, 1, corrupt.stdout);
    assert.ok(corrupt.stdout.includes(`CORRUPT\t${destination}`), corrupt.stdout);
    await writeFile(path.join(target, destination), skill);
  }
  assert.equal((await runCli(['verify', '--target', target])).code, undefined);
  const checkout = path.join(root, 'corrupt source');
  await cp(sourceRoot, checkout, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}.git`) });
  await writeFile(path.join(checkout, icmSource), 'changed source\n');
  const rejected = await runCli(['init', '--target', target], { checkout });
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /SOURCE_HASH_MISMATCH/);
});

test('the public manifest classifies every editable record as a seed file', async () => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const seedDestinations = manifest.entries.filter((entry) => entry.mergeKind === 'seed-file').map((entry) => entry.destination).sort();
  assert.deepEqual(seedDestinations, [...expectedSeedDestinations].sort());
  for (const entry of manifest.entries.filter((entry) => !expectedSeedDestinations.includes(entry.destination))) {
    assert.notEqual(entry.mergeKind, 'seed-file', `Unexpected editable seed: ${entry.destination}`);
  }
});

test('consumer installs into a directory with spaces, verifies, no-ops, and rolls back only its receipt', async (t) => {
  const root = await consumerRoot();
  cleanup(t, root);
  const target = path.join(root, 'Project Space');
  await mkdir(target);
  await writeFile(path.join(target, 'keep.md'), 'consumer-owned\n');

  const planned = await runCli(['init', '--target', target]);
  assert.equal(planned.code, undefined);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  assert.match(planned.stdout, /^CREATE\tHome\.md\tundo=remove-created-file$/m);

  const applied = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, undefined, applied.stdout);
  const receipt = appliedReceipt(applied.stdout);
  assert.ok(receipt, applied.stdout);

  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);

  const repeatPlan = await runCli(['init', '--target', target]);
  const repeatDigest = planDigest(repeatPlan.stdout);
  assert.ok(repeatDigest, repeatPlan.stdout);
  assert.match(repeatPlan.stdout, /^IDENTICAL\tHome\.md\tundo=none$/m);
  const repeat = await runCli(['init', '--target', target, '--apply', repeatDigest]);
  assert.equal(repeat.code, undefined, repeat.stdout);
  assert.match(repeat.stdout, /No changes needed/);

  const rolledBack = await runCli(['rollback', '--target', target, '--receipt', receipt]);
  assert.equal(rolledBack.code, undefined, rolledBack.stdout);
  assert.match(rolledBack.stdout, /ROLLED_BACK\tHome\.md/);
  await assert.rejects(readFile(path.join(target, 'Home.md')));
  assert.equal(await readFile(path.join(target, 'keep.md'), 'utf8'), 'consumer-owned\n');
});

test('installed Home is a complete operating dashboard with valid contained links and exact drift detection', async (t) => {
  const root = await consumerRoot('second-brain-dashboard-');
  cleanup(t, root);
  const target = path.join(root, 'Dashboard Project');
  await mkdir(target);

  const planned = await runCli(['init', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const applied = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, undefined, applied.stdout);

  const homePath = path.join(target, 'Home.md');
  const home = await readFile(homePath, 'utf8');
  const orderedMarkers = ['## Start my first result', '## Continue my project', '## Current records', '## When a need repeats', '## More'];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const markerIndex = home.indexOf(marker);
    assert.ok(markerIndex > previousIndex, `Dashboard marker missing or out of order: ${marker}`);
    previousIndex = markerIndex;
  }

  const expectedDestinations = [
    ...indexDestinations,
    '00-Meta/AGENTS.md',
    '00-Meta/Daily-Task-Plan.md',
    '00-Meta/Decisions.md',
    '01-Projects/Selected-Project/FACTS.md',
    '01-Projects/Selected-Project/roadmap.md',
    '01-Projects/Selected-Project/Decisions.md',
    '01-Projects/Selected-Project/progress.md',
    '02-Areas/Areas.md',
  '03-Resources/Extensions.md',
    '03-Resources/PARA-CODE.md',
    '03-Resources/Procedures/first-use.md',
    '03-Resources/Procedures/extend.md',
    '03-Resources/Procedures/context.md',
    '03-Resources/Procedures/capture.md',
    '03-Resources/Procedures/close.md',
    '03-Resources/Procedures/review.md',
    '03-Resources/Procedures/learning-and-scaling.md',
    '04-Archives/Projects/Archive-Guide.md',
    '05-Daily/daily-template.md',
  ];
  const installedDestinations = await validateDashboardLinks(home, target);
  const templateHome = await readFile(path.join(sourceRoot, 'template', 'Home.md'), 'utf8');
  assert.equal(home, templateHome);
  for (const destination of ['03-Resources/PARA-CODE.md', '03-Resources/Procedures/context.md', '03-Resources/Procedures/close.md']) {
    assert.deepEqual(await readFile(path.join(target, destination)), await readFile(path.join(sourceRoot, 'template', destination)));
  }

  const templateDestinations = await validateDashboardLinks(templateHome, path.join(sourceRoot, 'template'));
  assert.deepEqual([...new Set(installedDestinations)].sort(), expectedDestinations.sort());
  assert.deepEqual([...new Set(templateDestinations)].sort(), expectedDestinations.sort());

  await assert.rejects(
    validateDashboardLinks(`${home}\n[Broken](03-Resources/missing.md)\n`, target),
    /Dashboard link is not a regular file: 03-Resources\/missing\.md/,
  );
  await assert.rejects(
    validateDashboardLinks(`${home}\n[Broken section](03-Resources/missing.md#section)\n`, target),
    /Dashboard link is not a regular file: 03-Resources\/missing\.md/,
  );
  await assert.rejects(
    validateDashboardLinks(`${home}\n[Wrong type](03-Resources/missing.txt)\n`, target),
    /Dashboard local link is not Markdown: 03-Resources\/missing\.txt/,
  );
  await assert.rejects(
    validateDashboardLinks(`${home}\n[Broken reference][missing]\n\n[missing]: 03-Resources/missing.md\n`, target),
    /Dashboard link is not a regular file: 03-Resources\/missing\.md/,
  );
  await assert.rejects(
    validateDashboardLinks(`${home}\n[Escaping shortcut]\n\n[Escaping shortcut]: ..\/outside.md\n`, target),
    /Dashboard link escapes its root: \.\.\/outside\.md/,
  );
  await assert.rejects(
    validateDashboardLinks(`${home}\n[Escape](..\/outside.md)\n`, target),
    /Dashboard link escapes its root: \.\.\/outside\.md/,
  );
  if (process.platform !== 'win32') {
    const outsidePath = path.join(root, 'outside.md');
    const linkedPath = path.join(target, '03-Resources', 'outside.md');
    await writeFile(outsidePath, 'outside\n');
    await symlink(outsidePath, linkedPath);
    await assert.rejects(
      validateDashboardLinks(`${home}\n[Symlink escape](03-Resources/outside.md)\n`, target),
      /Dashboard link resolves outside its root: 03-Resources\/outside\.md/,
    );
  }

  const clean = await runCli(['verify', '--target', target]);
  assert.equal(clean.code, undefined, clean.stdout);
  assert.match(clean.stdout, /Verification: OK/);
  await writeFile(homePath, `${home}\nconsumer edit\n`);
  const drifted = await runCli(['verify', '--target', target]);
  assert.equal(drifted.code, 1, drifted.stdout);
  assert.match(drifted.stdout, /^CORRUPT\tHome\.md\tManaged destination hash mismatch: Home\.md$/m);
  assert.match(drifted.stdout, /Verification: FAILED/);
  await writeFile(homePath, home);
  const restored = await runCli(['verify', '--target', target]);
  assert.equal(restored.code, undefined, restored.stdout);
  assert.match(restored.stdout, /Verification: OK/);
});

test('consumer rejects unmanaged CRLF loaders and existing collisions without changing selected files', async (t) => {
  const root = await consumerRoot();
  cleanup(t, root);
  const target = path.join(root, 'existing-project');
  await mkdir(target);
  const loader = await fixtureBytes('unmanaged-loader-crlf.md');
  const crlfLoader = Buffer.from(loader.toString('utf8').replaceAll('\n', '\r\n'));
  await writeFile(path.join(target, 'AGENTS.md'), crlfLoader);
  await writeFile(path.join(target, 'Home.md'), 'my existing home\r\n');

  const planned = await runCli(['init', '--target', target]);
  assert.equal(planned.code, undefined, planned.stdout);
  assert.match(planned.stdout, /^CONFLICT\tAGENTS\.md\tundo=none$/m);
  assert.match(planned.stdout, /^CONFLICT\tHome\.md\tundo=none$/m);
  assert.match(planned.stdout, /Manual resolution required: AGENTS\.md/);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);

  const rejected = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), crlfLoader);
  assert.equal(await readFile(path.join(target, 'Home.md'), 'utf8'), 'my existing home\r\n');
});

test('consumer upgrade preserves a personalized seed while updating managed files', async (t) => {
  const root = await consumerRoot();
  cleanup(t, root);
  const checkout = path.join(root, 'starter copy');
  const target = path.join(root, 'consumer project');
  await cp(sourceRoot, checkout, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}.git`) });
  await mkdir(target);

  const initialPlan = await runCli(['init', '--target', target], { checkout });
  const initialDigest = planDigest(initialPlan.stdout);
  assert.ok(initialDigest, initialPlan.stdout);
  const initialApply = await runCli(['init', '--target', target, '--apply', initialDigest], { checkout });
  assert.equal(initialApply.code, undefined, initialApply.stdout);

  const personalizedPath = path.join(target, '01-Projects', 'Selected-Project', 'FACTS.md');
  await writeFile(personalizedPath, '# Personal facts\n');
  const manifestPath = path.join(checkout, 'template-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const homeEntry = manifest.entries.find((entry) => entry.destination === 'Home.md');
  const updatedHome = Buffer.from('# Updated home\n');
  await writeFile(path.join(checkout, 'template', 'Home.md'), updatedHome);
  homeEntry.sha256 = (await import('node:crypto')).createHash('sha256').update(updatedHome).digest('hex');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const upgradePlan = await runCli(['upgrade', '--target', target], { checkout });
  assert.equal(upgradePlan.code, undefined, upgradePlan.stdout);
  assert.match(upgradePlan.stdout, /^PERSONALIZED\t01-Projects\/Selected-Project\/FACTS\.md\tundo=none$/m);
  assert.match(upgradePlan.stdout, /^MANAGED-UPDATE\tHome\.md\tundo=restore-preimage$/m);
  const upgradeDigest = planDigest(upgradePlan.stdout);
  assert.ok(upgradeDigest, upgradePlan.stdout);
  const applied = await runCli(['upgrade', '--target', target, '--apply', upgradeDigest], { checkout });
  assert.equal(applied.code, undefined, applied.stdout);
  assert.equal(await readFile(personalizedPath, 'utf8'), '# Personal facts\n');
  assert.deepEqual(await readFile(path.join(target, 'Home.md')), updatedHome);
  const verified = await runCli(['verify', '--target', target], { checkout });
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /^PERSONALIZED\t01-Projects\/Selected-Project\/FACTS\.md$/m);
  assert.match(verified.stdout, /Verification: OK/);
});

function assertIndexManifest(manifest) {
  for (const destination of indexDestinations) {
    const entries = manifest.entries.filter((entry) => entry.destination === destination);
    assert.equal(entries.length, 1, `Missing or duplicate index: ${destination}`);
    assert.equal(entries[0].source, `template/${destination}`);
    assert.equal(entries[0].mergeKind, 'managed-file');
  }
}

test('installed indexes and shared imports preserve exact source bytes and detect managed drift', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  assertIndexManifest(manifest);
  for (const destination of indexDestinations) {
    assert.throws(() => assertIndexManifest({ entries: manifest.entries.filter((entry) => entry.destination !== destination) }), /Missing or duplicate index/);
  }
  const root = await consumerRoot('second-brain-indexes-');
  cleanup(t, root);
  const target = path.join(root, 'Selected Project');
  await mkdir(target);
  const planned = await runCli(['init', '--target', target]);
  const applied = await runCli(['init', '--target', target, '--apply', planDigest(planned.stdout)]);
  assert.equal(applied.code, undefined, applied.stdout);
  for (const destination of [...indexDestinations, 'AGENTS.md', 'CLAUDE.md', '00-Meta/AGENTS.md']) {
    assert.deepEqual(await readFile(path.join(target, destination)), await readFile(path.join(sourceRoot, 'template', destination)));
  }
  for (const destination of indexDestinations) {
    const bytes = await readFile(path.join(target, destination), 'utf8');
    await validateDashboardLinks(bytes, path.dirname(path.join(target, destination)), target);
  }
  const loader = await readFile(path.join(target, 'CLAUDE.md'), 'utf8');
  const expectedLoader = '<!-- second-brain:loader:start -->\n@AGENTS.md\n<!-- second-brain:loader:end -->\n';
  assert.equal(loader, expectedLoader);
  assert.throws(() => assert.equal(loader.replace('@AGENTS.md', '@missing.md'), expectedLoader));
  assert.throws(() => assert.equal(loader.replace('@AGENTS.md', '@AGENTS.md\nextra'), expectedLoader));
  await assert.rejects(validateDashboardLinks('[Broken](missing.md)', target), /not a regular file/);
  const indexPath = path.join(target, indexDestinations[0]);
  const clean = await readFile(indexPath);
  await writeFile(indexPath, Buffer.concat([clean, Buffer.from('consumer edit\n')]));
  const drift = await runCli(['verify', '--target', target]);
  assert.equal(drift.code, 1, drift.stdout);
  assert.match(drift.stdout, /CORRUPT\t00-Meta\/README.md/);
  await writeFile(indexPath, clean);
  const restored = await runCli(['verify', '--target', target]);
  assert.equal(restored.code, undefined, restored.stdout);
});

test('manifest rejects a malformed managed loader block', async (t) => {
  const root = await consumerRoot('second-brain-loader-control-');
  cleanup(t, root);
  const checkout = path.join(root, 'starter');
  await cp(sourceRoot, checkout, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}.git`) });
  const manifest = JSON.parse(await readFile(path.join(checkout, 'template-manifest.json'), 'utf8'));
  const entry = manifest.entries.find((candidate) => candidate.destination === 'CLAUDE.md');
  const bytes = Buffer.from('@AGENTS.md\n<!-- second-brain:loader:end -->\n');
  await writeFile(path.join(checkout, entry.source), bytes);
  entry.sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const { validateManifest } = await import('../lib/installer.mjs');
  await assert.rejects(() => validateManifest({ manifest, sourceRoot: checkout }), /exactly one well-ordered/);
});


test('recovery and close require actual artifact evidence and a separate new chat', async () => {
  for (const [owner, requirements] of [
    ['context.md', [
      'actual artifact path and check evidence',
      'Open the artifact to confirm the claimed evidence',
      'name any mismatch as Conflict before proceeding',
      'Ask only for information still missing from these owners',
      'Use a genuinely separate new chat',
      'A same-chat reread does not establish recovery',
      'Native automatic loading remains unverified',
    ]],
    ['close.md', [
      'including the actual useful artifact path',
      'compare the artifact content against the saved facts and intended outcome',
      'Installer integrity verification alone does not establish usefulness',
      'A completed action without evidence stays Open or In progress',
      'Request a separate new chat',
      'Preserve unknowns and report conflicts',
      'manual new-chat recovery does not prove native automatic loading',
    ]],
  ]) {
    const text = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures', owner), 'utf8');
    const check = (draft) => {
      for (const requirement of requirements) assert.ok(draft.includes(requirement), `Missing ${owner} boundary: ${requirement}`);
    };
    check(text);
    for (const requirement of requirements) {
      assert.throws(() => check(text.replace(requirement, 'omitted boundary')), /Missing .* boundary/);
      check(text);
    }
  }
});

const bundledMethod = 'icm-architect';
const bundledMethodSource = `template/shared-skills/${bundledMethod}`;
const bundledMethodClients = ['.agents', '.claude'];
// SHA-256 of each file at upstream commit e16cafe6a664dcf6d787a726b452adba77d913f4. The bundle ships unmodified.
const bundledMethodFiles = new Map([
  ['LICENSE', 'e13cd56a64956720629206c84499871594585bb3e17b6ef01ccca570cf38ce1d'],
  ['README.md', '9399c65c911565537e9665b619417573f2cbf46b3cb59428f3bdf8014a81402f'],
  ['SKILL.md', '8a0d62444f047e84aa02ca1728a5dc3848dd06afa32f9e66bf3225352fe67a38'],
  ['assets/templates/CLAUDE.md', '4a3b8a05a4469b78b703f2e5593fd977097038fe24c39c7cb7ca5bcf5aea6154'],
  ['assets/templates/CONTEXT.md', 'edc2c382d7559fa9232e8f93aef1c220d099f940f3668d937c47f9151196f1b2'],
  ['assets/templates/node.md', '28f94085722ae44f7c0c1483e051e87c4cae8c715afd86976db9b9ae656e8ca5'],
  ['assets/templates/object.md', '614bf1620533c2b0f48fde415caf3d0158b6b4847b80aa7e992b46a1bb1b1a3a'],
  ['assets/templates/process.md', '5e2481d15912d813f608e89d2e69e5f8e6c3bd21ebdcf4f7cbee5c4fc1a69433'],
  ['assets/templates/questionnaire.md', '47eeaa58318f87f443bc3937fcfa8166c6f225c36367698426edc85824980ee6'],
  ['assets/templates/schema.md', 'be96c82389d9d1d697a9767c601769bac8f71d7734ae8dd6ea4214d3958c40a0'],
  ['assets/templates/stage-CONTEXT.md', 'c689a6b4207c81f7c83219ef79ca268156841063ec25b686e5c07972822e31e3'],
  ['references/core.md', '4d1a8a415dc36250f3c0cad002be558d12ef63843396749b81106fbf52e5ba64'],
  ['references/forms.md', '4a3e68efcb5aac5803f46bebae499975337bc3ab9caf006e73bc32517284c73d'],
  ['references/reference-integrity.md', '1317824d70edb0db5561914940f3dff83ec706179e6d5d42c8794e9c52e89403'],
  ['references/system-map.md', 'd8f8f9d3e5be29ebc3d0ba072b6d5b95132723082ce3c0dc6bc3dc1153e27739'],
]);
const installedSkills = [
  'icm-architect',
  'second-brain-capture',
  'second-brain-close',
  'second-brain-context',
  'second-brain-icm',
  'second-brain-learning',
  'second-brain-review',
];

function assertBundledMethodProjection(manifest) {
  const expected = bundledMethodClients.flatMap((client) => [...bundledMethodFiles.keys()].map((file) => `${client}/skills/${bundledMethod}/${file}`)).sort();
  const entries = manifest.entries.filter((entry) => entry.source.startsWith(`${bundledMethodSource}/`) || entry.destination.includes(`/skills/${bundledMethod}/`));
  assert.deepEqual(entries.map((entry) => entry.destination).sort(), expected, 'bundled method destination set must be exact');
  for (const entry of entries) {
    const file = entry.source.slice(bundledMethodSource.length + 1);
    assert.deepEqual(entry, { source: entry.source, destination: entry.destination, sha256: bundledMethodFiles.get(file), mergeKind: 'managed-file' }, `bundled method entry differs from upstream: ${entry.destination}`);
  }
}

test('bundled icm-architect installs its LICENSE and SKILL.md unmodified into both client skill folders', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  assertBundledMethodProjection(manifest);
  for (const client of bundledMethodClients) {
    for (const file of ['LICENSE', 'SKILL.md']) {
      const destination = `${client}/skills/${bundledMethod}/${file}`;
      assert.throws(() => assertBundledMethodProjection({ entries: manifest.entries.filter((entry) => entry.destination !== destination) }), /destination set must be exact/);
    }
  }
  const skillNames = [...new Set(manifest.entries.map((entry) => entry.destination.match(/^\.(?:agents|claude)\/skills\/([^/]+)\//)?.[1]).filter(Boolean))].sort();
  assert.deepEqual(skillNames, installedSkills, 'installed skill set must be exact');
  const readme = await readFile(path.join(sourceRoot, 'README.md'), 'utf8');
  assert.match(readme, /seven local skills/);
  assert.match(readme, /seven shared skills/);
  assert.doesNotMatch(readme, /\bsix (?:local |shared )?skills\b/);

  const license = await readFile(path.join(sourceRoot, bundledMethodSource, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Jake Van Clief\n/);
  const attribution = await readFile(path.join(sourceRoot, 'ATTRIBUTION.md'), 'utf8');
  for (const required of ['Jake Van Clief', 'https://github.com/RinDig/icm-architect', 'e16cafe6a664dcf6d787a726b452adba77d913f4', 'MIT-licensed', 'copied unmodified', 'arXiv:2603.16021', 'does not imply endorsement']) {
    assert.ok(attribution.includes(required), `ATTRIBUTION.md is missing: ${required}`);
  }

  const root = await consumerRoot('second-brain-method-');
  cleanup(t, root);
  const target = path.join(root, 'Method Project');
  await mkdir(target);
  const planned = await runCli(['init', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const applied = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, undefined, applied.stdout);
  const { createHash } = await import('node:crypto');
  for (const client of bundledMethodClients) {
    for (const [file, upstreamHash] of bundledMethodFiles) {
      const installed = await readFile(path.join(target, client, 'skills', bundledMethod, ...file.split('/')));
      assert.deepEqual(installed, await readFile(path.join(sourceRoot, bundledMethodSource, ...file.split('/'))), `${client} ${file}`);
      assert.equal(createHash('sha256').update(installed).digest('hex'), upstreamHash, `${client} ${file} differs from upstream`);
    }
  }
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

const loopProcedures = ['capture.md', 'close.md', 'context.md', 'review.md', 'learning-and-scaling.md'];
const procedureContractHeadings = ['## Inputs', '## Outputs', '## Human check'];

function assertProcedureContract(name, markdown) {
  let previous = -1;
  for (const heading of procedureContractHeadings) {
    const lines = markdown.split('\n');
    const index = lines.indexOf(heading);
    assert.ok(index !== -1, `${name} is missing ${heading}`);
    assert.ok(index > previous, `${name} has ${heading} out of order`);
    assert.ok(lines.slice(index + 1).find((line) => line.trim() !== '' )?.startsWith('#') === false, `${name} has an empty ${heading}`);
    previous = index;
  }
}

test('each loop procedure states its inputs, outputs and human check', async () => {
  for (const name of loopProcedures) {
    const text = await readFile(path.join(sourceRoot, 'template/03-Resources/Procedures', name), 'utf8');
    assertProcedureContract(name, text);
    for (const heading of procedureContractHeadings) {
      assert.throws(() => assertProcedureContract(name, text.replace(`${heading}\n`, '')), new RegExp(`${name.replace('.', '\\.')} is missing ${heading}`));
    }
  }
});

const projectTemplateFiles = ['Decisions.md', 'FACTS.md', 'README.md', 'progress.md', 'roadmap.md'];

test('the project template folder ships the five seed project files as a managed stamp', async () => {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const entries = manifest.entries.filter((entry) => entry.destination.startsWith('03-Resources/_templates/'));
  assert.deepEqual(entries.map((entry) => entry.destination).sort(), projectTemplateFiles.map((file) => `03-Resources/_templates/project/${file}`).sort());
  for (const entry of entries) {
    assert.equal(entry.source, `template/${entry.destination}`);
    assert.equal(entry.mergeKind, 'managed-file');
  }
  const seeded = manifest.entries.filter((entry) => entry.destination.startsWith('01-Projects/Selected-Project/')).map((entry) => path.posix.basename(entry.destination)).sort();
  assert.deepEqual(seeded, [...projectTemplateFiles].sort(), 'the stamp must carry every seeded project file');
  const projectsMap = await readFile(path.join(sourceRoot, 'template/01-Projects/README.md'), 'utf8');
  assert.match(projectsMap, /\[Project template\]\(\.\.\/03-Resources\/_templates\/project\/README\.md\): a new project is a copy of that folder/);
});
