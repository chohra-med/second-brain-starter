import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { link, mkdir, readdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { InstallPlanError, connectSupport, sha256, stableStringify, validateManifest } from './installer.mjs';

// Two-root `connect` transaction: stages the pinned Spec Harness file set into a named
// repository and registers it in the hub, under ONE digest-approved plan, with
// per-write receipts and rollback. Zero production dependencies. No subprocess, no
// network, no git command: the remote is read from `.git/config` as a regular file.
// The hub's installed-state.json is never read-modified-written (see D14).

const S = connectSupport;
const { fail, isWithin, lstatOrNull, validateRelativePath, hasExactKeys } = S;

export const CONNECTIONS_RELATIVE_PATH = '.second-brain/connections.json';
const HARNESS_ROOT = 'vendor/spec-harness';
const HARNESS_MANIFEST_RELATIVE = `${HARNESS_ROOT}/install-manifest.json`;
const HARNESS_PIN_RELATIVE = 'vendor/SPEC-HARNESS-PIN.json';
const PROJECT_TEMPLATE_FILES = ['README.md', 'FACTS.md', 'roadmap.md', 'Decisions.md', 'progress.md'];
const PROJECT_TEMPLATE_SOURCE_DIRECTORY = 'template/03-Resources/_templates/project';
const HUB_PROJECTS_DIRECTORY = '01-Projects';
const RECORD_FILE = 'Connection.md';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SUPPORTED_RENDERS = ['copy', 'template'];
const DETECTION_STATUSES = ['NONE', 'LEGACY', 'INITIALISED'];
const MAX_NAME_LENGTH = 100;
const MAX_GIT_CONFIG_BYTES = 262144;
const HARNESS_RECEIPT = '.claude/agents/.init-synthesis.json';
const HARNESS_MARKER = 'SPEC-HARNESS.md';
const HARNESS_AGENTS_DIRECTORY = '.claude/agents';
const RULE_FILE_PROBES = [
  { name: 'AGENTS.md', directory: false },
  { name: 'CLAUDE.md', directory: false },
  { name: 'CONTRIBUTING.md', directory: false },
  { name: 'RULES.md', directory: false },
  { name: 'ai_rules', directory: true },
  { name: '.memory', directory: true },
];
const LINK_FALLBACK_CODES = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'];

const PLAN_PAYLOADS = new WeakMap();

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function absoluteFor(rootReal, destination) {
  validateRelativePath(destination, 'Plan destination');
  const filePath = path.resolve(rootReal, ...destination.split('/'));
  if (!isWithin(rootReal, filePath)) fail('TARGET_ESCAPE', `Plan destination escapes its root: ${destination}`);
  return filePath;
}

// ---------------------------------------------------------------------------
// Harness manifest (read from the vendored pin, never from bin/*.sh)
// ---------------------------------------------------------------------------

async function readSourceFile(sourceRootReal, relative, label) {
  const filePath = path.resolve(sourceRootReal, ...relative.split('/'));
  if (!isWithin(sourceRootReal, filePath)) fail('SOURCE_ESCAPE', `${label} escapes the checkout: ${relative}`);
  await S.assertNoSymlinkAncestors(filePath, label, sourceRootReal);
  return S.readRegularFile(filePath, label);
}

function parseJson(bytes, code, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail(code, `${label} is not valid JSON.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readHarnessManifest({ sourceRoot }) {
  const sourceRootReal = await realpath(sourceRoot);
  await S.assertNoSymlinkAncestors(sourceRootReal, 'Source root');
  const manifestBytes = await readSourceFile(sourceRootReal, HARNESS_MANIFEST_RELATIVE, 'Harness manifest');
  if (manifestBytes === null) fail('HARNESS_MANIFEST_MISSING', `Harness manifest is missing: ${HARNESS_MANIFEST_RELATIVE}`);
  const manifest = parseJson(manifestBytes, 'INVALID_HARNESS_MANIFEST', 'Harness manifest');
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1) {
    fail('INVALID_HARNESS_MANIFEST', 'Harness manifest schemaVersion must be 1.');
  }
  if (typeof manifest.harnessVersion !== 'string' || manifest.harnessVersion.length === 0) {
    fail('INVALID_HARNESS_MANIFEST', 'Harness manifest harnessVersion must be a non-empty string.');
  }
  const { substitutions } = manifest;
  if (!isPlainObject(substitutions) || !isPlainObject(substitutions.tokens) || !isPlainObject(substitutions.projectName)
    || substitutions.projectName.mustBeNonEmpty !== true || !Array.isArray(substitutions.projectName.forbiddenCharacters)
    || typeof substitutions.placeholder !== 'string' || substitutions.placeholder.length === 0) {
    fail('INVALID_HARNESS_MANIFEST', 'Harness manifest substitutions are missing or malformed.');
  }
  for (const [token, value] of Object.entries(substitutions.tokens)) {
    if (token.length === 0 || typeof value !== 'string') fail('INVALID_HARNESS_MANIFEST', 'Harness manifest token values must be strings.');
  }
  for (const forbidden of substitutions.projectName.forbiddenCharacters) {
    if (!['LF', 'CR', 'TAB'].includes(forbidden) && !(typeof forbidden === 'string' && [...forbidden].length === 1)) {
      fail('INVALID_HARNESS_MANIFEST', 'Harness manifest names a forbidden project-name character the engine does not understand.');
    }
  }
  if (typeof manifest.loaderBlock !== 'string') fail('INVALID_HARNESS_MANIFEST', 'Harness manifest loaderBlock must be a string.');
  if (!Array.isArray(manifest.directories)) fail('INVALID_HARNESS_MANIFEST', 'Harness manifest directories must be an array.');
  const directories = [];
  for (const directory of manifest.directories) {
    validateRelativePath(directory, 'Harness manifest directory');
    if (directories.includes(directory)) fail('INVALID_HARNESS_MANIFEST', `Harness manifest repeats a directory: ${directory}`);
    directories.push(directory);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) fail('INVALID_HARNESS_MANIFEST', 'Harness manifest entries must be a non-empty array.');

  const pinBytes = await readSourceFile(sourceRootReal, HARNESS_PIN_RELATIVE, 'Harness pin');
  if (pinBytes === null) fail('INVALID_HARNESS_PIN', `Harness pin record is missing: ${HARNESS_PIN_RELATIVE}`);
  const pin = parseJson(pinBytes, 'INVALID_HARNESS_PIN', 'Harness pin');
  if (!isPlainObject(pin) || pin.schemaVersion !== 1 || !COMMIT_PATTERN.test(pin.commit ?? '') || !COMMIT_PATTERN.test(pin.tree ?? '')
    || pin.harnessVersion !== manifest.harnessVersion) {
    fail('INVALID_HARNESS_PIN', 'Harness pin must carry schemaVersion 1, a full commit, a full tree and the manifest harnessVersion.');
  }

  const destinations = new Set();
  const entries = [];
  for (const [index, raw] of manifest.entries.entries()) {
    const label = `Harness manifest entry ${index}`;
    if (!isPlainObject(raw) || !hasExactKeys(raw, ['destination', 'source', 'render', 'tokens', 'sha256', 'mode'])) {
      fail('INVALID_HARNESS_MANIFEST', `${label} has unsupported keys.`);
    }
    validateRelativePath(raw.destination, `${label} destination`);
    validateRelativePath(raw.source, `${label} source`);
    if (!SUPPORTED_RENDERS.includes(raw.render)) fail('UNKNOWN_RENDER', `${label} uses an unknown render: ${String(raw.render)}`);
    if (!Array.isArray(raw.tokens)) fail('INVALID_HARNESS_MANIFEST', `${label} tokens must be an array.`);
    if (raw.tokens.length > 1) {
      fail('UNSUPPORTED_MULTI_TOKEN', `${label} lists more than one token; the manifest does not define how they combine.`);
    }
    if (raw.render === 'copy' && raw.tokens.length !== 0) fail('INVALID_HARNESS_MANIFEST', `${label} is a copy entry with tokens.`);
    for (const token of raw.tokens) {
      if (!Object.hasOwn(substitutions.tokens, token)) fail('INVALID_HARNESS_MANIFEST', `${label} names a token the manifest does not define.`);
    }
    if (!S.SHA256_PATTERN.test(raw.sha256 ?? '')) fail('INVALID_HARNESS_MANIFEST', `${label} sha256 must be lowercase SHA-256.`);
    if (typeof raw.mode !== 'string' || !/^0[0-7]{3}$/.test(raw.mode)) fail('INVALID_HARNESS_MANIFEST', `${label} mode must be an octal string.`);
    if (destinations.has(raw.destination)) fail('INVALID_HARNESS_MANIFEST', `Harness manifest repeats a destination: ${raw.destination}`);
    destinations.add(raw.destination);
    const sourceBytes = await readSourceFile(sourceRootReal, `${HARNESS_ROOT}/${raw.source}`, `Harness source ${raw.source}`);
    if (sourceBytes === null) fail('HARNESS_SOURCE_MISSING', `Harness source is missing: ${raw.source}`);
    if (sha256(sourceBytes) !== raw.sha256) fail('HARNESS_SOURCE_HASH_MISMATCH', `Harness source hash mismatch: ${raw.source}`);
    entries.push({ destination: raw.destination, source: raw.source, render: raw.render, tokens: [...raw.tokens], sha256: raw.sha256, mode: raw.mode, sourceBytes });
  }
  for (const destination of destinations) {
    const segments = destination.split('/');
    for (let length = 1; length < segments.length; length += 1) {
      if (destinations.has(segments.slice(0, length).join('/'))) fail('INVALID_HARNESS_MANIFEST', `Harness destination sits beneath another file: ${destination}`);
    }
    if (directories.includes(destination)) fail('INVALID_HARNESS_MANIFEST', `Harness destination is also a directory: ${destination}`);
  }
  return {
    sourceRoot: sourceRootReal,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    harnessVersion: manifest.harnessVersion,
    pin: { commit: pin.commit, tree: pin.tree },
    substitutions,
    directories,
    loaderBlock: manifest.loaderBlock,
    entries,
  };
}

function forbiddenNameCharacters(harness) {
  const named = { LF: '\n', CR: '\r', TAB: '\t' };
  return harness.substitutions.projectName.forbiddenCharacters.map((value) => named[value] ?? value);
}

export function validateConnectionName(name, harness) {
  const bad = (message) => fail('INVALID_CONNECTION_NAME', message);
  if (typeof name !== 'string' || name.length === 0) bad('Connection name must be a non-empty string.');
  if ([...name].length > MAX_NAME_LENGTH) bad(`Connection name must be at most ${MAX_NAME_LENGTH} characters.`);
  for (const character of forbiddenNameCharacters(harness)) {
    if (name.includes(character)) bad('Connection name contains a character the harness forbids (line break, tab, slash or backslash).');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name) || /[<>:"|?*]/.test(name)) bad('Connection name contains a character that is not portable in a folder name.');
  if (name !== name.trim() || name.endsWith('.')) bad('Connection name must not start or end with whitespace, and must not end with a dot.');
  try {
    validateRelativePath(name, 'Connection name');
  } catch {
    bad('Connection name must be one portable path segment.');
  }
  if (['selected-project', 'readme.md', '.second-brain'].includes(name.toLowerCase())) {
    bad(`Connection name is reserved by the workspace: ${name}`);
  }
  return name;
}

/**
 * Renders one manifest entry. `copy` is the source bytes. `template` replaces only the
 * entry's own tokens, literally, in one pass over the source (a substituted value is
 * never rescanned), and ends with exactly one LF when the source's last line lacked one.
 */
export function renderHarnessEntry(entry, name, harness) {
  if (entry.render === 'copy') return Buffer.from(entry.sourceBytes);
  if (entry.render !== 'template') fail('UNKNOWN_RENDER', `Unknown render: ${String(entry.render)}`);
  const text = entry.sourceBytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(entry.sourceBytes)) fail('INVALID_HARNESS_MANIFEST', `Template source is not valid UTF-8: ${entry.source}`);
  if (text.length === 0) return Buffer.alloc(0);
  const { placeholder, tokens } = harness.substitutions;
  let rendered = text;
  for (const token of entry.tokens) {
    const value = tokens[token].split(placeholder).join(name);
    rendered = rendered.split(token).join(value);
  }
  if (!rendered.endsWith('\n')) rendered += '\n';
  return Buffer.from(rendered, 'utf8');
}

// ---------------------------------------------------------------------------
// Filesystem probes (lstat only; a symlink at any probed path fails closed)
// ---------------------------------------------------------------------------

async function walkTo(rootReal, destination, label) {
  const segments = destination.split('/');
  let cursor = rootReal;
  for (let index = 0; index < segments.length - 1; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const stat = await lstatOrNull(cursor);
    if (!stat) return { full: path.join(rootReal, ...segments), stat: null };
    if (stat.isSymbolicLink()) fail('SYMLINK_PATH', `${label} contains a symlink: ${segments.slice(0, index + 1).join('/')}`);
    if (!stat.isDirectory()) fail('NON_DIRECTORY', `${label} ancestor is not a directory: ${segments.slice(0, index + 1).join('/')}`);
  }
  const full = path.join(cursor, segments.at(-1));
  const stat = await lstatOrNull(full);
  if (stat?.isSymbolicLink()) fail('SYMLINK_PATH', `${label} is a symlink: ${destination}`);
  return { full, stat };
}

async function probeFile(rootReal, destination, label) {
  const { stat } = await walkTo(rootReal, destination, label);
  if (!stat) return false;
  if (!stat.isFile()) fail('NON_REGULAR_FILE', `${label} is not a regular file: ${destination}`);
  return true;
}

async function inspectFile(rootReal, destination, label) {
  const { full, stat } = await walkTo(rootReal, destination, label);
  if (!stat) return { kind: 'absent' };
  if (!stat.isFile()) fail('NON_REGULAR_FILE', `${label} is not a regular file: ${destination}`);
  const bytes = await readFile(full);
  return { kind: 'file', sha256: sha256(bytes) };
}

async function inspectDirectory(rootReal, destination, label) {
  const { stat } = await walkTo(rootReal, destination, label);
  if (!stat) return 'absent';
  if (!stat.isDirectory()) fail('NON_DIRECTORY', `${label} is not a directory: ${destination}`);
  return 'exists';
}

export async function detectHarness({ repoReal }) {
  const label = 'Repository probe';
  const evidence = [];
  const initialised = await probeFile(repoReal, HARNESS_RECEIPT, label);
  if (initialised) evidence.push(HARNESS_RECEIPT);
  if (await probeFile(repoReal, HARNESS_MARKER, label)) evidence.push(HARNESS_MARKER);
  const agents = await walkTo(repoReal, HARNESS_AGENTS_DIRECTORY, label);
  if (agents.stat) {
    if (!agents.stat.isDirectory()) fail('NON_DIRECTORY', `${label} is not a directory: ${HARNESS_AGENTS_DIRECTORY}`);
    for (const name of (await readdir(agents.full)).sort()) {
      if (!/^sdd-.*\.md$/.test(name)) continue;
      const relative = `${HARNESS_AGENTS_DIRECTORY}/${name}`;
      await probeFile(repoReal, relative, label);
      evidence.push(relative);
    }
  }
  evidence.sort();
  const status = initialised ? 'INITIALISED' : evidence.length > 0 ? 'LEGACY' : 'NONE';
  return { status, evidence };
}

async function findRuleFiles(repoReal) {
  const found = [];
  for (const { name, directory } of RULE_FILE_PROBES) {
    const { stat } = await walkTo(repoReal, name, 'Repository probe');
    if (!stat) continue;
    if (directory && !stat.isDirectory()) fail('NON_DIRECTORY', `Repository probe is not a directory: ${name}`);
    if (!directory && !stat.isFile()) fail('NON_REGULAR_FILE', `Repository probe is not a regular file: ${name}`);
    found.push(directory ? `${name}/` : name);
  }
  return found.sort();
}

function sanitizeRemote(value) {
  let url = value.trim();
  // Never keep credentials embedded in a remote URL.
  url = url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]*@/, '$1');
  const schemeForm = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[A-Za-z0-9._~%+:@/\-#=?&]+$/;
  const scpForm = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~%+/\-#=]+$/;
  if (/^file:/i.test(url) || !(schemeForm.test(url) || scpForm.test(url))) return 'unknown';
  return url;
}

export async function readRemote({ repoReal }) {
  const gitDirectory = await walkTo(repoReal, '.git', 'Repository .git');
  if (!gitDirectory.stat || !gitDirectory.stat.isDirectory()) return 'unknown';
  const config = await walkTo(repoReal, '.git/config', 'Repository .git/config');
  if (!config.stat) return 'unknown';
  if (!config.stat.isFile()) fail('NON_REGULAR_FILE', 'Repository .git/config is not a regular file.');
  if (config.stat.size > MAX_GIT_CONFIG_BYTES) return 'unknown';
  const lines = (await readFile(config.full)).toString('utf8').split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]*)\]\s*$/);
    if (header) {
      inOrigin = /^remote\s+"origin"$/i.test(header[1].trim());
      continue;
    }
    const entry = inOrigin ? line.match(/^\s*url\s*=\s*(.+?)\s*$/i) : null;
    if (entry) return sanitizeRemote(entry[1]);
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Repository resolution (D10)
// ---------------------------------------------------------------------------

export async function resolveRepo({ repoPath, hubReal, sourceRoot }) {
  if (typeof repoPath !== 'string') fail('TARGET_NOT_ABSOLUTE', 'Repository path must be an absolute string.');
  if (repoPath.split(/[\\/]+/).includes('..')) fail('TARGET_TRAVERSAL', 'Repository path must not contain literal traversal segments.');
  if (!path.isAbsolute(repoPath)) fail('TARGET_NOT_ABSOLUTE', 'Repository path must be absolute.');
  const repo = path.resolve(repoPath);
  if (repo === path.parse(repo).root) fail('UNSAFE_TARGET', 'Repository cannot be the filesystem root.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(repo)) fail('UNSAFE_REPO', 'Repository path must not contain control characters.');
  const home = await realpath(homedir());
  await S.assertNoSymlinkAncestors(repo, 'Repository');
  const stat = await lstatOrNull(repo);
  if (!stat || !stat.isDirectory()) fail('REPO_NOT_DIRECTORY', 'Repository path must be an existing directory.');
  const repoReal = await realpath(repo);
  if (samePath(repoReal, home) || samePath(repo, homedir())) fail('UNSAFE_TARGET', 'Repository cannot be the home directory.');
  if (isWithin(sourceRoot, repoReal) || isWithin(sourceRoot, repo)) {
    fail('UNSAFE_TARGET', 'Repository cannot be the installer checkout or a path inside it.');
  }
  if (samePath(repoReal, hubReal)) fail('UNSAFE_REPO', 'Repository is the workspace itself.');
  if (isWithin(hubReal, repoReal)) fail('UNSAFE_REPO', 'Repository is inside the workspace.');
  if (isWithin(repoReal, hubReal)) fail('UNSAFE_REPO', 'Repository contains the workspace.');
  return repoReal;
}

// ---------------------------------------------------------------------------
// connections.json (new versioned state file beside installed-state.json)
// ---------------------------------------------------------------------------

const CONNECTION_KEYS = ['connectionId', 'name', 'hub', 'repo', 'detection', 'stage', 'remote', 'ruleFiles', 'harness', 'planDigest'];

function normalizeConnections(value) {
  const invalid = (message) => fail('INVALID_CONNECTIONS_STATE', message);
  if (!isPlainObject(value) || !hasExactKeys(value, ['schemaVersion', 'connections']) || value.schemaVersion !== 1) {
    invalid('Connections state must be an object with schemaVersion 1 and a connections map.');
  }
  if (!isPlainObject(value.connections)) invalid('Connections state connections must be an object.');
  for (const [id, record] of Object.entries(value.connections)) {
    if (!S.TRANSACTION_ID_PATTERN.test(id)) invalid('Connection ids must be transaction receipt ids.');
    if (!isPlainObject(record) || !hasExactKeys(record, CONNECTION_KEYS) || record.connectionId !== id) invalid(`Connection record is malformed: ${id}`);
    if (typeof record.name !== 'string' || record.name.length === 0 || typeof record.hub !== 'string' || !path.isAbsolute(record.hub)
      || typeof record.repo !== 'string' || !path.isAbsolute(record.repo) || typeof record.remote !== 'string'
      || !DETECTION_STATUSES.includes(record.detection) || !['STAGED', 'REGISTER-ONLY'].includes(record.stage)
      || !Array.isArray(record.ruleFiles) || record.ruleFiles.some((item) => typeof item !== 'string')
      || !S.SHA256_PATTERN.test(record.planDigest ?? '')
      || !isPlainObject(record.harness) || !hasExactKeys(record.harness, ['commit', 'manifestSha256', 'harnessVersion'])
      || !COMMIT_PATTERN.test(record.harness.commit ?? '') || !S.SHA256_PATTERN.test(record.harness.manifestSha256 ?? '')
      || typeof record.harness.harnessVersion !== 'string') {
      invalid(`Connection record is malformed: ${id}`);
    }
  }
  return value;
}

async function readConnectionsFile(hub) {
  const filePath = path.join(hub, ...CONNECTIONS_RELATIVE_PATH.split('/'));
  await S.assertNoSymlinkAncestors(filePath, 'Connections state path', hub);
  const bytes = await S.readRegularFile(filePath, 'Connections state');
  if (bytes === null) return { filePath, state: { schemaVersion: 1, connections: {} }, hash: null, bytes: null };
  const parsed = parseJson(bytes, 'INVALID_CONNECTIONS_STATE', 'Connections state');
  return { filePath, state: normalizeConnections(parsed), hash: sha256(bytes), bytes };
}

/** Read-only accessor for the hub's connection records (no writes, no repo access). */
export async function readConnections({ targetPath }) {
  const hub = await S.resolveTarget(targetPath, S.INSTALLER_ROOT);
  await S.assertTransactionNamespace(hub);
  const read = await readConnectionsFile(hub);
  return {
    path: CONNECTIONS_RELATIVE_PATH,
    connectionsSha256: read.hash,
    connections: structuredClone(read.state.connections),
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function renderConnectionRecord({ name, repo, remote, ruleFiles, detection, harness }) {
  const status = {
    NONE: 'STAGED until `.claude/agents/.init-synthesis.json` exists in the repository.',
    LEGACY: 'LEGACY: registered only. Nothing was written into the repository.',
    INITIALISED: 'INITIALISED: registered only. Nothing was written into the repository.',
  }[detection.status];
  return Buffer.from([
    `# Connection: ${name}`,
    '',
    'Coordinates of a repository registered in this workspace. This file does not copy the repository, and it holds no credentials.',
    '',
    `- Repository path: ${repo}`,
    `- Remote: ${remote}`,
    `- Rule files found: ${ruleFiles.length > 0 ? ruleFiles.join(', ') : 'none'}`,
    `- Detection: ${detection.status}`,
    `- Spec Harness: version ${harness.harnessVersion}, commit ${harness.pin.commit}`,
    `- Status: ${status}`,
    '',
  ].join('\n'), 'utf8');
}

function createUndo(root, destination, hash) {
  return { action: 'remove-created-file', root, destination, preimageSha256: null, postimageSha256: hash };
}

function noUndo(root, destination, currentHash, intendedHash) {
  return { action: 'none', root, destination, preimageSha256: currentHash, postimageSha256: intendedHash };
}

function directoryClosure(directories) {
  const all = new Set();
  for (const directory of directories) {
    const segments = directory.split('/');
    for (let length = 1; length <= segments.length; length += 1) all.add(segments.slice(0, length).join('/'));
  }
  return [...all].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}

function parentDirectories(destination) {
  const segments = destination.split('/');
  return segments.length > 1 ? [segments.slice(0, -1).join('/')] : [];
}

function plannedDigest(input) {
  return sha256(Buffer.from(stableStringify(input)));
}

export async function planConnect({ manifest, manifestBytes, sourceRoot, targetPath, repoPath, name }) {
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) fail('INVALID_MANIFEST', 'Manifest bytes are required for digest binding.');
  const validated = await validateManifest({ manifest, sourceRoot });
  const hub = await S.resolveTarget(targetPath, validated.sourceRoot);
  await S.assertTransactionNamespace(hub);
  const installed = await S.readInstalledState(hub);
  if (installed.stateHash === null) fail('HUB_NOT_INITIALISED', 'The workspace has no installed state; initialise it before connecting a repository.');
  const connections = await readConnectionsFile(hub);
  const harness = await readHarnessManifest({ sourceRoot: validated.sourceRoot });
  const repo = await resolveRepo({ repoPath, hubReal: hub, sourceRoot: validated.sourceRoot });
  const connectionName = validateConnectionName(name ?? path.basename(repo), harness);

  for (const record of Object.values(connections.state.connections)) {
    if (samePath(record.repo, repo)) {
      fail('ALREADY_CONNECTED', `Repository is already connected by receipt ${record.connectionId}. Roll that receipt back first (rollback --receipt ${record.connectionId}); nothing was written.`);
    }
  }
  for (const record of Object.values(connections.state.connections)) {
    if (record.name.toLowerCase() === connectionName.toLowerCase()) {
      fail('CONNECTION_NAME_TAKEN', `The workspace already has a connection named ${connectionName} (receipt ${record.connectionId}); nothing was written.`);
    }
  }

  const detection = await detectHarness({ repoReal: repo });
  const remote = await readRemote({ repoReal: repo });
  const ruleFiles = await findRuleFiles(repo);
  const payloads = new Map();
  const entries = [];
  const preserved = [];
  const repoDirectoryCandidates = [];

  if (detection.status === 'NONE') {
    repoDirectoryCandidates.push(...harness.directories);
    for (const entry of harness.entries) {
      const rendered = renderHarnessEntry(entry, connectionName, harness);
      const intendedSha256 = sha256(rendered);
      const current = await inspectFile(repo, entry.destination, 'Repository destination');
      if (current.kind === 'absent') {
        entries.push({
          root: 'repo', destination: entry.destination, kind: 'file', status: 'CREATE', currentSha256: null, intendedSha256,
          undo: createUndo('repo', entry.destination, intendedSha256),
        });
        payloads.set(`repo:${entry.destination}`, rendered);
        repoDirectoryCandidates.push(...parentDirectories(entry.destination));
      } else {
        const differs = current.sha256 !== intendedSha256;
        entries.push({
          root: 'repo', destination: entry.destination, kind: 'file', status: 'PRESERVED', differs, currentSha256: current.sha256, intendedSha256,
          undo: noUndo('repo', entry.destination, current.sha256, intendedSha256),
        });
        preserved.push({ destination: entry.destination, differs, currentSha256: current.sha256, intendedSha256 });
      }
    }
  }

  const connectionRecord = renderConnectionRecord({ name: connectionName, repo, remote, ruleFiles, detection, harness });
  const hubFiles = PROJECT_TEMPLATE_FILES.map((file) => {
    const source = `${PROJECT_TEMPLATE_SOURCE_DIRECTORY}/${file}`;
    const template = validated.entries.find((entry) => entry.source === source);
    if (!template) fail('MISSING_PROJECT_TEMPLATE', `The template manifest does not list the project template file: ${source}`);
    return { destination: `${HUB_PROJECTS_DIRECTORY}/${connectionName}/${file}`, bytes: Buffer.from(template.bytes) };
  });
  hubFiles.push({ destination: `${HUB_PROJECTS_DIRECTORY}/${connectionName}/${RECORD_FILE}`, bytes: connectionRecord });
  const hubDirectoryCandidates = [];
  for (const file of hubFiles) {
    const intendedSha256 = sha256(file.bytes);
    const current = await inspectFile(hub, file.destination, 'Workspace destination');
    const managed = Object.hasOwn(installed.state.managedPaths, file.destination);
    if (current.kind === 'absent' && !managed) {
      entries.push({
        root: 'hub', destination: file.destination, kind: 'file', status: 'CREATE', currentSha256: null, intendedSha256,
        undo: createUndo('hub', file.destination, intendedSha256),
      });
      payloads.set(`hub:${file.destination}`, file.bytes);
      hubDirectoryCandidates.push(...parentDirectories(file.destination));
    } else {
      entries.push({
        root: 'hub', destination: file.destination, kind: 'file', status: 'CONFLICT', currentSha256: current.kind === 'file' ? current.sha256 : null, intendedSha256,
        undo: noUndo('hub', file.destination, current.kind === 'file' ? current.sha256 : null, intendedSha256),
      });
    }
  }
  entries.push({
    root: 'hub', destination: CONNECTIONS_RELATIVE_PATH, kind: 'state', status: connections.hash === null ? 'CREATE' : 'UPDATE',
    currentSha256: connections.hash, intendedSha256: null,
    undo: { action: connections.hash === null ? 'remove-created-file' : 'restore-preimage', root: 'hub', destination: CONNECTIONS_RELATIVE_PATH, preimageSha256: connections.hash, postimageSha256: null },
  });

  const directories = [];
  for (const [root, rootReal, candidates] of [['repo', repo, repoDirectoryCandidates], ['hub', hub, hubDirectoryCandidates]]) {
    for (const destination of directoryClosure(candidates)) {
      const state = await inspectDirectory(rootReal, destination, root === 'repo' ? 'Repository directory' : 'Workspace directory');
      directories.push({ root, destination, status: state === 'absent' ? 'CREATE' : 'EXISTS' });
    }
  }

  const harnessIdentity = { commit: harness.pin.commit, tree: harness.pin.tree, harnessVersion: harness.harnessVersion, manifestSha256: harness.manifestSha256 };
  const templateManifestHash = sha256(manifestBytes);
  const digest = plannedDigest({
    operation: 'connect',
    hub,
    repo,
    name: connectionName,
    detection,
    harness: harnessIdentity,
    templateManifestHash,
    stateHash: installed.stateHash,
    connectionsHash: connections.hash,
    directories,
    entries: entries.map(({ root, destination, kind, status, currentSha256, intendedSha256, undo }) => ({ root, destination, kind, status, currentSha256, intendedSha256, undo })),
  });
  const plan = {
    operation: 'connect',
    sourceRoot: validated.sourceRoot,
    hub,
    repo,
    roots: { hub, repo },
    name: connectionName,
    detection,
    stage: detection.status === 'NONE' ? 'STAGED' : 'REGISTER-ONLY',
    remote,
    ruleFiles,
    harness: harnessIdentity,
    harnessSha256: harness.manifestSha256,
    templateManifestHash,
    stateHash: installed.stateHash,
    connectionsHash: connections.hash,
    connectionsPath: CONNECTIONS_RELATIVE_PATH,
    loaderBlock: harness.loaderBlock,
    directories,
    entries,
    preserved,
    digest,
  };
  PLAN_PAYLOADS.set(plan, payloads);
  return plan;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function assertApplyableConnectPlan(plan, approvedDigest) {
  if (typeof approvedDigest !== 'string' || approvedDigest !== plan.digest) {
    fail('PLAN_DIGEST_MISMATCH', 'The supplied approval does not match the current complete plan digest.');
  }
  const conflicts = plan.entries.filter((entry) => entry.status === 'CONFLICT');
  if (conflicts.length > 0) {
    fail('PLAN_CONFLICT', `Plan contains conflicts: ${conflicts.map((entry) => `${entry.root}: ${entry.destination}`).join(', ')}`);
  }
}

async function createExclusive(filePath, bytes, rootReal, label, createdDirectories) {
  if (!isWithin(rootReal, filePath)) fail('TARGET_ESCAPE', `${label} escapes its root: ${filePath}`);
  const directory = path.dirname(filePath);
  await S.ensureSafeDirectory(directory, rootReal, `${label} directory`, createdDirectories);
  await S.assertNoSymlinkAncestors(filePath, label, rootReal);
  const temporary = path.join(directory, `.${path.basename(filePath)}.second-brain-${randomUUID()}.tmp`);
  const clash = () => fail('CONCURRENT_MODIFICATION', `Destination appeared while the transaction was applying: ${label}`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      // link() fails with EEXIST instead of replacing a file that appeared meanwhile,
      // so a create-only write cannot clobber a concurrent creation (rename would).
      await link(temporary, filePath);
    } catch (error) {
      if (error?.code === 'EEXIST') clash();
      if (!LINK_FALLBACK_CODES.includes(error?.code)) throw error;
      try {
        await writeFile(filePath, bytes, { flag: 'wx' });
      } catch (second) {
        if (second?.code === 'EEXIST') clash();
        await rm(filePath, { force: true }).catch(() => {});
        throw second;
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function createDirectory(rootReal, destination, label, created) {
  const directoryPath = absoluteFor(rootReal, destination);
  await S.assertNoSymlinkAncestors(directoryPath, label, rootReal);
  if (await lstatOrNull(directoryPath)) fail('CONCURRENT_MODIFICATION', `Directory appeared while the transaction was applying: ${destination}`);
  await mkdir(directoryPath);
  created.add(directoryPath);
}

function relativeList(rootReal, directories) {
  return [...directories].map((directory) => posix(path.relative(rootReal, directory))).sort();
}

async function removeEmptyDirectory(rootReal, destination) {
  const directoryPath = absoluteFor(rootReal, destination);
  await S.assertNoSymlinkAncestors(directoryPath, 'Created directory', rootReal);
  const stat = await lstatOrNull(directoryPath);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
  try {
    await rmdir(directoryPath);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
  }
}

function writeKey(write) {
  return `${write.root}:${write.destination}`;
}

async function prepareConnectWrite(roots, write) {
  const rootReal = roots[write.root];
  if (!rootReal) fail('INVALID_RECEIPT', `Receipt write names a root that is not part of this transaction: ${write.root}`);
  try {
    return await S.prepareRollback(rootReal, [write]);
  } catch (error) {
    if (error instanceof InstallPlanError && error.code === 'POSTIMAGE_MISMATCH') {
      fail('POSTIMAGE_MISMATCH', `Rollback refused because ${write.root}: ${write.destination} no longer has this receipt's postimage. Nothing was removed in either root.`);
    }
    throw error;
  }
}

async function prepareUndo(roots, writes) {
  const prepared = [];
  for (const write of writes) prepared.push(...(await prepareConnectWrite(roots, write)));
  return prepared;
}

/**
 * Undoes a connect transaction in both roots. `prepared` already proved that every
 * created file still carries its postimage (no partial rollback); the step counter lets
 * a test inject a failure after each rollback write.
 */
async function executeUndo({ roots, prepared, backupPaths, createdDirectories, receiptId: id, injectAfterStep }) {
  let step = 0;
  const tick = async () => {
    step += 1;
    if (injectAfterStep === step) fail('INJECTED_WRITE_FAILURE', `Injected rollback failure after step ${step}.`);
  };
  for (const item of [...prepared].reverse()) {
    await S.applyPreparedRollback(roots[item.write.root], [item]);
    await tick();
  }
  await S.removeRegularFile(S.receiptPathFor(roots.hub, id), roots.hub, 'Transaction receipt');
  await tick();
  for (const backupPath of backupPaths) {
    await S.removeRegularFile(path.resolve(roots.hub, ...backupPath.split('/')), roots.hub, 'Transaction backup');
    await tick();
  }
  for (const root of ['repo', 'hub']) {
    if (!roots[root]) continue;
    const ordered = [...createdDirectories[root]].sort((left, right) => right.split('/').length - left.split('/').length || right.localeCompare(left));
    for (const directory of ordered) {
      await removeEmptyDirectory(roots[root], directory);
      await tick();
    }
  }
}

async function enumerateLeftovers({ roots, writes, backupPaths, createdDirectories, receiptRelative }) {
  const left = { hub: new Set(), repo: new Set() };
  const exists = async (filePath) => {
    try {
      return (await lstatOrNull(filePath)) !== null;
    } catch {
      return true;
    }
  };
  for (const write of writes) {
    const rootReal = roots[write.root];
    if (!rootReal) continue;
    const filePath = absoluteFor(rootReal, write.destination);
    if (!(await exists(filePath))) {
      if (write.preimageSha256 !== null) left[write.root].add(write.destination);
      continue;
    }
    if (write.preimageSha256 === null) {
      left[write.root].add(write.destination);
      continue;
    }
    let currentHash = null;
    try {
      currentHash = sha256(await readFile(filePath));
    } catch {
      currentHash = null;
    }
    if (currentHash !== write.preimageSha256) left[write.root].add(write.destination);
  }
  for (const backupPath of backupPaths) {
    if (await exists(absoluteFor(roots.hub, backupPath))) left.hub.add(backupPath);
  }
  if (await exists(absoluteFor(roots.hub, receiptRelative))) left.hub.add(receiptRelative);
  for (const root of ['hub', 'repo']) {
    if (!roots[root]) continue;
    for (const directory of createdDirectories[root]) {
      if (await exists(absoluteFor(roots[root], directory))) left[root].add(`${directory}/`);
    }
  }
  return { hub: [...left.hub].sort(), repo: [...left.repo].sort() };
}

function rollbackFailure(cause, leftovers, prefix) {
  const list = (items) => (items.length > 0 ? items.join(', ') : 'none');
  const error = new InstallPlanError(
    'ROLLBACK_FAILED',
    `${prefix} Left behind in the hub: ${list(leftovers.hub)}. Left behind in the repo: ${list(leftovers.repo)}. `
    + `Cause: ${cause instanceof Error ? cause.message : String(cause)} `
    + 'Not resumable: re-run connect to get a fresh plan; leftover repository files will show as PRESERVED, leftover workspace files as CONFLICT. '
    + 'A leftover Spec Harness marker file (SPEC-HARNESS.md or .claude/agents/sdd-*.md) makes the next plan LEGACY: register only, no repository writes.',
  );
  error.leftovers = leftovers;
  return error;
}

export async function applyConnect({
  manifest, manifestBytes, sourceRoot, targetPath, repoPath, name, approvedDigest,
  injectFailureAfterWrite = null, injectBeforeWrite = null, injectFailureAfterRollbackWrite = null,
}) {
  const plan = await planConnect({ manifest, manifestBytes, sourceRoot, targetPath, repoPath, name });
  assertApplyableConnectPlan(plan, approvedDigest);
  const payloads = PLAN_PAYLOADS.get(plan);
  const roots = { hub: plan.hub, repo: plan.repo };
  const id = S.receiptId();
  const receiptRelative = `${S.RECEIPTS_RELATIVE_DIRECTORY}/${id}.json`;
  const writes = [];
  const backupPaths = [];
  const created = { hub: new Set(), repo: new Set() };
  let position = 0;
  const failAfter = async () => {
    position += 1;
    if (injectFailureAfterWrite === position) fail('INJECTED_WRITE_FAILURE', `Injected write failure after position ${position}.`);
  };
  const createdLists = () => ({ hub: relativeList(roots.hub, created.hub), repo: relativeList(roots.repo, created.repo) });

  try {
    const createFile = async (entry) => {
      if (injectBeforeWrite) await injectBeforeWrite({ root: entry.root, destination: entry.destination, position: position + 1 });
      const bytes = payloads.get(writeKey(entry));
      if (!bytes || sha256(bytes) !== entry.intendedSha256) fail('CONCURRENT_MODIFICATION', `Planned bytes changed before apply: ${entry.destination}`);
      const label = `${entry.root === 'repo' ? 'Repository' : 'Workspace'} destination ${entry.destination}`;
      await createExclusive(absoluteFor(roots[entry.root], entry.destination), bytes, roots[entry.root], label, created[entry.root]);
      writes.push({ root: entry.root, destination: entry.destination, preimageSha256: null, postimageSha256: entry.intendedSha256, backupPath: null });
      await failAfter();
    };
    for (const root of ['repo', 'hub']) {
      for (const directory of plan.directories.filter((item) => item.root === root && item.status === 'CREATE')) {
        await createDirectory(roots[root], directory.destination, `${root} directory`, created[root]);
        await failAfter();
      }
      for (const entry of plan.entries.filter((item) => item.root === root && item.kind === 'file' && item.status === 'CREATE')) {
        await createFile(entry);
      }
    }

    for (const entry of plan.entries) {
      if (entry.kind !== 'file' || entry.status !== 'CREATE') continue;
      const current = await inspectFile(roots[entry.root], entry.destination, `Concurrent destination ${entry.destination}`);
      if (current.kind !== 'file' || current.sha256 !== entry.intendedSha256) {
        fail('CONCURRENT_MODIFICATION', `Destination changed while the transaction was applying: ${entry.root}: ${entry.destination}`);
      }
    }

    const installed = await S.readInstalledState(roots.hub);
    if (installed.stateHash !== plan.stateHash) fail('CONCURRENT_MODIFICATION', 'Installed state changed after plan approval.');
    const connections = await readConnectionsFile(roots.hub);
    if (connections.hash !== plan.connectionsHash) fail('CONCURRENT_MODIFICATION', 'Connections state changed after plan approval.');
    const record = {
      connectionId: id,
      name: plan.name,
      hub: plan.hub,
      repo: plan.repo,
      detection: plan.detection.status,
      stage: plan.stage,
      remote: plan.remote,
      ruleFiles: plan.ruleFiles,
      harness: { commit: plan.harness.commit, manifestSha256: plan.harness.manifestSha256, harnessVersion: plan.harness.harnessVersion },
      planDigest: plan.digest,
    };
    const nextConnections = Buffer.from(`${stableStringify({ schemaVersion: 1, connections: { ...connections.state.connections, [id]: record } })}\n`);
    const connectionsBackup = await S.backupPreimage({ target: roots.hub, receiptId: id, destination: CONNECTIONS_RELATIVE_PATH, bytes: connections.bytes, createdDirectories: created.hub });
    if (connectionsBackup !== null) backupPaths.push(connectionsBackup);
    if (injectBeforeWrite) await injectBeforeWrite({ root: 'hub', destination: CONNECTIONS_RELATIVE_PATH, position: position + 1 });
    await S.writeAtomically(connections.filePath, nextConnections, roots.hub, 'Connections state', created.hub);
    writes.push({ root: 'hub', destination: CONNECTIONS_RELATIVE_PATH, preimageSha256: connections.hash, postimageSha256: sha256(nextConnections), backupPath: connectionsBackup });
    await failAfter();

    await S.ensureSafeDirectory(path.dirname(S.receiptPathFor(roots.hub, id)), roots.hub, 'Receipt directory', created.hub);
    const receipt = {
      schemaVersion: 1,
      receiptId: id,
      operation: 'connect',
      planDigest: plan.digest,
      hub: plan.hub,
      repo: plan.repo,
      name: plan.name,
      detection: plan.detection.status,
      harness: { commit: plan.harness.commit, manifestSha256: plan.harness.manifestSha256, harnessVersion: plan.harness.harnessVersion },
      templateManifestSha256: plan.templateManifestHash,
      writes,
      createdDirectories: createdLists(),
    };
    if (injectBeforeWrite) await injectBeforeWrite({ root: 'hub', destination: receiptRelative, position: position + 1 });
    await createExclusive(S.receiptPathFor(roots.hub, id), Buffer.from(`${stableStringify(receipt)}\n`), roots.hub, 'Transaction receipt', created.hub);
    await failAfter();
    return { plan, receiptId: id, connectionId: id, receiptPath: receiptRelative, applied: true, durableWrites: position };
  } catch (error) {
    const undoInput = { roots, writes, backupPaths, createdDirectories: createdLists(), receiptId: id, injectAfterStep: injectFailureAfterRollbackWrite };
    try {
      undoInput.prepared = await prepareUndo(roots, writes);
      await executeUndo(undoInput);
    } catch (rollbackError) {
      const leftovers = await enumerateLeftovers({ roots, writes, backupPaths, createdDirectories: undoInput.createdDirectories, receiptRelative });
      throw rollbackFailure(rollbackError, leftovers, `Connect failed (${error instanceof Error ? error.message : String(error)}) and rollback could not complete.`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rollback of a connect receipt
// ---------------------------------------------------------------------------

const RECEIPT_KEYS = ['schemaVersion', 'receiptId', 'operation', 'planDigest', 'hub', 'repo', 'name', 'detection', 'harness', 'templateManifestSha256', 'writes', 'createdDirectories'];
const WRITE_KEYS = ['root', 'destination', 'preimageSha256', 'postimageSha256', 'backupPath'];

function validateConnectReceipt(receipt, id, hub) {
  const invalid = (message) => fail('INVALID_RECEIPT', message);
  if (!isPlainObject(receipt) || !hasExactKeys(receipt, RECEIPT_KEYS) || receipt.schemaVersion !== 1 || receipt.receiptId !== id
    || !S.TRANSACTION_ID_PATTERN.test(id) || receipt.operation !== 'connect') invalid('Connect receipt has an unsupported shape.');
  if (!S.SHA256_PATTERN.test(receipt.planDigest ?? '') || !S.SHA256_PATTERN.test(receipt.templateManifestSha256 ?? '')
    || !DETECTION_STATUSES.includes(receipt.detection) || typeof receipt.name !== 'string'
    || typeof receipt.repo !== 'string' || !path.isAbsolute(receipt.repo) || typeof receipt.hub !== 'string') invalid('Connect receipt has an unsupported shape.');
  if (!samePath(receipt.hub, hub)) invalid('Connect receipt belongs to a different workspace path.');
  if (!isPlainObject(receipt.harness) || !hasExactKeys(receipt.harness, ['commit', 'manifestSha256', 'harnessVersion'])
    || !COMMIT_PATTERN.test(receipt.harness.commit ?? '') || !S.SHA256_PATTERN.test(receipt.harness.manifestSha256 ?? '')
    || typeof receipt.harness.harnessVersion !== 'string') invalid('Connect receipt harness identity is malformed.');
  try {
    validateRelativePath(receipt.name, 'Receipt name');
  } catch {
    invalid('Connect receipt name is not a portable segment.');
  }
  if (!Array.isArray(receipt.writes) || receipt.writes.length === 0) invalid('Connect receipt has no writes.');
  const byRoot = { hub: [], repo: [] };
  let connectionsWrites = 0;
  for (const write of receipt.writes) {
    if (!isPlainObject(write) || !hasExactKeys(write, WRITE_KEYS) || !['hub', 'repo'].includes(write.root)) invalid('Connect receipt has an invalid write record.');
    S.assertReceiptWrite({ destination: write.destination, preimageSha256: write.preimageSha256, postimageSha256: write.postimageSha256, backupPath: write.backupPath }, id);
    byRoot[write.root].push(write);
    if (write.root === 'repo' && write.preimageSha256 !== null) invalid(`Repository writes are create-only: ${write.destination}`);
    if (write.root === 'hub') {
      if (write.destination === CONNECTIONS_RELATIVE_PATH) connectionsWrites += 1;
      else if (!write.destination.startsWith(`${HUB_PROJECTS_DIRECTORY}/${receipt.name}/`) || write.preimageSha256 !== null) {
        invalid(`Workspace write is outside the registered project folder: ${write.destination}`);
      }
    }
  }
  if (connectionsWrites !== 1) invalid('Connect receipt must own exactly one connections state write.');
  if (receipt.detection !== 'NONE' && byRoot.repo.length > 0) invalid('A register-only connection must not own repository writes.');
  S.assertUniqueDestinations(byRoot.hub);
  S.assertUniqueDestinations(byRoot.repo);
  if (!isPlainObject(receipt.createdDirectories) || !hasExactKeys(receipt.createdDirectories, ['hub', 'repo'])) invalid('Connect receipt createdDirectories is malformed.');
  for (const root of ['hub', 'repo']) {
    const list = receipt.createdDirectories[root];
    if (!Array.isArray(list) || new Set(list).size !== list.length) invalid('Connect receipt createdDirectories is malformed.');
    for (const directory of list) validateRelativePath(directory, 'Receipt created directory');
  }
}

export async function rollbackConnectReceipt({ target, receipt, receiptId: id, receiptPath, injectFailureAfterRollbackWrite = null }) {
  validateConnectReceipt(receipt, id, target);
  const connections = await readConnectionsFile(target);
  const record = connections.state.connections[id];
  if (!record || record.name !== receipt.name || !samePath(record.repo, receipt.repo) || !samePath(record.hub, receipt.hub)
    || record.planDigest !== receipt.planDigest || record.detection !== receipt.detection) {
    fail('INVALID_RECEIPT', 'Connect receipt does not match a current connection record.');
  }
  const roots = { hub: target, repo: null };
  const needsRepo = receipt.writes.some((write) => write.root === 'repo') || receipt.createdDirectories.repo.length > 0;
  if (needsRepo) {
    const repoReal = await resolveRepo({ repoPath: receipt.repo, hubReal: target, sourceRoot: S.INSTALLER_ROOT });
    if (!samePath(repoReal, receipt.repo)) fail('INVALID_RECEIPT', 'Connect receipt repository path no longer resolves to itself.');
    roots.repo = repoReal;
  }
  const backupPaths = receipt.writes.filter((write) => write.backupPath !== null).map((write) => write.backupPath);
  const receiptRelative = posix(path.relative(target, receiptPath));
  // Refusals raised while preparing leave both roots untouched and keep their own code.
  const prepared = await prepareUndo(roots, receipt.writes);
  try {
    await executeUndo({ roots, prepared, backupPaths, createdDirectories: receipt.createdDirectories, receiptId: id, injectAfterStep: injectFailureAfterRollbackWrite });
  } catch (error) {
    const leftovers = await enumerateLeftovers({ roots, writes: receipt.writes, backupPaths, createdDirectories: receipt.createdDirectories, receiptRelative });
    throw rollbackFailure(error, leftovers, 'Rollback could not complete.');
  }
  return { receiptId: id, rolledBackPaths: receipt.writes.map((write) => `${write.root}:${write.destination}`) };
}
