// Tests for template/shared-skills/second-brain-guide/SKILL.md, the agent guide.
//   node --test test/second-brain-guide-skill.test.mjs
// The guide's commands are run as written, from its own code blocks, on a fresh install and on an install made by the
// v1.2.0 CLI. Nothing here changes the source folder; every workspace is a temporary folder.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../lib/installer.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');
const guide = await readFile(path.join(sourceRoot, 'template', 'shared-skills', 'second-brain-guide', 'SKILL.md'), 'utf8');

const shBlocks = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]);

function node(args, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

async function temp(t, prefix) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function freshInstall(t) {
  const target = path.join(await temp(t, 'second-brain-guide-fresh-'), 'workspace');
  await mkdir(target);
  const digest = node(['init', '--target', target]).out.match(/^Plan digest: ([a-f0-9]{64})$/m)?.[1];
  assert.ok(digest);
  assert.equal(node(['init', '--target', target, '--apply', digest]).code, 0);
  return target;
}

async function olderInstall(t) {
  const fixture = JSON.parse(await readFile(path.join(sourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
  const root = await temp(t, 'second-brain-guide-older-');
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

// Runs one code block of the guide in the workspace root, with the two placeholders filled in.
function runBlock(block, cwd, entryPath = '.agents/skills/second-brain-guide/SKILL.md', env = process.env) {
  const text = block.replaceAll('<starter>', sourceRoot).replace('<path named in the entry>', entryPath);
  const result = spawnSync('sh', ['-c', text], { cwd, encoding: 'utf8', env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('the guide has a strict front matter, a quoted description with its triggers, and the four answers', () => {
  const front = guide.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.match(front, /^name: second-brain-guide$/m);
  const description = front.match(/^description: "(.*)"$/m)?.[1];
  assert.ok(description, 'the description is one double-quoted line');
  assert.ok(description.length <= 1024);
  for (const phrase of ['how to use or update', 'whether this install is current', 'whether a fix landed']) assert.ok(description.includes(phrase), phrase);
  for (const heading of ['## Do not use this when', '## What the tool is', '## Steps', '## An install that does not have this skill yet']) assert.ok(guide.includes(`\n${heading}\n`), heading);
  for (const step of ['**Read the installed version.**', '**Update (only when the person says yes).**', '**Run the read-only checks.**', '**Report each fix.**']) assert.ok(guide.includes(step), step);
  for (const word of ['landed', 'not landed', 'cannot tell']) assert.ok(guide.includes(`| ${word} |`), word);
});

test('the guide names no company, person, ticket, local path or version', () => {
  assert.doesNotMatch(guide, /\/Users\/|\/home\/|[A-Z]:\\|~\//);
  assert.doesNotMatch(guide, /\b[A-Z]{2,6}-\d{2,}\b/, 'no ticket id');
  assert.doesNotMatch(guide, /\bv?\d+\.\d+\.\d+\b(?!`)/, 'a version number is not written into the guide, except the one invented example in code');
  assert.doesNotMatch(guide, /—/, 'no em dash');
});

test('the apply command is not in a runnable block, so no command of the guide can change a workspace', () => {
  assert.equal(shBlocks.length, 7);
  for (const block of shBlocks) {
    assert.doesNotMatch(block, /--apply|rollback|--adopt|\binit\b/, block);
  }
});

test('every command of the guide runs as written on a fresh install', async (t) => {
  const target = await freshInstall(t);
  const results = shBlocks.map((block) => ({ block, ...runBlock(block, target) }));
  for (const r of results) assert.equal(r.code, 0, `${r.block}\n${r.out.slice(0, 300)}${r.err.slice(0, 300)}`);
  const [version, source, status, headings, plan, verify, check] = results;
  assert.match(version.out, /^\d+\.\d+\.\d+$/m);
  assert.match(source.out, /^v\d+\.\d+\.\d+$/m);
  assert.match(status.out, /^Installed: template \S+, receipt tx-/m);
  assert.match(status.out, /^This CLI: template \S+/m);
  assert.match(status.out, /^Upgrade would plan: \d+ IDENTICAL$/m);
  assert.match(status.out.replaceAll('\\', '/'), /^Agent guide: .*second-brain-guide\/SKILL\.md$/m);
  assert.match(headings.out, /^\d+:## v\d+\.\d+\.\d+/m);
  assert.match(headings.out, /^\d+:## Upgrading to v/m);
  assert.match(plan.out, /^Plan: upgrade$/m);
  assert.match(verify.out, /^Verification: OK$/m);
  assert.match(check.out, /^IDENTICAL\t\.agents\/skills\/second-brain-guide\/SKILL\.md\t/m, 'a landed fix shows IDENTICAL');
  assert.match(plan.out, /^Versions: installed (\S+) -> available \1$/m, 'a current install shows one version twice');
  assert.doesNotMatch(plan.out, /^(?:CREATE|MANAGED-UPDATE|SEED-UPDATE|CONFLICT)\t/m, 'a current install has nothing to update');
});

test('on an install made by the v1.2.0 CLI the same commands run, and say the install is behind', async (t) => {
  const older = await olderInstall(t);
  const results = shBlocks.map((block) => ({ block, ...runBlock(block, older, '.agents/skills/second-brain-guide/SKILL.md') }));
  const [version, source, status, , plan, verify, check] = results;
  assert.equal(version.code, 0, version.err);
  assert.equal(version.out.trim(), '1.2.0');
  assert.equal(source.code, 0);
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /^Installed: template 1\.2\.0, receipt tx-/m);
  assert.match(status.out, /^Upgrade would plan: .*\bCREATE\b/m);
  assert.match(status.out.replaceAll('\\', '/'), /^Agent guide: .*template\/shared-skills\/second-brain-guide\/SKILL\.md \(not installed in this workspace yet/m);
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /^Versions: installed 1\.2\.0 -> available \S+$/m);
  const digest = plan.out.match(/^Plan digest: ([a-f0-9]{64})$/m)?.[1];
  assert.ok(digest, 'the plan prints its digest');
  assert.match(plan.out, new RegExp(`^Apply this exact plan with: .* --apply ${digest}$`, 'm'));
  assert.equal(verify.code, 1, 'verify exits 1 on an install behind the source');
  assert.match(verify.out, /^Manifest: this CLI expects template \S+ .*; installed 1\.2\.0/m);
  assert.match(guide, /`SOURCE_MANIFEST_MISMATCH` and `UNMANAGED` lines are expected/);
  assert.match(check.out, /^CREATE\t\.agents\/skills\/second-brain-guide\/SKILL\.md\t/m, 'a fix that is not there shows CREATE');
  const changed = runBlock(shBlocks[6], older, '.agents/skills/second-brain-capture/SKILL.md');
  assert.match(changed.out, /^MANAGED-UPDATE\t\.agents\/skills\/second-brain-capture\/SKILL\.md\t/m, 'an older file shows MANAGED-UPDATE');
});

test('after the older install is upgraded with the approved digest, the guide is installed and the fix shows IDENTICAL', async (t) => {
  const older = await olderInstall(t);
  const digest = node(['upgrade', '--target', older]).out.match(/--apply ([a-f0-9]{64})$/m)?.[1];
  assert.ok(digest);
  const applied = node(['upgrade', '--target', older, '--apply', digest]);
  assert.equal(applied.code, 0, applied.err + applied.out);
  const status = runBlock(shBlocks[2], older);
  assert.match(status.out.replaceAll('\\', '/'), /^Agent guide: .*\.agents\/skills\/second-brain-guide\/SKILL\.md$/m);
  assert.match(runBlock(shBlocks[5], older).out, /^Verification: OK$/m);
  assert.match(runBlock(shBlocks[6], older).out, /^IDENTICAL\t\.agents\/skills\/second-brain-guide\/SKILL\.md\t/m);
  assert.equal(runBlock(shBlocks[0], older).out.trim(), (await readFile(path.join(sourceRoot, 'VERSION'), 'utf8')).trim().replace(/^v/, ''));
});

test('the managed 00-Meta/AGENTS.md section points to the guide and the root loader block is unchanged', async () => {
  const meta = await readFile(path.join(sourceRoot, 'template', '00-Meta', 'AGENTS.md'), 'utf8');
  const section = meta.split('\n## Version, update, check\n')[1]?.split('\n## ')[0];
  assert.ok(section, 'the section exists');
  assert.ok(!meta.endsWith(section), 'the section is not at the end of the file, so a local note added at the end still merges');
  assert.ok(section.split('\n').filter(Boolean).length <= 3, 'the section stays short');
  assert.ok(section.includes('.agents/skills/second-brain-guide/SKILL.md'));
  assert.ok(section.includes('.second-brain/installed-state.json'));
  assert.doesNotMatch(section, /\/Users\/|[A-Z]:\\/);
  const loader = await readFile(path.join(sourceRoot, 'template', 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(loader, /second-brain-guide/, 'the root loader block does not mention the guide');
  const source = await readFile(path.join(sourceRoot, 'AGENTS.md'), 'utf8');
  assert.ok(source.includes('(template/shared-skills/second-brain-guide/SKILL.md)'), 'the source AGENTS.md has the route line');
});

test('each block works in a fresh shell: it uses no variable that another block sets, and runs with nothing carried over', async (t) => {
  for (const block of shBlocks) {
    const used = [...block.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    assert.deepEqual(used.filter((name) => name !== 'PWD'), [], `a block uses a variable it does not set:\n${block}`);
  }
  const target = await freshInstall(t);
  // Only PATH is passed in: no STARTER, no SRC, no SH, no INSTALLED, nothing from an earlier block.
  const bare = { PATH: process.env.PATH };
  for (const block of shBlocks) {
    const result = runBlock(block, target, '.agents/skills/second-brain-guide/SKILL.md', bare);
    assert.equal(result.code, 0, `${block}\n${result.out.slice(0, 300)}${result.err.slice(0, 300)}`);
    assert.notEqual(result.out.trim(), '', `${block} printed nothing`);
  }
  // RED control: a block whose placeholder is left in place does not run, so the test would notice a block that depends on state.
  const control = spawnSync('sh', ['-c', shBlocks[2]], { cwd: target, encoding: 'utf8', env: bare });
  assert.notEqual(control.status, 0, 'with <starter> unfilled the block fails');
});

test('the guide is written for an agent that runs the commands, and says what to do when the person does not know the source folder', () => {
  assert.doesNotMatch(guide, /digest the person types/);
  assert.match(guide, /`upgrade` \(a plan; you apply it with its digest only after the person confirms that digest in the chat\)/);
  assert.match(guide, /If the person does not know it, say that you can fetch a fresh copy, that this is a network step, and what you would fetch\. Wait for a yes\./);
});
