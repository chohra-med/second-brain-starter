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
  assert.match(skill, /installed owner `03-Resources\/Procedures\/context\.md`/);
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
  const contract = source.toString('utf8');
  assertIcmContract(contract);

  const metaRoute = await readFile(path.join(sourceRoot, 'template/00-Meta/AGENTS.md'), 'utf8');
  assertIcmRoute(metaRoute, skill.toString('utf8'));
  assert.throws(() => assertIcmRoute(metaRoute.replace('use `second-brain-icm` before editing', 'skip maintenance'), skill.toString('utf8')), /AssertionError/);
  assert.throws(() => assertIcmRoute(metaRoute.replace('If native skill invocation is unavailable, manually read', 'No manual route'), skill.toString('utf8')), /AssertionError/);
  assert.throws(() => assertIcmRoute(metaRoute, skill.toString('utf8').replace('03-Resources/Procedures/context.md', 'missing.md')), /AssertionError/);
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
  assertIcmContract(installed.toString('utf8'));
  for (const destination of icmDestinations) assert.deepEqual(await readFile(path.join(target, destination)), skill);
  assertIcmRoute(await readFile(path.join(target, '00-Meta/AGENTS.md'), 'utf8'), skill.toString('utf8'));
  await validateDashboardLinks(contract, path.join(target, '03-Resources/Procedures'), target);
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
