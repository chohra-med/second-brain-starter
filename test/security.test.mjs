import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCleanPackage, PackageScanError, scanDiffEntries, scanPackage } from '../lib/package-scan.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const archive = path.join(root, 'archive');
  await mkdir(source);
  await mkdir(archive);
  await writeFile(path.join(source, 'README.md'), '# clean\n');
  await writeFile(path.join(source, 'FILE-ALLOWLIST.txt'), 'FILE-ALLOWLIST.txt\nREADME.md\n');
  await writeFile(path.join(archive, 'README.md'), '# clean\n');
  await writeFile(path.join(archive, 'FILE-ALLOWLIST.txt'), 'FILE-ALLOWLIST.txt\nREADME.md\n');
  return { source, archive, allowlist: path.join(source, 'FILE-ALLOWLIST.txt') };
}

test('scanner enumerates source, archive, and declared diff paths without echoing content', async (t) => {
  const subject = await fixture(t);
  const report = await assertCleanPackage({
    sourceRoot: subject.source,
    archiveRoot: subject.archive,
    allowlistPath: subject.allowlist,
    diffEntries: [{ path: 'README.md', before: '# old\n', after: '# clean\n' }],
  });
  assert.deepEqual(report.source.paths, ['FILE-ALLOWLIST.txt', 'README.md']);
  assert.deepEqual(report.archive.paths, ['FILE-ALLOWLIST.txt', 'README.md']);
  assert.deepEqual(report.diff.paths, ['README.md']);
  assert.equal(report.clean, true);
});

test('scanner rejects synthetic secrets, private paths, encoded material, premium markers, and unallowlisted members then returns green after restoration', async (t) => {
  const subject = await fixture(t);
  const planted = path.join(subject.source, 'planted.md');
  const authorization = ['Authori', 'zation: ', 'Bearer ', 'SYNTHETIC-ONLY-DO-NOT-USE'].join('');
  const jwt = ['eyJzdWJqZWN0IjoiZmFrZSJ9', 'eyJleHAiOjE3MDAwMDAwMDB9', 'signature'].join('.');
  const credential = ['api', '_key=', 'SYNTHETIC-ONLY-DO-NOT-USE'].join('');
  const personalPath = ['/', 'Users', '/synthetic-user/project'].join('');
  const premium = ['premium', '-', 'only'].join('');
  const encodedAuthorization = Buffer.from(['Authori', 'zation: ', 'Bearer ', 'ENCODED-SYNTHETIC-ONLY'].join('')).toString('base64');
  await writeFile(planted, [
    authorization,
    jwt,
    credential,
    personalPath,
    premium,
    encodedAuthorization,
  ].join('\n'));
  await writeFile(path.join(subject.source, '.env.local'), 'synthetic');

  await assert.rejects(
    () => assertCleanPackage({ sourceRoot: subject.source, allowlistPath: subject.allowlist }),
    (error) => {
      assert.ok(error instanceof PackageScanError);
      assert.equal(error.code, 'PACKAGE_SCAN_FAILED');
      assert.deepEqual(
        new Set(error.report.findings.map((finding) => finding.rule)),
        new Set([
          'AUTHORIZATION_MATERIAL',
          'CREDENTIAL_MATERIAL',
          'ENCODED_AUTHORIZATION_MATERIAL',
          'JWT_MATERIAL',
          'PERSONAL_ABSOLUTE_PATH',
          'PREMIUM_MARKER',
          'PRIVATE_PATH',
          'UNALLOWLISTED_MEMBER',
        ]),
      );
      assert.equal(JSON.stringify(error.report).includes('SYNTHETIC-ONLY-DO-NOT-USE'), false);
      return true;
    },
  );

  await rm(planted);
  await rm(path.join(subject.source, '.env.local'));
  const restored = await assertCleanPackage({ sourceRoot: subject.source, allowlistPath: subject.allowlist });
  assert.equal(restored.clean, true);
});

test('scanner marks unsafe archive members and sensitive diff bytes by exact path and rule', async (t) => {
  const subject = await fixture(t);
  await symlink(path.join(subject.archive, 'README.md'), path.join(subject.archive, 'linked.md'));
  const report = await scanPackage({ sourceRoot: subject.source, archiveRoot: subject.archive, allowlistPath: subject.allowlist });
  assert.deepEqual(report.findings, [{ path: 'linked.md', rule: 'SYMLINK_MEMBER' }]);

  const diff = scanDiffEntries([{ path: 'docs/change.md', after: ['pass', 'word=synthetic-value'].join('') }]);
  assert.deepEqual(diff.findings, [{ path: 'docs/change.md', rule: 'CREDENTIAL_MATERIAL' }]);
});
