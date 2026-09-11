import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, mkdir, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';

export class InstallPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallPlanError';
    this.code = code;
  }
}

const STATE_RELATIVE_PATH = '.second-brain/installed-state.json';
const RECEIPTS_RELATIVE_DIRECTORY = '.second-brain/receipts';
const BACKUPS_RELATIVE_DIRECTORY = '.second-brain/backups';

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

function receiptPathFor(target, receiptId) {
  validateRelativePath(receiptId, 'Receipt ID');
  return path.join(target, ...RECEIPTS_RELATIVE_DIRECTORY.split('/'), `${receiptId}.json`);
}

function backupPathFor(target, receiptId, destination) {
  validateRelativePath(destination, 'Backup destination');
  return path.join(target, ...BACKUPS_RELATIVE_DIRECTORY.split('/'), receiptId, ...destination.split('/'));
}

async function ensureSafeDirectory(directoryPath, target, label) {
  if (!isWithin(target, directoryPath)) fail('TARGET_ESCAPE', `${label} escapes the target: ${directoryPath}`);
  await assertNoSymlinkAncestors(directoryPath, label, target);
  await mkdir(directoryPath, { recursive: true });
  await assertNoSymlinkAncestors(directoryPath, label, target);
}

async function writeAtomically(filePath, bytes, target, label) {
  if (!isWithin(target, filePath)) fail('TARGET_ESCAPE', `${label} escapes the target: ${filePath}`);
  const directory = path.dirname(filePath);
  await ensureSafeDirectory(directory, target, `${label} directory`);
  await assertNoSymlinkAncestors(filePath, label, target);
  const temporary = path.join(directory, `.${path.basename(filePath)}.second-brain-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeRegularFile(filePath, target, label) {
  if (!isWithin(target, filePath)) fail('TARGET_ESCAPE', `${label} escapes the target: ${filePath}`);
  await assertNoSymlinkAncestors(filePath, label, target);
  const stat = await lstatOrNull(filePath);
  if (!stat) return;
  if (stat.isSymbolicLink()) fail('SYMLINK_PATH', `${label} is a symlink: ${filePath}`);
  if (!stat.isFile()) fail('NON_REGULAR_FILE', `${label} is not a regular file: ${filePath}`);
  await unlink(filePath);
}

function receiptId() {
  return `tx-${randomUUID()}`;
}

function stateForPlan(plan, receiptIdValue) {
  const managedPaths = {};
  for (const entry of plan.entries) {
    if (entry.status === 'DEPRECATED') continue;
    managedPaths[entry.destination] = {
      installedSha256: entry.intendedSha256,
      mergeKind: entry.mergeKind,
    };
  }
  return {
    schemaVersion: 1,
    edition: plan.edition,
    publicDependency: plan.publicDependency ?? null,
    manifestSha256: plan.manifestHash,
    planDigest: plan.digest,
    transactionId: receiptIdValue,
    managedPaths,
  };
}

function planEntryPath(target, destination) {
  validateRelativePath(destination, 'Plan destination');
  const filePath = path.resolve(target, ...destination.split('/'));
  if (!isWithin(target, filePath)) fail('TARGET_ESCAPE', `Plan destination escapes the target: ${destination}`);
  return filePath;
}

async function backupPreimage({ target, receiptId: receiptIdValue, destination, bytes }) {
  if (bytes === null) return null;
  const backupPath = backupPathFor(target, receiptIdValue, destination);
  await writeAtomically(backupPath, bytes, target, `Backup ${destination}`);
  return path.relative(target, backupPath).split(path.sep).join('/');
}

function assertApplyablePlan(plan, approvedDigest) {
  if (!plan || typeof plan !== 'object') fail('INVALID_PLAN', 'A computed install plan is required.');
  if (typeof approvedDigest !== 'string' || approvedDigest !== plan.digest) {
    fail('PLAN_DIGEST_MISMATCH', 'The supplied approval does not match the current complete plan digest.');
  }
  const conflicts = plan.entries.filter((entry) => entry.status === 'CONFLICT');
  if (conflicts.length > 0) {
    fail('PLAN_CONFLICT', `Plan contains conflicts: ${conflicts.map((entry) => entry.destination).join(', ')}`);
  }
}

async function restoreWrite(target, write) {
  const destinationPath = planEntryPath(target, write.destination);
  const current = await readRegularFile(destinationPath, `Rollback destination ${write.destination}`);
  const currentHash = current === null ? null : sha256(current);
  if (currentHash !== write.postimageSha256) {
    fail('POSTIMAGE_MISMATCH', `Rollback refused because ${write.destination} no longer has this receipt's postimage.`);
  }
  if (write.preimageSha256 === null) {
    await removeRegularFile(destinationPath, target, `Rollback destination ${write.destination}`);
    return;
  }
  validateRelativePath(write.backupPath, 'Receipt backup path');
  const backupPath = path.resolve(target, ...write.backupPath.split('/'));
  if (!isWithin(target, backupPath) || !backupPath.startsWith(path.join(target, ...BACKUPS_RELATIVE_DIRECTORY.split('/')))) {
    fail('INVALID_RECEIPT', `Receipt backup path is outside the transaction backup area: ${write.destination}`);
  }
  await assertNoSymlinkAncestors(backupPath, `Receipt backup ${write.destination}`, target);
  const backup = await readRegularFile(backupPath, `Receipt backup ${write.destination}`);
  if (backup === null || sha256(backup) !== write.preimageSha256) {
    fail('INVALID_RECEIPT', `Receipt backup does not match its recorded preimage: ${write.destination}`);
  }
  await writeAtomically(destinationPath, backup, target, `Rollback destination ${write.destination}`);
}

async function rollbackWrites(target, writes) {
  for (const write of [...writes].reverse()) await restoreWrite(target, write);
}

async function assertPlanPostconditions(plan) {
  for (const entry of plan.entries) {
    const destinationPath = planEntryPath(plan.target, entry.destination);
    const current = await readRegularFile(destinationPath, `Concurrent destination ${entry.destination}`);
    const actualHash = current === null ? null : sha256(current);
    const expectedHash = entry.status === 'DEPRECATED' ? null : entry.intendedSha256;
    if (actualHash !== expectedHash) {
      fail('CONCURRENT_MODIFICATION', `Destination changed while the transaction was applying: ${entry.destination}`);
    }
  }
}

async function removeEmptyTransactionDirectories(target) {
  for (const relative of [RECEIPTS_RELATIVE_DIRECTORY, BACKUPS_RELATIVE_DIRECTORY, '.second-brain']) {
    const directory = path.join(target, ...relative.split('/'));
    try {
      await rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
    }
  }
}

/**
 * Recomputes the plan immediately before mutation, applies only its exact
 * digest-approved non-conflicting writes, and creates a local receipt.
 */
export async function applyInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation = 'init', edition = 'free', publicDependency = null, approvedDigest, injectFailureAfterWrite = null }) {
  const plan = await planInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation, edition, publicDependency });
  assertApplyablePlan(plan, approvedDigest);
  const id = receiptId();
  const writes = [];
  let stateWrite = null;
  let stateWritten = false;
  let writePosition = 0;
  const failAfter = async () => {
    writePosition += 1;
    if (injectFailureAfterWrite === writePosition) fail('INJECTED_WRITE_FAILURE', `Injected write failure after position ${writePosition}.`);
  };

  try {
    for (const entry of plan.entries) {
      if (!['CREATE', 'MANAGED-UPDATE', 'DEPRECATED'].includes(entry.status)) continue;
      const destinationPath = planEntryPath(plan.target, entry.destination);
      const before = await readRegularFile(destinationPath, `Apply destination ${entry.destination}`);
      const beforeHash = before === null ? null : sha256(before);
      if (beforeHash !== entry.currentSha256) fail('CONCURRENT_MODIFICATION', `Destination changed after plan approval: ${entry.destination}`);
      const sourcePath = entry.status === 'DEPRECATED' ? null : path.resolve(plan.sourceRoot, ...entry.source.split('/'));
      if (sourcePath) await assertNoSymlinkAncestors(sourcePath, `Apply source ${entry.source}`, plan.sourceRoot);
      const postimage = sourcePath === null ? null : await readRegularFile(sourcePath, `Apply source ${entry.source}`);
      if (entry.status !== 'DEPRECATED' && postimage === null) fail('MISSING_SOURCE', `Manifest source disappeared before apply: ${entry.source}`);
      const postimageHash = postimage === null ? null : sha256(postimage);
      if (postimageHash !== entry.intendedSha256) fail('SOURCE_HASH_MISMATCH', `Manifest source changed before apply: ${entry.source}`);
      const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: entry.destination, bytes: before });
      if (postimage === null) await removeRegularFile(destinationPath, plan.target, `Apply destination ${entry.destination}`);
      else await writeAtomically(destinationPath, postimage, plan.target, `Apply destination ${entry.destination}`);
      writes.push({ destination: entry.destination, preimageSha256: beforeHash, postimageSha256: postimageHash, backupPath });
      await failAfter();
    }

    await assertPlanPostconditions(plan);
    const statePath = path.join(plan.target, ...STATE_RELATIVE_PATH.split('/'));
    const oldState = await readRegularFile(statePath, 'Installed state');
    const oldStateHash = oldState === null ? null : sha256(oldState);
    if (oldStateHash !== plan.stateHash) fail('CONCURRENT_MODIFICATION', 'Installed state changed after plan approval.');
    const nextState = Buffer.from(`${stableStringify(stateForPlan(plan, id))}\n`);
    const stateBackupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: STATE_RELATIVE_PATH, bytes: oldState });
    stateWrite = {
      destination: STATE_RELATIVE_PATH,
      preimageSha256: oldState === null ? null : sha256(oldState),
      postimageSha256: sha256(nextState),
      backupPath: stateBackupPath,
    };

    const receipt = {
      schemaVersion: 1,
      receiptId: id,
      operation: plan.operation,
      edition: plan.edition,
      publicDependency: plan.publicDependency ?? null,
      manifestSha256: plan.manifestHash,
      planDigest: plan.digest,
      writes: [...writes, stateWrite],
    };
    const receiptPath = receiptPathFor(plan.target, id);
    await writeAtomically(receiptPath, Buffer.from(`${stableStringify(receipt)}\n`), plan.target, 'Transaction receipt');
    await failAfter();
    await writeAtomically(statePath, nextState, plan.target, 'Installed state');
    stateWritten = true;
    await failAfter();
    return { plan, receiptId: id, receiptPath: path.relative(plan.target, receiptPath).split(path.sep).join('/') };
  } catch (error) {
    try {
      if (stateWritten && stateWrite) await restoreWrite(plan.target, stateWrite);
      await rollbackWrites(plan.target, writes);
      const receiptDirectory = path.join(plan.target, ...RECEIPTS_RELATIVE_DIRECTORY.split('/'));
      await removeRegularFile(path.join(receiptDirectory, `${id}.json`), plan.target, 'Failed transaction receipt');
      await rm(path.join(plan.target, ...BACKUPS_RELATIVE_DIRECTORY.split('/'), id), { recursive: true, force: true });
      await removeEmptyTransactionDirectories(plan.target);
    } catch (rollbackError) {
      if (rollbackError instanceof InstallPlanError) throw rollbackError;
      throw new InstallPlanError('ROLLBACK_FAILED', `Apply failed and rollback could not complete: ${rollbackError.message}`);
    }
    throw error;
  }
}

export async function rollbackReceipt({ targetPath, receiptId: receiptIdValue }) {
  if (!path.isAbsolute(targetPath)) fail('TARGET_NOT_ABSOLUTE', 'Target path must be absolute.');
  const target = path.resolve(targetPath);
  await assertNoSymlinkAncestors(target, 'Target');
  const receiptPath = receiptPathFor(target, receiptIdValue);
  await assertNoSymlinkAncestors(receiptPath, 'Receipt path', target);
  const receiptBytes = await readRegularFile(receiptPath, 'Transaction receipt');
  if (receiptBytes === null) fail('MISSING_RECEIPT', `Receipt does not exist: ${receiptIdValue}`);
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    fail('INVALID_RECEIPT', 'Transaction receipt is not valid JSON.');
  }
  if (!receipt || receipt.schemaVersion !== 1 || receipt.receiptId !== receiptIdValue || !Array.isArray(receipt.writes)) {
    fail('INVALID_RECEIPT', 'Transaction receipt has an unsupported shape.');
  }
  for (const write of receipt.writes) {
    if (!write || typeof write !== 'object' || typeof write.destination !== 'string' || !Object.hasOwn(write, 'preimageSha256') || !Object.hasOwn(write, 'postimageSha256')) {
      fail('INVALID_RECEIPT', 'Transaction receipt has an invalid write record.');
    }
  }
  await rollbackWrites(target, receipt.writes);
  await removeRegularFile(receiptPath, target, 'Transaction receipt');
  await rm(path.join(target, ...BACKUPS_RELATIVE_DIRECTORY.split('/'), receiptIdValue), { recursive: true, force: true });
  return { receiptId: receiptIdValue, rolledBackPaths: receipt.writes.map((write) => write.destination) };
}

function containsSecretBearingContent(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|authorization|access[_-]?token|secret)\s*[:=]/i.test(text);
}

function approvedChangeDigest({ owner, preimageSha256, postimageSha256, evidenceDigest }) {
  return sha256(Buffer.from(stableStringify({ owner, preimageSha256, postimageSha256, evidenceDigest })));
}

export async function planApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest }) {
  if (!path.isAbsolute(targetPath)) fail('TARGET_NOT_ABSOLUTE', 'Target path must be absolute.');
  const target = path.resolve(targetPath);
  await assertNoSymlinkAncestors(target, 'Target');
  validateRelativePath(owner, 'Owner path');
  if (!Array.isArray(allowedOwners)) fail('INVALID_OWNER', 'Allowed owners must be an array.');
  const matches = allowedOwners.filter((value) => value === owner);
  if (matches.length === 0) fail('UNDECLARED_OWNER', `Owner is not allowlisted: ${owner}`);
  if (matches.length !== 1) fail('AMBIGUOUS_OWNER', `Owner is declared more than once: ${owner}`);
  if (!/^[a-f0-9]{64}$/.test(preimageSha256) || !/^[a-f0-9]{64}$/.test(postimageSha256) || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
    fail('INVALID_APPROVED_CHANGE', 'Approved change hashes must be lowercase SHA-256 values.');
  }
  const bytes = Buffer.from(postimage);
  if (sha256(bytes) !== postimageSha256) fail('POSTIMAGE_HASH_MISMATCH', 'Proposed postimage does not match its declared hash.');
  if (containsSecretBearingContent(bytes)) fail('SECRET_BEARING_CONTENT', 'Proposed content appears to contain a secret and was rejected.');
  const ownerPath = planEntryPath(target, owner);
  const current = await readRegularFile(ownerPath, `Approved change owner ${owner}`);
  if (current === null || sha256(current) !== preimageSha256) fail('STALE_PREIMAGE', `Owner preimage no longer matches: ${owner}`);
  return { target, owner, ownerPath, preimageSha256, postimage: bytes, postimageSha256, evidenceDigest, digest: approvedChangeDigest({ owner, preimageSha256, postimageSha256, evidenceDigest }) };
}

export async function applyApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest, approvedDigest }) {
  const plan = await planApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest });
  if (approvedDigest !== plan.digest) fail('PLAN_DIGEST_MISMATCH', 'The supplied approval does not match the approved owner change digest.');
  const id = receiptId();
  const current = await readRegularFile(plan.ownerPath, `Approved change owner ${plan.owner}`);
  if (current === null || sha256(current) !== plan.preimageSha256) fail('STALE_PREIMAGE', `Owner preimage changed before apply: ${plan.owner}`);
  const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: plan.owner, bytes: current });
  try {
    await writeAtomically(plan.ownerPath, plan.postimage, plan.target, `Approved change owner ${plan.owner}`);
    const receipt = {
      schemaVersion: 1,
      receiptId: id,
      operation: 'approved-change',
      owner: plan.owner,
      planDigest: plan.digest,
      evidenceDigest: plan.evidenceDigest,
      writes: [{ destination: plan.owner, preimageSha256: plan.preimageSha256, postimageSha256: plan.postimageSha256, backupPath }],
    };
    const receiptPath = receiptPathFor(plan.target, id);
    await writeAtomically(receiptPath, Buffer.from(`${stableStringify(receipt)}\n`), plan.target, 'Approved change receipt');
    return { receiptId: id, receiptPath: path.relative(plan.target, receiptPath).split(path.sep).join('/'), planDigest: plan.digest };
  } catch (error) {
    const backup = backupPath === null ? null : await readRegularFile(path.resolve(plan.target, ...backupPath.split('/')), 'Approved change backup');
    if (backup === null) await removeRegularFile(plan.ownerPath, plan.target, `Approved change owner ${plan.owner}`);
    else await writeAtomically(plan.ownerPath, backup, plan.target, `Approved change owner ${plan.owner}`);
    await rm(path.join(plan.target, ...BACKUPS_RELATIVE_DIRECTORY.split('/'), id), { recursive: true, force: true });
    throw error;
  }
}
