import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPin, gitTreeHash } from '../tools/update-harness-pin.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const MIT = 'MIT License\n\nCopyright (c) 2026 Synthetic Author\n\nPermission is hereby granted, free of charge.\n';
const COMMIT = 'c'.repeat(40);

async function syntheticExport(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    { path: 'LICENSE', text: MIT },
    { path: 'install-manifest.json', text: '{"harnessVersion":"9.9.9"}\n' },
    { path: 'bin/run.sh', text: '#!/bin/sh\necho synthetic\n', executable: true },
    { path: 'docs/README.md', text: '# Synthetic harness\n' },
  ];
  for (const file of files) {
    const full = path.join(root, ...file.path.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, file.text);
    await chmod(full, file.executable ? 0o755 : 0o644);
  }
  const tree = gitTreeHash(files.map((file) => ({ path: file.path, bytes: Buffer.from(file.text), executable: process.platform !== 'win32' && file.executable === true })));
  return { root, tree };
}

async function refused(code, action) {
  await assert.rejects(action, (error) => error.code === code);
}

test('the pin tool accepts an exact export and records inventory, executable bits, license and version', async (t) => {
  const { root, tree } = await syntheticExport(t);
  const { pin } = await buildPin({ source: root, commit: COMMIT, tree });
  assert.equal(pin.harnessVersion, '9.9.9');
  assert.equal(pin.tree, tree);
  assert.deepEqual(pin.sourceInventory.map((entry) => entry.path), ['LICENSE', 'bin/run.sh', 'docs/README.md', 'install-manifest.json']);
  if (process.platform !== 'win32') assert.deepEqual(pin.sourceInventory.filter((entry) => entry.executable).map((entry) => entry.path), ['bin/run.sh']);
});

test('the pin tool refuses a dirty copy, a checkout, and a license that is not MIT or changed without review', async (t) => {
  const dirty = await syntheticExport(t);
  await writeFile(path.join(dirty.root, 'docs', 'README.md'), '# Synthetic harness, edited in the working tree\n');
  await refused('TREE_MISMATCH', () => buildPin({ source: dirty.root, commit: COMMIT, tree: dirty.tree }));

  const checkout = await syntheticExport(t);
  await mkdir(path.join(checkout.root, '.git'));
  await refused('NOT_AN_EXPORT', () => buildPin({ source: checkout.root, commit: COMMIT, tree: checkout.tree }));

  const notMit = await syntheticExport(t);
  const otherLicense = 'Apache License\nVersion 2.0\n';
  await writeFile(path.join(notMit.root, 'LICENSE'), otherLicense);
  const notMitTree = gitTreeHash([
    { path: 'LICENSE', bytes: Buffer.from(otherLicense), executable: false },
    { path: 'install-manifest.json', bytes: Buffer.from('{"harnessVersion":"9.9.9"}\n'), executable: false },
    { path: 'bin/run.sh', bytes: Buffer.from('#!/bin/sh\necho synthetic\n'), executable: process.platform !== 'win32' },
    { path: 'docs/README.md', bytes: Buffer.from('# Synthetic harness\n'), executable: false },
  ]);
  await refused('LICENSE_MISMATCH', () => buildPin({ source: notMit.root, commit: COMMIT, tree: notMitTree }));

  const changed = await syntheticExport(t);
  const previousPin = { license: { sha256: '0'.repeat(64) } };
  await refused('LICENSE_MISMATCH', () => buildPin({ source: changed.root, commit: COMMIT, tree: changed.tree, previousPin }));
  const accepted = await buildPin({ source: changed.root, commit: COMMIT, tree: changed.tree, previousPin, acceptLicenseChange: true });
  assert.equal(accepted.pin.license.spdx, 'MIT');
  await refused('USAGE', () => buildPin({ source: changed.root, commit: 'short', tree: changed.tree }));
});

test('the vendored inventory regenerates byte for byte into the committed pin', async () => {
  const committed = JSON.parse(await readFile(path.join(sourceRoot, 'vendor', 'SPEC-HARNESS-PIN.json'), 'utf8'));
  const { pin } = await buildPin({ source: path.join(sourceRoot, 'vendor', 'spec-harness'), commit: committed.commit, tree: committed.tree, repository: committed.repository, previousPin: committed });
  assert.deepEqual(pin, committed);
  assert.equal(committed.commit, '38e266b81e7b2e7247dfa2eea79821f754b04901', 'pinned to upstream 38e266b (Spec Harness 0.7.0, merged upstream as PR 41)');
  assert.equal(committed.harnessVersion, '0.7.0');
});
