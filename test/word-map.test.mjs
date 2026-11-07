import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { cleanup, consumerRoot, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const SEED = '00-Meta/Word-Map.md';
const SEED_SOURCE = `template/${SEED}`;
const HEADER = '| Word | Means | Example of use |';

const read = (relative) => readFile(path.join(sourceRoot, relative), 'utf8');

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

test('the Word-Map seed ships once, as a seed file, with the right hash and an allowlist line', async () => {
  const entries = JSON.parse(await read('template-manifest.json')).entries.filter((entry) => entry.destination === SEED);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, SEED_SOURCE);
  assert.equal(entries[0].mergeKind, 'seed-file');
  const bytes = await readFile(path.join(sourceRoot, SEED_SOURCE));
  assert.equal(entries[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok((await read('FILE-ALLOWLIST.txt')).split('\n').includes(SEED_SOURCE));
});

test('the Word-Map seed is generic, has the table header, one example row and the three rules', async () => {
  const text = await read(SEED_SOURCE);
  assert.match(text, /^# Word map$/m);
  const lines = text.split('\n');
  const header = lines.indexOf(HEADER);
  assert.ok(header > 0, 'the table header is missing');
  assert.match(lines[header + 1], /^\| --- \| --- \| --- \|$/);
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  assert.equal(rows.length, 1, 'one example row');
  for (const phrase of ['at the start of each session', 'use its meaning without asking', 'ask once what it means and offer to add it']) {
    assert.ok(text.includes(phrase), `the rules do not say: ${phrase}`);
  }
  assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash');
  assert.doesNotMatch(text, /\/Users\/|\/home\/|[A-Z]:\\/);
  assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, 'no dates');
});

test('the operating route reads the Word-Map in step 0, after Profile and before Decisions', async () => {
  const route = await read('template/00-Meta/AGENTS.md');
  const step = route.split('\n').find((line) => line.startsWith('0. '));
  assert.ok(step.includes('`00-Meta/Profile.md`'));
  assert.ok(step.indexOf('`00-Meta/Profile.md`') < step.indexOf('`00-Meta/Word-Map.md`'));
  assert.ok(route.indexOf('`00-Meta/Word-Map.md`') < route.indexOf('`00-Meta/Decisions.md`'));
  assert.match(step, /Word-Map\.md` when it exists: it lists the person's shorthand words, so use each listed meaning without asking/);
});

test('init installs the Word-Map seed once, an edited copy survives an upgrade byte for byte and no proposal is written', async (t) => {
  const root = await consumerRoot();
  cleanup(t, root);
  const target = path.join(root, 'workspace');
  const plan = await runCli(['init', '--target', target]);
  assert.equal(plan.code, undefined, plan.stdout);
  assert.match(plan.stdout, new RegExp(`^CREATE\\t${SEED.replace('.', '\\.')}\\t`, 'm'));
  const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan.stdout)]);
  assert.equal(applied.code, undefined, applied.stdout);
  const installed = path.join(target, ...SEED.split('/'));
  assert.deepEqual(await readFile(installed), await readFile(path.join(sourceRoot, SEED_SOURCE)));

  const edited = Buffer.from(`# Word map\n\n${HEADER}\n| --- | --- | --- |\n| ops | My own meaning | "Check ops." |\n`);
  await writeFile(installed, edited);
  const upgrade = await runCli(['upgrade', '--target', target]);
  assert.equal(upgrade.code, undefined, upgrade.stdout);
  assert.match(upgrade.stdout, new RegExp(`^PERSONALIZED\\t${SEED.replace('.', '\\.')}\\t`, 'm'));
  assert.doesNotMatch(upgrade.stdout, /^Proposal: /m);
  const applyUpgrade = await runCli(['upgrade', '--target', target, '--apply', planDigest(upgrade.stdout)]);
  assert.equal(applyUpgrade.code, undefined, applyUpgrade.stdout);
  assert.deepEqual(await readFile(installed), edited);
  const mergeDirectory = path.join(target, '.second-brain', 'merge');
  const proposals = (await exists(mergeDirectory)) ? (await walk(mergeDirectory)).filter((file) => file.endsWith('.proposed')) : [];
  assert.deepEqual(proposals, []);
});
