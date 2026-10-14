import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');

async function cli(args, options = {}) {
  try {
    return await execFile(process.execPath, [bin, ...args], { cwd: sourceRoot, ...options });
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
  }
}

function digest(output) {
  return output.match(/^Plan digest: ([a-f0-9]{64})$/m)?.[1] ?? null;
}

function receipt(output) {
  return output.match(/^Applied receipt: (tx-[a-f0-9-]+)$/m)?.[1] ?? null;
}

test('non-interactive init plans without writing, applies only the exact target-bound digest, verifies, and rolls back', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-'));
  const target = path.join(root, 'target');
  const other = path.join(root, 'other');
  await mkdir(target);
  await mkdir(other);
  t.after(() => rm(root, { recursive: true, force: true }));

  const planned = await cli(['init', '--target', target]);
  assert.equal(planned.code, undefined);
  const planDigest = digest(planned.stdout);
  assert.ok(planDigest);
  await assert.rejects(readFile(path.join(target, 'Home.md')));

  const stale = await cli(['init', '--target', other, '--apply', planDigest]);
  assert.equal(stale.code, 1);
  assert.match(stale.stdout, /Plan digest did not match/);
  await assert.rejects(readFile(path.join(other, 'Home.md')));

  const applied = await cli(['init', '--target', target, '--apply', planDigest]);
  assert.equal(applied.code, undefined);
  const appliedReceipt = receipt(applied.stdout);
  assert.ok(appliedReceipt);
  assert.equal(await readFile(path.join(target, '.agents', 'skills', 'second-brain-context', 'SKILL.md'), 'utf8'), await readFile(path.join(sourceRoot, 'template', 'shared-skills', 'second-brain-context', 'SKILL.md'), 'utf8'));
  assert.equal(await readFile(path.join(target, '.claude', 'skills', 'second-brain-learning', 'SKILL.md'), 'utf8'), await readFile(path.join(sourceRoot, 'template', 'shared-skills', 'second-brain-learning', 'SKILL.md'), 'utf8'));

  const verified = await cli(['verify', '--target', target]);
  assert.equal(verified.code, undefined);
  assert.match(verified.stdout, /Verification: OK/);

  const rolledBack = await cli(['rollback', '--target', target, '--receipt', appliedReceipt]);
  assert.equal(rolledBack.code, undefined);
  await assert.rejects(readFile(path.join(target, 'Home.md')));
});

test('a nonempty unmanaged loader is appended to, and its own bytes stay in front of the block', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-loader-'));
  const target = path.join(root, 'target');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), '# Existing project rules\n');
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await cli(['init', '--target', target]);
  assert.equal(result.code, undefined);
  assert.match(result.stdout, /APPEND\tAGENTS.md/);
  assert.doesNotMatch(result.stdout, /CONFLICT\tAGENTS.md/);
  const plannedDigest = digest(result.stdout);
  assert.ok(plannedDigest);
  const applied = await cli(['init', '--target', target, '--apply', plannedDigest]);
  assert.equal(applied.code, undefined, applied.stdout);
  const loader = await readFile(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(loader.startsWith('# Existing project rules\n'));
  assert.match(loader, /<!-- second-brain:loader:start -->/);
});


test('absent selected target plans without writes and is created only by exact approval', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-absent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'new selected project');
  const other = path.join(root, 'other selected project');
  await writeFile(path.join(root, 'existing-note.md'), 'preserve this parent record\n');
  const before = await readdir(root);
  const planned = await cli(['init', '--target', target]);
  assert.equal(planned.code, undefined, planned.stdout);
  const planDigest = digest(planned.stdout);
  assert.ok(planDigest);
  await assert.rejects(stat(target), /ENOENT/);
  assert.deepEqual(await readdir(root), before);
  const wrong = await cli(['init', '--target', target, '--apply', '0'.repeat(64)]);
  assert.equal(wrong.code, 1);
  await assert.rejects(stat(target), /ENOENT/);
  assert.deepEqual(await readdir(root), before);
  const changed = await cli(['init', '--target', other, '--apply', planDigest]);
  assert.equal(changed.code, 1);
  await assert.rejects(stat(other), /ENOENT/);
  assert.deepEqual(await readdir(root), before);
  const applied = await cli(['init', '--target', target, '--apply', planDigest]);
  assert.equal(applied.code, undefined, applied.stdout);
  assert.ok((await stat(target)).isDirectory());
  const verified = await cli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
  const repeated = await cli(['init', '--target', target]);
  assert.match(repeated.stdout, /^IDENTICAL\tHome\.md\tundo=none$/m);
  const noop = await cli(['init', '--target', target, '--apply', digest(repeated.stdout)]);
  assert.equal(noop.code, undefined, noop.stdout);
  assert.match(noop.stdout, /No changes/);
  assert.equal(await readFile(path.join(root, 'existing-note.md'), 'utf8'), 'preserve this parent record\n');

  const empty = path.join(root, 'existing empty project');
  await mkdir(empty);
  const emptyPlan = await cli(['init', '--target', empty]);
  assert.equal(emptyPlan.code, undefined, emptyPlan.stdout);
  assert.deepEqual(await readdir(empty), []);
  const emptyApplied = await cli(['init', '--target', empty, '--apply', digest(emptyPlan.stdout)]);
  assert.equal(emptyApplied.code, undefined, emptyApplied.stdout);
});

test('the CLI prints the version recorded in VERSION, package.json and the manifest', async () => {
  const version = (await readFile(path.join(sourceRoot, 'VERSION'), 'utf8')).trim();
  assert.match(version, /^v\d+\.\d+\.\d+$/);
  const bare = version.slice(1);
  assert.equal(JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')).version, bare);
  assert.equal(JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8')).metadata.templateVersion, bare);
  const printed = await cli(['--help']);
  assert.equal(printed.code, undefined, printed.stderr);
  assert.equal(printed.stdout.split(/\r?\n/)[0], `Second Brain Starter ${bare}`);
});

test('upgrade names both versions, verify labels a local edit MODIFIED, and verify --adopt accepts it under a receipt that rolls back', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-adopt-'));
  const target = path.join(root, 'target');
  await mkdir(target);
  t.after(() => rm(root, { recursive: true, force: true }));
  const planned = await cli(['init', '--target', target]);
  assert.equal((await cli(['init', '--target', target, '--apply', digest(planned.stdout)])).code, undefined);
  const version = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8')).metadata.templateVersion;

  const upgrade = await cli(['upgrade', '--target', target]);
  assert.match(upgrade.stdout, new RegExp(`^Versions: installed ${version.replace(/\./g, '\\.')} -> available ${version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(upgrade.stdout, /^Summary: \d+ IDENTICAL$/m);

  const skill = path.join(target, '.claude', 'skills', 'second-brain-context', 'SKILL.md');
  await writeFile(skill, `${await readFile(skill, 'utf8')}Local note.\n`);
  const modified = await cli(['verify', '--target', target]);
  assert.equal(modified.code, 1);
  assert.match(modified.stdout, /^Manifest: this CLI expects template \S+ \(manifest [a-f0-9]{64}\); installed \S+ \(manifest [a-f0-9]{64}\)$/m);
  assert.match(modified.stdout, /^MODIFIED\t\.claude\/skills\/second-brain-context\/SKILL\.md\t.*verify --adopt \.claude\/skills\/second-brain-context\/SKILL\.md$/m);
  assert.match(modified.stdout, /^DIVERGED\t\.claude\/skills\/second-brain-context\/SKILL\.md\t\.agents\/skills\/second-brain-context\/SKILL\.md\t/m);

  const adoptPlan = await cli(['verify', '--target', target, '--adopt', '.claude/skills/second-brain-context/SKILL.md']);
  assert.equal(adoptPlan.code, undefined, adoptPlan.stdout);
  assert.match(adoptPlan.stdout, /^ADOPT\t\.claude\/skills\/second-brain-context\/SKILL\.md\tinstalled [a-f0-9]{12} -> current [a-f0-9]{12}$/m);
  assert.match(adoptPlan.stdout, /Plan only: nothing was applied\./);
  const misuse = await cli(['verify', '--target', target, '--apply', digest(adoptPlan.stdout)]);
  assert.equal(misuse.code, 1);
  assert.match(misuse.stdout, /verify accepts --apply only with --adopt/);
  const adopted = await cli(['verify', '--target', target, '--adopt', '.claude/skills/second-brain-context/SKILL.md', '--apply', digest(adoptPlan.stdout)]);
  assert.equal(adopted.code, undefined, adopted.stdout);
  const adoptReceipt = receipt(adopted.stdout);
  assert.ok(adoptReceipt);
  const clean = await cli(['verify', '--target', target]);
  assert.equal(clean.code, undefined, 'DIVERGED alone does not fail verify');
  assert.match(clean.stdout, /^DIVERGED\t/m);
  assert.match(clean.stdout, /Verification: OK/);

  const undone = await cli(['rollback', '--target', target, '--receipt', adoptReceipt]);
  assert.equal(undone.code, undefined, undone.stdout);
  assert.equal((await cli(['verify', '--target', target])).code, 1, 'the adopt rollback restores the previous record');

  const badPath = await cli(['verify', '--target', target, '--adopt', '../outside.md']);
  assert.equal(badPath.code, 1);
  assert.match(badPath.stdout, /--adopt takes a workspace-relative path/);
});

test('an overlapping edit prints the proposal path and the exact adopt and upgrade commands', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-conflict-'));
  const checkout = path.join(root, 'starter');
  const target = path.join(root, 'target');
  await mkdir(target);
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(sourceRoot, checkout, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}.git`) && !entry.includes(`${path.sep}vendor${path.sep}`) && !entry.includes(`${path.sep}test${path.sep}`) });
  const copyBin = path.join(checkout, 'bin', 'second-brain.mjs');
  const run = async (args) => {
    try {
      return await execFile(process.execPath, [copyBin, ...args], { cwd: checkout });
    } catch (error) {
      return { stdout: error.stdout ?? '', code: error.code };
    }
  };
  const planned = await run(['init', '--target', target]);
  assert.equal((await run(['init', '--target', target, '--apply', digest(planned.stdout)])).code, undefined);
  const destination = '03-Resources/Procedures/review.md';
  const original = await readFile(path.join(target, ...destination.split('/')), 'utf8');
  const firstLine = original.split('\n')[0];
  await writeFile(path.join(target, ...destination.split('/')), original.replace(firstLine, `${firstLine} (local)`));
  const manifestPath = path.join(checkout, 'template-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const changed = original.replace(firstLine, `${firstLine} (template)`);
  await writeFile(path.join(checkout, 'template', ...destination.split('/')), changed);
  manifest.entries.find((entry) => entry.destination === destination).sha256 = createHash('sha256').update(changed).digest('hex');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const upgrade = await run(['upgrade', '--target', target]);
  assert.match(upgrade.stdout, new RegExp(`^CONFLICT\\t${destination.replace(/\./g, '\\.')}\\tundo=none$`, 'm'));
  assert.match(upgrade.stdout, new RegExp(`^Proposal: ${destination.replace(/\./g, '\\.')} has overlapping edits\\. A version with conflict markers is at \\.second-brain/merge/${destination.replace(/\./g, '\\.')}\\.proposed\\.$`, 'm'));
  assert.match(upgrade.stdout, /^Blocked: nothing is applied while CONFLICT lines remain: 03-Resources\/Procedures\/review\.md$/m);
  assert.ok(upgrade.stdout.includes(`verify --target ${target} --adopt ${destination}`) || upgrade.stdout.includes(`--adopt ${destination}`), upgrade.stdout);
  const proposal = await readFile(path.join(target, '.second-brain', 'merge', ...`${destination}.proposed`.split('/')), 'utf8');
  assert.match(proposal, /^<<<<<<< local /m);
  const refused = await run(['upgrade', '--target', target, '--apply', digest(upgrade.stdout)]);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /PLAN_CONFLICT/);
});
