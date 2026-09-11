import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertCleanPackage, PackageScanError, scanDiffEntries, scanPackage } from '../lib/package-scan.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source with spaces');
  const archive = path.join(root, 'archive');
  await mkdir(source);
  await mkdir(archive);
  await writeFile(path.join(source, 'README.md'), '# clean\n');
  await writeFile(path.join(source, 'FILE-ALLOWLIST.txt'), 'FILE-ALLOWLIST.txt\nREADME.md\n');
  await writeFile(path.join(archive, 'README.md'), '# clean\n');
  await writeFile(path.join(archive, 'FILE-ALLOWLIST.txt'), 'FILE-ALLOWLIST.txt\nREADME.md\n');
  return { source, archive, allowlist: path.join(source, 'FILE-ALLOWLIST.txt') };
}

function encodedCredentialForms() {
  const key = ['api', '_key'].join('');
  const value = ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('');
  const material = `${key}=${value}`;
  const unicode = (text) => [...text].map((character) => `${String.fromCharCode(92)}u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const utf16be = Buffer.from(material, 'utf16le');
  utf16be.swap16();
  const ordinaryBase64 = Buffer.from(material).toString('base64');
  const ordinaryBase64Url = Buffer.from(material).toString('base64url');
  const chunks = (value, separator) => value.match(/.{1,8}/g).join(separator);
  return [
    { name: 'plain', bytes: Buffer.from(material), encoded: false },
    { name: 'html', bytes: Buffer.from([...material].map((character) => `&#${character.charCodeAt(0)};`).join('')), encoded: true },
    { name: 'json', bytes: Buffer.from(`{"${unicode(key)}":"${unicode(value)}"}`), encoded: true },
    { name: 'utf16le', bytes: Buffer.from(material, 'utf16le'), encoded: true },
    { name: 'utf16be', bytes: utf16be, encoded: true },
    { name: 'percent', bytes: Buffer.from([...material].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')), encoded: true },
    { name: 'base64', bytes: Buffer.from(ordinaryBase64), encoded: true },
    { name: 'base64url', bytes: Buffer.from(ordinaryBase64Url), encoded: true },
    ...[
      ['space', ' '],
      ['tab', '\t'],
      ['newline', '\n'],
      ['crlf', '\r\n'],
      ['mixed-whitespace', ' \t\r\n'],
    ].flatMap(([name, separator]) => [
      { name: `wrapped-base64-${name}`, bytes: Buffer.from(chunks(ordinaryBase64, separator)), encoded: true },
      { name: `wrapped-base64url-${name}`, bytes: Buffer.from(chunks(ordinaryBase64Url, separator)), encoded: true },
    ]),
  ];
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

test('scanner checks every shipped source byte and detects a credential planted in the shipped CRLF fixture', async (t) => {
  const clean = await assertCleanPackage({
    sourceRoot: packageRoot,
    allowlistPath: path.join(packageRoot, 'FILE-ALLOWLIST.txt'),
  });
  assert.equal(clean.clean, true);

  const root = await mkdtemp(path.join(tmpdir(), 'second-brain-security-crlf-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await cp(packageRoot, source, { recursive: true, filter: (candidate) => !candidate.includes(`${path.sep}.git`) });
  const fixture = path.join(source, 'test', 'fixtures', 'unmanaged-loader-crlf.md');
  const original = await readFile(fixture);
  const planted = Buffer.concat([
    original,
    Buffer.from(['\r\n', 'Authori', 'zation: ', 'Bearer ', 'CRLF-SYNTHETIC-ONLY'].join('')),
  ]);
  await writeFile(fixture, planted);
  await assert.rejects(
    () => assertCleanPackage({ sourceRoot: source, allowlistPath: path.join(source, 'FILE-ALLOWLIST.txt') }),
    (error) => {
      assert.ok(error instanceof PackageScanError);
      assert.deepEqual(error.report.findings, [{ path: 'test/fixtures/unmanaged-loader-crlf.md', rule: 'AUTHORIZATION_MATERIAL' }]);
      assert.equal(JSON.stringify(error.report).includes('CRLF-SYNTHETIC-ONLY'), false);
      return true;
    },
  );
});

test('scanner detects each documented encoded credential form in source, archive, and diff then returns green after restoration', async (t) => {
  const subject = await fixture(t);
  const member = 'encoded.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  for (const form of encodedCredentialForms()) {
    await writeFile(path.join(subject.source, member), form.bytes);
    await writeFile(path.join(subject.archive, member), form.bytes);
    const report = await scanPackage({
      sourceRoot: subject.source,
      archiveRoot: subject.archive,
      allowlistPath: subject.allowlist,
      diffEntries: [{ path: member, before: form.bytes }],
    });
    const expectedRule = `${form.encoded ? 'ENCODED_' : ''}CREDENTIAL_MATERIAL`;
    for (const section of [report.source, report.archive, report.diff]) {
      assert.equal(section.findings.some((finding) => finding.path === member && finding.rule === expectedRule), true, form.name);
    }
    assert.equal(JSON.stringify(report).includes('SYNTHETIC-ONLY-VALUE'), false);
    await writeFile(path.join(subject.source, member), '# clean\n');
    await writeFile(path.join(subject.archive, member), '# clean\n');
    const restored = await scanPackage({
      sourceRoot: subject.source,
      archiveRoot: subject.archive,
      allowlistPath: subject.allowlist,
      diffEntries: [{ path: member, before: '# clean\n' }],
    });
    assert.equal(restored.clean, true, `${form.name} restoration`);
  }
});

test('public documentation has valid relative links and explains personalized verify drift', async () => {
  for (const document of ['ATTRIBUTION.md', 'README.md', 'UPGRADING.md']) {
    const documentPath = path.join(packageRoot, document);
    const text = await readFile(documentPath, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      if (/^[a-z]+:/i.test(match[1])) continue;
      assert.equal((await lstat(path.resolve(path.dirname(documentPath), match[1]))).isFile(), true, `${document} -> ${match[1]}`);
    }
  }
  const upgrading = await readFile(path.join(packageRoot, 'UPGRADING.md'), 'utf8');
  const readme = await readFile(path.join(packageRoot, 'README.md'), 'utf8');
  assert.match(upgrading, /intentionally make baseline `verify` non-green/i);
  assert.match(upgrading, /not proof of damage/i);
  assert.match(readme, /Personalizing a managed record intentionally creates baseline drift/i);
});
