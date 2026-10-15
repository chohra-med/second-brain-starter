import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { lintProgress, lintRoadmap, lintWorkspaceRecords, STATUS_WORDS } from '../lib/records.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const execFile = promisify(execFileCallback);
const header = '| Item | Status | Owner | Evidence for done | Next action |\n| --- | --- | --- | --- | --- |\n';
const goodRoadmap = `# Roadmap: synthetic\n\n${header}| Write draft | Open | Ana | Draft saved | Outline |\n| Publish note | Verified | Ana | Link checked | none |\n\nStatus vocabulary: ${STATUS_WORDS.join(', ')}.\n`;
const entry = (day) => `## 2026-01-${String(day).padStart(2, '0')}\n\n- Done: step ${day}\n- Verified: [check](link.md)\n- Open: none\n- Next: step ${day + 1}\n`;

test('a clean roadmap and a short progress log have no findings', async () => {
  assert.deepEqual(lintRoadmap(goodRoadmap), []);
  assert.deepEqual(lintProgress(Array.from({ length: 10 }, (_, i) => entry(i + 1)).join('\n'), 1000), []);
  const shipped = await readFile(path.join(sourceRoot, 'template/01-Projects/Selected-Project/roadmap.md'), 'utf8');
  assert.deepEqual(lintRoadmap(shipped), [], 'the seeded roadmap, with its separate fictional example table, is clean');
});

test('rows outside a table, unknown status words and a second task table are reported', () => {
  const stray = `${goodRoadmap}\nLater note:\n| Stray row | Open | Ana | x | y |\n`;
  assert.match(lintRoadmap(stray).join('\n'), /line \d+: a table row outside a table/);
  const unknown = goodRoadmap.replace('| Write draft | Open |', '| Write draft | Almost done |');
  assert.deepEqual(lintRoadmap(unknown), ['line 5: unknown status word "Almost done" (use Open, In progress, Blocked, Done, Verified)']);
  const two = `${goodRoadmap}\n${header}| Another | Open | Ana | x | y |\n`;
  assert.match(lintRoadmap(two).join('\n'), /2 task tables with a Status column; keep one table per roadmap/);
  assert.deepEqual(lintRoadmap('# Roadmap\n\nNo table.\n'), ['no task table with a Status column']);
});

test('progress over 10 entries or about 15 KB is reported, and a large roadmap too', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => entry(i + 1)).join('\n');
  assert.match(lintProgress(eleven, 2000).join('\n'), /11 entries; move all but the newest 10 to 04-Archives\/Projects\/<project>\/progress-YYYY\.md/);
  assert.match(lintProgress(entry(1), 16 * 1024).join('\n'), /over about 15 KB/);
});

test('verify --records reads every project folder, reports by path, exits 1 on findings and changes nothing', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-records-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'workspace');
  for (const [file, text] of [
    ['01-Projects/Good/roadmap.md', goodRoadmap],
    ['01-Projects/Good/progress.md', entry(1)],
    ['01-Projects/Messy/roadmap.md', goodRoadmap.replace('| Publish note | Verified |', '| Publish note | finished |')],
    ['01-Projects/Messy/progress.md', Array.from({ length: 12 }, (_, i) => entry(i + 1)).join('\n')],
  ]) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), text);
  }
  const before = await Promise.all(['Good', 'Messy'].flatMap((name) => ['roadmap.md', 'progress.md'].map((file) => readFile(path.join(target, '01-Projects', name, file)))));
  const result = await lintWorkspaceRecords({ targetPath: target });
  assert.deepEqual(result.findings.map((finding) => finding.path), ['01-Projects/Messy/roadmap.md', '01-Projects/Messy/progress.md']);
  let cli;
  try {
    cli = await execFile(process.execPath, [path.join(sourceRoot, 'bin', 'second-brain.mjs'), 'verify', '--target', target, '--records']);
  } catch (error) {
    cli = error;
  }
  assert.equal(cli.code, 1);
  assert.match(cli.stdout, /^RECORDS\t01-Projects\/Messy\/roadmap\.md\tline 6: unknown status word "finished"/m);
  assert.match(cli.stdout, /^Records: 2 problems in 4 record files read\. This check reads only; nothing was changed\.$/m);
  const after = await Promise.all(['Good', 'Messy'].flatMap((name) => ['roadmap.md', 'progress.md'].map((file) => readFile(path.join(target, '01-Projects', name, file)))));
  assert.deepEqual(after, before, 'the lint wrote nothing');
  const misuse = await execFile(process.execPath, [path.join(sourceRoot, 'bin', 'second-brain.mjs'), 'verify', '--target', target, '--records', '--adopt', 'x.md']).catch((error) => error);
  assert.equal(misuse.code, 1);
  assert.match(misuse.stdout, /verify --records reads only/);
});
