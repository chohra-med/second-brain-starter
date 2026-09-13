import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertCleanPackage, PackageScanError, scanDiffEntries, scanPackage, sensitiveContentRules } from '../lib/package-scan.mjs';
import { planApprovedChange, sha256 } from '../lib/installer.mjs';

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

test('scanner detects Base64 and Base64URL credential runs at widths 1-16 across every whitespace separator and prose context', async (t) => {
  const subject = await fixture(t);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const owner = path.join(subject.source, 'approved.md');
  await writeFile(owner, 'before\n');
  const separators = [' ', '\t', '\n', '\r\n', ' \t\r\n'];
  for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (let width = 1; width <= 16; width += 1) {
      for (const separator of separators) {
        const wrapped = encoded.match(new RegExp(`.{1,${width}}`, 'g')).join(separator);
        const surrounded = Buffer.from(`prefix prose ${wrapped} suffix prose`);
        assert.ok(sensitiveContentRules(surrounded).some((rule) => rule.includes('CREDENTIAL')), `${encoding} width ${width} ${JSON.stringify(separator)}`);
        const report = await scanPackage({
          sourceRoot: subject.source,
          archiveRoot: subject.archive,
          allowlistPath: subject.allowlist,
          diffEntries: [{ path: 'before.md', before: surrounded, after: surrounded }],
        });
        assert.ok(report.findings.some((finding) => finding.rule.includes('CREDENTIAL')), `shared scan ${encoding} width ${width}`);
        const postimageSha256 = sha256(surrounded);
        await assert.rejects(
          () => planApprovedChange({
            targetPath: subject.source,
            owner: 'approved.md',
            allowedOwners: ['approved.md'],
            preimageSha256: sha256(Buffer.from('before\n')),
            postimage: surrounded,
            postimageSha256,
            evidenceDigest: '1'.repeat(64),
          }),
          (error) => error?.code === 'SECRET_BEARING_CONTENT',
        );
      }
    }
  }
});

test('scanner detects punctuation-attached Base64 and Base64URL chunks at widths 1-16', async () => {
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const separators = [' ', '\t', '\n', '\r\n', ' \t\r\n'];
  const attachedPunctuation = ['(', ')', '"', "'", ',', '.'];
  for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (let width = 1; width <= 16; width += 1) {
      for (const separator of separators) {
        const chunks = encoded.match(new RegExp(`.{1,${width}}`, 'g'));
        for (const punctuation of attachedPunctuation) {
          const prefixAttached = `${punctuation}${chunks[0]}${separator}${chunks.slice(1).join(separator)}`;
          const suffixAttached = `${chunks.slice(0, -1).join(separator)}${separator}${chunks.at(-1)}${punctuation}`;
          for (const wrapped of [prefixAttached, suffixAttached]) {
            assert.ok(
              sensitiveContentRules(Buffer.from(`prefix prose ${wrapped} suffix prose`)).some((rule) => rule.includes('CREDENTIAL')),
              `${encoding} width ${width} ${JSON.stringify(separator)} ${punctuation}`,
            );
          }
        }
      }
    }
  }
});

test('scanner retains wrapped chunks beside ordinary lexical text and ambiguous edge punctuation', () => {
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const separators = [' ', '\t', '\n', '\r\n', ' \t\r\n'];
  const ordinaryWords = ['word', 'route', 'notes'];
  const contexts = [
    ['word(', ')word'], ['word[', ']word'], ['word{', '}word'], ['word<', '>word'],
    ['(', ')word'], ['word(', ')'], ['word"', '"word'], ["word'", "'word"], ['word`', '`word'],
    ['word,', ',word'], ['word.', '.word'], ['word:', ':word'], ['word;', ';word'],
    ['word*', '*word'], ['word#', '#word'], ['word~', '~word'], ['word/', '/word'],
    ['word+', '+word'], ['word-', '-word'], ['word_', '_word'],
  ];
  for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (let width = 1; width <= 16; width += 1) {
      const chunks = encoded.match(new RegExp(`.{1,${width}}`, 'g'));
      for (const separator of separators) {
        for (const [prefix, suffix] of contexts) {
          for (const word of ordinaryWords.slice(0, 1)) {
            const left = prefix.replace('word', word);
            const right = suffix.replace('word', word);
            const wrapped = `${left}${chunks[0]}${separator}${chunks.slice(1, -1).join(separator)}${separator}${chunks.at(-1)}${right}`;
            assert.ok(sensitiveContentRules(Buffer.from(wrapped)).some((rule) => rule.includes('CREDENTIAL')), `${encoding} width ${width} ${JSON.stringify(separator)} ${prefix}/${suffix}`);
          }
        }
      }
    }
  }
});

test('scanner rejects ordinary-adjacent and ambiguous-edge material across shared scans and approved writes', async (t) => {
  const subject = await fixture(t);
  const member = 'lexical-adjacency.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const chunks = encoded.match(/.{1,8}/g);
  const planted = Buffer.from(`word(${chunks[0]} ${chunks.slice(1, -1).join(' ')} ${chunks.at(-1)})word`);
  await writeFile(path.join(subject.source, member), planted);
  await writeFile(path.join(subject.archive, member), planted);
  const report = await scanPackage({ sourceRoot: subject.source, archiveRoot: subject.archive, allowlistPath: subject.allowlist, diffEntries: [{ path: member, before: planted, after: planted }] });
  for (const section of [report.source, report.archive, report.diff]) assert.equal(section.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
  await assert.rejects(() => planApprovedChange({ targetPath: subject.source, owner: member, allowedOwners: [member], preimageSha256: sha256(Buffer.from('before\n')), postimage: planted, postimageSha256: sha256(planted), evidenceDigest: '1'.repeat(64) }), (error) => error?.code === 'SECRET_BEARING_CONTENT');
  const edgeCases = ['-', '_', '/'].map((edge) => Buffer.from(`${edge}${chunks[0]} ${chunks.slice(1).join(' ')}`));
  for (const edgeCase of edgeCases) assert.ok(sensitiveContentRules(edgeCase).some((rule) => rule.includes('CREDENTIAL')));
});

test('scanner reconstructs generated UTF-8-prefixed credentials without flattening lexical alternatives', () => {
  const prefixes = ['é', '€', '漢'];
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const separators = [' ', '\t', '\n', '\r\n', ' \t\r\n'];
  let cases = 0;
  for (const prefix of prefixes) for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(`${prefix}${material}`).toString(encoding);
    for (let width = 1; width <= 16; width += 1) for (const separator of separators) {
      const wrapped = encoded.match(new RegExp(`.{1,${width}}`, 'g')).join(separator);
      assert.ok(sensitiveContentRules(Buffer.from(wrapped)).some((rule) => rule.includes('CREDENTIAL')), `${encoding} width ${width} ${JSON.stringify(separator)}`);
      cases += 1;
    }
  }
  assert.equal(cases, 480);
});

test('scanner retains chunks after repeated mixed ambiguous lexical prefixes', () => {
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const chunks = encoded.match(/.{1,8}/g);
  const prefixes = [
    'alpha-beta-gamma-delta-',
    'identifier_one_two_three_',
    'path/segment/branch/',
    'C++-template/operator+',
  ];
  for (const prefix of prefixes) {
    const wrapped = `${prefix}${chunks[0]} ${chunks.slice(1).join(' ')}`;
    assert.ok(sensitiveContentRules(Buffer.from(wrapped)).some((rule) => rule.includes('CREDENTIAL')), prefix);
  }
});

test('scanner preserves long lexical runs as source positions around wrapped credentials', () => {
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const separators = [' ', '\t', '\n', '\r\n', ' \t\r\n'];
  const lengths = [17, 32, 128];
  const contexts = (length) => {
    const alpha = 'a'.repeat(length);
    const mixed = `${'alpha-beta_'.repeat(Math.ceil(length / 11))}`.slice(0, length);
    return [alpha, mixed];
  };
  let cases = 0;
  for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (let width = 1; width <= 16; width += 1) {
      const chunks = encoded.match(new RegExp(`.{1,${width}}`, 'g'));
      for (const separator of separators) for (const length of lengths) for (const prefix of contexts(length)) {
        const prefixCase = `${prefix}${chunks[0]}${separator}${chunks.slice(1).join(separator)}`;
        const suffixCase = `${chunks.slice(0, -1).join(separator)}${separator}${chunks.at(-1)}${prefix}`;
        const pairedCase = `${prefix}${chunks[0]}${separator}${chunks.slice(1, -1).join(separator)}${separator}${chunks.at(-1)}${prefix}`;
        for (const value of [prefixCase, suffixCase, pairedCase]) {
          assert.ok(sensitiveContentRules(Buffer.from(value)).some((rule) => rule.includes('CREDENTIAL')), `${encoding} width ${width} length ${length} ${JSON.stringify(separator)}`);
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 2880);
});

test('long lexical prefix rejects across shared scans and approved change without writing', async (t) => {
  const subject = await fixture(t);
  const member = 'long-prefix.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const chunks = encoded.match(/.{1,8}/g);
  const planted = Buffer.from(`${'alpha-beta_'.repeat(3)}${chunks[0]} ${chunks.slice(1).join(' ')}`);
  await writeFile(path.join(subject.source, member), planted);
  await writeFile(path.join(subject.archive, member), planted);
  const report = await scanPackage({ sourceRoot: subject.source, archiveRoot: subject.archive, allowlistPath: subject.allowlist, diffEntries: [{ path: member, before: planted, after: planted }] });
  for (const section of [report.source, report.archive, report.diff]) assert.equal(section.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
  await assert.rejects(() => planApprovedChange({ targetPath: subject.source, owner: member, allowedOwners: [member], preimageSha256: sha256(Buffer.from('before\n')), postimage: planted, postimageSha256: sha256(planted), evidenceDigest: '1'.repeat(64) }), (error) => error?.code === 'SECRET_BEARING_CONTENT');
  assert.deepEqual(await readFile(path.join(subject.source, member)), planted);
});

test('scanner requires the final chunk when a long lexical suffix is attached', () => {
  const materials = [
    [['api', '_key='].join(''), '12345678'].join(''),
    [['sec', 'ret='].join(''), '12345678'].join(''),
    [['pass', 'word='].join(''), '12345678'].join(''),
  ];
  const lengths = [17, 32, 128];
  let cases = 0;
  for (const material of materials) for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (let width = 1; width <= 16; width += 1) {
      const chunks = encoded.match(new RegExp(`.{1,${width}}`, 'g'));
      for (const length of lengths) {
        const suffix = `${'alpha-beta_'.repeat(Math.ceil(length / 11))}`.slice(0, length);
        const wrapped = `${chunks.slice(0, -1).join(' ')} ${chunks.at(-1)}${suffix}`;
        assert.ok(sensitiveContentRules(Buffer.from(wrapped)).some((rule) => rule.includes('CREDENTIAL')), `${material} ${encoding} width ${width} length ${length}`);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 288);
});

test('scanner detects complete unwrapped credentials fused inside long lexical runs', () => {
  const materials = [
    [['api', '_key='].join(''), '12345678'].join(''),
    [['sec', 'ret='].join(''), '123456789'].join(''),
    [['access', '_token='].join(''), '12345678901234567890123456789012'].join(''),
    [['pass', 'word='].join(''), '12345678'].join(''),
  ];
  const contexts = [1, 17, 128, 1024];
  const placements = ['prefix', 'suffix', 'paired'];
  let cases = 0;
  for (const material of materials) for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (const length of contexts) {
      const context = `${'alpha'.repeat(Math.ceil(length / 5))}`.slice(0, length);
      for (const placement of placements) {
        const fused = placement === 'prefix' ? `${context}${encoded}` : placement === 'suffix' ? `${encoded}${context}` : `${context}${encoded}${context}`;
        assert.ok(sensitiveContentRules(Buffer.from(fused)).some((rule) => rule.includes('CREDENTIAL')), `${encoding} ${material.slice(0, 4)} ${length} ${placement}`);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 96);
});

test('scanner detects case-variant unwrapped credentials fused inside long lexical runs', () => {
  const materials = [
    [['API', '_KEY='].join(''), '12345678'].join(''),
    [['SeCr', 'Et='].join(''), '12345678'].join(''),
    [['ACCESS', '_ToKeN='].join(''), '12345678'].join(''),
    [['Pass', 'WORD='].join(''), '12345678'].join(''),
  ];
  let cases = 0;
  for (const material of materials) for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.from(material).toString(encoding);
    for (const placement of ['prefix', 'suffix', 'paired']) {
      const context = 'ordinary'.repeat(16);
      const fused = placement === 'prefix' ? `${context}${encoded}` : placement === 'suffix' ? `${encoded}${context}` : `${context}${encoded}${context}`;
      assert.ok(sensitiveContentRules(Buffer.from(fused)).some((rule) => rule.includes('CREDENTIAL')), `${encoding} ${placement}`);
      cases += 1;
    }
  }
  assert.equal(cases, 24);
});

test('scanner detects phase-shifted assignments inside fused Base64 runs', () => {
  const spellings = ['api-key', 'api_key', 'apikey', 'secret', 'access-token', 'access_token', 'password'];
  const utf8Contexts = ['é', '€', '漢'];
  const outerLengths = [1, 17, 128, 1024];
  const valueLengths = [8, 9, 32, 128];
  const caseVariant = (value, variant) => {
    if (variant === 0) return value.toLowerCase();
    if (variant === 1) return value.toUpperCase();
    return [...value].map((character, index) => index % 2 === 0 ? character.toUpperCase() : character.toLowerCase()).join('');
  };
  let cases = 0;
  for (const spelling of spellings) for (const encoding of ['base64', 'base64url']) {
    for (const placement of ['prefix', 'suffix', 'paired']) for (const outerLength of outerLengths) {
      for (let variant = 0; variant < 3; variant += 1) {
        const utf8 = utf8Contexts[(cases + variant) % utf8Contexts.length];
        const key = caseVariant(spelling, variant);
        const delimiter = (cases + variant) % 2 === 0 ? '=' : ':';
        const quote = ['', "'", '"'][(cases + variant) % 3];
        const spacing = ['', ' ', '  '][(cases + outerLength) % 3];
        const value = 'v'.repeat(valueLengths[(cases + variant) % valueLengths.length]);
        const material = `${utf8} ${key}${spacing}${delimiter}${spacing}${quote}${value}${quote} ${utf8}`;
        const encoded = Buffer.from(material).toString(encoding);
        const context = 'a'.repeat(outerLength);
        const fused = placement === 'prefix' ? `${context}${encoded}` : placement === 'suffix' ? `${encoded}${context}` : `${context}${encoded}${context}`;
        assert.ok(sensitiveContentRules(Buffer.from(fused)).some((rule) => rule.includes('CREDENTIAL')), `${spelling} ${encoding} ${placement} ${outerLength} ${variant}`);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 504);

  const encoded = Buffer.from(`€ ${['api', 'key'].join('-')}=${'1'.repeat(8)}`).toString('base64url');
  for (let phase = 0; phase < 4; phase += 1) {
    const fused = `${'a'.repeat(phase)}${encoded}`;
    assert.ok(sensitiveContentRules(Buffer.from(fused)).some((rule) => rule.includes('CREDENTIAL')), `textual phase ${phase}`);
  }

  for (const encoding of ['base64', 'base64url']) {
    const safe = Buffer.from('ordinary documentation value with no assignment').toString(encoding);
    assert.deepEqual(sensitiveContentRules(Buffer.from(`a${safe}${'a'.repeat(1024)}`)), []);
  }
});

test('scanner rejects an unwrapped fused credential across shared scans without writing', async (t) => {
  const subject = await fixture(t);
  const member = 'unwrapped-fused.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  const material = [['api', '_key='].join(''), '12345678901234567890123456789012'].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const planted = Buffer.from(`${'ordinary'.repeat(16)}${encoded}${'suffix'.repeat(16)}`);
  await writeFile(path.join(subject.source, member), planted);
  await writeFile(path.join(subject.archive, member), planted);
  const report = await scanPackage({ sourceRoot: subject.source, archiveRoot: subject.archive, allowlistPath: subject.allowlist, diffEntries: [{ path: member, before: planted, after: planted }] });
  for (const section of [report.source, report.archive, report.diff]) assert.equal(section.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
  await assert.rejects(() => planApprovedChange({ targetPath: subject.source, owner: member, allowedOwners: [member], preimageSha256: sha256(Buffer.from('before\n')), postimage: planted, postimageSha256: sha256(planted), evidenceDigest: '1'.repeat(64) }), (error) => error?.code === 'SECRET_BEARING_CONTENT');
  assert.deepEqual(await readFile(path.join(subject.source, member)), planted);
});

test('scanner keeps overlapping unwrapped windows bounded through 1 MB and late hostile input', () => {
  const material = [['secret=', '12345678901234567890123456789012'].join('')];
  const encoded = Buffer.from(material[0]).toString('base64url');
  const sizes = [1024, 10240, 102400, 1048576];
  const timings = [];
  for (const size of sizes) {
    const safe = Buffer.from('s'.repeat(size));
    const start = performance.now();
    assert.deepEqual(sensitiveContentRules(safe), []);
    const safeMs = performance.now() - start;
    const hostile = Buffer.concat([safe, Buffer.from(encoded)]);
    const hostileStart = performance.now();
    assert.ok(sensitiveContentRules(hostile).some((rule) => rule.includes('CREDENTIAL')));
    const hostileMs = performance.now() - hostileStart;
    timings.push({ size, safeMs: Math.round(safeMs), hostileMs: Math.round(hostileMs) });
  }
  assert.ok(timings.every(({ safeMs, hostileMs }) => safeMs < 5000 && hostileMs < 5000), JSON.stringify(timings));
});

test('generated UTF-8-prefixed width-2 and width-3 credentials reject across shared surfaces and do not write', async (t) => {
  const subject = await fixture(t);
  const member = 'generated-prefix.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  let finalWrapped;
  for (const width of [2, 3]) {
    const encoded = Buffer.from(`€${material}`).toString('base64');
    const wrapped = Buffer.from(encoded.match(new RegExp(`.{1,${width}}`, 'g')).join(' '));
    finalWrapped = wrapped;
    await writeFile(path.join(subject.source, member), wrapped);
    await writeFile(path.join(subject.archive, member), wrapped);
    const report = await scanPackage({ sourceRoot: subject.source, archiveRoot: subject.archive, allowlistPath: subject.allowlist, diffEntries: [{ path: member, before: wrapped, after: wrapped }] });
    assert.equal(report.source.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
    assert.equal(report.archive.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
    assert.equal(report.diff.findings.filter((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL').length >= 2, true);
    await assert.rejects(() => planApprovedChange({ targetPath: subject.source, owner: member, allowedOwners: [member], preimageSha256: sha256(Buffer.from('# clean\n')), postimage: wrapped, postimageSha256: sha256(wrapped), evidenceDigest: '1'.repeat(64) }), (error) => error?.code === 'SECRET_BEARING_CONTENT');
  }
  assert.deepEqual(await readFile(path.join(subject.source, member)), finalWrapped);
});

test('scanner rejects a representative punctuation-attached credential on every shared scan surface and approved change', async (t) => {
  const subject = await fixture(t);
  const member = 'attached.md';
  await writeFile(subject.allowlist, `FILE-ALLOWLIST.txt\nREADME.md\n${member}\n`);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const chunks = encoded.match(/.{1,8}/g);
  const planted = Buffer.from(`prefix (${chunks[0]} ${chunks.slice(1, -1).join(' ')} ${chunks.at(-1)}. suffix`);
  await writeFile(path.join(subject.source, member), planted);
  await writeFile(path.join(subject.archive, member), planted);
  const report = await scanPackage({
    sourceRoot: subject.source,
    archiveRoot: subject.archive,
    allowlistPath: subject.allowlist,
    diffEntries: [{ path: member, before: planted, after: planted }],
  });
  for (const section of [report.source, report.archive, report.diff]) {
    assert.equal(section.findings.some((finding) => finding.path === member && finding.rule === 'ENCODED_CREDENTIAL_MATERIAL'), true);
  }
  const postimageSha256 = sha256(planted);
  await assert.rejects(
    () => planApprovedChange({
      targetPath: subject.source,
      owner: member,
      allowedOwners: [member],
      preimageSha256: sha256(Buffer.from('before\n')),
      postimage: planted,
      postimageSha256,
      evidenceDigest: '1'.repeat(64),
    }),
    (error) => error?.code === 'SECRET_BEARING_CONTENT',
  );
});

test('scanner keeps benign prose, technical tokens, safe encoding, and bounded large input clean', () => {
  const safeEncoded = Buffer.from('ordinary documentation only').toString('base64');
  const inputs = [
    'Natural prose about an API key-shaped phrase without a value.',
    'Base64-like technical token QWxhZGRpbjpvcGVuIHNlc2FtZQ== is documentation.',
    `encoded safe prose: ${safeEncoded}`,
    `${'safe prose '.repeat(20000)}END`,
  ];
  for (const input of inputs) assert.deepEqual(sensitiveContentRules(Buffer.from(input)), []);
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(material).toString('base64url');
  const chunks = encoded.match(/.{1,8}/g);
  const afterLargeBenignPrefix = `${'safe '.repeat(2000)}(${chunks[0]} ${chunks.slice(1).join(' ')})`;
  assert.ok(sensitiveContentRules(Buffer.from(afterLargeBenignPrefix)).includes('CREDENTIAL_MATERIAL'));
});

test('scanner detects late hostile content at bounded benign input sizes', () => {
  const material = [['api', '_key='].join(''), ['SYNTHETIC', '-', 'ONLY', '-', 'VALUE'].join('')].join('');
  const encoded = Buffer.from(`é${material}`).toString('base64url');
  const wrapped = encoded.match(/.{1,3}/g).join(' ');
  for (const size of [1024, 10240, 102400]) {
    const input = Buffer.from(`${'safe prose '.repeat(Math.ceil(size / 11))} ${wrapped}`.slice(-size - wrapped.length));
    const started = Date.now();
    assert.ok(sensitiveContentRules(input).some((rule) => rule.includes('CREDENTIAL')));
    assert.ok(Date.now() - started < 10000, `bounded scan ${size}`);
  }
});

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
