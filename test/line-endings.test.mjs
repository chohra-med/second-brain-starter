import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstallPlanError, sha256, validateManifest } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

test('distribution attributes require LF checkout bytes for manifest-backed text', async () => {
  const attributes = await readFile(path.join(sourceRoot, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);

  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  for (const entry of manifest.entries) {
    const bytes = await readFile(path.join(sourceRoot, ...entry.source.split('/')));
    assert.equal(sha256(bytes), entry.sha256, entry.source);
  }
});

test('CRLF source drift is rejected until the source bytes are normalized to LF', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-line-endings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const source = 'template/Home.md';
  const destination = 'Home.md';
  const lfBytes = Buffer.from('# Home\n');
  await mkdir(path.join(sourceRoot, 'template'), { recursive: true });
  await writeFile(path.join(sourceRoot, ...source.split('/')), lfBytes);
  const manifest = {
    schemaVersion: 1,
    metadata: { templateVersion: '1.1.0' },
    entries: [{ source, destination, sha256: sha256(lfBytes), mergeKind: 'managed-file' }],
  };

  await validateManifest({ manifest, sourceRoot });
  await writeFile(path.join(sourceRoot, ...source.split('/')), '# Home\r\n');
  await assert.rejects(
    () => validateManifest({ manifest, sourceRoot }),
    (error) => error instanceof InstallPlanError && error.code === 'SOURCE_HASH_MISMATCH',
  );
  await writeFile(path.join(sourceRoot, ...source.split('/')), lfBytes);
  await validateManifest({ manifest, sourceRoot });
});
