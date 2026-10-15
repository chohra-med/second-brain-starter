import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');

async function cli(args) {
  try {
    const result = await execFile(process.execPath, [bin, ...args], { cwd: sourceRoot });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
  }
}

// Every entry under the folder, sorted, so a test can prove the plan wrote nothing.
async function tree(root, prefix = '') {
  const names = [];
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    names.push(relative);
    if (entry.isDirectory()) names.push(...(await tree(root, relative)));
  }
  return names;
}

async function fixtureParent(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-workspace-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'parent');
  await mkdir(path.join(parent, 'Alpha Repo', '.git'), { recursive: true });
  await mkdir(path.join(parent, 'beta', '.git'), { recursive: true });
  await mkdir(path.join(parent, 'plain-folder'), { recursive: true });
  await mkdir(path.join(parent, 'outer', 'inner', '.git'), { recursive: true });
  await mkdir(path.join(parent, 'Second Brain', '.git'), { recursive: true });
  await writeFile(path.join(parent, 'note.txt'), 'not a folder\n');
  await symlink(path.join(parent, 'beta'), path.join(parent, 'linked-repo'));
  // The CLI prints the resolved path (macOS puts temp folders behind /private), so expectations use it too.
  return { root, parent: await realpath(parent) };
}

test('workspace-plan lists each direct child repository with a ready connect command and writes nothing', async (t) => {
  const { parent } = await fixtureParent(t);
  const before = await tree(parent);

  const planned = await cli(['workspace-plan', '--parent', parent]);
  assert.equal(planned.code, 0, planned.stderr);
  assert.match(planned.stdout, /^Plan: workspace-plan \(plan only: nothing was written\)$/m);
  assert.match(planned.stdout, /^Repositories: 2 with a \.git folder directly under the parent$/m);
  assert.ok(planned.stdout.includes(`  ${path.join(parent, 'Alpha Repo')}`), planned.stdout);
  assert.ok(planned.stdout.includes(`  ${path.join(parent, 'beta')}`), planned.stdout);

  // Each connect line is absolute, quoted where needed, and points at the proposed workspace.
  const hub = path.join(parent, 'Second Brain');
  const connectLines = planned.stdout.split('\n').filter((line) => line.includes(' connect --target '));
  assert.equal(connectLines.length, 2, planned.stdout);
  assert.ok(connectLines.some((line) => line.includes(`--target '${hub}' --repo '${path.join(parent, 'Alpha Repo')}'`)), connectLines.join('\n'));
  assert.ok(connectLines.some((line) => line.includes(`--target '${hub}' --repo ${path.join(parent, 'beta')}`)), connectLines.join('\n'));
  assert.ok(connectLines.every((line) => path.isAbsolute(line.match(/node (\S+)/)?.[1] ?? '')), connectLines.join('\n'));

  assert.deepEqual(await tree(parent), before, 'the plan changed the parent folder');
});

test('workspace-plan skips links, nested repositories, plain folders, files and the proposed workspace folder', async (t) => {
  const { parent } = await fixtureParent(t);
  const planned = await cli(['workspace-plan', '--parent', parent]);
  const listed = await cli(['workspace-plan', '--parent', parent, '--list-projects']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.doesNotMatch(planned.stdout, /linked-repo/);
  assert.doesNotMatch(planned.stdout, /inner/);
  assert.doesNotMatch(planned.stdout, /plain-folder/);
  assert.doesNotMatch(listed.stdout, /Second Brain/);
  assert.doesNotMatch(listed.stdout, /linked-repo/);
  assert.doesNotMatch(listed.stdout, /note\.txt/);
});

test('--list-projects prints only the repository paths, one per line', async (t) => {
  const { parent } = await fixtureParent(t);
  const listed = await cli(['workspace-plan', '--parent', parent, '--list-projects']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout, `${path.join(parent, 'Alpha Repo')}\n${path.join(parent, 'beta')}\n`);
});

test('a parent with no repositories plans cleanly and says so', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-workspace-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planned = await cli(['workspace-plan', '--parent', root]);
  assert.equal(planned.code, 0, planned.stderr);
  assert.match(planned.stdout, /^Repositories: none\. No direct child folder of the parent has a \.git folder\.$/m);
  assert.doesNotMatch(planned.stdout, / connect --target /);
});

test('a parent behind a link is resolved, and its real path is printed', async (t) => {
  const { root, parent } = await fixtureParent(t);
  const link = path.join(root, 'parent-link');
  await symlink(parent, link);
  const listed = await cli(['workspace-plan', '--parent', link, '--list-projects']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.ok(listed.stdout.includes(path.join(await realpath(parent), 'beta')), listed.stdout);
});

test('workspace-plan refuses bad arguments and changes nothing', async (t) => {
  const { parent } = await fixtureParent(t);
  const before = await tree(parent);
  const refusals = [
    [['workspace-plan'], /requires --parent with an absolute folder path/],
    [['workspace-plan', '--parent', 'relative/folder'], /requires --parent with an absolute folder path/],
    [['workspace-plan', '--parent', parent, '--target', path.join(parent, 'x')], /workspace-plan does not accept --target/],
    [['workspace-plan', '--parent', parent, '--apply', 'a'.repeat(64)], /workspace-plan does not accept --apply/],
    [['workspace-plan', '--parent', parent, '--records'], /workspace-plan does not accept --records/],
    [['init', '--parent', parent, '--target', path.join(parent, 'x')], /init does not accept --parent/],
    [['init', '--list-projects', '--target', path.join(parent, 'x')], /init does not accept --list-projects/],
    [['workspace-plan', '--parent', path.join(parent, 'missing')], /parent folder does not exist/],
    [['workspace-plan', '--parent', path.join(parent, 'note.txt')], /must be a folder/],
  ];
  for (const [args, pattern] of refusals) {
    const result = await cli(args);
    assert.equal(result.code, 1, `${args.join(' ')} exited ${result.code}`);
    assert.match(`${result.stdout}${result.stderr}`, pattern, args.join(' '));
  }
  assert.deepEqual(await tree(parent), before, 'a refused plan changed the parent folder');
});

test('workspace-plan lists a child whose .git is a folder, and not one whose .git is a file (a worktree or submodule shape)', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-workspace-gitfile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'parent');
  await mkdir(path.join(parent, 'a', '.git'), { recursive: true });
  await mkdir(path.join(parent, 'b'), { recursive: true });
  await writeFile(path.join(parent, 'b', '.git'), 'gitdir: ../a/.git/worktrees/b\n');
  const before = await tree(parent);

  const listed = await cli(['workspace-plan', '--parent', parent, '--list-projects']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout, `${path.join(await realpath(parent), 'a')}\n`);
  assert.deepEqual(await tree(parent), before, 'the plan changed the parent folder');
});
