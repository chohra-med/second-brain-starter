import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { appliedReceipt, cleanup, consumerRoot, fixtureBytes, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

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
