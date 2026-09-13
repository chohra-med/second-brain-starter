import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { appliedReceipt, cleanup, consumerRoot, fixtureBytes, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const inlineLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const referenceDefinitionPattern = /^\[([^\]]+)\]:\s*(\S+)/gm;
const referenceLinkPattern = /\[([^\]]+)\]\[([^\]]*)\]/g;

async function validateDashboardLinks(markdown, root) {
  const definitions = new Map([...markdown.matchAll(referenceDefinitionPattern)].map((match) => [match[1].toLowerCase(), match[2]]));
  const rawDestinations = [...markdown.matchAll(inlineLinkPattern)].map((match) => match[1]);
  for (const match of markdown.matchAll(referenceLinkPattern)) {
    const label = (match[2] || match[1]).toLowerCase();
    assert.ok(definitions.has(label), `Dashboard reference link has no destination: ${label}`);
    rawDestinations.push(definitions.get(label));
  }
  assert.ok(rawDestinations.length > 0, 'Home.md must contain Markdown links');
  const canonicalRoot = await realpath(root);
  const destinations = [];

  for (const rawDestination of rawDestinations) {
    if (rawDestination.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(rawDestination)) continue;
    const destination = rawDestination.split(/[?#]/, 1)[0];
    assert.match(destination, /\.md$/i, `Dashboard local link is not Markdown: ${rawDestination}`);
    destinations.push(destination);
    const resolved = path.resolve(root, destination);
    const relative = path.relative(root, resolved);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `Dashboard link escapes its root: ${destination}`);
    const actual = await realpath(resolved).catch(() => null);
    const actualRelative = actual ? path.relative(canonicalRoot, actual) : null;
    assert.ok(!actual || (actualRelative && !actualRelative.startsWith(`..${path.sep}`) && actualRelative !== '..' && !path.isAbsolute(actualRelative)), `Dashboard link resolves outside its root: ${destination}`);
    const destinationStat = actual ? await stat(actual) : null;
    assert.ok(destinationStat?.isFile(), `Dashboard link is not a regular file: ${destination}`);
  }

  return destinations;
}

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
  const orderedMarkers = ['## Start here', '## One project', '## Daily loop', '**Focus:**', '**Context:**', '**Do:**', '**Close:**', '**Review:**', '## Operating route', '## Organise and retain'];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const markerIndex = home.indexOf(marker);
    assert.ok(markerIndex > previousIndex, `Dashboard marker missing or out of order: ${marker}`);
    previousIndex = markerIndex;
  }

  const expectedDestinations = [
    '00-Meta/AGENTS.md',
    '00-Meta/Daily-Task-Plan.md',
    '00-Meta/Decisions.md',
    '01-Projects/Selected-Project/FACTS.md',
    '01-Projects/Selected-Project/roadmap.md',
    '01-Projects/Selected-Project/Decisions.md',
    '01-Projects/Selected-Project/progress.md',
    '02-Areas/Areas.md',
    '03-Resources/PARA-CODE.md',
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

test('consumer upgrade exposes a personalized managed file as a conflict and leaves it untouched', async (t) => {
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
  assert.match(upgradePlan.stdout, /^CONFLICT\t01-Projects\/Selected-Project\/FACTS\.md\tundo=none$/m);
  const upgradeDigest = planDigest(upgradePlan.stdout);
  assert.ok(upgradeDigest, upgradePlan.stdout);
  const rejected = await runCli(['upgrade', '--target', target, '--apply', upgradeDigest], { checkout });
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.equal(await readFile(personalizedPath, 'utf8'), '# Personal facts\n');
});
