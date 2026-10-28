import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const SKILL = path.join(sourceRoot, 'template/shared-skills/graphify/SKILL.md');

async function skill() {
  return readFile(SKILL, 'utf8');
}

function stampScript(text) {
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const found = blocks.filter((b) => b.includes('set -o pipefail'));
  assert.equal(found.length, 1, 'the skill holds exactly one stamp command');
  return found[0].replace(/^ {2}/gm, '');
}

function stamp(script, cwd, folders, env = process.env) {
  return spawnSync('bash', ['-c', script, 'stamp', ...folders], { cwd, encoding: 'utf8', env });
}

const sha = (data) => createHash('sha256').update(data).digest('hex');

function expectedValue(files) {
  const lines = Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((name) => `${sha(files[name])}  ${name}\n`);
  return sha(lines.join(''));
}

test('graphify skill: Step 0, the stamp rules and the unchanged pointer rule are all present', async () => {
  const text = await skill();
  const order = ['## The rule', '## Step 0: Search by keyword first', '## Step 1', '## Step 2', '## Step 3', '## Step 4'].map((h) => text.indexOf(h));
  assert.ok(order.every((n) => n >= 0), 'every heading is present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'headings are in order');
  assert.ok(text.includes('A graph result is a pointer. It is not the source of truth.'));
  assert.ok(text.includes('Before you rely on a result, open the file the result names and read the text there.'));
  const step2 = text.slice(text.indexOf('## Step 2'), text.indexOf('## Step 3'));
  for (const word of ['UNKNOWN', 'STALE', 'stamp matches', 'does not replace Step 3', 'whose `graph` line names that file']) {
    assert.ok(step2.includes(word), `Step 2 says ${word}`);
  }
  const step4 = text.slice(text.indexOf('## Step 4'));
  for (const word of ['`built`', '`graph`', '`folder`', '`value`', 'Write no stamp if the command fails', 'not the same before and after the build', 'files that are not Markdown', 'outside the notes folder', 'bash stamp.sh', 'use the same tool every time', 'is the only freshness check there is', 'Delete any BUILT-FROM.txt that is already there before the build']) {
    assert.ok(step4.includes(word), `Step 4 says ${word}`);
  }
  for (const word of ['If it is missing, names another graph', 'lacks a `built`, `graph` or `value` line or any `folder` line', 'is not 64 lowercase hex characters', 'call the graph STALE and prefer the keyword search', 'If it is equal, say "stamp matches"', 'from the notes folder, with each `folder` line as one quoted argument']) {
    assert.ok(step2.includes(word), `Step 2 says ${word}`);
  }
  assert.ok(step2.includes('call the graph UNKNOWN in your answer'), 'Step 2 has the first UNKNOWN sentence');
  assert.ok(step2.includes('If the command fails or prints nothing, call the graph UNKNOWN'), 'Step 2 has the second UNKNOWN sentence');
  const rule = text.slice(text.indexOf('## The rule'), text.indexOf('## Step 0'));
  for (const word of ['The graph can be stale.', 'The graph can be incomplete.', 'A hit does not prove a file is current.', 'A miss does not prove a fact is absent.']) {
    assert.ok(rule.includes(word), `The rule says ${word}`);
  }
  const step0 = text.slice(text.indexOf('## Step 0'), text.indexOf('## Step 1'));
  for (const word of ['folders the person named', 'exact words', 'If no folder is named, ask which']) {
    assert.ok(step0.includes(word), `Step 0 says ${word}`);
  }
});

test('graphify stamp command: content edits change the hash, and bad input fails instead of printing a hash', async () => {
  const script = stampScript(await skill());
  const root = await mkdtemp(path.join(os.tmpdir(), 'graphify-stamp-'));
  try {
    await mkdir(path.join(root, 'My Project', 'sub'), { recursive: true });
    await mkdir(path.join(root, 'empty'));
    await writeFile(path.join(root, 'My Project', 'n 1.md'), 'a\n');
    await writeFile(path.join(root, 'My Project', 'sub', 'X.MD'), 'b\n');
    const base = stamp(script, root, ['My Project']);
    assert.equal(base.status, 0, base.stderr);
    assert.match(base.stdout, /^[0-9a-f]{64}\n$/);
    assert.equal(stamp(script, root, ['My Project']).stdout, base.stdout, 'same input, same value');

    await writeFile(path.join(root, 'My Project', 'n 1.md'), 'z\n');
    const edited = stamp(script, root, ['My Project']);
    assert.notEqual(edited.stdout, base.stdout, 'a same-size edit in a folder with a space changes the value');

    await writeFile(path.join(root, 'My Project', 'sub', 'X.MD'), 'y\n');
    assert.notEqual(stamp(script, root, ['My Project']).stdout, edited.stdout, 'an upper-case .MD edit changes the value');

    const before = stamp(script, root, ['My Project']).stdout;
    await writeFile(path.join(root, 'My Project', 'note.txt'), 'not markdown\n');
    assert.equal(stamp(script, root, ['My Project']).stdout, before, 'a non-Markdown file does not change the value');

    await mkdir(path.join(root, 'real-target'));
    await writeFile(path.join(root, 'real-target', 'linked.md'), 'linked\n');
    const linkless = stamp(script, root, ['My Project']).stdout;
    await symlink(path.join(root, 'real-target'), path.join(root, 'My Project', 'link'));
    assert.notEqual(stamp(script, root, ['My Project']).stdout, linkless, 'a symlinked subfolder is followed');

    const mixed = stamp(script, root, ['My Project', 'missing']);
    assert.notEqual(mixed.status, 0, 'a real folder plus a missing one fails');
    assert.equal(mixed.stdout, '', 'nothing printed for a real folder plus a missing one');

    for (const folders of [['missing'], ['empty'], []]) {
      const result = stamp(script, root, folders);
      assert.notEqual(result.status, 0, `no value for ${JSON.stringify(folders)}`);
      assert.equal(result.stdout, '', `nothing printed for ${JSON.stringify(folders)}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('graphify stamp command: value is the documented sha256 over sorted path and content lines', { skip: process.platform === 'win32' && 'the stamp command needs bash, find and shasum, which a Windows runner may not provide' }, async () => {
  const script = stampScript(await skill());
  const root = await mkdtemp(path.join(os.tmpdir(), 'graphify-stamp-'));
  try {
    await mkdir(path.join(root, 'n', 'sub'), { recursive: true });
    const files = { 'n/B.md': 'b\n', 'n/a.md': 'a\n', 'n/_c.markdown': 'c\n', 'n/sub/D.MARKDOWN': 'd\n' };
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, name), body);
    await writeFile(path.join(root, 'n', 'skip.txt'), 'x\n');
    const expected = `${expectedValue(files)}\n`;
    for (const locale of ['C', 'en_US.UTF-8', 'de_DE.UTF-8']) {
      const result = stamp(script, root, ['n'], { ...process.env, LC_ALL: locale });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected, `value under ${locale} matches the recipe`);
    }
    await rm(path.join(root, 'n', 'a.md'));
    await writeFile(path.join(root, 'n', 'z.md'), 'a\n');
    const { 'n/a.md': _gone, ...rest } = files;
    const renamed = stamp(script, root, ['n']).stdout;
    assert.equal(renamed, `${expectedValue({ ...rest, 'n/z.md': 'a\n' })}\n`, 'a rename with the same content changes the value, as the recipe says');
    assert.notEqual(renamed, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
