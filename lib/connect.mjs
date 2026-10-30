import { homedir } from 'node:os';
import path from 'node:path';
import { chmod, link, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
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
// The project index: connect adds one row per registered repository, and its undo removes exactly that row.
const INDEX_RELATIVE_PATH = `${HUB_PROJECTS_DIRECTORY}/Index.md`;
const INDEX_SOURCE = 'template/01-Projects/Index.md';
const INDEX_HEADER = ['| Project | Record map | Source location | Status |', '| --- | --- | --- | --- |'];
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
// The one registration this engine knows (see "Registrations" below): the edit guard entry that the harness
// installer merges with bin/sh-hook-register.py add. These values are that script's own constants.
const SETTINGS_RELATIVE = '.claude/settings.local.json';
// The committed settings file. connect never writes it; it reads it only to see whether an entry there runs a refused hook.
const COMMITTED_SETTINGS_RELATIVE = '.claude/settings.json';
const HOOK_REGISTRAR = 'bin/sh-hook-register.py';
const HOOK_SCRIPT = '.claude/spec-harness/hooks/sdd-gate.sh';
const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
const HOOK_COMMAND = `"$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT}`;
const REGISTRAR_CONSTANTS = [
  `SETTINGS = "${SETTINGS_RELATIVE}"`,
  `MATCHER = "${HOOK_MATCHER}"`,
  `SCRIPT = "${HOOK_SCRIPT}"`,
  'COMMAND = \'"$CLAUDE_PROJECT_DIR"/\' + SCRIPT',
];
const EXCLUDE_RELATIVE = '.git/info/exclude';
const EXCLUDE_LINE = `/${SETTINGS_RELATIVE}`;
// The two writes of the registration, in order: [record name, plan entry kind].
const REGISTRATION_PARTS = [['settings', 'registration'], ['exclude', 'exclude']];

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
  const hookRegistration = await readRegistrations(sourceRootReal, manifest, entries);
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
    hookRegistration,
  };
}

// A manifest may declare `registrations`: writes its installer makes that are not staged copies. The only one
// this engine can carry out is the edit guard. Anything else is refused before anything is planned, because
// connect would otherwise have to guess what to write. The vendored registrar must still declare the entry this
// engine writes, so a re-pin that changes it fails here instead of registering an outdated entry.
async function readRegistrations(sourceRootReal, manifest, entries) {
  if (!Object.hasOwn(manifest, 'registrations')) return false;
  if (!Array.isArray(manifest.registrations)) fail('INVALID_HARNESS_MANIFEST', 'Harness manifest registrations must be an array.');
  let known = false;
  for (const [index, raw] of manifest.registrations.entries()) {
    const label = `Harness manifest registration ${index}`;
    if (!isPlainObject(raw) || !hasExactKeys(raw, ['destination', 'by', 'note']) || typeof raw.note !== 'string') fail('INVALID_HARNESS_MANIFEST', `${label} has unsupported keys.`);
    if (raw.destination !== SETTINGS_RELATIVE || raw.by !== HOOK_REGISTRAR) {
      fail('UNKNOWN_REGISTRATION', `${label} (${String(raw.destination)} by ${String(raw.by)}) is not one this engine knows how to write, so connect does not guess. Nothing was planned.`);
    }
    if (known) fail('INVALID_HARNESS_MANIFEST', `Harness manifest repeats a registration: ${raw.destination}`);
    known = true;
  }
  if (!known) return false;
  const script = entries.find((entry) => entry.destination === HOOK_SCRIPT);
  if (!script || (Number.parseInt(script.mode, 8) & 0o111) === 0) {
    fail('INVALID_HARNESS_MANIFEST', `The edit guard registration runs ${HOOK_SCRIPT}, which the manifest must stage with an executable mode.`);
  }
  if (entries.some((entry) => entry.destination === SETTINGS_RELATIVE)) fail('INVALID_HARNESS_MANIFEST', `${SETTINGS_RELATIVE} is registered, so it cannot also be a staged file.`);
  const registrar = await readSourceFile(sourceRootReal, `${HARNESS_ROOT}/${HOOK_REGISTRAR}`, `Harness source ${HOOK_REGISTRAR}`);
  const lines = registrar === null ? [] : registrar.toString('utf8').split(/\r?\n/);
  if (REGISTRAR_CONSTANTS.some((line) => !lines.includes(line))) {
    fail('UNKNOWN_REGISTRATION', `The vendored ${HOOK_REGISTRAR} is missing or no longer declares the edit guard entry this engine writes (${HOOK_MATCHER}, ${HOOK_COMMAND}). Connect does not guess; update lib/connect.mjs with the re-pin. Nothing was planned.`);
  }
  return true;
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
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) bad(`Connection name is a reserved Windows device name: ${name}`);
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
  const url = value.trim();
  const cutQuery = (text) => text.split(/[?#]/)[0];
  const unsafePath = (text) => text.includes('@') || !/^[A-Za-z0-9._~%+/-]*$/.test(text);
  const scheme = url.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s);
  if (scheme) {
    if (!['http', 'https', 'ssh', 'git'].includes(scheme[1].toLowerCase())) return 'unknown';
    const slash = scheme[2].indexOf('/');
    const authority = slash === -1 ? scheme[2] : scheme[2].slice(0, slash);
    const pathPart = cutQuery(slash === -1 ? '' : scheme[2].slice(slash));
    // Strip ALL userinfo: everything up to the last @ of the authority, so a secret that
    // itself contains @, ? or # is cut with it. A secret containing / leaves a malformed
    // host or an @ in the path; both are rejected. Query and fragment are never kept.
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host) || unsafePath(pathPart)) return 'unknown';
    return `${scheme[1].toLowerCase()}://${host}${pathPart}`;
  }
  // scp form: record host and path only, never the user name.
  const scp = url.match(/^(?:[^@\s:/]+@)?([A-Za-z0-9.-]+):([^\s]+)$/);
  if (!scp) return 'unknown';
  const pathPart = cutQuery(scp[2]);
  if (pathPart.length === 0 || unsafePath(pathPart)) return 'unknown';
  return `${scp[1]}:${pathPart}`;
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
// Registrations: the edit guard entry in .claude/settings.local.json
// ---------------------------------------------------------------------------
//
// The harness installer runs bin/sh-hook-register.py add: it merges one PreToolUse entry into the untracked
// .claude/settings.local.json (never the committed settings.json), keeps every other key and hook in order, adds
// nothing when an entry already runs the same command, and leaves a file it cannot trust untouched and named.
// In a git repository it then adds the file to .git/info/exclude, once, unless git already ignores or tracks it.
// The engine starts no process, so the same merge rules are written out here; the exclude step asks git nothing
// (see below). The JSON is read and written the way Python's json module does it, so the bytes are the ones the
// registrar writes.

const SETTINGS_MAX_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 500; // Python stops far deeper JSON with a RecursionError; a settings file never nests like this.
const MAX_IGNORE_BYTES = 100 * 1024 * 1024; // git skips an ignore file larger than this

class SettingsRefused extends Error {}
const refuseSettings = (reason) => {
  throw new SettingsRefused(reason);
};

// Python json.loads: object keys keep their order (a repeated key keeps its first place and its last value), an
// integer keeps its digits, a float is a double, and NaN, Infinity and -Infinity are accepted. Objects are Maps.
function loadPythonJson(text) {
  let at = 0;
  const bad = () => refuseSettings(`${SETTINGS_RELATIVE} is not valid JSON; it was left as it is`);
  const space = () => {
    while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n' || text[at] === '\r') at += 1;
  };
  const hex = (from) => {
    const digits = text.slice(from, from + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) bad();
    return Number.parseInt(digits, 16);
  };
  const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  const string = () => {
    at += 1;
    let out = '';
    for (;;) {
      const char = text[at];
      if (char === undefined || char.charCodeAt(0) < 0x20) bad();
      if (char === '"') {
        at += 1;
        return out;
      }
      if (char !== '\\') {
        out += char;
        at += 1;
        continue;
      }
      const escape = text[at + 1];
      if (Object.hasOwn(ESCAPES, escape ?? '')) {
        out += ESCAPES[escape];
        at += 2;
        continue;
      }
      if (escape !== 'u') bad();
      const unit = hex(at + 2);
      at += 6;
      // A high surrogate joins a following \u low surrogate; any other pair of escapes stays two characters.
      if (unit >= 0xd800 && unit <= 0xdbff && text[at] === '\\' && text[at + 1] === 'u' && at + 6 < text.length) {
        const low = hex(at + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          out += String.fromCharCode(unit, low);
          at += 6;
          continue;
        }
      }
      out += String.fromCharCode(unit);
    }
  };
  const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
  const value = (depth) => {
    if (depth > MAX_JSON_DEPTH) bad();
    const char = text[at];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      const object = char === '{';
      const result = object ? new Map() : [];
      at += 1;
      space();
      if (text[at] === (object ? '}' : ']')) {
        at += 1;
        return result;
      }
      for (;;) {
        if (object) {
          if (text[at] !== '"') bad();
          const key = string();
          space();
          if (text[at] !== ':') bad();
          at += 1;
          space();
          result.set(key, value(depth + 1));
        } else {
          result.push(value(depth + 1));
        }
        space();
        if (text[at] === (object ? '}' : ']')) {
          at += 1;
          return result;
        }
        if (text[at] !== ',') bad();
        at += 1;
        space();
      }
    }
    for (const [word, result] of [['null', null], ['true', true], ['false', false]]) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return result;
      }
    }
    // The sticky pattern matches at lastIndex only; String.prototype.match honours that for a non-global pattern.
    NUMBER.lastIndex = at;
    const number = text.match(NUMBER);
    if (number) {
      at = NUMBER.lastIndex;
      if (number[1] !== undefined || number[2] !== undefined) return { float: Number(number[0]) };
      // Python refuses to convert an integer of more than 4300 digits.
      if (number[0].replace('-', '').length > 4300) bad();
      return { int: number[0] === '-0' ? '0' : number[0] };
    }
    for (const [word, result] of [['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]]) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return { float: result };
      }
    }
    return bad();
  };
  space();
  const result = value(0);
  space();
  if (at !== text.length) bad();
  return result;
}

// Python's repr of a float: the shortest digits that read back the same, fixed notation from 1e-4 up to 1e16.
function pythonFloat(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa, exponentText] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const point = Number(exponentText) + 1;
  const sign = value < 0 ? '-' : '';
  if (point <= -4 || point > 16) {
    const exponent = point - 1;
    return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

// Python json.dumps(value, indent=2, ensure_ascii=False). A lone surrogate cannot be encoded as UTF-8, so the
// registrar fails on it before it writes; here that is a refusal.
function dumpPythonJson(value, level = 0) {
  if (value === null) return 'null';
  if (value === true || value === false) return String(value);
  if (typeof value === 'string') {
    if (!value.isWellFormed()) refuseSettings(`${SETTINGS_RELATIVE} holds text that cannot be written back as UTF-8; it was left as it is`);
    return JSON.stringify(value);
  }
  const inner = `\n${'  '.repeat(level + 1)}`;
  const outer = `\n${'  '.repeat(level)}`;
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${inner}${value.map((item) => dumpPythonJson(item, level + 1)).join(`,${inner}`)}${outer}]`;
  }
  if (value instanceof Map) {
    return value.size === 0 ? '{}' : `{${inner}${[...value].map(([key, item]) => `${dumpPythonJson(key)}: ${dumpPythonJson(item, level + 1)}`).join(`,${inner}`)}${outer}}`;
  }
  return Object.hasOwn(value, 'int') ? value.int : pythonFloat(value.float);
}

const settingsBytes = (settings) => Buffer.from(`${dumpPythonJson(settings)}\n`, 'utf8');
const isHarnessHook = (hook) => hook instanceof Map && hook.get('command') === HOOK_COMMAND;
const holdsHarnessHook = (group) => group instanceof Map && Array.isArray(group.get('hooks')) && group.get('hooks').some(isHarnessHook);

function parseSettings(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    refuseSettings(`${SETTINGS_RELATIVE} is not valid JSON; it was left as it is`);
  }
  const settings = loadPythonJson(text);
  if (!(settings instanceof Map)) refuseSettings(`${SETTINGS_RELATIVE} is not a JSON object; it was left as it is`);
  return settings;
}

function preToolGroups(settings, create) {
  let hooks = settings.get('hooks') ?? null;
  if (hooks === null) {
    if (!create) return null;
    hooks = new Map();
    settings.set('hooks', hooks);
  }
  if (!(hooks instanceof Map)) refuseSettings(`"hooks" in ${SETTINGS_RELATIVE} is not an object; it was left as it is`);
  let groups = hooks.get('PreToolUse') ?? null;
  if (groups === null) {
    if (!create) return null;
    groups = [];
    hooks.set('PreToolUse', groups);
  }
  if (!Array.isArray(groups)) refuseSettings(`"hooks.PreToolUse" in ${SETTINGS_RELATIVE} is not a list; it was left as it is`);
  return groups;
}

/** sh-hook-register.py add: the bytes it would leave in the settings file (null bytes for no write), or why it refuses. */
function mergeHookRegistration(bytes) {
  try {
    const settings = bytes === null ? new Map() : parseSettings(bytes);
    const groups = preToolGroups(settings, true);
    if (groups.some(holdsHarnessHook)) return { status: 'REGISTERED', bytes: null, note: `already registered in ${SETTINGS_RELATIVE}` };
    groups.push(new Map([['matcher', HOOK_MATCHER], ['hooks', [new Map([['type', 'command'], ['command', HOOK_COMMAND]])]]]));
    return { status: bytes === null ? 'CREATE' : 'MERGE', bytes: settingsBytes(settings), note: null };
  } catch (error) {
    if (error instanceof SettingsRefused) return { status: 'NOT-REGISTERED', bytes: null, note: `NOT registered: ${error.message}` };
    throw error;
  }
}

/** sh-hook-register.py remove: only the harness entry goes, with any container it leaves empty. */
function removeHookRegistration(bytes) {
  const settings = parseSettings(bytes);
  const groups = preToolGroups(settings, false);
  let removed = 0;
  if (groups !== null) {
    const kept = [];
    for (const group of groups) {
      if (!holdsHarnessHook(group)) {
        kept.push(group);
        continue;
      }
      const left = group.get('hooks').filter((hook) => !isHarnessHook(hook));
      removed += group.get('hooks').length - left.length;
      if (left.length === 0 && [...group.keys()].every((key) => key === 'matcher' || key === 'hooks')) continue;
      kept.push(new Map(group).set('hooks', left));
    }
    if (removed > 0) {
      const hooks = settings.get('hooks');
      if (kept.length > 0) hooks.set('PreToolUse', kept);
      else {
        hooks.delete('PreToolUse');
        if (hooks.size === 0) settings.delete('hooks');
      }
    }
  }
  return { removed, settings };
}

// What sits at a repository path, by name and type. A link anywhere on the way is reported and never followed.
async function lookAt(rootReal, relative) {
  const segments = relative.split('/');
  let cursor = rootReal;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const stat = await lstatOrNull(cursor);
    if (!stat) return { kind: 'absent', full: path.join(rootReal, ...segments) };
    if (stat.isSymbolicLink()) return { kind: 'link', full: cursor };
    if (index < segments.length - 1 && !stat.isDirectory()) return { kind: 'other', full: cursor };
    if (index === segments.length - 1) return { kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other', full: cursor, stat };
  }
  return { kind: 'other', full: cursor };
}

async function planSettingsRegistration(repoReal) {
  const look = await lookAt(repoReal, SETTINGS_RELATIVE);
  const refused = (reason) => ({ status: 'NOT-REGISTERED', current: null, bytes: null, note: `NOT registered: ${SETTINGS_RELATIVE} is not a plain readable file (${reason})` });
  if (look.kind === 'absent') return { ...mergeHookRegistration(null), current: null };
  if (look.kind !== 'file') return refused(look.kind === 'link' ? 'it is a link' : 'not a regular file');
  if (look.stat.size > SETTINGS_MAX_BYTES) return refused(`exceeds ${SETTINGS_MAX_BYTES}-byte read limit`);
  const current = await readFile(look.full);
  if (current.length > SETTINGS_MAX_BYTES) return refused(`exceeds ${SETTINGS_MAX_BYTES}-byte read limit`);
  return { ...mergeHookRegistration(current), current };
}

// Whether an entry in one settings file already runs the edit guard command, for a plan that does not register the
// hook: 'active', 'none', or 'unknown' with the reason connect cannot tell. Read only, with the same parser; a link
// anywhere on the path is never followed.
async function probeHarnessEntry(repoReal, relative) {
  const look = await lookAt(repoReal, relative);
  if (look.kind === 'absent') return { state: 'none' };
  if (look.kind === 'link') return { state: 'unknown', reason: 'a link, which connect does not follow' };
  if (look.kind !== 'file') return { state: 'unknown', reason: 'not a regular file' };
  if (look.stat.size > SETTINGS_MAX_BYTES) return { state: 'unknown', reason: `larger than the ${SETTINGS_MAX_BYTES}-byte read limit` };
  try {
    const groups = preToolGroups(parseSettings(await readFile(look.full)), false);
    return { state: groups !== null && groups.some(holdsHarnessHook) ? 'active' : 'none' };
  } catch (error) {
    if (error instanceof SettingsRefused) return { state: 'unknown', reason: 'not valid JSON or not shaped as settings' };
    if (['EACCES', 'EPERM'].includes(error?.code)) return { state: 'unknown', reason: 'not readable' };
    throw error;
  }
}

// The copy of the settings file that connect kept before its merge (null when there is none). A copy that cannot be
// read is treated as missing, so the undo falls back to taking out only the entry.
async function settingsPreimage(hubReal, id) {
  try {
    const backupPath = absoluteFor(hubReal, settingsBackupRelativeFor(id));
    await S.assertNoSymlinkAncestors(backupPath, 'Transaction backup', hubReal);
    return await S.readRegularFile(backupPath, 'Transaction backup');
  } catch (error) {
    if (error instanceof InstallPlanError) return null;
    throw error;
  }
}

// The undo of the settings write, decided before anything is removed: 'absent' (nothing of ours is there),
// 'match' (next: the bytes to write back, or null to remove the file connect created) or 'differs' (left alone).
// A file that still holds exactly the bytes connect wrote gets back the copy connect kept of it while it ran, byte for
// byte. Without that copy (the connect finished and deleted it, or it is gone) or after an edit, only the harness entry
// goes, and the rest is written in the registrar's layout. Either way the file keeps its current mode, whatever the
// umask. preimage reads the copy (or gives null).
async function observeSettingsUndo(repoReal, record, preimage = async () => null) {
  const look = await lookAt(repoReal, record.destination);
  const result = { destination: record.destination, path: look.full };
  if (look.kind === 'absent') return { ...result, state: 'absent' };
  if (look.kind !== 'file' || look.stat.size > SETTINGS_MAX_BYTES) return { ...result, state: 'differs' };
  const bytes = await readFile(look.full);
  result.currentSha256 = sha256(bytes);
  const keepMode = look.stat.mode & 0o7777;
  if (result.currentSha256 === record.intendedSha256) {
    if (record.created) return { ...result, state: 'match', next: null };
    const kept = await preimage();
    if (kept !== null && sha256(kept) === record.preimageSha256) return { ...result, state: 'match', next: kept, keepMode };
  }
  try {
    const { removed, settings } = removeHookRegistration(bytes);
    if (removed === 0) return { ...result, state: 'absent' };
    if (record.created && settings.size === 0) return { ...result, state: 'match', next: null };
    return { ...result, state: 'match', next: settingsBytes(settings), keepMode };
  } catch (error) {
    if (error instanceof SettingsRefused) return { ...result, state: 'differs' };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Registrations: the settings file in .git/info/exclude
// ---------------------------------------------------------------------------
//
// The registrar asks git where the repository is, whether it tracks the file and whether it ignores it. connect
// asks only where the repository is, from its own .git folder (HEAD, objects, refs), and adds the line unless
// .git/info/exclude already holds it exactly. So it also adds the line for a file git tracks or already ignores:
// harmless, because an exclude line does not apply to a tracked file and a second ignore rule changes nothing. The
// index and the .gitignore files are never read. connect writes only inside the repository folder, so a linked
// worktree, a submodule or a folder inside another repository's work tree is reported with the line to add by hand.

async function gitFolderAt(directory) {
  const dotGit = await lstatOrNull(path.join(directory, '.git'));
  if (!dotGit) return null;
  if (!dotGit.isDirectory()) return dotGit.isFile() || dotGit.isSymbolicLink() ? 'file' : null;
  const inside = async (name) => lstatOrNull(path.join(directory, '.git', name));
  const head = await inside('HEAD');
  const objects = await inside('objects');
  const refs = await inside('refs');
  const usable = (stat, file) => stat && (stat.isSymbolicLink() || (file ? stat.isFile() : stat.isDirectory()));
  return usable(head, true) && usable(objects, false) && usable(refs, false) ? 'directory' : null;
}

async function planExcludeLine(repoReal) {
  const manual = (note) => ({ status: 'MANUAL', note });
  const here = await gitFolderAt(repoReal);
  if (here === 'file') {
    return manual(`.git is a file here (a linked worktree or a submodule), so its exclude file is outside the repository folder, where connect does not write; add ${EXCLUDE_LINE} to the file that git rev-parse --git-path info/exclude names`);
  }
  if (here === null) {
    for (let cursor = path.dirname(repoReal); ; cursor = path.dirname(cursor)) {
      if (await gitFolderAt(cursor)) {
        return manual(`the repository folder is inside the git work tree at ${cursor}, where connect does not write; add /${posix(path.relative(cursor, repoReal))}/${SETTINGS_RELATIVE} to that work tree's .git/info/exclude yourself`);
      }
      if (path.dirname(cursor) === cursor) break;
    }
    return { status: 'NOT-GIT', note: 'not a git repository; nothing added to .git/info/exclude' };
  }
  const exclude = await lookAt(repoReal, EXCLUDE_RELATIVE);
  const current = exclude.kind === 'file' && exclude.stat.size <= MAX_IGNORE_BYTES ? await readFile(exclude.full) : null;
  if (exclude.kind !== 'absent' && current === null) return manual(`.git/info/exclude is a link, not a file, or too large, so connect does not change it; add ${EXCLUDE_LINE} to it yourself`);
  const directories = [];
  if (current === null) {
    const info = await lookAt(repoReal, '.git/info');
    if (info.kind === 'absent') directories.push('.git/info');
    else if (info.kind !== 'directory') return manual(`.git/info is not a folder, so connect does not create the exclude file; add ${EXCLUDE_LINE} to .git/info/exclude yourself`);
  }
  if (current !== null && current.toString('latin1').split(/\r\n|\r|\n/).includes(EXCLUDE_LINE)) {
    return { status: 'LISTED', note: `git already excludes ${SETTINGS_RELATIVE}`, current };
  }
  const separator = current !== null && current.length > 0 && current.at(-1) !== 10;
  const bytes = Buffer.concat([current ?? Buffer.alloc(0), Buffer.from(`${separator ? '\n' : ''}${EXCLUDE_LINE}\n`)]);
  return {
    status: current === null ? 'CREATE' : 'APPEND',
    note: `adds ${EXCLUDE_LINE} to .git/info/exclude`,
    current,
    bytes,
    directories,
    record: { destination: EXCLUDE_RELATIVE, line: EXCLUDE_LINE, created: current === null, separator, intendedSha256: sha256(bytes) },
  };
}

// The undo of the exclude line, decided before anything is removed (same states as the settings undo). The line
// this connect appended comes off the end exactly; if lines were added after it, only that one line goes.
async function observeExcludeUndo(repoReal, record) {
  const look = await lookAt(repoReal, record.destination);
  const result = { destination: record.destination, path: look.full };
  if (look.kind === 'absent') return { ...result, state: 'absent' };
  if (look.kind !== 'file' || look.stat.size > MAX_IGNORE_BYTES) return { ...result, state: 'differs' };
  const bytes = await readFile(look.full);
  result.currentSha256 = sha256(bytes);
  if (record.created && result.currentSha256 === record.intendedSha256) return { ...result, state: 'match', next: null };
  const text = bytes.toString('latin1');
  const segments = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  const ours = segments.filter((segment) => segment.replace(/\r?\n$|\r$/, '') === record.line).length;
  if (ours === 0) return { ...result, state: 'absent' };
  if (ours > 1) return { ...result, state: 'differs' };
  const appended = `${record.separator ? '\n' : ''}${record.line}\n`;
  const kept = text.endsWith(appended) && (record.separator || text.length === appended.length || /[\r\n]$/.test(text.slice(0, -appended.length)))
    ? text.slice(0, -appended.length)
    : segments.filter((segment) => segment.replace(/\r?\n$|\r$/, '') !== record.line).join('');
  if (record.created && kept.length === 0) return { ...result, state: 'match', next: null };
  return { ...result, state: 'match', next: Buffer.from(kept, 'latin1'), keepMode: look.stat.mode & 0o7777 };
}

function validateRegistration(value, invalid) {
  if (value === null) return;
  if (!isPlainObject(value) || !hasExactKeys(value, ['settings', 'exclude']) || (value.settings === null && value.exclude === null)) invalid();
  const { settings, exclude } = value;
  // preimageSha256 names the bytes of a settings file that existed before the merge; a file connect created has none.
  // The copy it names lives only while connect runs, so nothing here, in a receipt least of all, needs it to exist.
  if (settings !== null && (!isPlainObject(settings) || !hasExactKeys(settings, ['destination', 'created', 'preimageSha256', 'intendedSha256'])
    || settings.destination !== SETTINGS_RELATIVE || typeof settings.created !== 'boolean' || !S.SHA256_PATTERN.test(settings.intendedSha256 ?? '')
    || (settings.created ? settings.preimageSha256 !== null : !S.SHA256_PATTERN.test(settings.preimageSha256 ?? '')))) invalid();
  if (exclude !== null && (!isPlainObject(exclude) || !hasExactKeys(exclude, ['destination', 'line', 'created', 'separator', 'intendedSha256'])
    || exclude.destination !== EXCLUDE_RELATIVE || exclude.line !== EXCLUDE_LINE || typeof exclude.created !== 'boolean'
    || typeof exclude.separator !== 'boolean' || !S.SHA256_PATTERN.test(exclude.intendedSha256 ?? ''))) invalid();
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

function indexCell(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
}

// The source cell links the git-ignored Connection.md, which holds the repository path; the tracked index never does.
function indexRowFor({ name, stage }) {
  return `| ${indexCell(name)} | [${indexCell(name)}/README.md](<${indexCell(name)}/README.md>) | [Connection.md](<${indexCell(name)}/Connection.md>) | ${stage === 'STAGED' ? 'Connected: STAGED' : 'Connected: registered'} |`;
}

function indexLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function stripEol(line) {
  return line.replace(/\r?\n$/, '');
}

function hasIndexRowFor(text, name) {
  return indexLines(text).some((line) => stripEol(line).startsWith(`| ${indexCell(name)} |`));
}

// Inserts the row after the last table line, or appends a table when the file has none.
function insertIndexRow(text, row) {
  const lines = indexLines(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let last = -1;
  lines.forEach((line, index) => {
    if (stripEol(line).startsWith('|')) last = index;
  });
  if (last === -1) {
    const tail = text.length === 0 || text.endsWith('\n') ? '' : eol;
    return `${text}${tail}${text.length === 0 ? '' : eol}${INDEX_HEADER.join(eol)}${eol}${row}${eol}`;
  }
  if (!lines[last].endsWith('\n')) lines[last] = `${lines[last]}${eol}`;
  lines.splice(last + 1, 0, `${row}${eol}`);
  return lines.join('');
}

// Row-level undo: 'match' when the row is there exactly once, 'absent' when it is not
// there (already undone, or removed by hand), 'differs' when it appears more than once.
function indexRowState(bytes, row) {
  if (bytes === null) return { state: 'absent', next: null };
  const lines = indexLines(bytes.toString('utf8'));
  const found = lines.filter((line) => stripEol(line) === row).length;
  if (found === 0) return { state: 'absent', next: null };
  if (found > 1) return { state: 'differs', next: null };
  return { state: 'match', next: Buffer.from(lines.filter((line) => stripEol(line) !== row).join(''), 'utf8') };
}

function validateIndexRow(value, invalid) {
  if (value === null) return;
  if (!isPlainObject(value) || !hasExactKeys(value, ['destination', 'row', 'created', 'intendedSha256'])
    || value.destination !== INDEX_RELATIVE_PATH || typeof value.row !== 'string' || !value.row.startsWith('| ') || /[\r\n]/.test(value.row)
    || typeof value.created !== 'boolean' || !S.SHA256_PATTERN.test(value.intendedSha256 ?? '')) {
    invalid('The project index row record is malformed.');
  }
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

  for (const pending of await readPendingRecords(hub)) {
    if (samePath(pending.repo, repo) || pending.name.toLowerCase() === connectionName.toLowerCase()) {
      fail('INTERRUPTED_CONNECT', `An earlier connect for this repository or name was interrupted (pending ${pending.pendingId}). `
        + 'The repository may hold part of its file set. Nothing was written by this plan. '
        + `Recover first (it finishes or undoes that run, whichever the records show): rollbackReceipt({ targetPath: <workspace>, receiptId: '${pending.pendingId}' }) (command line: rollback --target <workspace> --receipt ${pending.pendingId}).`);
    }
  }
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

  const projectsFolder = path.join(hub, HUB_PROJECTS_DIRECTORY);
  if ((await lstatOrNull(projectsFolder))?.isDirectory()) {
    const clash = (await readdir(projectsFolder)).find((entry) => entry !== connectionName && entry.toLowerCase() === connectionName.toLowerCase());
    if (clash) fail('CONNECTION_NAME_TAKEN', `The workspace already has a project folder ${clash} that differs from ${connectionName} only by case; nothing was written.`);
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
          root: 'repo', destination: entry.destination, kind: 'file', status: 'CREATE', currentSha256: null, intendedSha256, mode: entry.mode,
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

  // The manifest's registrations, after the staged files, as the harness installer orders them. A refusal or a
  // decision not to write is a plan line with its reason, never a blocked plan: the installer goes on the same way.
  let registration = null;
  if (detection.status === 'NONE' && harness.hookRegistration) {
    // The registered command runs the staged hook on every edit, so it is registered only when that file is the
    // shipped edit guard: created by this plan, or already there byte for byte. A different file (one that came
    // with the repository) is kept, as every existing file is, and is never registered. The registrar checks this
    // first, before it reads the settings file.
    const hook = entries.find((entry) => entry.root === 'repo' && entry.kind === 'file' && entry.destination === HOOK_SCRIPT);
    // A kept copy keeps its mode. Without the execute bit Claude Code cannot run it, which does not block an edit.
    const kept = hook && hook.status === 'PRESERVED' && !hook.differs && process.platform !== 'win32' ? await lookAt(repo, HOOK_SCRIPT) : null;
    const hookRefusal = !hook ? `${HOOK_SCRIPT} is not staged; the edit guard was not registered`
      : hook.status === 'PRESERVED' && hook.differs
        ? `${HOOK_SCRIPT} differs from the shipped edit guard (it was changed, or it came with the repository); it was kept and not registered. Review it, or replace it with the shipped one, then register it by hand`
        : kept && kept.kind === 'file' && (kept.stat.mode & 0o100) === 0
          ? `${HOOK_SCRIPT} is the shipped edit guard but is not executable, so it could not run and edits would go unguarded; it was not registered. Run chmod +x ${HOOK_SCRIPT}, then register it by hand`
          : null;
    let settings;
    if (hookRefusal) {
      // An entry already in a settings file runs the refused hook on every edit, so the plan must not read as if the
      // guard were inactive. Both files Claude Code reads from the repository are looked at; for one that connect cannot
      // read, the plan says it cannot tell. connect did not write such an entry, so it leaves it. The registrar's own add
      // takes an entry in settings.local.json out when it refuses; connect differs on purpose, because its undo gives
      // back only what it wrote. The hand-off prints the registrar's remove command instead.
      const activeIn = [];
      const unknownIn = [];
      let found = '';
      for (const relative of [SETTINGS_RELATIVE, COMMITTED_SETTINGS_RELATIVE]) {
        const probe = await probeHarnessEntry(repo, relative);
        if (probe.state === 'active') {
          activeIn.push(relative);
          found += `. An entry already in ${relative} still runs it on every edit; connect did not write that entry and leaves it`;
        } else if (probe.state === 'unknown') {
          unknownIn.push(relative);
          found += `. connect cannot tell whether an entry in ${relative} already runs this file, because ${relative} is ${probe.reason}`;
        }
      }
      settings = { status: 'NOT-REGISTERED', current: null, bytes: null, hookRefused: true, activeIn, unknownIn, note: `NOT registered: ${hookRefusal}${found}` };
    } else {
      settings = await planSettingsRegistration(repo);
    }
    const writesSettings = settings.status === 'CREATE' || settings.status === 'MERGE';
    const settingsCurrent = settings.current ? sha256(settings.current) : null;
    const settingsIntended = writesSettings ? sha256(settings.bytes) : settingsCurrent;
    entries.push({
      root: 'repo', destination: SETTINGS_RELATIVE, kind: 'registration', status: settings.status, currentSha256: settingsCurrent, intendedSha256: settingsIntended,
      undo: { action: writesSettings ? 'remove-hook-entry' : 'none', root: 'repo', destination: SETTINGS_RELATIVE, preimageSha256: settingsCurrent, postimageSha256: settingsIntended },
      note: settings.note ?? `${settings.status === 'CREATE' ? 'creates' : 'merges one PreToolUse entry into'} ${SETTINGS_RELATIVE}; never ${COMMITTED_SETTINGS_RELATIVE}`,
      ...(settings.status === 'NOT-REGISTERED' ? {
        hookRefused: settings.hookRefused === true,
        activeIn: settings.activeIn ?? [],
        unknownIn: settings.unknownIn ?? [],
        activeEntry: (settings.activeIn ?? []).length > 0,
      } : {}),
    });
    if (writesSettings) {
      payloads.set(`registration:${SETTINGS_RELATIVE}`, settings.bytes);
      repoDirectoryCandidates.push(...parentDirectories(SETTINGS_RELATIVE));
    }
    // As in the registrar, a refused registration stops before the exclude step.
    const exclude = settings.status === 'NOT-REGISTERED'
      ? { status: 'SKIPPED', note: 'the edit guard was not registered, so .git/info/exclude is left alone', current: null }
      : await planExcludeLine(repo);
    const writesExclude = exclude.status === 'CREATE' || exclude.status === 'APPEND';
    const excludeCurrent = exclude.current ? sha256(exclude.current) : null;
    const excludeIntended = writesExclude ? exclude.record.intendedSha256 : excludeCurrent;
    entries.push({
      root: 'repo', destination: EXCLUDE_RELATIVE, kind: 'exclude', status: exclude.status, currentSha256: excludeCurrent, intendedSha256: excludeIntended,
      undo: { action: { CREATE: 'remove-created-file', APPEND: 'remove-line' }[exclude.status] ?? 'none', root: 'repo', destination: EXCLUDE_RELATIVE, preimageSha256: excludeCurrent, postimageSha256: excludeIntended },
      note: exclude.note,
    });
    if (writesExclude) {
      payloads.set(`exclude:${EXCLUDE_RELATIVE}`, exclude.bytes);
      repoDirectoryCandidates.push(...exclude.directories);
    }
    const settingsRecord = writesSettings ? { destination: SETTINGS_RELATIVE, created: settings.status === 'CREATE', preimageSha256: settingsCurrent, intendedSha256: settingsIntended } : null;
    if (settingsRecord || writesExclude) registration = { settings: settingsRecord, exclude: writesExclude ? exclude.record : null };
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
  const stage = detection.status === 'NONE' ? 'STAGED' : 'REGISTER-ONLY';
  let indexRow = null;
  // Only a workspace whose installed state manages the index (v1.4.0 or later) gets a row. An older
  // install has no index yet: its next upgrade creates it, and creating it here would make that a conflict.
  const indexTemplate = validated.entries.find((entry) => entry.source === INDEX_SOURCE);
  if (indexTemplate && Object.hasOwn(installed.state.managedPaths, INDEX_RELATIVE_PATH)) {
    const row = indexRowFor({ name: connectionName, stage });
    const indexPath = absoluteFor(hub, INDEX_RELATIVE_PATH);
    await S.assertNoSymlinkAncestors(indexPath, 'Project index', hub);
    const current = await S.readRegularFile(indexPath, 'Project index');
    const currentSha256 = current === null ? null : sha256(current);
    let status;
    let bytes = null;
    if (current === null) {
      status = 'CREATE';
      bytes = Buffer.from(insertIndexRow(Buffer.from(indexTemplate.bytes).toString('utf8'), row), 'utf8');
      hubDirectoryCandidates.push(...parentDirectories(INDEX_RELATIVE_PATH));
    } else if (hasIndexRowFor(current.toString('utf8'), connectionName)) {
      status = 'LISTED';
    } else {
      status = 'APPEND';
      bytes = Buffer.from(insertIndexRow(current.toString('utf8'), row), 'utf8');
    }
    const intendedSha256 = bytes === null ? currentSha256 : sha256(bytes);
    const action = { CREATE: 'remove-created-file', APPEND: 'remove-row', LISTED: 'none' }[status];
    entries.push({
      root: 'hub', destination: INDEX_RELATIVE_PATH, kind: 'index', status, currentSha256, intendedSha256,
      undo: { action, root: 'hub', destination: INDEX_RELATIVE_PATH, preimageSha256: currentSha256, postimageSha256: intendedSha256 },
    });
    if (bytes !== null) {
      payloads.set(`index:${INDEX_RELATIVE_PATH}`, bytes);
      indexRow = { destination: INDEX_RELATIVE_PATH, row, created: status === 'CREATE', intendedSha256 };
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
    stage,
    indexRow,
    registration,
    remote,
    ruleFiles,
    harness: harnessIdentity,
    harnessSha256: harness.manifestSha256,
    templateManifestHash,
    stateHash: installed.stateHash,
    connectionsHash: connections.hash,
    connectionsPreimage: connections.hash === null ? 'absent' : Object.keys(connections.state.connections).length === 0 ? 'empty' : 'records',
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
// Durability (fsync) and the write-ahead pending record
// ---------------------------------------------------------------------------

async function fsyncFile(filePath) {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Windows cannot open a directory for fsync, so that call is skipped there on purpose;
// every other platform syncs the directory entry as well as the file.
async function fsyncDirectory(directoryPath) {
  if (process.platform === 'win32') return;
  let handle = null;
  try {
    handle = await open(directoryPath, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'ENOENT'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

const PENDING_DIRECTORY = '.second-brain/connect-pending';
const PENDING_KEYS = ['schemaVersion', 'pendingId', 'operation', 'phase', 'planDigest', 'hub', 'repo', 'name', 'directories', 'writes', 'connectionsPreimage'];
// v1.4.0 records also carry indexRow (null when connect adds no index row). Records written by v1.3.0 lack it.
const PENDING_KEYS_WITH_INDEX = [...PENDING_KEYS, 'indexRow'];
// v1.11.0 records also carry registration (null when connect writes no registration). Older records lack it.
const PENDING_KEYS_WITH_REGISTRATION = [...PENDING_KEYS_WITH_INDEX, 'registration'];
const CONNECTIONS_PREIMAGES = ['absent', 'empty', 'records'];
const pendingRelativeFor = (id) => `${PENDING_DIRECTORY}/${id}.json`;
const backupRelativeFor = (id) => `.second-brain/backups/${id}/${CONNECTIONS_RELATIVE_PATH}`;
// The copy of a settings file that existed before the merge, kept in the workspace only while connect runs, so the
// undo of a failed or interrupted connect can give the file back byte for byte. A finished connect deletes it.
const settingsBackupRelativeFor = (id) => `.second-brain/backups/${id}/repo/${SETTINGS_RELATIVE}`;
const receiptRelativeFor = (id) => `${S.RECEIPTS_RELATIVE_DIRECTORY}/${id}.json`;

function writeKey(write) {
  return `${write.root}:${write.destination}`;
}

function validatePending(record, id) {
  const bad = (message) => fail('INVALID_PENDING_CONNECT', message);
  if (!isPlainObject(record) || ![PENDING_KEYS, PENDING_KEYS_WITH_INDEX, PENDING_KEYS_WITH_REGISTRATION].some((keys) => hasExactKeys(record, keys)) || record.schemaVersion !== 1 || record.pendingId !== id
    || record.operation !== 'connect-pending' || !S.SHA256_PATTERN.test(record.planDigest ?? '')
    || typeof record.hub !== 'string' || !path.isAbsolute(record.hub) || typeof record.repo !== 'string' || !path.isAbsolute(record.repo)
    || typeof record.name !== 'string' || record.name.length === 0 || !['apply', 'rollback'].includes(record.phase)
    || !CONNECTIONS_PREIMAGES.includes(record.connectionsPreimage)) {
    bad(`Pending connect record is malformed: ${id}`);
  }
  if (!isPlainObject(record.directories) || !hasExactKeys(record.directories, ['hub', 'repo'])) bad(`Pending connect directories are malformed: ${id}`);
  for (const root of ['hub', 'repo']) {
    const list = record.directories[root];
    if (!Array.isArray(list) || new Set(list).size !== list.length) bad(`Pending connect directories are malformed: ${id}`);
    for (const directory of list) validateRelativePath(directory, 'Pending connect directory');
  }
  validateIndexRow(record.indexRow ?? null, () => bad(`Pending connect index row is malformed: ${id}`));
  validateRegistration(record.registration ?? null, () => bad(`Pending connect registration is malformed: ${id}`));
  if (!Array.isArray(record.writes)) bad(`Pending connect writes are malformed: ${id}`);
  const seen = new Set();
  for (const write of record.writes) {
    if (!isPlainObject(write) || !hasExactKeys(write, ['root', 'destination', 'intendedSha256']) || !['hub', 'repo'].includes(write.root)
      || !S.SHA256_PATTERN.test(write.intendedSha256 ?? '')) bad(`Pending connect write is malformed: ${id}`);
    validateRelativePath(write.destination, 'Pending connect destination');
    if (seen.has(writeKey(write))) bad(`Pending connect repeats a destination: ${id}`);
    seen.add(writeKey(write));
  }
  return record;
}

async function readPendingRecord(hub, id) {
  const filePath = path.join(hub, ...pendingRelativeFor(id).split('/'));
  await S.assertNoSymlinkAncestors(filePath, 'Pending connect record', hub);
  const bytes = await S.readRegularFile(filePath, 'Pending connect record');
  if (bytes === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('INVALID_PENDING_CONNECT', `Pending connect record ${filePath} is empty or truncated and could not be parsed. A record that never parsed was never acted on, so it can be deleted; then run the command again.`);
  }
  try {
    return validatePending(parsed, id);
  } catch (error) {
    if (error instanceof InstallPlanError) throw new InstallPlanError(error.code, `${error.message} (${filePath})`);
    throw error;
  }
}

async function readPendingRecords(hub) {
  const directory = path.join(hub, ...PENDING_DIRECTORY.split('/'));
  await S.assertNoSymlinkAncestors(directory, 'Pending connect namespace', hub);
  const stat = await lstatOrNull(directory);
  if (!stat) return [];
  if (!stat.isDirectory()) fail('INVALID_NAMESPACE', `Pending connect namespace must be absent or a real directory: ${PENDING_DIRECTORY}`);
  const records = [];
  for (const name of (await readdir(directory)).sort()) {
    // Only names shaped like a pending record are read. Anything else (a Finder .DS_Store,
    // Thumbs.db, a stray folder, an engine temp file that cleanup handles by exact name) is
    // ignored, so a foreign file in this folder can never lock the workspace.
    const match = name.match(/^(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/);
    if (!match) continue;
    records.push(await readPendingRecord(hub, match[1]));
  }
  return records;
}

/** Read-only list of interrupted connects (for the workspace verify listing). */
export async function listPendingConnects({ targetPath }) {
  const hub = await S.resolveTarget(targetPath, S.INSTALLER_ROOT);
  await S.assertTransactionNamespace(hub);
  // `committed` is the engine's own completed check (connectCommitted), read-only: true when the connect finished and only the marker is left.
  const listed = [];
  for (const record of await readPendingRecords(hub)) {
    listed.push({ kind: 'pending', pendingId: record.pendingId, name: record.name, repo: record.repo, planDigest: record.planDigest, committed: await connectCommitted(hub, record) });
  }
  return [...listed, ...(await unlinkedPendingTemps(hub)).map((pendingId) => ({ kind: 'unlinked-temp', pendingId }))];
}

// A kill inside the very first write leaves only this engine-named temp (the record never
// linked, nothing else was written). It is matched by its exact shape, which embeds one id twice.
async function unlinkedPendingTemps(hub) {
  const directory = path.join(hub, ...PENDING_DIRECTORY.split('/'));
  await S.assertNoSymlinkAncestors(directory, 'Pending connect namespace', hub);
  if (!(await lstatOrNull(directory))?.isDirectory()) return [];
  const ids = [];
  const names = await readdir(directory);
  for (const name of names) {
    const match = name.match(/^\.(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json\.second-brain-(tx-[0-9a-f-]{36})\.tmp$/);
    // A temp whose record DID link is cleaned by that record's own recovery, so it is not listed here.
    if (match && match[1] === match[2] && !names.includes(`${match[1]}.json`)) ids.push(match[1]);
  }
  return ids.sort();
}

/** Refuses (writes nothing) while any connection or interrupted connect exists in the workspace. */
export async function assertNoConnections(target) {
  const connections = Object.keys((await readConnectionsFile(target)).state.connections);
  const pending = (await readPendingRecords(target)).map((record) => record.pendingId);
  if (connections.length > 0 || pending.length > 0) {
    fail('CONNECTIONS_PRESENT', `This workspace still has connections (${connections.join(', ') || 'none'}) or interrupted connects (${pending.join(', ') || 'none'}). `
      + 'Roll those back first; nothing was changed.');
  }
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

// mode is the mode a new file is created with, less the umask, as open(2) applies it: a manifest entry's own mode.
async function createExclusive(filePath, bytes, rootReal, label, createdDirectories, { ownerId, durable = false, linkFailureCode = null, between = null, mode = 0o666 } = {}) {
  if (!isWithin(rootReal, filePath)) fail('TARGET_ESCAPE', `${label} escapes its root: ${filePath}`);
  const directory = path.dirname(filePath);
  await S.ensureSafeDirectory(directory, rootReal, `${label} directory`, createdDirectories);
  await S.assertNoSymlinkAncestors(filePath, label, rootReal);
  const temporary = path.join(directory, `.${path.basename(filePath)}.second-brain-${ownerId}.tmp`);
  const clash = () => fail('CONCURRENT_MODIFICATION', `Destination appeared while the transaction was applying: ${label}`);
  try {
    await rm(temporary, { force: true }); // this transaction's own stale temp, same id only
    await writeFile(temporary, bytes, { flag: 'wx', mode });
    if (durable) await fsyncFile(temporary);
    if (between) await between();
    try {
      // link() fails with EEXIST instead of replacing a file that appeared meanwhile,
      // so a create-only write cannot clobber a concurrent creation (rename would).
      if (linkFailureCode) throw Object.assign(new Error('injected link failure'), { code: linkFailureCode });
      await link(temporary, filePath);
    } catch (error) {
      if (error?.code === 'EEXIST') clash();
      if (!LINK_FALLBACK_CODES.includes(error?.code)) throw error;
      try {
        await writeFile(filePath, bytes, { flag: 'wx', mode });
      } catch (second) {
        if (second?.code === 'EEXIST') clash();
        await rm(filePath, { force: true }).catch(() => {});
        throw second;
      }
    }
    if (durable) {
      await fsyncFile(filePath);
      await fsyncDirectory(directory);
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

// The temporary file of a write is named after the transaction, so it can be derived from the
// pending record or receipt and removed by exact name: .<basename>.second-brain-<id>.tmp
function tempRelativeFor(destination, id) {
  const slash = destination.lastIndexOf('/');
  return `${destination.slice(0, slash + 1)}.${destination.slice(slash + 1)}.second-brain-${id}.tmp`;
}

function ownedTemps(writes, id, indexRow = null, registration = null) {
  const out = { repo: [], hub: [] };
  for (const write of writes) out[write.root].push(tempRelativeFor(write.destination, id));
  if (indexRow) out.hub.push(tempRelativeFor(indexRow.destination, id));
  for (const record of [registration?.settings, registration?.exclude]) {
    if (record) out.repo.push(tempRelativeFor(record.destination, id));
  }
  if (registration?.settings && !registration.settings.created) out.hub.push(tempRelativeFor(settingsBackupRelativeFor(id), id));
  for (const relative of [CONNECTIONS_RELATIVE_PATH, receiptRelativeFor(id), pendingRelativeFor(id), backupRelativeFor(id)]) out.hub.push(tempRelativeFor(relative, id));
  return out;
}

async function removeOwnedTemp(rootReal, relative) {
  const filePath = absoluteFor(rootReal, relative);
  try {
    await S.assertNoSymlinkAncestors(filePath, 'Transaction temporary file', rootReal);
    const stat = await lstatOrNull(filePath);
    if (stat?.isFile()) await rm(filePath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOTDIR') throw error;
  }
}

// mode is the creation mode of the replacement (less the umask); keepMode, when set, is applied to it exactly,
// so a replaced file keeps the mode it had.
async function writeOwned(filePath, bytes, rootReal, label, createdDirectories, ownerId, between = null, { mode = 0o666, keepMode = null } = {}) {
  if (!isWithin(rootReal, filePath)) fail('TARGET_ESCAPE', `${label} escapes its root: ${filePath}`);
  const directory = path.dirname(filePath);
  await S.ensureSafeDirectory(directory, rootReal, `${label} directory`, createdDirectories);
  await S.assertNoSymlinkAncestors(filePath, label, rootReal);
  const temporary = path.join(directory, `.${path.basename(filePath)}.second-brain-${ownerId}.tmp`);
  try {
    await rm(temporary, { force: true });
    await writeFile(temporary, bytes, { flag: 'wx', mode });
    if (keepMode !== null) await chmod(temporary, keepMode);
    await fsyncFile(temporary);
    if (between) await between();
    await rename(temporary, filePath);
    await fsyncDirectory(directory);
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

function recordMatches(record, expected) {
  return Object.entries(expected).every(([key, value]) => (key === 'repo' || key === 'hub' ? samePath(record[key], value) : record[key] === value));
}

// The bytes connections.json held before this connect, from the backup the apply wrote, when those
// bytes held zero records. Anything else returns null: a file that held other records cannot be
// given back byte for byte once they are gone, so the caller writes the canonical form instead.
async function originalEmptyConnections(hubReal, id) {
  const bytes = await S.readRegularFile(absoluteFor(hubReal, backupRelativeFor(id)), 'Transaction backup');
  if (bytes === null) return null;
  try {
    return Object.keys(normalizeConnections(JSON.parse(bytes.toString('utf8'))).connections).length === 0 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The single undo engine behind (1) a failed apply, (2) rollback of a connect receipt and
 * (3) recovery of an interrupted connect from its pending record.
 *
 * It is idempotent: a create-only file that is already absent counts as undone, a record
 * that is already gone counts as undone, so any interrupted run can simply be repeated.
 * Order: the registration (the edit guard entry, the exclude line), repository files, workspace
 * files, this connection's record in connections.json, backups, created directories, the pending
 * record, the receipt, then the directories that held the receipt. Nothing that points at the
 * repository is removed before the repository files are. Only bytes that equal the recorded
 * postimage are ever removed. The registration undo of an unfinished connect gives a merged settings
 * file that nobody edited its old bytes back from the copy in the workspace; otherwise, and always for a
 * finished connect, it takes out only its own entry and line.
 *   strict:  any changed file or record refuses BEFORE the first removal (POSTIMAGE_MISMATCH).
 *   lenient: matching files are removed, changed ones are left and listed, and the pending
 *            record and receipt are kept so the run can be retried after the person acts.
 */
async function undoConnect({ roots, id, writes, owned = null, expectedRecord, connectionsPreimage, createdDirectories, strict, checkOnly = false, injectAfterStep = null, onStep = null, indexRow = null, registration = null, ownedRegistration = null }) {
  const observed = [];
  const registrationObserved = [];
  let observing = true;
  let connections;
  let recordState;
  let edited;
  let refused;
  let indexObservation = null;
  try {
  for (const root of ['repo', 'hub']) {
    for (const write of writes.filter((item) => item.root === root)) {
      if (!roots[root]) continue;
      const found = await inspectFile(roots[root], write.destination, `Rollback destination ${write.destination}`);
      observed.push({ write, state: found.kind === 'absent' ? 'absent' : found.sha256 === write.postimageSha256 ? 'match' : 'differs' });
    }
  }
  // A failed apply undoes the registration writes it made (ownedRegistration); a rollback or recovery, all of them.
  // A write the failed apply did not reach is undone only when the file holds exactly the bytes it would have written.
  if (registration && roots.repo) {
    for (const [part, observe] of [['settings', observeSettingsUndo], ['exclude', observeExcludeUndo]]) {
      if (!registration[part]) continue;
      const found = await observe(roots.repo, registration[part], () => settingsPreimage(roots.hub, id));
      const reached = ownedRegistration === null || ownedRegistration.has(part) || found.currentSha256 === registration[part].intendedSha256;
      registrationObserved.push(reached ? found : { ...found, state: 'absent' });
    }
  }
  if (indexRow) {
    const indexPath = absoluteFor(roots.hub, indexRow.destination);
    await S.assertNoSymlinkAncestors(indexPath, 'Project index', roots.hub);
    const indexBytes = await S.readRegularFile(indexPath, 'Project index');
    const rowState = indexRowState(indexBytes, indexRow.row);
    // A created index that still holds exactly the bytes connect wrote is removed whole.
    const wholeFile = indexRow.created && indexBytes !== null && sha256(indexBytes) === indexRow.intendedSha256;
    indexObservation = { path: indexPath, state: rowState.state, next: rowState.next, wholeFile };
  }
  connections = await readConnectionsFile(roots.hub);
  const record = connections.state.connections[id] ?? null;
  recordState = record === null ? 'absent' : recordMatches(record, expectedRecord) ? 'match' : 'differs';
  edited = observed.filter((item) => item.state === 'differs' && (owned === null || owned.has(writeKey(item.write))));
  const indexRefused = indexObservation?.state === 'differs' ? [`hub: ${indexRow.destination}`] : [];
  const registrationRefused = registrationObserved.filter((item) => item.state === 'differs').map((item) => `repo: ${item.destination}`);
  const changed = [...registrationRefused, ...edited.map((item) => `${item.write.root}: ${item.write.destination}`), ...indexRefused];
  refused = [...changed, ...(recordState === 'differs' ? [`hub: ${CONNECTIONS_RELATIVE_PATH}`] : [])];
  if (strict && changed.length > 0) {
    fail('POSTIMAGE_MISMATCH', `Rollback refused because ${changed.join(', ')} no longer has this receipt's postimage. Nothing was removed in either root.`);
  }
  if (strict && recordState === 'differs') fail('INVALID_RECEIPT', 'Connect receipt does not match a current connection record.');

  } catch (error) {
    if (observing && error instanceof InstallPlanError) error.beforeRemoval = true;
    throw error;
  }
  observing = false;
  if (checkOnly) return;
  let step = 0;
  const run = async (action) => {
    step += 1;
    if (onStep) await onStep({ step });
    await action();
    if (injectAfterStep === step) fail('INJECTED_WRITE_FAILURE', `Injected rollback failure after step ${step}.`);
  };
  for (const item of registrationObserved) {
    // Only the harness entry or the exclude line goes; a file connect created goes whole when nothing else is in it.
    await run(async () => {
      if (item.state !== 'match') return;
      const label = `Rollback destination ${item.destination}`;
      if (item.next === null) await S.removeRegularFile(item.path, roots.repo, label);
      else await writeOwned(item.path, item.next, roots.repo, label, null, id, null, { mode: 0o644, keepMode: item.keepMode });
    });
  }
  for (const item of observed) {
    await run(async () => {
      if (item.state === 'match') await S.removeRegularFile(absoluteFor(roots[item.write.root], item.write.destination), roots[item.write.root], `Rollback destination ${item.write.destination}`);
    });
  }
  if (indexObservation) {
    // Exactly this connection's row goes; every other line of the index, edits included, stays.
    await run(async () => {
      if (indexObservation.wholeFile) await S.removeRegularFile(indexObservation.path, roots.hub, 'Project index');
      else if (indexObservation.state === 'match') await writeOwned(indexObservation.path, indexObservation.next, roots.hub, 'Project index', null, id);
    });
  }
  await run(async () => {
    if (recordState !== 'match') return;
    const remaining = { ...connections.state.connections };
    delete remaining[id];
    if (Object.keys(remaining).length > 0) {
      // Other connections stay intact, so the file is written again from the records that remain.
      // R05-26: the rewrite is canonical JSON, so a hand-formatted connections.json that held other
      // records comes back re-serialised, not byte-identical. Only the zero-record case is restored byte for byte (R05-21).
      await writeOwned(connections.filePath, Buffer.from(`${stableStringify({ schemaVersion: 1, connections: remaining })}\n`), roots.hub, 'Connections state', null, id);
    } else if (connectionsPreimage === 'empty') {
      // The file held no records before this connect and none remain, so its original bytes come back (R05-21).
      const original = await originalEmptyConnections(roots.hub, id);
      await writeOwned(connections.filePath, original ?? Buffer.from(`${stableStringify({ schemaVersion: 1, connections: {} })}\n`), roots.hub, 'Connections state', null, id);
    } else {
      await S.removeRegularFile(connections.filePath, roots.hub, 'Connections state');
      await fsyncDirectory(path.dirname(connections.filePath));
    }
  });
  await run(async () => {
    // Both copies go only now, after the registration undo above has read the settings copy.
    for (const relative of [backupRelativeFor(id), settingsBackupRelativeFor(id)]) await S.removeRegularFile(absoluteFor(roots.hub, relative), roots.hub, 'Transaction backup');
  });
  const temps = ownedTemps(writes, id, indexRow, registration);
  for (const root of ['repo', 'hub']) {
    if (!roots[root]) continue;
    await run(async () => {
      for (const relative of temps[root]) await removeOwnedTemp(roots[root], relative);
    });
  }
  const receiptRelative = receiptRelativeFor(id);
  const pendingRelative = pendingRelativeFor(id);
  const holds = (file) => (directory) => file === directory || file.startsWith(`${directory}/`);
  const holdsReceipt = holds(receiptRelative);
  const holdsPending = holds(pendingRelative);
  const deepestFirst = (list) => [...list].sort((left, right) => right.split('/').length - left.split('/').length || right.localeCompare(left));
  const hubDirectories = createdDirectories.hub;
  if (roots.repo) {
    for (const directory of deepestFirst(createdDirectories.repo)) await run(() => removeEmptyDirectory(roots.repo, directory));
  }
  for (const directory of deepestFirst(hubDirectories.filter((item) => !holdsReceipt(item) && !holdsPending(item)))) {
    await run(() => removeEmptyDirectory(roots.hub, directory));
  }
  if (refused.length > 0) {
    const error = new InstallPlanError('ROLLBACK_FAILED', '');
    error.refused = refused;
    throw error;
  }
  // The receipt goes first and the pending record LAST: until the pending record is gone the
  // plan answers INTERRUPTED_CONNECT, so there is never a moment where the connection record
  // is gone, a live receipt is left, and a new connect is allowed. Either survivor lets the
  // same call finish the job.
  await run(() => S.removeRegularFile(absoluteFor(roots.hub, receiptRelative), roots.hub, 'Transaction receipt'));
  for (const directory of deepestFirst(hubDirectories.filter(holdsReceipt))) {
    await run(() => removeEmptyDirectory(roots.hub, directory));
  }
  await run(async () => {
    await S.removeRegularFile(absoluteFor(roots.hub, pendingRelative), roots.hub, 'Pending connect record');
    await fsyncDirectory(path.dirname(absoluteFor(roots.hub, pendingRelative)));
  });
  await run(() => removeEmptyDirectory(roots.hub, PENDING_DIRECTORY));
  for (const directory of deepestFirst(hubDirectories.filter((item) => holdsPending(item) && !holdsReceipt(item) && item !== PENDING_DIRECTORY))) {
    await run(() => removeEmptyDirectory(roots.hub, directory));
  }
}

async function enumerateLeftovers({ roots, writes, id, createdDirectories, indexRow = null, registration = null }) {
  const left = { hub: new Set(), repo: new Set() };
  const exists = async (filePath) => {
    try {
      return (await lstatOrNull(filePath)) !== null;
    } catch {
      return true;
    }
  };
  for (const write of writes) {
    if (roots[write.root] && await exists(absoluteFor(roots[write.root], write.destination))) left[write.root].add(write.destination);
  }
  if (indexRow) {
    try {
      const bytes = await S.readRegularFile(absoluteFor(roots.hub, indexRow.destination), 'Project index');
      if (indexRowState(bytes, indexRow.row).state !== 'absent') left.hub.add(`${indexRow.destination} (its row for this connection)`);
    } catch {
      left.hub.add(indexRow.destination);
    }
  }
  if (registration && roots.repo) {
    for (const [part, observe, what] of [['settings', observeSettingsUndo, 'its edit guard entry'], ['exclude', observeExcludeUndo, 'its line for this connection']]) {
      if (!registration[part]) continue;
      try {
        if ((await observe(roots.repo, registration[part], () => settingsPreimage(roots.hub, id))).state !== 'absent') left.repo.add(`${registration[part].destination} (${what})`);
      } catch {
        left.repo.add(registration[part].destination);
      }
    }
  }
  try {
    if ((await readConnectionsFile(roots.hub)).state.connections[id]) left.hub.add(CONNECTIONS_RELATIVE_PATH);
  } catch {
    left.hub.add(CONNECTIONS_RELATIVE_PATH);
  }
  for (const relative of [backupRelativeFor(id), settingsBackupRelativeFor(id), receiptRelativeFor(id), pendingRelativeFor(id)]) {
    if (await exists(absoluteFor(roots.hub, relative))) left.hub.add(relative);
  }
  const temps = ownedTemps(writes, id, indexRow, registration);
  for (const root of ['hub', 'repo']) {
    if (!roots[root]) continue;
    for (const relative of temps[root]) {
      if (await exists(absoluteFor(roots[root], relative))) left[root].add(relative);
    }
  }
  for (const root of ['hub', 'repo']) {
    if (!roots[root]) continue;
    for (const directory of createdDirectories[root]) {
      if (await exists(absoluteFor(roots[root], directory))) left[root].add(`${directory}/`);
    }
  }
  return { hub: [...left.hub].sort(), repo: [...left.repo].sort() };
}

function rollbackFailure(cause, leftovers, prefix, id) {
  const list = (items) => (items.length > 0 ? items.join(', ') : 'none');
  const error = new InstallPlanError(
    'ROLLBACK_FAILED',
    `${prefix} Left behind in the hub: ${list(leftovers.hub)}. Left behind in the repo: ${list(leftovers.repo)}. `
    + `Cause: ${cause instanceof Error ? cause.message : String(cause)} `
    + `Retry the recovery: rollbackReceipt({ targetPath: <workspace>, receiptId: '${id}' }). Until it completes, connect for this repository is refused with INTERRUPTED_CONNECT.`,
  );
  error.leftovers = leftovers;
  return error;
}

/** Runs the undo engine; every failure other than a strict refusal becomes ROLLBACK_FAILED with enumerated paths. */
async function undoOrExplain(input, prefix) {
  try {
    await undoConnect(input);
  } catch (error) {
    if (error instanceof InstallPlanError && error.refused) {
      const failure = new InstallPlanError('ROLLBACK_FAILED', `${prefix} These files no longer hold the bytes the transaction wrote, so they were left untouched: ${error.refused.join(', ')}. Restore or remove them yourself, then retry rollbackReceipt({ targetPath: <workspace>, receiptId: '${input.id}' }).`);
      failure.leftovers = {
        hub: error.refused.filter((item) => item.startsWith('hub: ')).map((item) => item.slice(5)),
        repo: error.refused.filter((item) => item.startsWith('repo: ')).map((item) => item.slice(6)),
      };
      throw failure;
    }
    if (input.strict && error.beforeRemoval) throw error;
    const leftovers = await enumerateLeftovers({ roots: input.roots, writes: input.writes, id: input.id, createdDirectories: input.createdDirectories, indexRow: input.indexRow ?? null, registration: input.registration ?? null });
    throw rollbackFailure(error, leftovers, prefix, input.id);
  }
}

export async function applyConnect({
  manifest, manifestBytes, sourceRoot, targetPath, repoPath, name, approvedDigest,
  injectFailureAfterWrite = null, injectBeforeWrite = null, injectFailureAfterRollbackWrite = null, injectLinkFailure = null, injectBetweenTempAndLink = null,
}) {
  const plan = await planConnect({ manifest, manifestBytes, sourceRoot, targetPath, repoPath, name });
  assertApplyableConnectPlan(plan, approvedDigest);
  // Residue is swept only after the exact digest is accepted: planning never writes (R05-23).
  await tidyConnectResidue({ hubReal: plan.hub });
  const payloads = PLAN_PAYLOADS.get(plan);
  const roots = { hub: plan.hub, repo: plan.repo };
  const id = S.receiptId();
  const receiptRelative = receiptRelativeFor(id);
  const pendingRelative = pendingRelativeFor(id);
  const writes = [];
  const registered = new Set();
  const created = { hub: new Set(), repo: new Set() };
  const extraHubDirectories = [];
  let pendingRecord = null;
  let receiptWritten = false;
  let position = 0;
  const failAfter = async () => {
    position += 1;
    if (injectFailureAfterWrite === position) fail('INJECTED_WRITE_FAILURE', `Injected write failure after position ${position}.`);
  };
  const before = async (root, destination, kind) => {
    if (injectBeforeWrite) await injectBeforeWrite({ root, destination, kind, position: position + 1 });
  };
  const plannedWrites = plan.entries.filter((entry) => entry.kind === 'file' && entry.status === 'CREATE')
    .map((entry) => ({ root: entry.root, destination: entry.destination, postimageSha256: entry.intendedSha256 }));
  const expectedRecord = { name: plan.name, repo: plan.repo, hub: plan.hub, planDigest: plan.digest, detection: plan.detection.status };
  const connectionsPreimage = plan.connectionsPreimage;
  const between = (root, destination, kind) => (injectBetweenTempAndLink ? () => injectBetweenTempAndLink({ root, destination, kind }) : null);
  const plannedDirectories = {
    hub: plan.directories.filter((item) => item.root === 'hub' && item.status === 'CREATE').map((item) => item.destination),
    repo: plan.directories.filter((item) => item.root === 'repo' && item.status === 'CREATE').map((item) => item.destination),
  };
  const createdLists = () => ({
    hub: [...new Set([...relativeList(roots.hub, created.hub), ...plannedDirectories.hub, ...extraHubDirectories])].sort(),
    repo: [...new Set([...relativeList(roots.repo, created.repo), ...plannedDirectories.repo])].sort(),
  });

  try {
    const backupFolders = [`.second-brain/backups/${id}/.second-brain`, ...(plan.registration?.settings && !plan.registration.settings.created ? [`.second-brain/backups/${id}/repo`, `.second-brain/backups/${id}/repo/.claude`] : [])];
    for (const candidate of [PENDING_DIRECTORY, S.RECEIPTS_RELATIVE_DIRECTORY, '.second-brain/backups', `.second-brain/backups/${id}`, ...backupFolders]) {
      if (!(await lstatOrNull(absoluteFor(roots.hub, candidate)))) extraHubDirectories.push(candidate);
    }
    // Write-ahead intent: durable BEFORE the first repository write, so a hard kill can
    // never leave repository files that nothing in the workspace accounts for.
    const pending = {
      schemaVersion: 1,
      pendingId: id,
      operation: 'connect-pending',
      phase: 'apply',
      planDigest: plan.digest,
      hub: plan.hub,
      repo: plan.repo,
      name: plan.name,
      directories: createdLists(),
      writes: plannedWrites.map((item) => ({ root: item.root, destination: item.destination, intendedSha256: item.postimageSha256 })),
      connectionsPreimage,
      indexRow: plan.indexRow,
      registration: plan.registration,
    };
    pendingRecord = pending;
    await before('hub', pendingRelative, 'pending');
    await createExclusive(absoluteFor(roots.hub, pendingRelative), Buffer.from(`${stableStringify(pending)}\n`), roots.hub, 'Pending connect record', created.hub, { ownerId: id, durable: true, between: between('hub', pendingRelative, 'pending') });
    await failAfter();

    const createFile = async (entry) => {
      await before(entry.root, entry.destination, 'file');
      const bytes = payloads.get(writeKey(entry));
      if (!bytes || sha256(bytes) !== entry.intendedSha256) fail('CONCURRENT_MODIFICATION', `Planned bytes changed before apply: ${entry.destination}`);
      const label = `${entry.root === 'repo' ? 'Repository' : 'Workspace'} destination ${entry.destination}`;
      // A staged file gets its manifest mode (less the umask), so loop.sh and the hook script are executable.
      const mode = entry.mode ? Number.parseInt(entry.mode, 8) : 0o666;
      await createExclusive(absoluteFor(roots[entry.root], entry.destination), bytes, roots[entry.root], label, created[entry.root], { ownerId: id, linkFailureCode: injectLinkFailure, between: between(entry.root, entry.destination, 'file'), mode });
      writes.push({ root: entry.root, destination: entry.destination, preimageSha256: null, postimageSha256: entry.intendedSha256, backupPath: null });
      await failAfter();
    };
    // The registration, after the staged files as in the harness installer: the settings entry, then the exclude line.
    const writeRegistration = async () => {
      for (const [part, kind] of REGISTRATION_PARTS) {
        const record = plan.registration?.[part];
        if (!record) continue;
        await before('repo', record.destination, kind);
        const bytes = payloads.get(`${kind}:${record.destination}`);
        if (!bytes || sha256(bytes) !== record.intendedSha256) fail('CONCURRENT_MODIFICATION', `Planned bytes changed before apply: ${record.destination}`);
        const look = await lookAt(roots.repo, record.destination);
        const preimage = look.kind === 'file' ? await readFile(look.full) : null;
        const current = preimage !== null ? sha256(preimage) : look.kind === 'absent' ? null : look.kind;
        if (current !== plan.entries.find((entry) => entry.kind === kind).currentSha256) fail('CONCURRENT_MODIFICATION', `Destination changed after plan approval: repo: ${record.destination}`);
        const label = `Repository destination ${record.destination}`;
        if (part === 'settings') {
          // The entry is written only while the staged hook is still the shipped edit guard the plan approved.
          const hook = await inspectFile(roots.repo, HOOK_SCRIPT, `Repository destination ${HOOK_SCRIPT}`);
          const shipped = plan.entries.find((entry) => entry.root === 'repo' && entry.destination === HOOK_SCRIPT).intendedSha256;
          if (hook.kind !== 'file' || hook.sha256 !== shipped) fail('CONCURRENT_MODIFICATION', `${HOOK_SCRIPT} is no longer the shipped edit guard; the edit guard was not registered.`);
          if (!record.created) {
            // The file as it was, kept durably in the workspace before it is replaced, so that the undo of a failed or
            // interrupted apply gives it back byte for byte. It lives only while connect runs (see the end of the apply).
            const settingsBackup = settingsBackupRelativeFor(id);
            await createExclusive(absoluteFor(roots.hub, settingsBackup), preimage, roots.hub, 'Transaction backup', created.hub, { ownerId: id, durable: true, between: between('hub', settingsBackup, 'backup') });
          }
        }
        if (record.created) {
          await createExclusive(look.full, bytes, roots.repo, label, created.repo, { ownerId: id, between: between('repo', record.destination, kind), mode: 0o644 });
        } else {
          // The replacement gets the old mode back, whatever the umask. (The registrar sets it back only when it was not
          // 0644, so under a strict umask it leaves a narrower mode; connect keeps the mode the person chose.) The
          // registrar appends to the exclude file in place, so that file keeps its mode too.
          await writeOwned(look.full, bytes, roots.repo, label, created.repo, id, between('repo', record.destination, kind), { mode: 0o644, keepMode: look.stat.mode & 0o7777 });
        }
        registered.add(part);
        await failAfter();
      }
    };
    for (const root of ['repo', 'hub']) {
      for (const directory of plan.directories.filter((item) => item.root === root && item.status === 'CREATE')) {
        await before(root, directory.destination, 'directory');
        await createDirectory(roots[root], directory.destination, `${root} directory`, created[root]);
        await failAfter();
      }
      for (const entry of plan.entries.filter((item) => item.root === root && item.kind === 'file' && item.status === 'CREATE')) await createFile(entry);
      if (root === 'repo') await writeRegistration();
    }

    for (const entry of plan.entries) {
      if (entry.kind !== 'file' || entry.status !== 'CREATE') continue;
      const current = await inspectFile(roots[entry.root], entry.destination, `Concurrent destination ${entry.destination}`);
      if (current.kind !== 'file' || current.sha256 !== entry.intendedSha256) {
        fail('CONCURRENT_MODIFICATION', `Destination changed while the transaction was applying: ${entry.root}: ${entry.destination}`);
      }
    }
    for (const record of [plan.registration?.settings, plan.registration?.exclude]) {
      if (!record) continue;
      const current = await inspectFile(roots.repo, record.destination, `Concurrent destination ${record.destination}`);
      if (current.kind !== 'file' || current.sha256 !== record.intendedSha256) fail('CONCURRENT_MODIFICATION', `Destination changed while the transaction was applying: repo: ${record.destination}`);
    }

    if (plan.indexRow) {
      const indexEntry = plan.entries.find((entry) => entry.kind === 'index');
      const indexPath = absoluteFor(roots.hub, INDEX_RELATIVE_PATH);
      await before('hub', INDEX_RELATIVE_PATH, 'index');
      const bytes = payloads.get(`index:${INDEX_RELATIVE_PATH}`);
      if (!bytes || sha256(bytes) !== plan.indexRow.intendedSha256) fail('CONCURRENT_MODIFICATION', 'Planned project index bytes changed before apply.');
      await S.assertNoSymlinkAncestors(indexPath, 'Project index', roots.hub);
      const current = await S.readRegularFile(indexPath, 'Project index');
      if ((current === null ? null : sha256(current)) !== indexEntry.currentSha256) fail('CONCURRENT_MODIFICATION', `Destination changed after plan approval: ${INDEX_RELATIVE_PATH}`);
      if (plan.indexRow.created) {
        await createExclusive(indexPath, bytes, roots.hub, 'Project index', created.hub, { ownerId: id, between: between('hub', INDEX_RELATIVE_PATH, 'index') });
      } else {
        await writeOwned(indexPath, bytes, roots.hub, 'Project index', created.hub, id, between('hub', INDEX_RELATIVE_PATH, 'index'));
      }
      await failAfter();
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
    let connectionsBackup = null;
    if (connections.bytes !== null) {
      connectionsBackup = backupRelativeFor(id);
      await createExclusive(absoluteFor(roots.hub, connectionsBackup), connections.bytes, roots.hub, 'Transaction backup', created.hub, { ownerId: id, between: between('hub', connectionsBackup, 'backup') });
    }
    await before('hub', CONNECTIONS_RELATIVE_PATH, 'state');
    await writeOwned(connections.filePath, nextConnections, roots.hub, 'Connections state', created.hub, id, between('hub', CONNECTIONS_RELATIVE_PATH, 'state'));
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
      connectionsPreimage,
      writes,
      createdDirectories: createdLists(),
      indexRow: plan.indexRow,
      registration: plan.registration,
    };
    await before('hub', receiptRelative, 'receipt');
    await createExclusive(S.receiptPathFor(roots.hub, id), Buffer.from(`${stableStringify(receipt)}\n`), roots.hub, 'Transaction receipt', created.hub, { ownerId: id, durable: true, between: between('hub', receiptRelative, 'receipt') });
    receiptWritten = true;
    await failAfter();

    // The pending record is removed only now that the receipt is durable: the record and
    // the receipt overlap, so there is no instant at which neither accounts for the writes.
    await before('hub', pendingRelative, 'pending-clear');
    await S.removeRegularFile(absoluteFor(roots.hub, pendingRelative), roots.hub, 'Pending connect record');
    await fsyncDirectory(path.dirname(absoluteFor(roots.hub, pendingRelative)));
    await removeEmptyDirectory(roots.hub, PENDING_DIRECTORY);
    await failAfter();

    // The connect has finished, so the copy of the settings file goes now, with the folders made for it: no second
    // copy of a file that can hold local secrets stays in the workspace, and a receipt rollback takes out only the
    // entry. Until this line every failure is undone with the copy. A stop right here leaves a finished connect and its
    // copy with no pending record: verify lists the copy, and the next approved connect, rollback or recovery deletes it.
    if (plan.registration?.settings && !plan.registration.settings.created) {
      await before('hub', settingsBackupRelativeFor(id), 'backup-clear');
      await removeSettingsCopy(roots.hub, id);
      if (extraHubDirectories.includes('.second-brain/backups')) await removeEmptyDirectory(roots.hub, '.second-brain/backups');
    }
    return { plan, receiptId: id, connectionId: id, receiptPath: receiptRelative, applied: true, durableWrites: position };
  } catch (error) {
    const prefix = `Connect failed (${error instanceof Error ? error.message : String(error)}) and rollback could not complete.`;
    if (pendingRecord) {
      // The run is being undone: say so durably first, so no undo ever runs without a durable intent.
      // The record is re-created when the failure came after the pending clear (R05-18), and written
      // whether or not the receipt exists (R05-25), so the plan stays refused until the undo ends.
      try {
        await writeOwned(absoluteFor(roots.hub, pendingRelative), Buffer.from(`${stableStringify({ ...pendingRecord, phase: 'rollback' })}\n`), roots.hub, 'Pending connect record', null, id);
      } catch (markError) {
        const leftovers = await enumerateLeftovers({ roots, writes: plannedWrites, id, createdDirectories: createdLists(), indexRow: plan.indexRow, registration: plan.registration });
        throw rollbackFailure(markError, leftovers, prefix, id);
      }
    }
    await undoOrExplain({
      roots, id, writes: plannedWrites, owned: new Set(writes.map(writeKey)), expectedRecord, connectionsPreimage,
      createdDirectories: createdLists(), strict: false, injectAfterStep: injectFailureAfterRollbackWrite, indexRow: plan.indexRow,
      registration: plan.registration, ownedRegistration: registered,
    }, prefix);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rollback of a connect receipt, and recovery of an interrupted connect
// ---------------------------------------------------------------------------

const RECEIPT_KEYS = ['schemaVersion', 'receiptId', 'operation', 'planDigest', 'hub', 'repo', 'name', 'detection', 'harness', 'templateManifestSha256', 'connectionsPreimage', 'writes', 'createdDirectories'];
// v1.4.0 receipts also carry indexRow; v1.3.0 receipts do not, and still roll back.
const RECEIPT_KEYS_WITH_INDEX = [...RECEIPT_KEYS, 'indexRow'];
// v1.11.0 receipts also carry registration (null when connect wrote none); older receipts do not, and still roll back.
const RECEIPT_KEYS_WITH_REGISTRATION = [...RECEIPT_KEYS_WITH_INDEX, 'registration'];
const WRITE_KEYS = ['root', 'destination', 'preimageSha256', 'postimageSha256', 'backupPath'];

function validateConnectReceipt(receipt, id, hub) {
  const invalid = (message) => fail('INVALID_RECEIPT', message);
  if (!isPlainObject(receipt) || ![RECEIPT_KEYS, RECEIPT_KEYS_WITH_INDEX, RECEIPT_KEYS_WITH_REGISTRATION].some((keys) => hasExactKeys(receipt, keys)) || receipt.schemaVersion !== 1 || receipt.receiptId !== id
    || !S.TRANSACTION_ID_PATTERN.test(id) || receipt.operation !== 'connect') invalid('Connect receipt has an unsupported shape.');
  if (!S.SHA256_PATTERN.test(receipt.planDigest ?? '') || !S.SHA256_PATTERN.test(receipt.templateManifestSha256 ?? '')
    || !DETECTION_STATUSES.includes(receipt.detection) || typeof receipt.name !== 'string'
    || typeof receipt.repo !== 'string' || !path.isAbsolute(receipt.repo) || typeof receipt.hub !== 'string') invalid('Connect receipt has an unsupported shape.');
  if (!samePath(receipt.hub, hub)) invalid('Connect receipt belongs to a different workspace path: the workspace path changed since the connect, or this receipt was copied from another workspace. Move the workspace back, or recover from the original location.');
  if (!isPlainObject(receipt.harness) || !hasExactKeys(receipt.harness, ['commit', 'manifestSha256', 'harnessVersion'])
    || !COMMIT_PATTERN.test(receipt.harness.commit ?? '') || !S.SHA256_PATTERN.test(receipt.harness.manifestSha256 ?? '')
    || typeof receipt.harness.harnessVersion !== 'string') invalid('Connect receipt harness identity is malformed.');
  try {
    validateRelativePath(receipt.name, 'Receipt name');
  } catch {
    invalid('Connect receipt name is not a portable segment.');
  }
  if (!CONNECTIONS_PREIMAGES.includes(receipt.connectionsPreimage)) invalid('Connect receipt connectionsPreimage is malformed.');
  validateIndexRow(receipt.indexRow ?? null, invalid);
  validateRegistration(receipt.registration ?? null, () => invalid('Connect receipt registration is malformed.'));
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
  if (receipt.detection !== 'NONE' && (byRoot.repo.length > 0 || (receipt.registration ?? null) !== null)) invalid('A register-only connection must not own repository writes.');
  S.assertUniqueDestinations(byRoot.hub);
  S.assertUniqueDestinations(byRoot.repo);
  if (!isPlainObject(receipt.createdDirectories) || !hasExactKeys(receipt.createdDirectories, ['hub', 'repo'])) invalid('Connect receipt createdDirectories is malformed.');
  for (const root of ['hub', 'repo']) {
    const list = receipt.createdDirectories[root];
    if (!Array.isArray(list) || new Set(list).size !== list.length) invalid('Connect receipt createdDirectories is malformed.');
    for (const directory of list) validateRelativePath(directory, 'Receipt created directory');
  }
}

async function assertNoNewerClaim(hub, receipt, connections) {
  const conflicts = new Set();
  for (const record of Object.values(connections.state.connections)) {
    if (record.connectionId !== receipt.receiptId && samePath(record.repo, receipt.repo)) conflicts.add(record.connectionId);
  }
  const directory = path.join(hub, ...S.RECEIPTS_RELATIVE_DIRECTORY.split('/'));
  if ((await lstatOrNull(directory))?.isDirectory()) {
    for (const name of await readdir(directory)) {
      const match = name.match(/^(tx-[0-9a-f-]{36})\.json$/);
      if (!match || match[1] === receipt.receiptId) continue;
      let other = null;
      try {
        other = JSON.parse((await S.readRegularFile(path.join(directory, name), 'Receipt'))?.toString('utf8') ?? 'null');
      } catch {
        continue;
      }
      if (!isPlainObject(other) || other.operation !== 'connect' || !Array.isArray(other.writes)) continue;
      // An overlap is the same file in both receipts for the same repository. connections.json is shared bookkeeping that every
      // connect writes, so it never counts as an overlap (R08-1); a repository file or a project file does.
      const sameRepository = typeof other.repo === 'string' && samePath(other.repo, receipt.repo);
      const claims = other.writes.some((theirs) => receipt.writes.some((mine) => mine.root === theirs.root && mine.destination === theirs.destination
        && mine.destination !== CONNECTIONS_RELATIVE_PATH && sameRepository));
      if (claims) conflicts.add(match[1]);
    }
  }
  if (conflicts.size > 0) {
    fail('RECEIPT_SUPERSEDED', `Rollback refused: this receipt's connection record is gone and ${[...conflicts].join(', ')} now claims the same files. Removing them could delete the newer connection's files. Nothing was changed.`);
  }
}

function pendingFromReceipt(receipt, id) {
  const connectionsWrite = receipt.writes.find((write) => write.root === 'hub' && write.destination === CONNECTIONS_RELATIVE_PATH);
  return {
    schemaVersion: 1,
    pendingId: id,
    operation: 'connect-pending',
    phase: 'rollback',
    planDigest: receipt.planDigest,
    hub: receipt.hub,
    repo: receipt.repo,
    name: receipt.name,
    directories: receipt.createdDirectories,
    writes: receipt.writes.filter((write) => write !== connectionsWrite).map((write) => ({ root: write.root, destination: write.destination, intendedSha256: write.postimageSha256 })),
    connectionsPreimage: receipt.connectionsPreimage,
    indexRow: receipt.indexRow ?? null,
    registration: receipt.registration ?? null,
  };
}

export async function rollbackConnectReceipt({ target, receipt, receiptId: id, injectFailureAfterRollbackWrite = null, onRollbackStep = null }) {
  await tidyConnectResidue({ hubReal: target });
  validateConnectReceipt(receipt, id, target);
  const roots = { hub: target, repo: null };
  if (receipt.writes.some((write) => write.root === 'repo') || receipt.createdDirectories.repo.length > 0 || (receipt.registration ?? null) !== null) {
    const repoReal = await resolveRepo({ repoPath: receipt.repo, hubReal: target, sourceRoot: S.INSTALLER_ROOT });
    if (!samePath(repoReal, receipt.repo)) fail('INVALID_RECEIPT', 'Connect receipt repository path no longer resolves to itself.');
    roots.repo = repoReal;
  }
  const connectionsWrite = receipt.writes.find((write) => write.root === 'hub' && write.destination === CONNECTIONS_RELATIVE_PATH);
  const base = {
    roots,
    id,
    writes: receipt.writes.filter((write) => write !== connectionsWrite).map((write) => ({ root: write.root, destination: write.destination, postimageSha256: write.postimageSha256 })),
    owned: null,
    expectedRecord: { name: receipt.name, repo: receipt.repo, hub: receipt.hub, planDigest: receipt.planDigest, detection: receipt.detection },
    connectionsPreimage: receipt.connectionsPreimage,
    createdDirectories: receipt.createdDirectories,
    indexRow: receipt.indexRow ?? null,
    registration: receipt.registration ?? null,
  };
  // 1. Strict check of every file and the record: refuses before anything is touched.
  await undoOrExplain({ ...base, strict: true, checkOnly: true }, 'Rollback could not complete.');
  // 2. A receipt whose record is gone must not remove files a newer connection claims.
  const connections = await readConnectionsFile(target);
  if (!connections.state.connections[id]) await assertNoNewerClaim(target, receipt, connections);
  // 3. Durable rollback intent (same id, phase rollback): from here on the plan answers
  //    INTERRUPTED_CONNECT and re-running this call finishes the job.
  await createExclusive(absoluteFor(target, pendingRelativeFor(id)), Buffer.from(`${stableStringify(pendingFromReceipt(receipt, id))}\n`), target, 'Pending connect record', null, { ownerId: id, durable: true });
  if (onRollbackStep) await onRollbackStep({ step: 0 });
  await undoOrExplain({ ...base, strict: false, injectAfterStep: injectFailureAfterRollbackWrite, onStep: onRollbackStep }, 'Rollback could not complete.');
  return { receiptId: id, rolledBackPaths: receipt.writes.map((write) => `${write.root}:${write.destination}`) };
}

/** True when the pending record is the leftover of a connect that DID commit (receipt + matching record). */
async function connectCommitted(hub, pending) {
  if (pending.phase !== 'apply') return false;
  try {
    const bytes = await S.readRegularFile(S.receiptPathFor(hub, pending.pendingId), 'Transaction receipt');
    if (bytes === null) return false;
    const receipt = JSON.parse(bytes.toString('utf8'));
    validateConnectReceipt(receipt, pending.pendingId, hub);
    if (receipt.planDigest !== pending.planDigest) return false;
    const record = (await readConnectionsFile(hub)).state.connections[pending.pendingId];
    if (!record || !recordMatches(record, { name: receipt.name, repo: receipt.repo, hub: receipt.hub, planDigest: receipt.planDigest, detection: receipt.detection })) return false;
    // Every file the receipt records must still exist. A missing file means the connect is not complete,
    // so it takes the undo path (R05-20). A file that exists with other bytes was edited after the connect
    // finished: the connect is still complete (receipt and record exist), so recovery clears the pending
    // record, leaves the edit alone, and the receipt's later rollback refuses the edited file by name (R05-24).
    // The connections state is checked through its record above: it changes legitimately when another connect lands.
    for (const write of receipt.writes) {
      if (write.root === 'hub' && write.destination === CONNECTIONS_RELATIVE_PATH) continue;
      const bytes = await S.readRegularFile(absoluteFor(write.root === 'repo' ? receipt.repo : hub, write.destination), 'Committed file');
      if (bytes === null) return false;
    }
    return true;
  } catch (error) {
    if (error instanceof InstallPlanError || error instanceof SyntaxError) return false;
    throw error;
  }
}

// Residue the engine can leave in the workspace's own namespace, removed by exact name only:
//  (a) an unlinked pending temp: a kill inside the very first write, no pending record and no receipt for its id;
//  (b) a receipt temp: its receipt was linked, no pending record exists for its id, and the temp was not removed;
//  (c) the connect-pending folder itself, once it is empty.
// The id is matched twice by a backreference, so a loose glob or a foreign name never matches.
// The repository is never touched here, and a live pending record protects its own temp.
// The derived temp of a state file the engine writes directly under .second-brain/ (exactly these two names),
// named with its transaction id. The id is group 1. bin/second-brain.mjs imports this same pattern.
export const STATE_TEMP_PATTERN = /^\.(?:connections\.json|installed-state\.json)\.second-brain-(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.tmp$/;
const DERIVED_TEMP_PATTERN = /^\.(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json\.second-brain-\1\.tmp$/;

async function tidyConnectResidue({ hubReal }) {
  const pendingDirectory = path.join(hubReal, ...PENDING_DIRECTORY.split('/'));
  const receiptDirectory = path.join(hubReal, ...S.RECEIPTS_RELATIVE_DIRECTORY.split('/'));
  await S.assertNoSymlinkAncestors(pendingDirectory, 'Pending connect namespace', hubReal);
  await S.assertNoSymlinkAncestors(receiptDirectory, 'Receipt namespace', hubReal);
  const pendingIsDirectory = (await lstatOrNull(pendingDirectory))?.isDirectory() === true;
  const receiptIsDirectory = (await lstatOrNull(receiptDirectory))?.isDirectory() === true;
  const pendingNames = pendingIsDirectory ? await readdir(pendingDirectory) : [];
  const receiptNames = receiptIsDirectory ? await readdir(receiptDirectory) : [];
  for (const name of pendingNames) {
    const match = name.match(DERIVED_TEMP_PATTERN);
    if (!match) continue;
    const id = match[1];
    if (pendingNames.includes(`${id}.json`) || receiptNames.includes(`${id}.json`)) continue;
    await removeOwnedTemp(hubReal, `${PENDING_DIRECTORY}/${name}`);
  }
  for (const name of receiptNames) {
    const match = name.match(DERIVED_TEMP_PATTERN);
    if (!match) continue;
    const id = match[1];
    if (!receiptNames.includes(`${id}.json`) || pendingNames.includes(`${id}.json`)) continue;
    await removeOwnedTemp(hubReal, `${S.RECEIPTS_RELATIVE_DIRECTORY}/${name}`);
  }
  // T06-8: a derived temp of a state file, directly under .second-brain/, is removed by an approved operation
  // when no live pending record exists for its id. The id must match the strict transaction-id pattern.
  const stateDirectory = path.join(hubReal, '.second-brain');
  if ((await lstatOrNull(stateDirectory))?.isDirectory() === true) {
    for (const name of await readdir(stateDirectory)) {
      const match = name.match(STATE_TEMP_PATTERN);
      if (!match || pendingNames.includes(`${match[1]}.json`)) continue;
      await removeOwnedTemp(hubReal, `.second-brain/${name}`);
    }
  }
  // (d) the copy of a repository's settings file that a connect keeps while it runs, when no pending record exists for
  // its id: that connect finished and was stopped before it deleted the copy. A live pending record still needs its copy.
  const backupsDirectory = path.join(hubReal, '.second-brain', 'backups');
  await S.assertNoSymlinkAncestors(backupsDirectory, 'Backup namespace', hubReal);
  if ((await lstatOrNull(backupsDirectory))?.isDirectory() === true) {
    for (const name of (await readdir(backupsDirectory)).sort()) {
      if (S.TRANSACTION_ID_PATTERN.test(name) && !pendingNames.includes(`${name}.json`)) await removeSettingsCopy(hubReal, name);
    }
  }
  if (pendingIsDirectory && (await readdir(pendingDirectory)).length === 0) await removeEmptyDirectory(hubReal, PENDING_DIRECTORY);
}

// Deletes the copy of a settings file a connect kept while it ran, its temporary file, and the folders that held only
// them, the receipt's own backup folder included when nothing else is in it. Exact names only; a link fails closed.
async function removeSettingsCopy(hubReal, id) {
  const holder = `.second-brain/backups/${id}/repo`;
  if (!(await lstatOrNull(absoluteFor(hubReal, holder)))) return;
  await S.removeRegularFile(absoluteFor(hubReal, settingsBackupRelativeFor(id)), hubReal, 'Transaction backup');
  await removeOwnedTemp(hubReal, tempRelativeFor(settingsBackupRelativeFor(id), id));
  for (const folder of [`${holder}/.claude`, holder, `.second-brain/backups/${id}`]) await removeEmptyDirectory(hubReal, folder);
}

/** Removes an empty pending folder left by an interrupted cleanup; null when there is nothing of the kind. */
export async function tidyPendingDirectory({ target, pendingId }) {
  const directory = path.join(target, ...PENDING_DIRECTORY.split('/'));
  await S.assertNoSymlinkAncestors(directory, 'Pending connect namespace', target);
  const stat = await lstatOrNull(directory);
  if (!stat?.isDirectory()) return null;
  const ownTemp = path.posix.basename(tempRelativeFor(pendingRelativeFor(pendingId), pendingId));
  if ((await readdir(directory)).some((name) => name !== ownTemp)) return null;
  await removeOwnedTemp(target, tempRelativeFor(pendingRelativeFor(pendingId), pendingId));
  await removeEmptyDirectory(target, PENDING_DIRECTORY);
  return { pendingId, recovered: false, completed: false, nothingToRecover: true };
}

/**
 * Recovers an interrupted connect (or an interrupted rollback) from its pending record.
 * Only files whose bytes equal what the transaction intended are removed; absent ones are
 * skipped; a file that differs is left alone and listed. A connect that had already
 * committed (receipt and matching record exist) only loses its pending record. Idempotent.
 */
export async function recoverPendingConnect({ targetPath, pendingId, injectFailureAfterRollbackWrite = null, onRollbackStep = null }) {
  const hub = await S.resolveTarget(targetPath, S.INSTALLER_ROOT);
  await S.assertTransactionNamespace(hub);
  await tidyConnectResidue({ hubReal: hub });
  if (!S.TRANSACTION_ID_PATTERN.test(pendingId ?? '')) fail('MISSING_RECEIPT', `Pending connect record does not exist: ${pendingId}`);
  const pending = await readPendingRecord(hub, pendingId);
  if (pending === null) {
    const tidy = await tidyPendingDirectory({ target: hub, pendingId });
    if (tidy) return tidy;
    fail('MISSING_RECEIPT', `No pending connect record exists for ${pendingId}. If you were recovering an interrupted connect, there is nothing left to recover.`);
  }
  if (!samePath(pending.hub, hub)) {
    fail('INVALID_PENDING_CONNECT', 'Pending connect record belongs to a different workspace path: the workspace path changed since the connect started.');
  }
  if (await connectCommitted(hub, pending)) {
    await removeOwnedTemp(hub, tempRelativeFor(pendingRelativeFor(pendingId), pendingId));
    await S.removeRegularFile(absoluteFor(hub, pendingRelativeFor(pendingId)), hub, 'Pending connect record');
    await fsyncDirectory(path.dirname(absoluteFor(hub, pendingRelativeFor(pendingId))));
    await removeEmptyDirectory(hub, PENDING_DIRECTORY);
    // The receipt is kept, so a receipt temp left by the interrupted link is the only thing to sweep here.
    await tidyConnectResidue({ hubReal: hub });
    return { pendingId, recovered: false, completed: true, nothingToRecover: false };
  }
  const roots = { hub, repo: null };
  try {
    const repoReal = await resolveRepo({ repoPath: pending.repo, hubReal: hub, sourceRoot: S.INSTALLER_ROOT });
    if (!samePath(repoReal, pending.repo)) fail('INVALID_PENDING_CONNECT', 'Pending connect repository path no longer resolves to itself.');
    roots.repo = repoReal;
  } catch (error) {
    // A repository that is gone holds none of the staged files; everything else still fails closed.
    if (!(error instanceof InstallPlanError && error.code === 'REPO_NOT_DIRECTORY')) throw error;
  }
  await undoOrExplain({
    roots,
    id: pendingId,
    writes: pending.writes.map((write) => ({ root: write.root, destination: write.destination, postimageSha256: write.intendedSha256 })),
    owned: null,
    expectedRecord: { name: pending.name, repo: pending.repo, hub: pending.hub, planDigest: pending.planDigest },
    connectionsPreimage: pending.connectionsPreimage,
    createdDirectories: pending.directories,
    indexRow: pending.indexRow ?? null,
    registration: pending.registration ?? null,
    strict: false,
    injectAfterStep: injectFailureAfterRollbackWrite,
    onStep: onRollbackStep,
  }, 'Recovery could not complete.');
  return { pendingId, recovered: true, completed: false, nothingToRecover: false };
}
