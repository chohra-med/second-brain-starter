import assert from 'node:assert/strict';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { scanPackage } from '../lib/package-scan.mjs';
import { sha256 } from '../lib/installer.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

const vendorRoot = path.join(sourceRoot, 'vendor', 'spec-harness');
const pinPath = path.join(sourceRoot, 'vendor', 'SPEC-HARNESS-PIN.json');

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
  assert.ok(section.includes(pin.repository), 'attribution must name the upstream repository');
});

test('the real source root, vendored bytes included, passes the package scanner against FILE-ALLOWLIST.txt', async () => {
  const report = await scanPackage({ sourceRoot, allowlistPath: path.join(sourceRoot, 'FILE-ALLOWLIST.txt') });
  assert.deepEqual(report.findings.map((finding) => `${finding.rule} ${finding.path}`), [], 'scanner findings (rule and path)');
  assert.equal(report.clean, true);
});
