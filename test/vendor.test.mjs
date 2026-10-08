import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { scanPackage } from '../lib/package-scan.mjs';
import { sha256 } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const vendorRoot = path.join(sourceRoot, 'vendor', 'spec-harness');
const pinPath = path.join(sourceRoot, 'vendor', 'SPEC-HARNESS-PIN.json');

// Anchored: the URL must stand alone (preceded by start, space, '(', '<' or '[' and followed by
// a terminator), so a longer lookalike such as .../spec-harness-oss-evil does not satisfy it.
function namesRepository(text, repository) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s(<\\[])${escaped}(?=[\\s)>\\].,;]|$)`, 'm').test(text);
}

// Git tree object hash recomputed in Node (no git binary, so it also runs on Windows).
function gitHash(type, body) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])).digest();
}

function gitTreeHash(files) {
  const root = { files: [], dirs: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      if (!node.dirs.has(segment)) node.dirs.set(segment, { files: [], dirs: new Map() });
      node = node.dirs.get(segment);
    }
    node.files.push({ name: segments.at(-1), mode: file.mode, hash: file.blob });
  }
  const hashNode = (node) => {
    const entries = [
      ...node.files.map((file) => ({ sortKey: file.name, name: file.name, mode: file.mode, hash: file.hash })),
      ...[...node.dirs].map(([name, child]) => ({ sortKey: `${name}/`, name, mode: '40000', hash: hashNode(child) })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.sortKey), Buffer.from(right.sortKey)));
    return gitHash('tree', Buffer.concat(entries.map((entry) => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), entry.hash]))));
  };
  return hashNode(root).toString('hex');
}

async function readPin() {
  return JSON.parse(await readFile(pinPath, 'utf8'));
}

async function walk(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(path.join(directory, entry.name), relative)));
    else found.push(relative);
  }
  return found.sort();
}

test('Spec Harness pin record names a full commit and tree of the upstream repository', async () => {
  const pin = await readPin();
  assert.equal(pin.schemaVersion, 1);
  assert.equal(pin.repository, 'https://github.com/chohra-med/spec-harness-oss');
  assert.match(pin.commit, /^[0-9a-f]{40}$/, 'pin commit must be a full 40-hex SHA');
  assert.match(pin.tree, /^[0-9a-f]{40}$/, 'pin tree must be a full 40-hex SHA');
  assert.ok(Array.isArray(pin.sourceInventory) && pin.sourceInventory.length > 0, 'inventory must list files');
});

test('vendored Spec Harness tree is exactly the pinned inventory, with no extra, missing or non-regular file', async () => {
  const pin = await readPin();
  const listed = pin.sourceInventory.map((file) => file.path);
  assert.equal(new Set(listed).size, listed.length, 'inventory paths must be unique');
  const onDisk = await walk(vendorRoot);
  const extra = onDisk.filter((file) => !listed.includes(file));
  const missing = listed.filter((file) => !onDisk.includes(file));
  assert.deepEqual({ extra, missing }, { extra: [], missing: [] }, 'vendor/spec-harness differs from the pin inventory');
  for (const file of listed) {
    const stat = await lstat(path.join(vendorRoot, ...file.split('/')));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${file} must be a regular file`);
  }
});

test('every vendored file matches its pinned byte length and SHA-256', async () => {
  const pin = await readPin();
  const mismatched = [];
  for (const file of pin.sourceInventory) {
    let bytes;
    try {
      bytes = await readFile(path.join(vendorRoot, ...file.path.split('/')));
    } catch {
      mismatched.push(`${file.path}: unreadable`);
      continue;
    }
    if (bytes.length !== file.bytes) mismatched.push(`${file.path}: ${bytes.length} bytes, pinned ${file.bytes}`);
    if (sha256(bytes) !== file.sha256) mismatched.push(`${file.path}: sha256 differs from pin`);
  }
  assert.deepEqual(mismatched, [], 'vendored bytes differ from the pin');
});

test('FILE-ALLOWLIST.txt lists every vendored path and the pin record exactly once, and nothing else under vendor/', async () => {
  const pin = await readPin();
  const lines = (await readFile(path.join(sourceRoot, 'FILE-ALLOWLIST.txt'), 'utf8')).split(/\r?\n/).filter((line) => line.startsWith('vendor/'));
  const expected = ['vendor/SPEC-HARNESS-PIN.json', ...pin.sourceInventory.map((file) => `vendor/spec-harness/${file.path}`)].sort();
  assert.equal(new Set(lines).size, lines.length, 'allowlist must not repeat a vendor path');
  const sorted = [...lines].sort();
  assert.deepEqual(
    { notAllowlisted: expected.filter((file) => !sorted.includes(file)), notVendored: sorted.filter((file) => !expected.includes(file)) },
    { notAllowlisted: [], notVendored: [] },
  );
});

test('the vendored LICENSE is present, MIT, and matches the hash recorded in the pin', async () => {
  const pin = await readPin();
  assert.equal(pin.license.spdx, 'MIT');
  assert.equal(pin.license.path, 'LICENSE');
  let bytes;
  try {
    bytes = await readFile(path.join(vendorRoot, 'LICENSE'));
  } catch {
    assert.fail('vendor/spec-harness/LICENSE is missing');
  }
  assert.equal(sha256(bytes), pin.license.sha256, 'vendor/spec-harness/LICENSE differs from the pinned hash');
  assert.match(bytes.toString('utf8'), /^MIT License\b/);
});

test('ATTRIBUTION.md credits Spec Harness at the pinned commit and names no other commit in that section', async () => {
  const pin = await readPin();
  const attribution = await readFile(path.join(sourceRoot, 'ATTRIBUTION.md'), 'utf8');
  const heading = '## Bundled third-party system: Spec Harness';
  const start = attribution.indexOf(heading);
  assert.notEqual(start, -1, 'ATTRIBUTION.md must carry the Spec Harness section');
  const rest = attribution.slice(start + heading.length);
  const next = rest.search(/^## /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  assert.deepEqual([...new Set(section.match(/\b[0-9a-f]{40}\b/g) ?? [])], [pin.commit], 'attributed commit must equal the pin commit');
  assert.ok(namesRepository(section, pin.repository), 'attribution must name the upstream repository (whole URL, not a prefix of a longer one)');
});

test('the real source root, vendored bytes included, passes the package scanner against FILE-ALLOWLIST.txt', async () => {
  const report = await scanPackage({ sourceRoot, allowlistPath: path.join(sourceRoot, 'FILE-ALLOWLIST.txt') });
  assert.deepEqual(report.findings.map((finding) => `${finding.rule} ${finding.path}`), [], 'scanner findings (rule and path)');
  assert.equal(report.clean, true);
});

async function measuredTree(pin) {
  const files = [];
  for (const file of pin.sourceInventory) {
    const bytes = await readFile(path.join(vendorRoot, ...file.path.split('/')));
    files.push({ path: file.path, mode: file.executable === true ? '100755' : '100644', blob: gitHash('blob', bytes) });
  }
  return gitTreeHash(files);
}

test('the pinned git tree hash equals the tree recomputed from the vendored bytes, paths and recorded executable bits', async () => {
  const pin = await readPin();
  assert.ok(pin.sourceInventory.every((file) => file.executable === undefined || file.executable === true), 'executable is absent or true');
  assert.equal(pin.sourceInventory.filter((file) => file.executable === true).length, 11, 'the 11 executable paths are recorded');
  assert.equal(await measuredTree(pin), pin.tree, 'recomputed git tree differs from pin.tree');
});

test('the git tree recomputation is a real instrument: it matches a known git object and moves on a one-bit change', () => {
  // `git hash-object` of the empty blob and of an empty tree are fixed constants.
  assert.equal(gitHash('blob', Buffer.alloc(0)).toString('hex'), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(gitTreeHash([]), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  const blob = gitHash('blob', Buffer.from('x'));
  const plain = gitTreeHash([{ path: 'a/b.sh', mode: '100644', blob }]);
  assert.notEqual(plain, gitTreeHash([{ path: 'a/b.sh', mode: '100755', blob }]), 'an executable bit changes the tree');
  assert.notEqual(plain, gitTreeHash([{ path: 'a/c.sh', mode: '100644', blob }]), 'a path changes the tree');
  assert.notEqual(plain, gitTreeHash([{ path: 'a/b.sh', mode: '100644', blob: gitHash('blob', Buffer.from('y')) }]), 'bytes change the tree');
});

test('executable bits on disk match the pin inventory', { skip: process.platform === 'win32' && 'Windows checkouts carry no POSIX modes' }, async () => {
  const pin = await readPin();
  const wrong = [];
  for (const file of pin.sourceInventory) {
    const executable = ((await lstat(path.join(vendorRoot, ...file.path.split('/')))).mode & 0o111) !== 0;
    if (executable !== (file.executable === true)) wrong.push(`${file.path}: disk ${executable}, pin ${file.executable === true}`);
  }
  assert.deepEqual(wrong, []);
});

test('no vendored path can be executed by node --test (no .js, .mjs, .cjs or .ts file)', async () => {
  const pin = await readPin();
  const pattern = /\.(?:js|mjs|cjs|ts)$/i;
  assert.ok(pattern.test('planted/file.mjs') && pattern.test('x.CJS') && !pattern.test('x.sh'), 'control: the pattern fires on planted names');
  assert.deepEqual(pin.sourceInventory.map((file) => file.path).filter((file) => pattern.test(file)), []);
  assert.deepEqual((await walk(vendorRoot)).filter((file) => pattern.test(file)), []);
});

test('the attribution repository check is anchored: a longer lookalike URL does not satisfy it', async () => {
  const repository = (await readPin()).repository;
  assert.ok(namesRepository(`See ${repository}.`, repository));
  assert.ok(namesRepository(`[x](${repository})`, repository));
  assert.ok(namesRepository(`<${repository}>`, repository));
  assert.ok(!namesRepository(`See ${repository}-evil for more`, repository));
  assert.ok(!namesRepository(`https://example.invalid/${repository}`, repository));
  assert.ok(!namesRepository(`prefix${repository}`, repository));
});
