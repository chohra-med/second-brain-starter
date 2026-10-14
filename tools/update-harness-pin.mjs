#!/usr/bin/env node
// Regenerates vendor/spec-harness/ and vendor/SPEC-HARNESS-PIN.json from one exported
// upstream commit, and updates the vendor lines of FILE-ALLOWLIST.txt and the commit
// line of ATTRIBUTION.md.
//
// usage:
//   git -C <harness checkout> archive <COMMIT> | tar -x -C <EXPORT>
//   node tools/update-harness-pin.mjs --source <EXPORT> --commit <COMMIT> --tree <TREE>
//        [--repository URL] [--dry-run] [--accept-license-change]
//
// <TREE> is `git -C <harness checkout> rev-parse <COMMIT>^{tree}`. The tool recomputes
// that git tree hash from the exported bytes, paths and executable bits, so the export
// must be exactly the committed tree: a working tree, a dirty checkout or a copy with
// one changed byte is refused. A folder that contains .git is refused outright. The
// tool starts no process and opens no network connection; it writes only inside this
// checkout, and only after every check passed. --dry-run checks and prints, writing nothing.
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'https://github.com/chohra-med/spec-harness-oss';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class PinError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new PinError(code, message);
};

function gitObject(type, body) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])).digest();
}

export function gitTreeHash(files) {
  const root = { files: [], dirs: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      if (!node.dirs.has(segment)) node.dirs.set(segment, { files: [], dirs: new Map() });
      node = node.dirs.get(segment);
    }
    node.files.push({ name: segments.at(-1), mode: file.executable ? '100755' : '100644', hash: gitObject('blob', file.bytes) });
  }
  const hashNode = (node) => {
    const entries = [
      ...node.files.map((file) => ({ sortKey: file.name, name: file.name, mode: file.mode, hash: file.hash })),
      ...[...node.dirs].map(([name, child]) => ({ sortKey: `${name}/`, name, mode: '40000', hash: hashNode(child) })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.sortKey), Buffer.from(right.sortKey)));
    return gitObject('tree', Buffer.concat(entries.map((entry) => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), entry.hash]))));
  };
  return hashNode(root).toString('hex');
}

async function walk(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.name === '.git') refuse('NOT_AN_EXPORT', `The source contains .git (${relative}). Pass a folder made with git archive, not a checkout: a working tree can hold uncommitted changes.`);
    if (entry.isSymbolicLink()) refuse('UNSUPPORTED_ENTRY', `The source contains a symlink, which the pin cannot record: ${relative}`);
    if (entry.isDirectory()) found.push(...(await walk(full, relative)));
    else if (entry.isFile()) found.push(relative);
    else refuse('UNSUPPORTED_ENTRY', `The source contains an entry that is not a regular file: ${relative}`);
  }
  return found;
}

/** Reads and checks an export. Returns the pin it would write; writes nothing. */
export async function buildPin({ source, commit, tree, repository = DEFAULT_REPOSITORY, previousPin = null, acceptLicenseChange = false }) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) refuse('USAGE', '--commit must be a full 40-character commit.');
  if (!/^[0-9a-f]{40}$/.test(tree ?? '')) refuse('USAGE', '--tree must be the full 40-character tree of that commit.');
  const stat = await lstat(source).catch(() => null);
  if (!stat?.isDirectory()) refuse('USAGE', `--source must be an existing folder: ${source}`);
  const paths = (await walk(source)).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const files = [];
  for (const file of paths) {
    const full = path.join(source, ...file.split('/'));
    const bytes = await readFile(full);
    const executable = process.platform === 'win32' ? false : ((await lstat(full)).mode & 0o111) !== 0;
    files.push({ path: file, bytes, executable });
  }
  const recomputed = gitTreeHash(files);
  if (recomputed !== tree) {
    refuse('TREE_MISMATCH', `The exported files hash to tree ${recomputed}, not ${tree}. The source is not exactly that commit (a dirty or partial copy, or a different commit). Nothing was written.`);
  }
  const license = files.find((file) => file.path === 'LICENSE');
  if (!license) refuse('LICENSE_MISSING', 'The export has no LICENSE file at its root. Nothing was written.');
  if (!/^MIT License\r?\n/.test(license.bytes.toString('utf8'))) refuse('LICENSE_MISMATCH', 'The export LICENSE is not the MIT license text. Nothing was written.');
  const licenseSha256 = sha256(license.bytes);
  if (previousPin && previousPin.license?.sha256 !== licenseSha256 && !acceptLicenseChange) {
    refuse('LICENSE_MISMATCH', `The LICENSE changed since the current pin (${previousPin.license?.sha256} -> ${licenseSha256}). Review it, then rerun with --accept-license-change. Nothing was written.`);
  }
  const manifestFile = files.find((file) => file.path === 'install-manifest.json');
  if (!manifestFile) refuse('MANIFEST_MISSING', 'The export has no install-manifest.json. Nothing was written.');
  const harnessVersion = JSON.parse(manifestFile.bytes.toString('utf8')).harnessVersion;
  if (typeof harnessVersion !== 'string' || harnessVersion.length === 0) refuse('MANIFEST_INVALID', 'install-manifest.json has no harnessVersion.');
  const sourceInventory = files.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes), ...(file.executable ? { executable: true } : {}) }));
  return {
    pin: { schemaVersion: 1, repository, commit, tree, harnessVersion, license: { spdx: 'MIT', path: 'LICENSE', sha256: licenseSha256 }, sourceInventory },
    files,
  };
}

function replaceVendorLines(allowlist, inventory) {
  const lines = allowlist.split('\n');
  const kept = lines.filter((line) => !line.startsWith('vendor/spec-harness/'));
  const at = lines.findIndex((line) => line.startsWith('vendor/spec-harness/'));
  const insertAt = at === -1 ? kept.indexOf('vendor/SPEC-HARNESS-PIN.json') + 1 : lines.slice(0, at).filter((line) => !line.startsWith('vendor/spec-harness/')).length;
  kept.splice(insertAt, 0, ...inventory.map((entry) => `vendor/spec-harness/${entry.path}`));
  return kept.join('\n');
}

export async function writePin({ root = repoRoot, built, previousPin }) {
  const vendorDirectory = path.join(root, 'vendor', 'spec-harness');
  await rm(vendorDirectory, { recursive: true, force: true });
  for (const file of built.files) {
    const destination = path.join(vendorDirectory, ...file.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes);
    await chmod(destination, file.executable ? 0o755 : 0o644);
  }
  await writeFile(path.join(root, 'vendor', 'SPEC-HARNESS-PIN.json'), `${JSON.stringify(built.pin, null, 2)}\n`);
  const allowlistPath = path.join(root, 'FILE-ALLOWLIST.txt');
  await writeFile(allowlistPath, replaceVendorLines(await readFile(allowlistPath, 'utf8'), built.pin.sourceInventory));
  const attributionPath = path.join(root, 'ATTRIBUTION.md');
  let attribution = await readFile(attributionPath, 'utf8');
  if (previousPin) {
    attribution = attribution.split(previousPin.commit).join(built.pin.commit)
      .replace(`harness version ${previousPin.harnessVersion}`, `harness version ${built.pin.harnessVersion}`);
  }
  await writeFile(attributionPath, attribution);
}

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run' || flag === '--accept-license-change') options[flag] = true;
    else if (['--source', '--commit', '--tree', '--repository'].includes(flag) && argv[index + 1]) options[flag] = argv[++index];
    else refuse('USAGE', 'usage: node tools/update-harness-pin.mjs --source <EXPORT> --commit <COMMIT> --tree <TREE> [--repository URL] [--dry-run] [--accept-license-change]');
  }
  if (!options['--source']) refuse('USAGE', '--source is required.');
  const previousPin = JSON.parse(await readFile(path.join(repoRoot, 'vendor', 'SPEC-HARNESS-PIN.json'), 'utf8').catch(() => 'null'));
  const built = await buildPin({
    source: path.resolve(options['--source']),
    commit: options['--commit'],
    tree: options['--tree'],
    repository: options['--repository'] ?? previousPin?.repository ?? DEFAULT_REPOSITORY,
    previousPin,
    acceptLicenseChange: options['--accept-license-change'] === true,
  });
  process.stdout.write(`Checked: ${built.files.length} files hash to tree ${built.pin.tree}; LICENSE is MIT (${built.pin.license.sha256}); harness version ${built.pin.harnessVersion}.\n`);
  if (options['--dry-run']) {
    process.stdout.write('Dry run: nothing was written.\n');
    return;
  }
  await writePin({ built, previousPin });
  process.stdout.write(`Wrote vendor/spec-harness/ (${built.files.length} files), vendor/SPEC-HARNESS-PIN.json, the vendor lines of FILE-ALLOWLIST.txt and the commit in ATTRIBUTION.md.\n`);
  process.stdout.write('Next: node --test test/vendor.test.mjs, then the whole suite, then review the CHANGELOG entry.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stdout.write(`${error.code ?? 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
