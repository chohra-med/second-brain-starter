import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { sensitiveContentRules } from './package-scan.mjs';
import { isUtf8, mergeThreeWay, twoWayProposal } from './merge3.mjs';

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
// Template bytes each managed file was last installed from: the merge base of the next upgrade.
const BASE_RELATIVE_DIRECTORY = '.second-brain/base';
// Proposals with markers for files that became user-owned in a release. The approved apply writes them, create-only,
// under the template version that offered them. A CONFLICT proposal is never written: `upgrade --proposal` prints it.
const MERGE_RELATIVE_DIRECTORY = '.second-brain/merge';
// Managed template bytes of earlier releases, keyed by SHA-256, so an install made
// before base snapshots existed still has a merge base. Verified by hash on use.
const RELEASE_BASES_RELATIVE_PATH = 'template-bases.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TEMPLATE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const TRANSACTION_ID_PATTERN = /^tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOADER_START = Buffer.from('<!-- second-brain:loader:start -->');
const LOADER_END = Buffer.from('<!-- second-brain:loader:end -->');
const PRIVACY_START = Buffer.from('# second-brain:privacy:start');
const PRIVACY_END = Buffer.from('# second-brain:privacy:end');
// The markers each managed-block destination must carry. A destination not listed here cannot be a managed block.
const BLOCK_MARKERS = new Map([
  ['AGENTS.md', { start: LOADER_START, end: LOADER_END }],
  ['CLAUDE.md', { start: LOADER_START, end: LOADER_END }],
  ['.gitignore', { start: PRIVACY_START, end: PRIVACY_END }],
]);

function markersFor(destination) {
  const markers = BLOCK_MARKERS.get(destination);
  if (!markers) fail('INVALID_MANIFEST', `Managed block destination must be AGENTS.md, CLAUDE.md or .gitignore: ${destination}`);
  return markers;
}

// A comment names this tool when its text has "second", then zero or more spaces, hyphens or underscores, then "brain",
// in any letter case. Only comments count as markers. A plain sentence that names the tool never does.
const NAMES_TOOL = /second[ \-_]*brain/i;
const INSTALLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function canonicalTargetPath(target) {
  let cursor = target;
  const missingSegments = [];
  while (true) {
    const stat = await lstatOrNull(cursor);
    if (stat) {
      if (!stat.isDirectory()) fail('TARGET_NOT_DIRECTORY', `Target must be a directory: ${target}`);
      return path.join(await realpath(cursor), ...missingSegments);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) fail('UNSAFE_TARGET', `Target has no real directory ancestor: ${target}`);
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }
}

async function resolveTarget(targetPath, sourceRoot) {
  if (typeof targetPath !== 'string') fail('TARGET_NOT_ABSOLUTE', 'Target path must be an absolute string.');
  if (targetPath.split(/[\\/]+/).includes('..')) {
    fail('TARGET_TRAVERSAL', 'Target path must not contain literal traversal segments.');
  }
  if (!path.isAbsolute(targetPath)) fail('TARGET_NOT_ABSOLUTE', 'Target path must be absolute.');
  const target = path.resolve(targetPath);
  const root = path.parse(target).root;
  if (target === root) fail('UNSAFE_TARGET', 'Target cannot be the filesystem root.');

  const home = await realpath(homedir());
  await assertNoSymlinkAncestors(target, 'Target');
  const targetReal = await canonicalTargetPath(target);
  if (targetReal === home || target === homedir()) fail('UNSAFE_TARGET', 'Target cannot be the home directory.');
  if (isWithin(sourceRoot, targetReal) || isWithin(sourceRoot, target)) {
    fail('UNSAFE_TARGET', 'Target cannot be the installer checkout or a path inside it.');
  }
  return targetReal;
}

function normalizeState(state) {
  if (state === null) return { managedPaths: {} };
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    fail('INVALID_STATE', 'Installed state must be a JSON object.');
  }
  if (!hasExactKeys(state, ['schemaVersion', 'edition', 'templateVersion', 'publicDependency', 'manifestSha256', 'planDigest', 'transactionId', 'operation', 'writeSetDigest', 'managedPaths'])
    || state.schemaVersion !== 1) fail('INVALID_STATE', 'Installed state schemaVersion must be 1.');
  if (!['free', 'paid'].includes(state.edition)) fail('INVALID_STATE', 'Installed state edition must be free or paid.');
  if (typeof state.templateVersion !== 'string' || !TEMPLATE_VERSION_PATTERN.test(state.templateVersion)) {
    fail('INVALID_STATE', 'Installed state templateVersion must be a supported version.');
  }
  if (!SHA256_PATTERN.test(state.manifestSha256 ?? '') || !SHA256_PATTERN.test(state.planDigest ?? '') || !SHA256_PATTERN.test(state.writeSetDigest ?? '')) {
    fail('INVALID_STATE', 'Installed state digests must be lowercase SHA-256 values.');
  }
  if (typeof state.transactionId !== 'string' || !TRANSACTION_ID_PATTERN.test(state.transactionId)) {
    fail('INVALID_STATE', 'Installed state transactionId must be a transaction receipt ID.');
  }
  if (!['init', 'upgrade', 'adopt'].includes(state.operation)) {
    fail('INVALID_STATE', 'Installed state operation must be init, upgrade or adopt.');
  }
  if ((state.edition === 'free' && state.publicDependency !== null) || (state.edition === 'paid' && (typeof state.publicDependency !== 'string' || state.publicDependency.length === 0))) {
    fail('INVALID_STATE', 'Installed state publicDependency does not match its edition.');
  }
  if (!state.managedPaths || typeof state.managedPaths !== 'object' || Array.isArray(state.managedPaths)) {
    fail('INVALID_STATE', 'Installed state managedPaths must be an object.');
  }
  for (const [destination, record] of Object.entries(state.managedPaths)) {
    validateRelativePath(destination, 'Installed state destination');
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !SHA256_PATTERN.test(record.installedSha256 ?? '')
      || !SHA256_PATTERN.test(record.templateSha256 ?? '')
      || !['managed-file', 'managed-block', 'seed-file'].includes(record.mergeKind)) {
      fail('INVALID_STATE', `Installed state managed path is invalid: ${destination}`);
    }
    if (['managed-file', 'seed-file'].includes(record.mergeKind) && !hasExactKeys(record, ['installedSha256', 'templateSha256', 'mergeKind'])) {
      fail('INVALID_STATE', `Installed state managed file has unsupported keys: ${destination}`);
    }
    if (record.mergeKind === 'managed-block' && (!hasExactKeys(record, ['installedSha256', 'templateSha256', 'mergeKind', 'managedBlockSha256']) || !SHA256_PATTERN.test(record.managedBlockSha256 ?? ''))) {
      fail('INVALID_STATE', `Installed state managed block hash is invalid: ${destination}`);
    }
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

async function assertTransactionNamespace(target) {
  for (const [relative, label] of [
    ['.second-brain', 'Transaction namespace'],
    [RECEIPTS_RELATIVE_DIRECTORY, 'Receipt namespace'],
    [BACKUPS_RELATIVE_DIRECTORY, 'Backup namespace'],
    [BASE_RELATIVE_DIRECTORY, 'Base snapshot namespace'],
    [MERGE_RELATIVE_DIRECTORY, 'Merge proposal namespace'],
  ]) {
    const namespacePath = path.join(target, ...relative.split('/'));
    await assertNoSymlinkAncestors(namespacePath, label, target);
    const stat = await lstatOrNull(namespacePath);
    if (stat && !stat.isDirectory()) fail('INVALID_NAMESPACE', `${label} must be absent or a real directory: ${namespacePath}`);
  }
  await assertNoSymlinkAncestors(path.join(target, ...STATE_RELATIVE_PATH.split('/')), 'Installed state namespace', target);
}

export async function validateManifest({ manifest, sourceRoot }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('INVALID_MANIFEST', 'Manifest must be an object.');
  if (manifest.schemaVersion !== 1) fail('INVALID_MANIFEST', 'Manifest schemaVersion must be 1.');
  if (!manifest.metadata || typeof manifest.metadata !== 'object' || Array.isArray(manifest.metadata)
    || typeof manifest.metadata.templateVersion !== 'string' || !TEMPLATE_VERSION_PATTERN.test(manifest.metadata.templateVersion)) {
    fail('INVALID_MANIFEST', 'Manifest metadata.templateVersion must be a supported version.');
  }
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
    if (!['managed-file', 'managed-block', 'seed-file'].includes(rawEntry.mergeKind)) fail('INVALID_MANIFEST', `Manifest entry ${index} has an unsupported mergeKind.`);
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
    if (rawEntry.mergeKind === 'managed-block') loaderPostimage({ sourceBytes: bytes, existing: null, destination });
    entries.push({ source, destination, sha256: actualHash, mergeKind: rawEntry.mergeKind, sourcePath, bytes });
  }
  return { sourceRoot: sourceRootReal, templateVersion: manifest.metadata.templateVersion, entries };
}

function stateRecordFor(state, destination) {
  const record = state.managedPaths[destination];
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

function markerPositions(bytes, marker) {
  const positions = [];
  let offset = 0;
  while (offset <= bytes.length - marker.length) {
    const found = bytes.indexOf(marker, offset);
    if (found === -1) break;
    positions.push(found);
    offset = found + marker.length;
  }
  return positions;
}

function parseLoaderBlock(bytes, label, destination) {
  const { start, end } = markersFor(destination);
  const starts = markerPositions(bytes, start);
  const ends = markerPositions(bytes, end);
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    fail('LOADER_CONFLICT', `${label} must contain exactly one well-ordered Second Brain loader block.`);
  }
  const blockEnd = ends[0] + end.length;
  return {
    prefix: bytes.subarray(0, starts[0]),
    block: bytes.subarray(starts[0], blockEnd),
    suffix: bytes.subarray(blockEnd),
  };
}

function loaderPostimage({ sourceBytes, existing, destination }) {
  const source = parseLoaderBlock(sourceBytes, `Loader source ${destination}`, destination);
  if (existing === null || existing.length === 0) return sourceBytes;
  const current = parseLoaderBlock(existing, `Existing loader ${destination}`, destination);
  return Buffer.concat([current.prefix, source.block, current.suffix]);
}

// A file with content and no managed markers keeps every byte it has. The block goes at the end, after one blank
// line, and ends with a newline. Rollback restores the saved preimage, so the appended block is removed exactly.
function appendPostimage({ sourceBytes, existing, destination }) {
  const source = parseLoaderBlock(sourceBytes, `Loader source ${destination}`, destination);
  if (existing.length === 0) return Buffer.concat([source.block, Buffer.from('\n')]);
  const separator = existing[existing.length - 1] === 0x0a ? '\n' : '\n\n';
  return Buffer.concat([existing, Buffer.from(separator), source.block, Buffer.from('\n')]);
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// The marks of one comment each: 'start' for the exact start marker, 'end' for the exact end marker, 'other' for any
// other comment that names the tool. Stops at the first comment that is never closed.
function htmlMarks(text, startLine, endLine) {
  const marks = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) return { marks };
    const close = text.indexOf('-->', open + 4);
    if (close === -1) return { unclosed: lineOf(text, open), marks };
    const raw = text.slice(open, close + 3);
    if (NAMES_TOOL.test(raw)) {
      marks.push({ line: lineOf(text, open), kind: raw === startLine ? 'start' : raw === endLine ? 'end' : 'other' });
    }
    from = close + 3;
  }
}

// The marks for .gitignore: the exact start and end lines, and any # line shaped like a privacy marker (a damaged
// one, such as "# second-brain:privacy: end"). Other # lines that name the tool, such as "# second-brain notes", are
// the user's comments and are not marks.
const PRIVACY_MARKER_SHAPE = /^[ \t]*#[ \t]*second[ \-_]*brain[ \t]*:[ \t]*privacy\b/i;
// A marker can also be cut short. A # line is marker-shaped when it is the old form above, or when, with spaces and tabs
// removed and case ignored, it is a prefix of a real privacy marker line and at least "#second-brain:" long. So
// "# second-brain:priv", "# second-brain:privacy:sta", "#second-brain:privacy:start" and "# SECOND-BRAIN:PRIV" count.
// "# second-brain notes: keep" and "# my second-brain setup" do not: they leave the marker text before the colon.
const PRIVACY_MARKER_KEYS = [PRIVACY_START, PRIVACY_END].map((marker) => marker.toString('latin1').replace(/[ \t]/g, '').toLowerCase());
function isPrivacyMarkerShaped(line) {
  if (PRIVACY_MARKER_SHAPE.test(line)) return true;
  const key = line.replace(/[ \t]/g, '').toLowerCase();
  return key.length >= '#second-brain:'.length && PRIVACY_MARKER_KEYS.some((marker) => marker.startsWith(key));
}
function lineMarks(text, startLine, endLine) {
  const marks = [];
  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, '');
    const kind = line === startLine ? 'start' : line === endLine ? 'end' : isPrivacyMarkerShaped(line) ? 'other' : null;
    if (kind !== null) marks.push({ line: index + 1, kind });
  });
  return { marks };
}

// Returns the first mark that is not part of exactly one clean block, or null. The block is a start mark, then an end
// mark. Other marks are allowed only between them, and only in .gitignore, whose shipped block has a comment line that
// names the tool. A start mark still open at the end is the problem.
function blockProblem(marks, bodyMayName) {
  let state = 'before';
  let startMark = null;
  for (const mark of marks) {
    if (state === 'before' && mark.kind === 'start') {
      state = 'inside';
      startMark = mark;
    } else if (state === 'inside' && mark.kind === 'end') {
      state = 'after';
    } else if (state === 'inside' && mark.kind === 'other' && bodyMayName) {
      continue;
    } else {
      return mark;
    }
  }
  return state === 'inside' ? startMark : null;
}

// The marks of a loader file, read from its bytes. A UTF-8 byte-order mark at the start is not part of the first line.
function scanMarks(bytes, destination) {
  const text = withoutByteOrderMark(bytes).toString('latin1');
  const { start, end } = markersFor(destination);
  const startLine = start.toString('latin1');
  const endLine = end.toString('latin1');
  return destination === '.gitignore' ? lineMarks(text, startLine, endLine) : htmlMarks(text, startLine, endLine);
}

// 'absent': no comment names the tool, and no HTML comment is left open. 'well-formed': the only comments that name the
// tool are one clean block. 'damaged': anything else, with the line that caused it and the cause ('unclosed' or 'comment').
function markerCheck(bytes, destination) {
  const scan = scanMarks(bytes, destination);
  if (scan.unclosed !== undefined) return { form: 'damaged', line: scan.unclosed, cause: 'unclosed' };
  if (scan.marks.length === 0) return { form: 'absent' };
  const problem = blockProblem(scan.marks, destination === '.gitignore');
  return problem === null ? { form: 'well-formed' } : { form: 'damaged', line: problem.line, cause: 'comment' };
}

function markerConflictReason(destination, found) {
  if (found.cause === 'unclosed') {
    return `${destination} line ${found.line} has an HTML comment that is never closed, so the install stops; write the comment in full, ending with -->, or remove it, then plan again.`;
  }
  return `${destination} line ${found.line} has a comment that names second-brain but is not the one clean managed block, so the install stops; remove the leftover marker lines, or remove the comment, then plan again.`;
}

function editedBlockReason(destination) {
  return `${destination} has a managed block whose text differs from the block this tool installed, so the install stops; put the block's lines back as installed, or move your edit out of the block, then plan again.`;
}

// A clean block in a file this tool has no install record for. The tool did not install it, so the wording says so.
function unrecordedBlockReason(destination) {
  return `${destination} has a loader block whose text differs from the block this tool ships, and this tool has no install record for the file, so the install stops; put the block's lines back as shipped, or remove the block, then plan again.`;
}

// A UTF-8 byte-order mark at the very start of a file is allowed. It is not part of the first line.
function withoutByteOrderMark(bytes) {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
}

// The last words of a refusal. A plan refuses an install; verify fails, and the next step is to run verify again.
function refusalWords(after) {
  return after === 'verify' ? { stop: 'verify stops', again: 'run verify again' } : { stop: 'the install stops', again: 'plan again' };
}

// The block text between the two marker lines of the shipped file, without the line breaks that touch the markers.
function shippedBlockText(sourceBytes, destination) {
  const { start, end } = markersFor(destination);
  const block = parseLoaderBlock(sourceBytes, `Loader source ${destination}`, destination).block;
  let inner = block.subarray(start.length, block.length - end.length);
  if (inner[0] === 0x0a) inner = inner.subarray(1);
  if (inner[inner.length - 1] === 0x0a) inner = inner.subarray(0, inner.length - 1);
  return inner;
}

// One named damage to an installed loader file, read from its own marks: the start marker or the end marker is gone,
// both are gone (the block text is still there, or the block is gone), or the file is empty. Each sentence names the
// marker text and the one way out that was tested by hand. Any other damage returns null, and the caller words it.
function loaderDamageReason(bytes, destination, sourceBytes, source, after) {
  const { start, end } = markersFor(destination);
  const startText = start.toString('latin1');
  const endText = end.toString('latin1');
  const { stop, again } = refusalWords(after);
  const paste = `paste every line of ${source} from the starter copy into the file, both marker lines included`;
  if (bytes.length === 0) return `${destination} is empty, so its managed block is gone and ${stop}; ${paste}, then ${again}.`;
  const scan = scanMarks(bytes, destination);
  if (scan.unclosed !== undefined || scan.marks.some((mark) => mark.kind === 'other')) return null;
  const starts = scan.marks.filter((mark) => mark.kind === 'start');
  const ends = scan.marks.filter((mark) => mark.kind === 'end');
  if (starts.length === 1 && ends.length === 0) {
    return `${destination} line ${starts[0].line} has the start marker ${startText} but no end marker, so ${stop}; put back the end marker ${endText} on its own line below the block, keeping your own text, then ${again}.`;
  }
  if (starts.length === 0 && ends.length === 1) {
    return `${destination} line ${ends[0].line} has the end marker ${endText} but no start marker, so ${stop}; put back the start marker ${startText} on its own line above the block, keeping your own text, then ${again}.`;
  }
  if (starts.length === 0 && ends.length === 0) {
    const inner = shippedBlockText(sourceBytes, destination);
    if (inner.length > 0 && bytes.includes(inner)) {
      return `${destination} has no start marker and no end marker, but the block text is still there, so ${stop}; put back both marker lines, ${startText} above the block text and ${endText} below it, keeping your own text, then ${again}.`;
    }
    return `${destination} has no managed block, so ${stop}; ${paste}, keeping your own text, then ${again}.`;
  }
  return null;
}

// What verify says for an installed loader file whose bytes do not match its block: the named damage when there is one,
// the UTF-16 refusal for a file that is not UTF-8 text, and the plain mismatch for a change inside the block.
function loaderVerifyMessage(bytes, entry) {
  if (isNonUtf8Text(bytes)) return nonUtf8Reason(entry.destination, 'verify');
  return loaderDamageReason(bytes, entry.destination, entry.bytes, entry.source, 'verify') ?? `Managed destination hash mismatch: ${entry.destination}`;
}

// An installed loader file that is gone. Upgrade plans it as CREATE, and approving that plan writes it back with the block.
function missingLoaderMessage(destination) {
  return `${destination} is missing, so verify stops; run upgrade and approve its plan, which shows CREATE ${destination}, to write the file again.`;
}

// A root file that is not UTF-8 text. The marker scan reads bytes, so a UTF-16 or UTF-32 file can hide a comment from it.
function isNonUtf8Text(bytes) {
  const utf16OrUtf32Mark = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  return utf16OrUtf32Mark || bytes.includes(0x00);
}

function nonUtf8Reason(destination, after = 'plan') {
  const { stop, again } = refusalWords(after);
  return `${destination} is not UTF-8 text (it has a null byte, or starts with a UTF-16 or UTF-32 byte-order mark), so ${stop}; convert the file to UTF-8 text first, then ${again}.`;
}

function mergeNonUtf8Reason(destination) {
  return `${destination} is not UTF-8 text; the merge was not attempted, so the file is kept as it is.`;
}

function loaderBlockSha256(bytes, label, destination) {
  return sha256(parseLoaderBlock(bytes, label, destination).block);
}

// The loader files (AGENTS.md, CLAUDE.md, .gitignore) are verified by their managed block only, because users add their
// own text around it. A change inside the block, or a damaged or missing marker, does not match.
function loaderBlockMatches(bytes, destination, record) {
  return markerCheck(bytes, destination).form === 'well-formed'
    && loaderBlockSha256(bytes, `Destination ${destination}`, destination) === record.managedBlockSha256;
}

function conflictEntry(entry, currentSha256, conflictReason = null) {
  return {
    destination: entry.destination,
    source: entry.source,
    mergeKind: entry.mergeKind,
    templateSha256: entry.sha256,
    status: 'CONFLICT',
    currentSha256,
    intendedSha256: entry.sha256,
    undo: exactUndo('CONFLICT', entry.destination, currentSha256, entry.sha256),
    ...(conflictReason ? { conflictReason } : {}),
  };
}

function postimageForEntry(entry, existing) {
  if (entry.mergeKind === 'managed-block') return loaderPostimage({ sourceBytes: entry.bytes, existing, destination: entry.destination });
  return entry.bytes;
}

function exactUndo(status, destination, beforeHash, afterHash) {
  if (status === 'CREATE') return { action: 'remove-created-file', destination, preimageSha256: null, postimageSha256: afterHash };
  if (['MANAGED-UPDATE', 'SEED-UPDATE', 'MERGE', 'APPEND'].includes(status)) return { action: 'restore-preimage', destination, preimageSha256: beforeHash, postimageSha256: afterHash };
  if (status === 'DEPRECATED') return { action: 'none', destination, preimageSha256: beforeHash, postimageSha256: beforeHash };
  return { action: 'none', destination, preimageSha256: beforeHash, postimageSha256: afterHash };
}

function plannedDigestInput({ operation, edition, publicDependency, templateVersion, manifestHash, stateHash, target, entries, baseWrites, proposalWrites }) {
  return {
    baseWrites: baseWrites.map(({ destination, currentSha256, intendedSha256 }) => ({ destination, currentSha256, intendedSha256 })),
    proposalWrites: proposalWrites.map(({ destination, currentSha256, intendedSha256 }) => ({ destination, currentSha256, intendedSha256 })),
    operation,
    edition,
    publicDependency: publicDependency ?? null,
    templateVersion,
    manifestHash,
    stateHash,
    target,
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

function baseDestinationFor(destination) {
  return `${BASE_RELATIVE_DIRECTORY}/${destination}`;
}

async function readBaseSnapshot(target, destination) {
  const snapshotPath = path.resolve(target, ...baseDestinationFor(destination).split('/'));
  if (!isWithin(target, snapshotPath)) fail('TARGET_ESCAPE', `Base snapshot escapes the target: ${destination}`);
  await assertNoSymlinkAncestors(snapshotPath, 'Base snapshot', target);
  return readRegularFile(snapshotPath, `Base snapshot ${destination}`);
}

let releaseBasesCache = null;
async function releaseBases() {
  if (releaseBasesCache) return releaseBasesCache;
  const bytes = await readRegularFile(path.join(INSTALLER_ROOT, RELEASE_BASES_RELATIVE_PATH), 'Release bases');
  const parsed = bytes === null ? {} : JSON.parse(bytes.toString('utf8'));
  releaseBasesCache = new Map(Object.entries(parsed.bases ?? {}));
  return releaseBasesCache;
}

/**
 * The merge base for one managed path: the bytes whose SHA-256 is the recorded
 * templateSha256. Looked up in the target's own base snapshot, then this CLI's
 * template, then the bundled bytes of earlier releases. Every candidate is
 * checked by hash; null means no base is known.
 */
export async function findMergeBase({ target, destination, record, templateBytes }) {
  const snapshot = await readBaseSnapshot(target, destination);
  if (snapshot !== null && sha256(snapshot) === record.templateSha256) return { bytes: snapshot, source: 'snapshot' };
  if (templateBytes && sha256(templateBytes) === record.templateSha256) return { bytes: Buffer.from(templateBytes), source: 'template' };
  const text = (await releaseBases()).get(record.templateSha256);
  if (typeof text === 'string') {
    const bytes = Buffer.from(text, 'utf8');
    if (sha256(bytes) === record.templateSha256) return { bytes, source: 'release' };
  }
  return null;
}

// Three-way rules for one managed path. Current bytes c, recorded installed bytes I,
// recorded template (the merge base) B, and this release's template T:
//   c = T                     IDENTICAL
//   c = I and I = B           MANAGED-UPDATE (the file is the pristine template)
//   T = B                     CUSTOMIZED-KEEP (or IDENTICAL once accepted): keep the local file
//   T != B, merge clean       MERGE
//   T != B, merge overlaps    CONFLICT, with a marked proposal
//   T != B, no base known     CONFLICT, with a whole-file proposal
async function threeWayDecision({ target, entry, record, existing, currentSha256 }) {
  const keep = (status) => ({ status, intendedSha256: currentSha256, postimage: null, proposal: null, baseSource: null });
  if (currentSha256 === entry.sha256) return { status: 'IDENTICAL', intendedSha256: entry.sha256, postimage: null, proposal: null, baseSource: null };
  if (currentSha256 === record.installedSha256 && record.installedSha256 === record.templateSha256) {
    return { status: 'MANAGED-UPDATE', intendedSha256: entry.sha256, postimage: null, proposal: null, baseSource: null };
  }
  if (entry.sha256 === record.templateSha256) return keep(currentSha256 === record.installedSha256 ? 'IDENTICAL' : 'CUSTOMIZED-KEEP');
  const base = await findMergeBase({ target, destination: entry.destination, record, templateBytes: entry.bytes });
  // The merge decodes UTF-8, so a non-UTF-8 base, local or template is never merged and gets no proposal.
  if (!isUtf8(existing) || !isUtf8(entry.bytes) || (base !== null && !isUtf8(base.bytes))) {
    return {
      status: 'CONFLICT', intendedSha256: entry.sha256, postimage: null, proposal: null, baseSource: null,
      conflictReason: mergeNonUtf8Reason(entry.destination),
    };
  }
  if (base === null) {
    return {
      status: 'CONFLICT', intendedSha256: entry.sha256, postimage: null, baseSource: null,
      proposal: Buffer.from(twoWayProposal(existing, entry.bytes, { local: `local ${entry.destination}`, template: `template ${entry.sha256.slice(0, 12)}` })),
    };
  }
  const merged = mergeThreeWay(base.bytes, existing, entry.bytes, {
    local: `local ${entry.destination}`,
    base: `base ${record.templateSha256.slice(0, 12)}`,
    template: `template ${entry.sha256.slice(0, 12)}`,
  });
  if (!merged.clean) {
    return { status: 'CONFLICT', intendedSha256: entry.sha256, postimage: null, baseSource: base.source, proposal: Buffer.from(merged.text) };
  }
  const postimage = Buffer.from(merged.text);
  const postimageSha256 = sha256(postimage);
  if (postimageSha256 === currentSha256) return { ...keep('CUSTOMIZED-KEEP'), baseSource: base.source };
  return { status: 'MERGE', intendedSha256: postimageSha256, postimage, proposal: null, baseSource: base.source };
}

// A seed the user changed, whose template changed since install: the proposal is the merged text (clean or marked),
// or the whole-file offer when no base is known. The seed bytes themselves are never written.
async function seedProposal({ target, entry, record, existing }) {
  // Non-UTF-8 bytes get no proposal: the seed stays as it is, as the merge would otherwise rewrite the bytes.
  if (!isUtf8(existing) || !isUtf8(entry.bytes)) return null;
  const labels = { local: `local ${entry.destination}`, template: `template ${entry.sha256.slice(0, 12)}` };
  const base = await findMergeBase({ target, destination: entry.destination, record, templateBytes: entry.bytes });
  if (base !== null && !isUtf8(base.bytes)) return null;
  if (base === null) return Buffer.from(twoWayProposal(existing, entry.bytes, labels));
  return Buffer.from(mergeThreeWay(base.bytes, existing, entry.bytes, { ...labels, base: `base ${record.templateSha256.slice(0, 12)}` }).text);
}

// The file a seed migration's proposal is written to: one folder per template version, so a later release never
// collides with an earlier offer.
function proposalPathFor(templateVersion, destination) {
  const relative = `${MERGE_RELATIVE_DIRECTORY}/${templateVersion}/${destination}.proposed`;
  validateRelativePath(relative, 'Merge proposal path');
  return relative;
}

export async function planInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation = 'init', edition = 'free', publicDependency = null }) {
  if (!['init', 'upgrade'].includes(operation)) fail('INVALID_OPERATION', 'Operation must be init or upgrade.');
  if (!['free', 'paid'].includes(edition)) fail('INVALID_EDITION', 'Edition must be free or paid.');
  if ((edition === 'free' && publicDependency !== null) || (edition === 'paid' && (typeof publicDependency !== 'string' || publicDependency.length === 0))) {
    fail('INVALID_DEPENDENCY', 'publicDependency must be null for free and a non-empty pinned identity for paid.');
  }
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) fail('INVALID_MANIFEST', 'Manifest bytes are required for digest binding.');
  const validated = await validateManifest({ manifest, sourceRoot });
  const target = await resolveTarget(targetPath, validated.sourceRoot);
  await assertTransactionNamespace(target);
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
    // A managed block may be appended only when the file exists, no comment names the tool and no install record exists.
    // A damaged marker is a conflict, whether or not there is an install record.
    if (entry.mergeKind === 'managed-block' && existing !== null && isNonUtf8Text(existing)) {
      entries.push(conflictEntry(entry, currentSha256, nonUtf8Reason(entry.destination)));
      continue;
    }
    // An installed loader file with one named damage gets that sentence. An empty file still stops the whole plan.
    if (entry.mergeKind === 'managed-block' && existing !== null && record !== null) {
      const damage = loaderDamageReason(existing, entry.destination, entry.bytes, entry.source, 'plan');
      if (damage !== null && existing.length === 0) fail('LOADER_CONFLICT', damage);
      if (damage !== null) {
        entries.push(conflictEntry(entry, currentSha256, damage));
        continue;
      }
    }
    const check =entry.mergeKind === 'managed-block' && existing !== null ? markerCheck(existing, entry.destination) : { form: 'absent' };
    if (check.form === 'damaged') {
      entries.push(conflictEntry(entry, currentSha256, markerConflictReason(entry.destination, check)));
      continue;
    }
    const canAppend = entry.mergeKind === 'managed-block' && existing !== null && record === null && check.form === 'absent';
    let intendedBytes;
    try {
      intendedBytes = canAppend ? appendPostimage({ sourceBytes: entry.bytes, existing, destination: entry.destination }) : postimageForEntry(entry, existing);
    } catch (error) {
      if (error instanceof InstallPlanError && error.code === 'LOADER_CONFLICT') {
        entries.push(conflictEntry(entry, currentSha256, null));
        continue;
      }
      throw error;
    }
    const managedBlockSha256 = entry.mergeKind === 'managed-block'
      ? loaderBlockSha256(entry.bytes, `Loader source ${entry.destination}`, entry.destination)
      : null;
    let intendedSha256 = sha256(intendedBytes);
    let status;
    let postimage = null;
    let proposal = null;
    let baseSource = null;
    let reason = null;
    if (existing === null) status = 'CREATE';
    else if (entry.mergeKind === 'managed-block') {
      if (currentSha256 === intendedSha256) status = 'IDENTICAL';
      else if (canAppend) status = 'APPEND';
      else if (record?.managedBlockSha256 === loaderBlockSha256(existing, `Existing loader ${entry.destination}`, entry.destination)) status = 'MANAGED-UPDATE';
      else status = 'CONFLICT';
    } else if (!record) {
      // A file the installed state does not manage is never adopted or merged silently. The one exception: an upgrade of
      // an installed workspace, where a seed path new to this install already holds the user's file. That file is kept
      // as the user's seed, and the template is offered through proposalWrites, as no base exists for it.
      if (operation === 'upgrade' && stateHash !== null && entry.mergeKind === 'seed-file' && currentSha256 !== intendedSha256) {
        status = 'PERSONALIZED';
        intendedSha256 = currentSha256;
        proposal = Buffer.from(entry.bytes);
      } else {
        status = currentSha256 === intendedSha256 ? 'IDENTICAL' : 'CONFLICT';
      }
    } else if (entry.mergeKind === 'seed-file' && record.mergeKind === 'seed-file') {
      if (currentSha256 === entry.sha256) status = 'IDENTICAL';
      else if (currentSha256 === record.installedSha256 && record.installedSha256 === record.templateSha256) status = 'SEED-UPDATE';
      else {
        status = 'PERSONALIZED';
        intendedSha256 = currentSha256;
        // The template changed since this seed was installed: offer the merge through proposalWrites, never by writing the seed.
        if (entry.sha256 !== record.templateSha256) proposal = await seedProposal({ target, entry, record, existing });
      }
    } else {
      // A managed file, or a formerly managed file that becomes a seed in this
      // release: three-way rules against the template bytes it was installed from.
      const decision = await threeWayDecision({ target, entry, record, existing, currentSha256 });
      ({ status, postimage, proposal, baseSource } = decision);
      intendedSha256 = decision.intendedSha256;
      reason = decision.conflictReason ?? null;
      if (entry.mergeKind === 'seed-file' && status === 'CONFLICT') {
        // The file becomes user-owned in this release: keep the local bytes and
        // offer the marked proposal instead of blocking the whole upgrade.
        status = 'PERSONALIZED';
        intendedSha256 = currentSha256;
      }
    }
    entries.push({
      destination: entry.destination,
      source: entry.source,
      mergeKind: entry.mergeKind,
      templateSha256: entry.sha256,
      managedBlockSha256,
      status,
      currentSha256,
      intendedSha256,
      undo: exactUndo(status, entry.destination, currentSha256, intendedSha256),
      ...(status === 'CONFLICT' && entry.mergeKind === 'managed-block' ? { conflictReason: record ? editedBlockReason(entry.destination) : unrecordedBlockReason(entry.destination) } : {}),
      ...(status === 'CONFLICT' && reason !== null ? { conflictReason: reason } : {}),
      ...(baseSource ? { baseSource } : {}),
      ...(proposal !== null ? { proposal } : {}),
      ...(postimage !== null ? { postimage } : {}),
      templateBytes: entry.bytes,
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
  const baseWrites = [];
  // A seed keeps a base snapshot of its template too, so a later seed proposal has a base from the workspace.
  for (const entry of entries) {
    if (!['managed-file', 'seed-file'].includes(entry.mergeKind) || ['CONFLICT', 'DEPRECATED'].includes(entry.status)) continue;
    const snapshot = await readBaseSnapshot(target, entry.destination);
    const currentBaseSha256 = snapshot === null ? null : sha256(snapshot);
    if (currentBaseSha256 === entry.templateSha256) continue;
    baseWrites.push({
      destination: baseDestinationFor(entry.destination),
      managedDestination: entry.destination,
      currentSha256: currentBaseSha256,
      intendedSha256: entry.templateSha256,
      bytes: entry.templateBytes,
    });
  }
  // A seed migration's proposal is written by the apply, and only when no file is at its path yet. A file already
  // there is the user's, edited or not, and the plan keeps it: it is never overwritten and never planned as a write.
  const proposalWrites = [];
  for (const entry of entries) {
    if (!entry.proposal || entry.status !== 'PERSONALIZED') continue;
    entry.proposalPath = proposalPathFor(validated.templateVersion, entry.destination);
    const proposalFile = planEntryPath(target, entry.proposalPath);
    await assertNoSymlinkAncestors(proposalFile, 'Merge proposal', target);
    const existing = await readRegularFile(proposalFile, `Merge proposal ${entry.destination}`);
    if (existing === null) {
      entry.proposalState = 'write';
      proposalWrites.push({
        destination: entry.proposalPath,
        managedDestination: entry.destination,
        currentSha256: null,
        intendedSha256: sha256(entry.proposal),
        bytes: entry.proposal,
      });
    } else {
      entry.proposalState = sha256(existing) === sha256(entry.proposal) ? 'present' : 'kept';
    }
  }
  const digestInput = plannedDigestInput({
    baseWrites,
    proposalWrites,
    operation,
    edition,
    publicDependency,
    templateVersion: validated.templateVersion,
    manifestHash: sha256(manifestBytes),
    stateHash,
    target,
    entries,
  });
  return {
    operation,
    edition,
    publicDependency,
    sourceRoot: validated.sourceRoot,
    templateVersion: validated.templateVersion,
    target,
    manifestHash: sha256(manifestBytes),
    statePath: path.relative(target, statePath).split(path.sep).join('/'),
    stateHash,
    installedTemplateVersion: stateHash === null ? null : state.templateVersion,
    entries,
    baseWrites,
    proposalWrites,
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

function backupRelativePathFor(receiptIdValue, destination) {
  return `${BACKUPS_RELATIVE_DIRECTORY}/${receiptIdValue}/${destination}`;
}

function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertReceiptWrite(write, receiptIdValue) {
  if (!write || typeof write !== 'object' || Array.isArray(write)
    || !hasExactKeys(write, ['destination', 'preimageSha256', 'postimageSha256', 'backupPath'])) {
    fail('INVALID_RECEIPT', 'Transaction receipt has an invalid write record.');
  }
  validateRelativePath(write.destination, 'Receipt destination');
  if (!SHA256_PATTERN.test(write.postimageSha256 ?? '') || (write.preimageSha256 !== null && !SHA256_PATTERN.test(write.preimageSha256 ?? ''))) {
    fail('INVALID_RECEIPT', `Transaction receipt has invalid image hashes: ${write.destination}`);
  }
  if (write.preimageSha256 === null) {
    if (write.backupPath !== null) fail('INVALID_RECEIPT', `Created receipt write must not have a backup: ${write.destination}`);
    return;
  }
  if (write.backupPath !== backupRelativePathFor(receiptIdValue, write.destination)) {
    fail('INVALID_RECEIPT', `Receipt backup path is not owned by this transaction: ${write.destination}`);
  }
}

function assertUniqueDestinations(writes) {
  const destinations = new Set();
  for (const write of writes) {
    if (destinations.has(write.destination)) fail('INVALID_RECEIPT', `Transaction receipt has a duplicate destination: ${write.destination}`);
    for (const destination of destinations) {
      if (write.destination.startsWith(`${destination}/`) || destination.startsWith(`${write.destination}/`)) {
        fail('INVALID_RECEIPT', `Transaction receipt has overlapping destinations: ${write.destination}`);
      }
    }
    destinations.add(write.destination);
  }
}

function stateBindingHash(state) {
  return sha256(Buffer.from(`${stableStringify({ ...state, writeSetDigest: '0'.repeat(64) })}\n`));
}

function receiptWriteSetDigest(writes, stateBinding = null) {
  return sha256(Buffer.from(stableStringify(writes.map((write) => ({
    destination: write.destination,
    preimageSha256: write.preimageSha256,
    postimageSha256: write.destination === STATE_RELATIVE_PATH ? stateBinding : write.postimageSha256,
    backupPath: write.backupPath,
    ...(write.destination === STATE_RELATIVE_PATH ? { binding: stateBinding } : {}),
  })))));
}

async function ensureSafeDirectory(directoryPath, target, label, createdDirectories = null) {
  if (!isWithin(target, directoryPath)) fail('TARGET_ESCAPE', `${label} escapes the target: ${directoryPath}`);
  await assertNoSymlinkAncestors(directoryPath, label, target);
  const missing = [];
  for (let cursor = directoryPath; cursor !== target; cursor = path.dirname(cursor)) {
    const stat = await lstatOrNull(cursor);
    if (!stat) missing.push(cursor);
    else if (!stat.isDirectory()) fail('NON_DIRECTORY', `${label} is not a directory: ${cursor}`);
  }
  await mkdir(directoryPath, { recursive: true });
  await assertNoSymlinkAncestors(directoryPath, label, target);
  if (createdDirectories) {
    for (const directory of missing) {
      if ((await lstatOrNull(directory))?.isDirectory()) createdDirectories.add(directory);
    }
  }
}

async function writeAtomically(filePath, bytes, target, label, createdDirectories = null) {
  if (!isWithin(target, filePath)) fail('TARGET_ESCAPE', `${label} escapes the target: ${filePath}`);
  const directory = path.dirname(filePath);
  await ensureSafeDirectory(directory, target, `${label} directory`, createdDirectories);
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

function stateForPlan(plan, receiptIdValue, writeSetDigest) {
  const managedPaths = {};
  for (const entry of plan.entries) {
    if (entry.status === 'DEPRECATED') continue;
    managedPaths[entry.destination] = {
      installedSha256: entry.intendedSha256,
      templateSha256: entry.templateSha256,
      mergeKind: entry.mergeKind,
      ...(entry.managedBlockSha256 ? { managedBlockSha256: entry.managedBlockSha256 } : {}),
    };
  }
  return {
    schemaVersion: 1,
    edition: plan.edition,
    templateVersion: plan.templateVersion,
    publicDependency: plan.publicDependency ?? null,
    manifestSha256: plan.manifestHash,
    planDigest: plan.digest,
    transactionId: receiptIdValue,
    operation: plan.operation,
    writeSetDigest,
    managedPaths,
  };
}

function planEntryPath(target, destination) {
  validateRelativePath(destination, 'Plan destination');
  const filePath = path.resolve(target, ...destination.split('/'));
  if (!isWithin(target, filePath)) fail('TARGET_ESCAPE', `Plan destination escapes the target: ${destination}`);
  return filePath;
}

async function backupPreimage({ target, receiptId: receiptIdValue, destination, bytes, createdDirectories = null }) {
  if (bytes === null) return null;
  const backupPath = backupPathFor(target, receiptIdValue, destination);
  await writeAtomically(backupPath, bytes, target, `Backup ${destination}`, createdDirectories);
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

async function prepareRollback(target, writes) {
  const prepared = [];
  for (const write of writes) {
    const destinationPath = planEntryPath(target, write.destination);
    await assertNoSymlinkAncestors(destinationPath, `Rollback destination ${write.destination}`, target);
    const current = await readRegularFile(destinationPath, `Rollback destination ${write.destination}`);
    const currentHash = current === null ? null : sha256(current);
    if (currentHash !== write.postimageSha256) {
      fail('POSTIMAGE_MISMATCH', `Rollback refused because ${write.destination} no longer has this receipt's postimage.`);
    }
    let backup = null;
    if (write.preimageSha256 !== null) {
      const backupPath = path.resolve(target, ...write.backupPath.split('/'));
      if (!isWithin(target, backupPath)) fail('INVALID_RECEIPT', `Receipt backup path is outside the target: ${write.destination}`);
      await assertNoSymlinkAncestors(backupPath, `Receipt backup ${write.destination}`, target);
      backup = await readRegularFile(backupPath, `Receipt backup ${write.destination}`);
      if (backup === null || sha256(backup) !== write.preimageSha256) {
        fail('INVALID_RECEIPT', `Receipt backup does not match its recorded preimage: ${write.destination}`);
      }
    }
    prepared.push({ write, destinationPath, backup });
  }
  return prepared;
}

async function applyPreparedRollback(target, prepared) {
  for (const { write, destinationPath, backup } of [...prepared].reverse()) {
    if (backup === null) await removeRegularFile(destinationPath, target, `Rollback destination ${write.destination}`);
    else await writeAtomically(destinationPath, backup, target, `Rollback destination ${write.destination}`);
  }
}

async function assertPlanPostconditions(plan) {
  for (const entry of plan.entries) {
    const destinationPath = planEntryPath(plan.target, entry.destination);
    const current = await readRegularFile(destinationPath, `Concurrent destination ${entry.destination}`);
    const actualHash = current === null ? null : sha256(current);
    const expectedHash = entry.status === 'DEPRECATED' ? entry.currentSha256 : entry.intendedSha256;
    if (actualHash !== expectedHash) {
      fail('CONCURRENT_MODIFICATION', `Destination changed while the transaction was applying: ${entry.destination}`);
    }
  }
  for (const baseWrite of plan.baseWrites ?? []) {
    const current = await readRegularFile(planEntryPath(plan.target, baseWrite.destination), `Concurrent base snapshot ${baseWrite.managedDestination}`);
    if ((current === null ? null : sha256(current)) !== baseWrite.intendedSha256) {
      fail('CONCURRENT_MODIFICATION', `Base snapshot changed while the transaction was applying: ${baseWrite.managedDestination}`);
    }
  }
  for (const proposalWrite of plan.proposalWrites ?? []) {
    const current = await readRegularFile(planEntryPath(plan.target, proposalWrite.destination), `Concurrent merge proposal ${proposalWrite.managedDestination}`);
    if ((current === null ? null : sha256(current)) !== proposalWrite.intendedSha256) {
      fail('CONCURRENT_MODIFICATION', `Merge proposal changed while the transaction was applying: ${proposalWrite.managedDestination}`);
    }
  }
}

async function removeEmptyDirectories(directories) {
  for (const directory of [...directories].sort((left, right) => right.length - left.length || right.localeCompare(left))) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
    }
  }
}

async function removeTransactionBackups(target, writes) {
  for (const write of writes) {
    if (write.backupPath !== null) {
      const backupPath = path.resolve(target, ...write.backupPath.split('/'));
      await removeRegularFile(backupPath, target, `Transaction backup ${write.destination}`);
    }
  }
}

function receiptBackupDirectories(target, receiptIdValue, writes) {
  const root = path.join(target, ...BACKUPS_RELATIVE_DIRECTORY.split('/'), receiptIdValue);
  const directories = new Set([root]);
  for (const write of writes) {
    if (write.backupPath === null) continue;
    for (let directory = path.dirname(path.resolve(target, ...write.backupPath.split('/'))); isWithin(root, directory); directory = path.dirname(directory)) {
      directories.add(directory);
      if (directory === root) break;
    }
  }
  return directories;
}

// Folders under a namespace folder (.second-brain/base or .second-brain/merge) that only held files this receipt created.
function createdDirectoriesUnder(target, writes, namespaceRelative) {
  const root = path.join(target, ...namespaceRelative.split('/'));
  const directories = new Set();
  for (const write of writes) {
    if (write.preimageSha256 !== null || !write.destination.startsWith(`${namespaceRelative}/`)) continue;
    for (let directory = path.dirname(path.resolve(target, ...write.destination.split('/'))); isWithin(root, directory); directory = path.dirname(directory)) {
      directories.add(directory);
      if (directory === root) break;
    }
  }
  return directories;
}

/**
 * Recomputes the plan immediately before mutation, applies only its exact
 * digest-approved non-conflicting writes, and creates a local receipt.
 */
export async function applyInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation = 'init', edition = 'free', publicDependency = null, approvedDigest, injectFailureAfterWrite = null }) {
  const plan = await planInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation, edition, publicDependency });
  assertApplyablePlan(plan, approvedDigest);
  if (plan.entries.every((entry) => entry.status === 'IDENTICAL') && plan.baseWrites.length === 0 && plan.proposalWrites.length === 0) {
    return { plan, receiptId: null, receiptPath: null, applied: false };
  }
  const id = receiptId();
  const writes = [];
  const createdDirectories = new Set();
  let stateWrite = null;
  let stateWritten = false;
  let writePosition = 0;
  const failAfter = async () => {
    writePosition += 1;
    if (injectFailureAfterWrite === writePosition) fail('INJECTED_WRITE_FAILURE', `Injected write failure after position ${writePosition}.`);
  };

  try {
    for (const entry of plan.entries) {
      if (!['CREATE', 'MANAGED-UPDATE', 'SEED-UPDATE', 'MERGE', 'APPEND'].includes(entry.status)) continue;
      const destinationPath = planEntryPath(plan.target, entry.destination);
      const before = await readRegularFile(destinationPath, `Apply destination ${entry.destination}`);
      const beforeHash = before === null ? null : sha256(before);
      if (beforeHash !== entry.currentSha256) fail('CONCURRENT_MODIFICATION', `Destination changed after plan approval: ${entry.destination}`);
      const sourcePath = path.resolve(plan.sourceRoot, ...entry.source.split('/'));
      if (sourcePath) await assertNoSymlinkAncestors(sourcePath, `Apply source ${entry.source}`, plan.sourceRoot);
      const sourceBytes = await readRegularFile(sourcePath, `Apply source ${entry.source}`);
      if (sourceBytes === null) fail('MISSING_SOURCE', `Manifest source disappeared before apply: ${entry.source}`);
      if (sha256(sourceBytes) !== entry.templateSha256) fail('SOURCE_HASH_MISMATCH', `Manifest source changed before apply: ${entry.source}`);
      let postimage = sourceBytes;
      if (entry.status === 'APPEND') postimage = appendPostimage({ sourceBytes, existing: before, destination: entry.destination });
      else if (entry.mergeKind === 'managed-block') postimage = loaderPostimage({ sourceBytes, existing: before, destination: entry.destination });
      else if (entry.status === 'MERGE') postimage = entry.postimage;
      const postimageHash = sha256(postimage);
      if (postimageHash !== entry.intendedSha256) fail('CONCURRENT_MODIFICATION', `Loader surroundings changed after plan approval: ${entry.destination}`);
      const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: entry.destination, bytes: before, createdDirectories });
      await writeAtomically(destinationPath, postimage, plan.target, `Apply destination ${entry.destination}`, createdDirectories);
      writes.push({ destination: entry.destination, preimageSha256: beforeHash, postimageSha256: postimageHash, backupPath });
      await failAfter();
    }

    for (const baseWrite of plan.baseWrites) {
      const basePath = planEntryPath(plan.target, baseWrite.destination);
      const before = await readRegularFile(basePath, `Base snapshot ${baseWrite.managedDestination}`);
      const beforeHash = before === null ? null : sha256(before);
      if (beforeHash !== baseWrite.currentSha256) fail('CONCURRENT_MODIFICATION', `Base snapshot changed after plan approval: ${baseWrite.managedDestination}`);
      if (sha256(baseWrite.bytes) !== baseWrite.intendedSha256) fail('SOURCE_HASH_MISMATCH', `Base snapshot bytes do not match the template: ${baseWrite.managedDestination}`);
      const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: baseWrite.destination, bytes: before, createdDirectories });
      await writeAtomically(basePath, baseWrite.bytes, plan.target, `Base snapshot ${baseWrite.managedDestination}`, createdDirectories);
      writes.push({ destination: baseWrite.destination, preimageSha256: beforeHash, postimageSha256: baseWrite.intendedSha256, backupPath });
      await failAfter();
    }

    for (const proposalWrite of plan.proposalWrites) {
      const proposalPath = planEntryPath(plan.target, proposalWrite.destination);
      const before = await readRegularFile(proposalPath, `Merge proposal ${proposalWrite.managedDestination}`);
      const beforeHash = before === null ? null : sha256(before);
      // Create-only: a file that appeared after the plan, edited or not, is kept, and the apply stops.
      if (beforeHash !== proposalWrite.currentSha256) fail('CONCURRENT_MODIFICATION', `Merge proposal appeared after plan approval: ${proposalWrite.managedDestination}`);
      if (sha256(proposalWrite.bytes) !== proposalWrite.intendedSha256) fail('SOURCE_HASH_MISMATCH', `Merge proposal bytes do not match the plan: ${proposalWrite.managedDestination}`);
      const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: proposalWrite.destination, bytes: before, createdDirectories });
      await writeAtomically(proposalPath, proposalWrite.bytes, plan.target, `Merge proposal ${proposalWrite.managedDestination}`, createdDirectories);
      writes.push({ destination: proposalWrite.destination, preimageSha256: beforeHash, postimageSha256: proposalWrite.intendedSha256, backupPath });
      await failAfter();
    }

    await assertPlanPostconditions(plan);
    const statePath = path.join(plan.target, ...STATE_RELATIVE_PATH.split('/'));
    const oldState = await readRegularFile(statePath, 'Installed state');
    const oldStateHash = oldState === null ? null : sha256(oldState);
    if (oldStateHash !== plan.stateHash) fail('CONCURRENT_MODIFICATION', 'Installed state changed after plan approval.');
    const stateSeed = stateForPlan(plan, id, '0'.repeat(64));
    const bindingPostimage = stateBindingHash(stateSeed);
    const stateBackupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: STATE_RELATIVE_PATH, bytes: oldState, createdDirectories });
    const provisionalStateWrite = {
      destination: STATE_RELATIVE_PATH,
      preimageSha256: oldState === null ? null : sha256(oldState),
      postimageSha256: bindingPostimage,
      backupPath: stateBackupPath,
    };
    const stateWriteDigest = receiptWriteSetDigest([...writes, provisionalStateWrite], bindingPostimage);
    const nextStateObject = stateForPlan(plan, id, stateWriteDigest);
    const nextState = Buffer.from(`${stableStringify(nextStateObject)}\n`);
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
      templateVersion: plan.templateVersion,
      publicDependency: plan.publicDependency ?? null,
      manifestSha256: plan.manifestHash,
      planDigest: plan.digest,
      writes: [...writes, stateWrite],
    };
    const receiptPath = receiptPathFor(plan.target, id);
    await writeAtomically(receiptPath, Buffer.from(`${stableStringify(receipt)}\n`), plan.target, 'Transaction receipt', createdDirectories);
    await failAfter();
    await writeAtomically(statePath, nextState, plan.target, 'Installed state', createdDirectories);
    stateWritten = true;
    await failAfter();
    return { plan, receiptId: id, receiptPath: path.relative(plan.target, receiptPath).split(path.sep).join('/'), applied: true };
  } catch (error) {
    try {
      const rollbackWrites = [...writes, ...(stateWritten && stateWrite ? [stateWrite] : [])];
      const backupWrites = [...writes, ...(stateWrite ? [stateWrite] : [])];
      const prepared = await prepareRollback(plan.target, rollbackWrites);
      await applyPreparedRollback(plan.target, prepared);
      const receiptDirectory = path.join(plan.target, ...RECEIPTS_RELATIVE_DIRECTORY.split('/'));
      await removeRegularFile(path.join(receiptDirectory, `${id}.json`), plan.target, 'Failed transaction receipt');
      await removeTransactionBackups(plan.target, backupWrites);
      await removeEmptyDirectories(createdDirectories);
    } catch (rollbackError) {
      if (rollbackError instanceof InstallPlanError) throw rollbackError;
      throw new InstallPlanError('ROLLBACK_FAILED', `Apply failed and rollback could not complete: ${rollbackError.message}`);
    }
    throw error;
  }
}

/**
 * Checks only manifest-declared installed paths. Managed bytes are checked
 * against recorded hashes; editable seed paths are checked for safe regular
 * existence. A newer source manifest is reported separately.
 */
// Read-only summary for `status`: the installed template and receipt, this CLI's template, and how many entries an
// upgrade would give each state. It builds the same plan `upgrade` prints and writes nothing: no proposals, no state.
export async function statusInstall({ manifest, manifestBytes, sourceRoot, targetPath }) {
  const read = await readInstalledState(await resolveTarget(targetPath, sourceRoot));
  const installed = read.stateHash === null
    ? null
    : { templateVersion: read.state.templateVersion, receiptId: read.state.transactionId, manifestSha256: read.state.manifestSha256 };
  let plan = null;
  try {
    plan = await planInstall({ manifest, manifestBytes, sourceRoot, targetPath, operation: 'upgrade' });
  } catch (error) {
    if (!(error instanceof InstallPlanError)) throw error;
    if (installed !== null) throw error;
  }
  const counts = new Map();
  for (const entry of plan?.entries ?? []) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  return {
    target: path.resolve(targetPath),
    installed,
    available: { templateVersion: plan?.templateVersion ?? null, manifestSha256: sha256(manifestBytes) },
    counts: [...counts.entries()],
    blocked: plan ? plan.entries.filter((entry) => entry.status === 'CONFLICT').map((entry) => entry.destination) : [],
  };
}

export async function verifyInstall({ manifest, manifestBytes, sourceRoot, targetPath }) {
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) {
    fail('INVALID_MANIFEST', 'Manifest bytes are required for installed verification.');
  }
  const validated = await validateManifest({ manifest, sourceRoot });
  const target = await resolveTarget(targetPath, validated.sourceRoot);
  const statePath = path.join(target, ...STATE_RELATIVE_PATH.split('/'));
  const entries = [];
  const issues = [];
  const manifestSha256 = sha256(manifestBytes);
  let state = null;
  let stateHash = null;

  try {
    const read = await readInstalledState(target);
    state = read.state;
    stateHash = read.stateHash;
    if (stateHash === null) {
      issues.push({ code: 'MISSING_STATE', path: STATE_RELATIVE_PATH, message: `Missing installed state: ${STATE_RELATIVE_PATH}` });
    }
  } catch (error) {
    if (!(error instanceof InstallPlanError)) throw error;
    issues.push({ code: error.code, path: STATE_RELATIVE_PATH, message: error.message });
  }
  if (state !== null && stateHash !== null && state.manifestSha256 !== manifestSha256) {
    issues.push({
      code: 'SOURCE_MANIFEST_MISMATCH',
      path: STATE_RELATIVE_PATH,
      message: `Installed state was created from a different source manifest: ${STATE_RELATIVE_PATH}`,
    });
  }

  for (const entry of validated.entries) {
    const record = state ? stateRecordFor(state, entry.destination) : null;
    const destinationPath = path.resolve(target, ...entry.destination.split('/'));
    let actualSha256 = null;
    let status = 'VERIFIED';
    let message = null;
    try {
      await assertNoSymlinkAncestors(destinationPath, 'Verification destination', target);
      const bytes = await readRegularFile(destinationPath, `Verification destination ${entry.destination}`);
      actualSha256 = bytes === null ? null : sha256(bytes);
      if (!record) {
        status = 'UNMANAGED';
        message = `Installed state does not manage ${entry.destination}`;
      } else if (actualSha256 === null) {
        status = 'MISSING';
        message = entry.mergeKind === 'managed-block' ? missingLoaderMessage(entry.destination) : `Missing managed destination: ${entry.destination}`;
      } else if (entry.mergeKind === 'seed-file') {
        status = 'PERSONALIZED';
      } else if (entry.mergeKind === 'managed-block') {
        // Loader files are verified by their managed block only: users add their own text around it.
        if (!loaderBlockMatches(bytes, entry.destination, record)) {
          status = 'CORRUPT';
          message = loaderVerifyMessage(bytes, entry);
        }
      } else if (actualSha256 !== record.installedSha256) {
        // Content drift is a local edit, not damage: upgrade keeps or merges it, and --adopt accepts it.
        status = 'MODIFIED';
        message = `Managed file differs from its installed bytes (a local edit): ${entry.destination}. Keep it with verify --adopt ${entry.destination}`;
      }
      if (record && ['managed-file', 'seed-file'].includes(entry.mergeKind)) {
        const snapshot = await readBaseSnapshot(target, entry.destination);
        if (snapshot !== null && sha256(snapshot) !== record.templateSha256) {
          issues.push({ code: 'CORRUPT', path: baseDestinationFor(entry.destination), message: `Base snapshot does not match the recorded template hash: ${baseDestinationFor(entry.destination)}` });
        }
      }
    } catch (error) {
      if (!(error instanceof InstallPlanError)) throw error;
      status = error.code;
      message = error.message;
    }
    if (!['VERIFIED', 'PERSONALIZED'].includes(status)) issues.push({ code: status, path: entry.destination, message });
    entries.push({
      destination: entry.destination,
      expectedSha256: record?.installedSha256 ?? null,
      actualSha256,
      status,
    });
  }

  return {
    ok: issues.length === 0,
    target,
    statePath: path.relative(target, statePath).split(path.sep).join('/'),
    stateHash,
    manifestSha256,
    templateVersion: validated.templateVersion,
    installedTemplateVersion: state && stateHash !== null ? state.templateVersion : null,
    installedManifestSha256: state && stateHash !== null ? state.manifestSha256 : null,
    manifestMatchesInstalled: state?.manifestSha256 === manifestSha256,
    entries,
    issues,
    divergences: await skillCopyDivergences(target, validated.entries),
  };
}

/**
 * Plans `verify --adopt`: record the current bytes of named managed files as the
 * accepted local version. The installed hash becomes the current bytes, and the
 * merge base becomes this CLI's template, so the next upgrade treats the file as
 * customized from this template. Only state and base snapshots are written.
 */
export async function planAdopt({ manifest, manifestBytes, sourceRoot, targetPath, paths }) {
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) fail('INVALID_MANIFEST', 'Manifest bytes are required for digest binding.');
  if (!Array.isArray(paths) || paths.length === 0) fail('ADOPT_REFUSED', 'Name at least one managed path to adopt.');
  const validated = await validateManifest({ manifest, sourceRoot });
  const target = await resolveTarget(targetPath, validated.sourceRoot);
  await assertTransactionNamespace(target);
  const { state, stateHash } = await readInstalledState(target);
  if (stateHash === null) fail('MISSING_STATE', 'The target has no installed state, so there is nothing to adopt into.');
  const seen = new Set();
  const entries = [];
  const baseWrites = [];
  for (const destination of paths) {
    validateRelativePath(destination, 'Adopt path');
    if (seen.has(destination)) fail('ADOPT_REFUSED', `Adopt path is named twice: ${destination}`);
    seen.add(destination);
    const entry = validated.entries.find((item) => item.destination === destination);
    const record = stateRecordFor(state, destination);
    if (!entry || !record) fail('ADOPT_REFUSED', `Not a managed path of this installation: ${destination}`);
    if (entry.mergeKind !== 'managed-file' || record.mergeKind !== 'managed-file') {
      fail('ADOPT_REFUSED', `Only managed files can be adopted; ${destination} is a ${entry.mergeKind === 'managed-file' ? record.mergeKind : entry.mergeKind}.`);
    }
    await assertNoSymlinkAncestors(planEntryPath(target, destination), `Adopt path ${destination}`, target);
    const current = await readRegularFile(planEntryPath(target, destination), `Adopt path ${destination}`);
    if (current === null) fail('ADOPT_REFUSED', `Adopt path is missing: ${destination}`);
    const currentSha256 = sha256(current);
    entries.push({
      destination,
      currentSha256,
      previousInstalledSha256: record.installedSha256,
      previousTemplateSha256: record.templateSha256,
      templateSha256: entry.sha256,
      baseMoves: record.templateSha256 !== entry.sha256,
    });
    const snapshot = await readBaseSnapshot(target, destination);
    const snapshotSha256 = snapshot === null ? null : sha256(snapshot);
    if (snapshotSha256 !== entry.sha256) {
      baseWrites.push({ destination: baseDestinationFor(destination), managedDestination: destination, currentSha256: snapshotSha256, intendedSha256: entry.sha256, bytes: entry.bytes });
    }
  }
  entries.sort((left, right) => left.destination.localeCompare(right.destination));
  baseWrites.sort((left, right) => left.destination.localeCompare(right.destination));
  const manifestHash = sha256(manifestBytes);
  const digest = sha256(Buffer.from(stableStringify({
    operation: 'adopt',
    target,
    stateHash,
    manifestHash,
    entries,
    baseWrites: baseWrites.map(({ destination, currentSha256, intendedSha256 }) => ({ destination, currentSha256, intendedSha256 })),
  })));
  const unchanged = entries.every((item) => item.currentSha256 === item.previousInstalledSha256 && !item.baseMoves) && baseWrites.length === 0;
  return { operation: 'adopt', target, stateHash, manifestHash, state, templateVersion: validated.templateVersion, entries, baseWrites, unchanged, digest };
}

export async function applyAdopt({ manifest, manifestBytes, sourceRoot, targetPath, paths, approvedDigest }) {
  const plan = await planAdopt({ manifest, manifestBytes, sourceRoot, targetPath, paths });
  if (typeof approvedDigest !== 'string' || approvedDigest !== plan.digest) {
    fail('PLAN_DIGEST_MISMATCH', 'The supplied approval does not match the current adopt plan digest.');
  }
  if (plan.unchanged) return { plan, receiptId: null, receiptPath: null, applied: false };
  const id = receiptId();
  const writes = [];
  const createdDirectories = new Set();
  let stateWrite = null;
  let stateWritten = false;
  try {
    for (const item of plan.entries) {
      const current = await readRegularFile(planEntryPath(plan.target, item.destination), `Adopt path ${item.destination}`);
      if (current === null || sha256(current) !== item.currentSha256) fail('CONCURRENT_MODIFICATION', `Adopt path changed after plan approval: ${item.destination}`);
    }
    for (const baseWrite of plan.baseWrites) {
      const basePath = planEntryPath(plan.target, baseWrite.destination);
      const before = await readRegularFile(basePath, `Base snapshot ${baseWrite.managedDestination}`);
      const beforeHash = before === null ? null : sha256(before);
      if (beforeHash !== baseWrite.currentSha256) fail('CONCURRENT_MODIFICATION', `Base snapshot changed after plan approval: ${baseWrite.managedDestination}`);
      const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: baseWrite.destination, bytes: before, createdDirectories });
      await writeAtomically(basePath, baseWrite.bytes, plan.target, `Base snapshot ${baseWrite.managedDestination}`, createdDirectories);
      writes.push({ destination: baseWrite.destination, preimageSha256: beforeHash, postimageSha256: baseWrite.intendedSha256, backupPath });
    }
    const statePath = path.join(plan.target, ...STATE_RELATIVE_PATH.split('/'));
    const oldState = await readRegularFile(statePath, 'Installed state');
    if ((oldState === null ? null : sha256(oldState)) !== plan.stateHash) fail('CONCURRENT_MODIFICATION', 'Installed state changed after plan approval.');
    const managedPaths = structuredClone(plan.state.managedPaths);
    for (const item of plan.entries) {
      managedPaths[item.destination] = { ...managedPaths[item.destination], installedSha256: item.currentSha256, templateSha256: item.templateSha256 };
    }
    const stateFor = (writeSetDigest) => ({
      ...plan.state,
      planDigest: plan.digest,
      transactionId: id,
      operation: 'adopt',
      writeSetDigest,
      managedPaths,
    });
    const bindingPostimage = stateBindingHash(stateFor('0'.repeat(64)));
    const stateBackupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: STATE_RELATIVE_PATH, bytes: oldState, createdDirectories });
    const provisional = { destination: STATE_RELATIVE_PATH, preimageSha256: sha256(oldState), postimageSha256: bindingPostimage, backupPath: stateBackupPath };
    const nextState = Buffer.from(`${stableStringify(stateFor(receiptWriteSetDigest([...writes, provisional], bindingPostimage)))}\n`);
    stateWrite = { ...provisional, postimageSha256: sha256(nextState) };
    const receipt = {
      schemaVersion: 1,
      receiptId: id,
      operation: 'adopt',
      edition: plan.state.edition,
      templateVersion: plan.state.templateVersion,
      publicDependency: plan.state.publicDependency ?? null,
      manifestSha256: plan.state.manifestSha256,
      planDigest: plan.digest,
      writes: [...writes, stateWrite],
    };
    const receiptPath = receiptPathFor(plan.target, id);
    await writeAtomically(receiptPath, Buffer.from(`${stableStringify(receipt)}\n`), plan.target, 'Adopt receipt', createdDirectories);
    await writeAtomically(statePath, nextState, plan.target, 'Installed state', createdDirectories);
    stateWritten = true;
    return { plan, receiptId: id, receiptPath: path.relative(plan.target, receiptPath).split(path.sep).join('/'), applied: true };
  } catch (error) {
    try {
      const prepared = await prepareRollback(plan.target, [...writes, ...(stateWritten && stateWrite ? [stateWrite] : [])]);
      await applyPreparedRollback(plan.target, prepared);
      await removeRegularFile(receiptPathFor(plan.target, id), plan.target, 'Failed adopt receipt');
      await removeTransactionBackups(plan.target, [...writes, ...(stateWrite ? [stateWrite] : [])]);
      await removeEmptyDirectories(createdDirectories);
    } catch (rollbackError) {
      if (rollbackError instanceof InstallPlanError) throw rollbackError;
      throw new InstallPlanError('ROLLBACK_FAILED', `Adopt failed and rollback could not complete: ${rollbackError.message}`);
    }
    throw error;
  }
}

// The same skill ships to .claude/skills and .agents/skills. Two copies that differ
// mean the two clients load different instructions. Reported, never fixed here.
async function skillCopyDivergences(target, entries) {
  const divergences = [];
  for (const entry of entries) {
    if (!entry.destination.startsWith('.claude/skills/')) continue;
    const twin = `.agents/skills/${entry.destination.slice('.claude/skills/'.length)}`;
    if (!entries.some((other) => other.destination === twin)) continue;
    try {
      const left = await readRegularFile(planEntryPath(target, entry.destination), `Skill copy ${entry.destination}`);
      const right = await readRegularFile(planEntryPath(target, twin), `Skill copy ${twin}`);
      if (left !== null && right !== null && !left.equals(right)) divergences.push({ claude: entry.destination, agents: twin });
    } catch (error) {
      if (!(error instanceof InstallPlanError)) throw error;
    }
  }
  return divergences;
}

async function assertReceiptRollbackContract(target, receipt, receiptIdValue) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schemaVersion !== 1 || receipt.receiptId !== receiptIdValue || !TRANSACTION_ID_PATTERN.test(receiptIdValue)
    || !Array.isArray(receipt.writes) || receipt.writes.length === 0) {
    fail('INVALID_RECEIPT', 'Transaction receipt has an unsupported shape.');
  }
  for (const write of receipt.writes) assertReceiptWrite(write, receiptIdValue);
  assertUniqueDestinations(receipt.writes);

  if (receipt.operation === 'approved-change') {
    if (!hasExactKeys(receipt, ['schemaVersion', 'receiptId', 'operation', 'targetIdentitySha256', 'owner', 'allowedOwners', 'planDigest', 'evidenceDigest', 'writes'])
      || !SHA256_PATTERN.test(receipt.targetIdentitySha256 ?? '') || !SHA256_PATTERN.test(receipt.planDigest ?? '') || !SHA256_PATTERN.test(receipt.evidenceDigest ?? '')) {
      fail('INVALID_RECEIPT', 'Approved-change receipt has an unsupported shape.');
    }
    validateRelativePath(receipt.owner, 'Approved-change receipt owner');
    if (!Array.isArray(receipt.allowedOwners) || receipt.allowedOwners.length === 0) {
      fail('INVALID_RECEIPT', 'Approved-change receipt must declare allowed owners.');
    }
    for (const owner of receipt.allowedOwners) validateRelativePath(owner, 'Approved-change receipt allowed owner');
    if (new Set(receipt.allowedOwners).size !== receipt.allowedOwners.length || receipt.allowedOwners.filter((owner) => owner === receipt.owner).length !== 1) {
      fail('INVALID_RECEIPT', 'Approved-change receipt owner must be uniquely allowlisted.');
    }
    if (receipt.targetIdentitySha256 !== sha256(Buffer.from(target)) || receipt.writes.length !== 1
      || receipt.writes[0].destination !== receipt.owner || receipt.writes[0].preimageSha256 === null) {
      fail('INVALID_RECEIPT', 'Approved-change receipt does not own exactly its declared write.');
    }
    if (receipt.planDigest !== approvedChangeDigest({
      target,
      owner: receipt.owner,
      allowedOwners: receipt.allowedOwners,
      preimageSha256: receipt.writes[0].preimageSha256,
      postimageSha256: receipt.writes[0].postimageSha256,
      evidenceDigest: receipt.evidenceDigest,
    })) {
      fail('INVALID_RECEIPT', 'Approved-change receipt does not match its canonical plan digest.');
    }
    return;
  }

  if (!['init', 'upgrade', 'adopt'].includes(receipt.operation)
    || !hasExactKeys(receipt, ['schemaVersion', 'receiptId', 'operation', 'edition', 'templateVersion', 'publicDependency', 'manifestSha256', 'planDigest', 'writes'])
    || !['free', 'paid'].includes(receipt.edition)
    || !TEMPLATE_VERSION_PATTERN.test(receipt.templateVersion ?? '')
    || !SHA256_PATTERN.test(receipt.manifestSha256 ?? '')
    || !SHA256_PATTERN.test(receipt.planDigest ?? '')
    || (receipt.edition === 'free' && receipt.publicDependency !== null)
    || (receipt.edition === 'paid' && (typeof receipt.publicDependency !== 'string' || receipt.publicDependency.length === 0))) {
    fail('INVALID_RECEIPT', 'Install receipt has an unsupported shape.');
  }

  const { state, stateHash } = await readInstalledState(target);
  if (stateHash === null || state.transactionId !== receiptIdValue
    || state.operation !== receipt.operation
    || state.edition !== receipt.edition
    || state.templateVersion !== receipt.templateVersion
    || state.publicDependency !== receipt.publicDependency
    || state.manifestSha256 !== receipt.manifestSha256
    || state.planDigest !== receipt.planDigest) {
    fail('INVALID_RECEIPT', 'Install receipt does not match the currently installed state.');
  }
  const stateWrites = receipt.writes.filter((write) => write.destination === STATE_RELATIVE_PATH);
  if (stateWrites.length !== 1 || stateWrites[0].postimageSha256 !== stateHash) {
    fail('INVALID_RECEIPT', 'Install receipt does not own the current installed state write.');
  }
  const transactionWrites = receipt.writes.filter((write) => write.destination !== STATE_RELATIVE_PATH);
  const bindingPostimage = stateBindingHash(state);
  if (state.writeSetDigest !== receiptWriteSetDigest(receipt.writes, bindingPostimage)) {
    fail('INVALID_RECEIPT', 'Install receipt does not match the installed transaction write set.');
  }
  for (const write of transactionWrites) {
    if (write.destination.startsWith(`${MERGE_RELATIVE_DIRECTORY}/`)) {
      // A merge proposal is created by the upgrade that offered it, for a seed migration of this release, and never overwrites.
      const prefix = `${MERGE_RELATIVE_DIRECTORY}/${state.templateVersion}/`;
      const managed = write.destination.startsWith(prefix) && write.destination.endsWith('.proposed')
        ? write.destination.slice(prefix.length, -'.proposed'.length)
        : null;
      if (managed === null || managed.length === 0 || write.preimageSha256 !== null || write.backupPath !== null
        || state.managedPaths[managed]?.mergeKind !== 'seed-file') {
        fail('INVALID_RECEIPT', `Install receipt write is not a merge proposal of this release: ${write.destination}`);
      }
      validateRelativePath(managed, 'Receipt merge proposal destination');
      continue;
    }
    // A base snapshot is owned by the recorded template hash of its managed path.
    const baseOf = write.destination.startsWith(`${BASE_RELATIVE_DIRECTORY}/`) ? write.destination.slice(BASE_RELATIVE_DIRECTORY.length + 1) : null;
    const owned = baseOf === null
      ? state.managedPaths[write.destination]?.installedSha256
      : state.managedPaths[baseOf]?.templateSha256;
    if (owned !== write.postimageSha256) {
      fail('INVALID_RECEIPT', `Install receipt write is not owned by installed state: ${write.destination}`);
    }
  }
}

export async function rollbackReceipt({ targetPath, receiptId: receiptIdValue, injectFailureAfterRollbackWrite = null, onRollbackStep = null }) {
  const target = await resolveTarget(targetPath, INSTALLER_ROOT);
  await assertTransactionNamespace(target);
  const receiptPath = receiptPathFor(target, receiptIdValue);
  await assertNoSymlinkAncestors(receiptPath, 'Receipt path', target);
  // An interrupted connect leaves a write-ahead pending record in the workspace; its id is
  // recovered by lib/connect.mjs (idempotent, removes only bytes it wrote).
  if (await lstatOrNull(path.join(target, '.second-brain', 'connect-pending', `${receiptIdValue}.json`))) {
    const { recoverPendingConnect } = await import('./connect.mjs');
    return recoverPendingConnect({ targetPath: target, pendingId: receiptIdValue, injectFailureAfterRollbackWrite, onRollbackStep });
  }
  const receiptBytes = await readRegularFile(receiptPath, 'Transaction receipt');
  if (receiptBytes === null) {
    if (await lstatOrNull(path.join(target, '.second-brain', 'connect-pending'))) {
      // A recovery killed late can leave an empty pending folder behind; tidy it and say so plainly.
      const { tidyPendingDirectory } = await import('./connect.mjs');
      const tidy = await tidyPendingDirectory({ target, pendingId: receiptIdValue });
      if (tidy) return tidy;
    }
    fail('MISSING_RECEIPT', `Receipt does not exist: ${receiptIdValue}`);
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    fail('INVALID_RECEIPT', 'Transaction receipt is not valid JSON.');
  }
  if (receipt && typeof receipt === 'object' && receipt.operation === 'connect') {
    // Two-root receipts are validated and undone by lib/connect.mjs. Loaded lazily so
    // the shared helpers below stay the only import edge between the two modules.
    const { rollbackConnectReceipt } = await import('./connect.mjs');
    return rollbackConnectReceipt({ target, receipt, receiptId: receiptIdValue, injectFailureAfterRollbackWrite, onRollbackStep });
  }
  if (receipt && ['init', 'upgrade'].includes(receipt.operation)
    && ((await lstatOrNull(path.join(target, '.second-brain', 'connections.json'))) || (await lstatOrNull(path.join(target, '.second-brain', 'connect-pending'))))) {
    // Pure additional refusal: only fires when connect has left records in this workspace.
    const { assertNoConnections } = await import('./connect.mjs');
    await assertNoConnections(target);
  }
  await assertReceiptRollbackContract(target, receipt, receiptIdValue);
  const prepared = await prepareRollback(target, receipt.writes);
  await applyPreparedRollback(target, prepared);
  await removeRegularFile(receiptPath, target, 'Transaction receipt');
  await removeTransactionBackups(target, receipt.writes);
  await removeEmptyDirectories(receiptBackupDirectories(target, receiptIdValue, receipt.writes));
  await removeEmptyDirectories(createdDirectoriesUnder(target, receipt.writes, BASE_RELATIVE_DIRECTORY));
  await removeEmptyDirectories(createdDirectoriesUnder(target, receipt.writes, MERGE_RELATIVE_DIRECTORY));
  return { receiptId: receiptIdValue, rolledBackPaths: receipt.writes.map((write) => write.destination) };
}

function containsSecretBearingContent(bytes) {
  return sensitiveContentRules(bytes).length > 0;
}

function approvedChangeDigest({ target, owner, allowedOwners, preimageSha256, postimageSha256, evidenceDigest }) {
  return sha256(Buffer.from(stableStringify({ target, owner, allowedOwners, preimageSha256, postimageSha256, evidenceDigest })));
}

export async function planApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest }) {
  const target = await resolveTarget(targetPath, INSTALLER_ROOT);
  await assertTransactionNamespace(target);
  validateRelativePath(owner, 'Owner path');
  if (!Array.isArray(allowedOwners)) fail('INVALID_OWNER', 'Allowed owners must be an array.');
  for (const allowedOwner of allowedOwners) validateRelativePath(allowedOwner, 'Allowed owner path');
  if (new Set(allowedOwners).size !== allowedOwners.length) fail('AMBIGUOUS_OWNER', 'Allowed owners must be unique.');
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
  await assertNoSymlinkAncestors(ownerPath, `Approved change owner ${owner}`, target);
  const current = await readRegularFile(ownerPath, `Approved change owner ${owner}`);
  if (current === null || sha256(current) !== preimageSha256) fail('STALE_PREIMAGE', `Owner preimage no longer matches: ${owner}`);
  return {
    target,
    owner,
    allowedOwners: [...allowedOwners],
    ownerPath,
    preimageSha256,
    postimage: bytes,
    postimageSha256,
    evidenceDigest,
    digest: approvedChangeDigest({ target, owner, allowedOwners, preimageSha256, postimageSha256, evidenceDigest }),
  };
}

export async function applyApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest, approvedDigest }) {
  const plan = await planApprovedChange({ targetPath, owner, allowedOwners, preimageSha256, postimage, postimageSha256, evidenceDigest });
  if (approvedDigest !== plan.digest) fail('PLAN_DIGEST_MISMATCH', 'The supplied approval does not match the approved owner change digest.');
  const id = receiptId();
  const createdDirectories = new Set();
  await assertNoSymlinkAncestors(plan.ownerPath, `Approved change owner ${plan.owner}`, plan.target);
  const current = await readRegularFile(plan.ownerPath, `Approved change owner ${plan.owner}`);
  if (current === null || sha256(current) !== plan.preimageSha256) fail('STALE_PREIMAGE', `Owner preimage changed before apply: ${plan.owner}`);
  let transactionWrite = null;
  let ownerWritten = false;
  const receiptPath = receiptPathFor(plan.target, id);
  try {
    const backupPath = await backupPreimage({ target: plan.target, receiptId: id, destination: plan.owner, bytes: current, createdDirectories });
    transactionWrite = { destination: plan.owner, preimageSha256: plan.preimageSha256, postimageSha256: plan.postimageSha256, backupPath };
    await writeAtomically(plan.ownerPath, plan.postimage, plan.target, `Approved change owner ${plan.owner}`, createdDirectories);
    ownerWritten = true;
    const receipt = {
      schemaVersion: 1,
      receiptId: id,
      operation: 'approved-change',
      targetIdentitySha256: sha256(Buffer.from(plan.target)),
      owner: plan.owner,
      allowedOwners: plan.allowedOwners,
      planDigest: plan.digest,
      evidenceDigest: plan.evidenceDigest,
      writes: [transactionWrite],
    };
    await writeAtomically(receiptPath, Buffer.from(`${stableStringify(receipt)}\n`), plan.target, 'Approved change receipt', createdDirectories);
    return { receiptId: id, receiptPath: path.relative(plan.target, receiptPath).split(path.sep).join('/'), planDigest: plan.digest };
  } catch (error) {
    try {
      if (ownerWritten && transactionWrite) {
        const prepared = await prepareRollback(plan.target, [transactionWrite]);
        await applyPreparedRollback(plan.target, prepared);
      }
      await removeRegularFile(receiptPath, plan.target, 'Failed approved-change receipt');
      if (transactionWrite) await removeTransactionBackups(plan.target, [transactionWrite]);
      await removeEmptyDirectories(createdDirectories);
    } catch (rollbackError) {
      if (rollbackError instanceof InstallPlanError) throw rollbackError;
      throw new InstallPlanError('ROLLBACK_FAILED', `Approved change failed and rollback could not complete: ${rollbackError.message}`);
    }
    throw error;
  }
}

/**
 * Shared transaction helpers for lib/connect.mjs. The functions are the ones the
 * single-root operations above use; connect reuses them per root instead of forking
 * a second, weaker write path.
 */
export const connectSupport = Object.freeze({
  INSTALLER_ROOT,
  RECEIPTS_RELATIVE_DIRECTORY,
  SHA256_PATTERN,
  TRANSACTION_ID_PATTERN,
  fail,
  isWithin,
  validateRelativePath,
  lstatOrNull,
  assertNoSymlinkAncestors,
  readRegularFile,
  resolveTarget,
  readInstalledState,
  assertTransactionNamespace,
  hasExactKeys,
  assertReceiptWrite,
  assertUniqueDestinations,
  writeAtomically,
  ensureSafeDirectory,
  removeRegularFile,
  receiptId,
  receiptPathFor,
  backupPreimage,
  prepareRollback,
  applyPreparedRollback,
});
