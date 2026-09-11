import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const sourceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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

test('a nonempty unmanaged loader warns for manual resolution and preserves the target inventory', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-cli-loader-'));
  const target = path.join(root, 'target');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), '# Existing project rules\n');
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await cli(['init', '--target', target]);
  assert.equal(result.code, undefined);
  assert.match(result.stdout, /CONFLICT\tAGENTS.md/);
  assert.match(result.stdout, /Manual resolution required: AGENTS.md/);
  const plannedDigest = digest(result.stdout);
  assert.ok(plannedDigest);
  const rejected = await cli(['init', '--target', target, '--apply', plannedDigest]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), '# Existing project rules\n');
});
