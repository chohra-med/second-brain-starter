import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

// Every file's path and bytes under the folder. Equal snapshots before and after prove a command wrote nothing.
async function snapshot(root, prefix = '') {
  const out = new Map();
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of await snapshot(root, relative)) out.set(key, value);
    } else {
      out.set(relative, await readFile(path.join(root, relative)));
    }
  }
  return out;
}

function sameSnapshot(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (!right.has(key) || !value.equals(right.get(key))) return false;
  return true;
}

async function installedTarget(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'workspace');
  await mkdir(target);
  const planned = await cli(['init', '--target', target]);
  const digest = planned.stdout.match(/^Plan digest: ([a-f0-9]{64})$/m)?.[1];
  assert.ok(digest, planned.stdout);
  const applied = await cli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, 0, applied.stderr || applied.stdout);
  return target;
}

test('status on an empty folder says nothing is installed and writes nothing', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-status-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await snapshot(root);
  const result = await cli(['status', '--target', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Installed: none\. Run init to install the harness\.$/m);
  assert.match(result.stdout, /^This CLI: template \S+ \(manifest [a-f0-9]{64}\)$/m);
  assert.match(result.stdout, /^Nothing was applied\./m);
  assert.ok(sameSnapshot(before, await snapshot(root)), 'status changed the folder');
});

test('status on an installed workspace names the installed template and receipt, and counts what upgrade would plan', async (t) => {
  const target = await installedTarget(t);
  const before = await snapshot(target);
  const result = await cli(['status', '--target', target]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Installed: template \S+, receipt tx-[0-9a-f-]+$/m);
  assert.match(result.stdout, /^Upgrade would plan: \d+ IDENTICAL/m);
  assert.doesNotMatch(result.stdout, /CONFLICT/);
  assert.ok(sameSnapshot(before, await snapshot(target)), 'status changed the installed workspace');
});

test('status reports a local edit to a managed file as CUSTOMIZED-KEEP, and still writes nothing', async (t) => {
  const target = await installedTarget(t);
  const managed = path.join(target, '03-Resources', 'Procedures', 'close.md');
  await writeFile(managed, `${await readFile(managed, 'utf8')}\nA local note the template does not have.\n`);
  const before = await snapshot(target);
  const result = await cli(['status', '--target', target]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\b1 CUSTOMIZED-KEEP\b/);
  assert.ok(sameSnapshot(before, await snapshot(target)), 'status changed the edited workspace');
});

test('status on a workspace with a CONFLICT names the blocked path and the CONFLICT count, and writes nothing', async (t) => {
  const target = await installedTarget(t);
  // A lone loader start marker appended to the root AGENTS.md is a damaged loader, which the upgrade plan lists as a CONFLICT.
  const agents = path.join(target, 'AGENTS.md');
  await writeFile(agents, `${await readFile(agents, 'utf8')}<!-- second-brain:loader:start -->\nmine\n`);
  const before = await snapshot(target);
  const result = await cli(['status', '--target', target]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Upgrade would plan: .*\b1 CONFLICT\b/m);
  assert.match(result.stdout, /^Blocked: AGENTS\.md need a decision before an upgrade applies\.$/m);
  assert.ok(sameSnapshot(before, await snapshot(target)), 'status changed the workspace with a CONFLICT');
});

test('status takes only --target and refuses other flags, changing nothing', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-status-args-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const args of [
    ['status'],
    ['status', '--target', 'relative/path'],
    ['status', '--target', root, '--apply', 'a'.repeat(64)],
    ['status', '--target', root, '--records'],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 1, `${args.join(' ')} exited ${result.code}`);
  }
  assert.deepEqual([...(await snapshot(root)).keys()], []);
});

// An install made by the v1.2.0 CLI, from the exact tree test/fixtures/v1.2.0-install.json holds. It has no agent guide skill.
async function olderInstall(t) {
  const { stableStringify } = await import('../lib/installer.mjs');
  const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-status-older-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (posix, content) => {
    const file = path.join(root, ...posix.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  };
  for (const [destination, content] of Object.entries(fixture.files)) await put(destination, content);
  await put('.second-brain/installed-state.json', `${stableStringify(fixture.state)}\n`);
  await put(fixture.receiptPath, `${stableStringify(fixture.receipt)}\n`);
  return root;
}

test('status prints one Agent guide line: the installed skill when the workspace has it', async (t) => {
  const target = await installedTarget(t);
  const before = await snapshot(target);
  const result = await cli(['status', '--target', target]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('Agent guide:'));
  assert.deepEqual(lines, [`Agent guide: ${path.join(target, '.agents', 'skills', 'second-brain-guide', 'SKILL.md')}`]);
  assert.ok((await readFile(lines[0].slice('Agent guide: '.length))).length > 0, 'the named file exists');
  assert.ok(sameSnapshot(before, await snapshot(target)), 'status changed the installed workspace');
});

test('status names the source copy of the guide for an install that does not have the skill, and finds it without any file of the old install', async (t) => {
  const older = await olderInstall(t);
  const before = await snapshot(older);
  const result = await cli(['status', '--target', older]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Installed: template 1\.2\.0, receipt tx-/m);
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('Agent guide:'));
  const source = path.join(sourceRoot, 'template', 'shared-skills', 'second-brain-guide', 'SKILL.md');
  assert.deepEqual(lines, [`Agent guide: ${source} (not installed in this workspace yet; an upgrade installs it)`]);
  assert.ok((await readFile(source, 'utf8')).startsWith('---\nname: second-brain-guide\n'), 'the named source file is the guide');
  assert.ok(sameSnapshot(before, await snapshot(older)), 'status changed the older install');

  const empty = await mkdtemp(path.join(tmpdir(), 'second-brain-status-empty-guide-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const none = await cli(['status', '--target', empty]);
  assert.equal(none.stdout.split('\n').filter((line) => line.startsWith('Agent guide:')).length, 1);
});
