import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';

export class InstallPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallPlanError';
    this.code = code;
  }
}

const STATE_RELATIVE_PATH = '.second-brain/installed-state.json';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fail(code, message) {
  throw new InstallPlanError(code, message);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail('INVALID_PATH', `${label} must be a non-empty string.`);
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    fail('INVALID_PATH', `${label} must be a portable relative path.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('INVALID_PATH', `${label} must not contain empty, dot, or traversal segments.`);
  }
  return value;
}

async function lstatOrNull(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function isMacSystemAlias(filePath) {
  if (process.platform !== 'darwin' || (filePath !== '/var' && filePath !== '/tmp')) return false;
  try {
    const physical = await realpath(filePath);
    return (filePath === '/var' && physical === '/private/var') || (filePath === '/tmp' && physical === '/private/tmp');
  } catch {
    return false;
  }
}

async function assertNoSymlinkAncestors(filePath, label, boundary = null) {
  const absolute = path.resolve(filePath);
  const resolvedBoundary = boundary ? path.resolve(boundary) : null;
  if (resolvedBoundary && !isWithin(resolvedBoundary, absolute)) {
    fail('TARGET_ESCAPE', `${label} escapes its approved boundary: ${absolute}`);
  }
  let cursor = absolute;
  while (true) {
    const stat = await lstatOrNull(cursor);
    if (stat?.isSymbolicLink() && !(await isMacSystemAlias(cursor))) {
      fail('SYMLINK_PATH', `${label} contains a symlink: ${cursor}`);
    }
    if (resolvedBoundary && cursor === resolvedBoundary) return;
    // Once a real existing directory or file has been reached, its own realpath
    // anchors the operation. Walking into platform-owned prefixes such as /var
    // would reject ordinary macOS temporary paths without protecting a project
    // destination beneath that anchor.
    if (stat && !resolvedBoundary) {
      const parent = path.dirname(cursor);
      if (parent === cursor) return;
      cursor = parent;
      continue;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function readRegularFile(filePath, label) {
  const stat = await lstatOrNull(filePath);
  if (!stat) return null;
  if (stat.isSymbolicLink()) fail('SYMLINK_PATH', `${label} is a symlink: ${filePath}`);
  if (!stat.isFile()) fail('NON_REGULAR_FILE', `${label} is not a regular file: ${filePath}`);
  return readFile(filePath);
}

async function resolveTarget(targetPath, sourceRoot) {
  if (!path.isAbsolute(targetPath)) fail('TARGET_NOT_ABSOLUTE', 'Target path must be absolute.');
  const target = path.resolve(targetPath);
  const root = path.parse(target).root;
  if (target === root) fail('UNSAFE_TARGET', 'Target cannot be the filesystem root.');

  const home = await realpath(homedir());
  const targetStat = await lstatOrNull(target);
  await assertNoSymlinkAncestors(target, 'Target');
  const targetReal = targetStat ? await realpath(target) : target;
  if (targetReal === home || target === homedir()) fail('UNSAFE_TARGET', 'Target cannot be the home directory.');
  if (isWithin(sourceRoot, targetReal) || isWithin(sourceRoot, target)) {
    fail('UNSAFE_TARGET', 'Target cannot be the installer checkout or a path inside it.');
  }
  return target;
}

function normalizeState(state) {
  if (state === null) return { managedPaths: {} };
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    fail('INVALID_STATE', 'Installed state must be a JSON object.');
  }
  if (state.managedPaths === undefined) return { ...state, managedPaths: {} };
  if (!state.managedPaths || typeof state.managedPaths !== 'object' || Array.isArray(state.managedPaths)) {
    fail('INVALID_STATE', 'Installed state managedPaths must be an object.');
  }
  return state;
}

async function readInstalledState(target) {
  const statePath = path.join(target, ...STATE_RELATIVE_PATH.split('/'));
  await assertNoSymlinkAncestors(statePath, 'Installed state path', target);
  const bytes = await readRegularFile(statePath, 'Installed state');
  if (bytes === null) return { statePath, state: normalizeState(null), stateHash: null };
  try {
    return { statePath, state: normalizeState(JSON.parse(bytes.toString('utf8'))), stateHash: sha256(bytes) };
  } catch (error) {
    if (error instanceof InstallPlanError) throw error;
    fail('INVALID_STATE', `Installed state is not valid JSON: ${statePath}`);
  }
}

export async function validateManifest({ manifest, sourceRoot }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('INVALID_MANIFEST', 'Manifest must be an object.');
  if (manifest.schemaVersion !== 1) fail('INVALID_MANIFEST', 'Manifest schemaVersion must be 1.');
  if (!Array.isArray(manifest.entries)) fail('INVALID_MANIFEST', 'Manifest entries must be an array.');

  const sourceRootReal = await realpath(sourceRoot);
  await assertNoSymlinkAncestors(sourceRootReal, 'Source root');
  const destinations = new Set();
  const entries = [];
  for (const [index, rawEntry] of manifest.entries.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) fail('INVALID_MANIFEST', `Manifest entry ${index} must be an object.`);
    const source = validateRelativePath(rawEntry.source, `Manifest entry ${index} source`);
    const destination = validateRelativePath(rawEntry.destination, `Manifest entry ${index} destination`);
    if (!source.startsWith('template/')) fail('INVALID_MANIFEST', `Manifest entry ${index} source must be beneath template/.`);
    if (!['managed-file', 'managed-block'].includes(rawEntry.mergeKind)) fail('INVALID_MANIFEST', `Manifest entry ${index} has an unsupported mergeKind.`);
    if (!/^[a-f0-9]{64}$/.test(rawEntry.sha256)) fail('INVALID_MANIFEST', `Manifest entry ${index} sha256 must be lowercase SHA-256.`);
    if (destinations.has(destination)) fail('DUPLICATE_DESTINATION', `Manifest has a duplicate destination: ${destination}`);
    destinations.add(destination);

    const sourcePath = path.resolve(sourceRootReal, ...source.split('/'));
    if (!isWithin(sourceRootReal, sourcePath)) fail('SOURCE_ESCAPE', `Manifest source escapes the checkout: ${source}`);
    await assertNoSymlinkAncestors(sourcePath, 'Manifest source', sourceRootReal);
    const bytes = await readRegularFile(sourcePath, `Manifest source ${source}`);
    if (bytes === null) fail('MISSING_SOURCE', `Manifest source is missing: ${source}`);
    const actualHash = sha256(bytes);
    if (actualHash !== rawEntry.sha256) fail('SOURCE_HASH_MISMATCH', `Manifest source hash mismatch: ${source}`);
    entries.push({ source, destination, sha256: actualHash, mergeKind: rawEntry.mergeKind, sourcePath, bytes });
  }
  return { sourceRoot: sourceRootReal, entries };
}

function stateRecordFor(state, destination) {
  const record = state.managedPaths[destination];
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

function exactUndo(status, destination, beforeHash, afterHash) {
  if (status === 'CREATE') return { action: 'remove-created-file', destination, preimageSha256: null, postimageSha256: afterHash };
  if (status === 'MANAGED-UPDATE') return { action: 'restore-preimage', destination, preimageSha256: beforeHash, postimageSha256: afterHash };
  if (status === 'DEPRECATED') return { action: 'restore-deprecated-file', destination, preimageSha256: beforeHash, postimageSha256: null };
  return { action: 'none', destination, preimageSha256: beforeHash, postimageSha256: afterHash };
}

function plannedDigestInput({ operation, edition, publicDependency, manifestHash, stateHash, entries }) {
  return {
    operation,
    edition,
    publicDependency: publicDependency ?? null,
    manifestHash,
    stateHash,
    entries: entries.map(({ destination, status, currentSha256, intendedSha256, mergeKind, undo }) => ({
      destination,
      status,
      currentSha256,
      intendedSha256,
      mergeKind,
      undo,
    })),
  };
}

export async function planInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation = 'init', edition = 'free', publicDependency = null }) {
  if (!['init', 'upgrade'].includes(operation)) fail('INVALID_OPERATION', 'Operation must be init or upgrade.');
  if (!['free', 'paid'].includes(edition)) fail('INVALID_EDITION', 'Edition must be free or paid.');
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) fail('INVALID_MANIFEST', 'Manifest bytes are required for digest binding.');
  const validated = await validateManifest({ manifest, sourceRoot });
  const target = await resolveTarget(targetPath, validated.sourceRoot);
  const { statePath, state, stateHash } = await readInstalledState(target);
  const activeDestinations = new Set(validated.entries.map((entry) => entry.destination));
  const entries = [];

  for (const entry of validated.entries) {
    const destinationPath = path.resolve(target, ...entry.destination.split('/'));
    if (!isWithin(target, destinationPath)) fail('TARGET_ESCAPE', `Manifest destination escapes the target: ${entry.destination}`);
    await assertNoSymlinkAncestors(destinationPath, 'Manifest destination', target);
    const existing = await readRegularFile(destinationPath, `Destination ${entry.destination}`);
    const currentSha256 = existing === null ? null : sha256(existing);
    const record = stateRecordFor(state, entry.destination);
    let status;
    if (existing === null) status = 'CREATE';
    else if (currentSha256 === entry.sha256) status = 'IDENTICAL';
    else if (record && currentSha256 === record.installedSha256) status = 'MANAGED-UPDATE';
    else status = 'CONFLICT';
    entries.push({
      destination: entry.destination,
      source: entry.source,
      mergeKind: entry.mergeKind,
      status,
      currentSha256,
      intendedSha256: entry.sha256,
      undo: exactUndo(status, entry.destination, currentSha256, entry.sha256),
    });
  }

  for (const [destination, record] of Object.entries(state.managedPaths)) {
    if (activeDestinations.has(destination)) continue;
    validateRelativePath(destination, 'Installed state destination');
    const destinationPath = path.resolve(target, ...destination.split('/'));
    if (!isWithin(target, destinationPath)) fail('TARGET_ESCAPE', `Installed state destination escapes the target: ${destination}`);
    await assertNoSymlinkAncestors(destinationPath, 'Deprecated destination', target);
    const existing = await readRegularFile(destinationPath, `Deprecated destination ${destination}`);
    const currentSha256 = existing === null ? null : sha256(existing);
    const installedSha256 = record?.installedSha256 ?? null;
    const status = existing !== null && installedSha256 === currentSha256 ? 'DEPRECATED' : 'CONFLICT';
    entries.push({
      destination,
      source: null,
      mergeKind: record?.mergeKind ?? 'managed-file',
      status,
      currentSha256,
      intendedSha256: null,
      undo: exactUndo(status, destination, currentSha256, null),
    });
  }

  entries.sort((left, right) => left.destination.localeCompare(right.destination));
  const digestInput = plannedDigestInput({
    operation,
    edition,
    publicDependency,
    manifestHash: sha256(manifestBytes),
    stateHash,
    entries,
  });
  return {
    operation,
    edition,
    publicDependency,
    sourceRoot: validated.sourceRoot,
    target,
    manifestHash: sha256(manifestBytes),
    statePath: path.relative(target, statePath).split(path.sep).join('/'),
    stateHash,
    entries,
    digest: sha256(Buffer.from(stableStringify(digestInput))),
  };
}
