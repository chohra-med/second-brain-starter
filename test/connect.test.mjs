import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { InstallPlanError, applyInstall, planInstall, rollbackReceipt, verifyInstall } from '../lib/installer.mjs';
import {
  applyConnect,
  detectHarness,
  planConnect,
  readConnections,
  readHarnessManifest,
  renderHarnessEntry,
  listPendingConnects,
  validateConnectionName,
} from '../lib/connect.mjs';
import { sourceRoot as realSourceRoot } from './helpers/consumer-cli.mjs';

const run = promisify(execFile);
const STATE = '.second-brain/installed-state.json';
const CONNECTIONS = '.second-brain/connections.json';
const isPosix = process.platform !== 'win32';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (root, posixPath) => path.join(root, ...posixPath.split('/'));

// The expected-failure helper asserts OUTSIDE the catch: an action that resolves, or that
// throws something else, fails the test (see the falsification test below).
async function rejects(code, action, context = '') {
  let caught = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== null, `${context} expected ${code} but the action resolved`.trim());
  assert.ok(caught instanceof InstallPlanError, `${context} expected InstallPlanError ${code}, got ${caught}`.trim());
  assert.equal(caught.code, code, `${context} expected ${code}, got ${caught.code}: ${caught.message}`.trim());
  return caught;
}

async function treeInventory(root) {
  const result = {};
  async function visit(directory, relative = '') {
    for (const name of (await readdir(directory)).sort()) {
      const filePath = path.join(directory, name);
      const child = relative ? `${relative}/${name}` : name;
      const stat = await lstat(filePath);
      if (stat.isDirectory()) {
        result[child] = 'directory';
        await visit(filePath, child);
      } else if (stat.isFile()) result[child] = `file:${digestOf(await readFile(filePath))}`;
      else result[child] = stat.isSymbolicLink() ? 'symlink' : 'other';
    }
  }
  await visit(root);
  return result;
}

function changedPaths(before, after) {
  return Object.keys(after).filter((key) => before[key] !== after[key]).map((key) => (after[key] === 'directory' ? `${key}/` : key)).sort();
}

// Reference renderer written independently of the engine: line by line, function
// replacers (no $-pattern processing), trailing LF on every emitted line.
function referenceRender(harnessManifest, entry, sourceText, name) {
  if (entry.render === 'copy') return Buffer.from(sourceText, 'utf8');
  if (sourceText === '') return Buffer.alloc(0);
  const lines = sourceText.split('\n');
  if (sourceText.endsWith('\n')) lines.pop();
  const out = lines.map((line) => {
    let result = line;
    for (const token of entry.tokens) {
      const value = harnessManifest.substitutions.tokens[token].replaceAll(harnessManifest.substitutions.placeholder, () => name);
      result = result.replaceAll(token, () => value);
    }
    return `${result}\n`;
  });
  return Buffer.from(out.join(''), 'utf8');
}

const SYNTHETIC_HARNESS_FILES = (nonce) => [
  { source: 'templates/AGENTS.md', destination: 'AGENTS.md', render: 'template', tokens: ['{{PROJECT_NAME}}'], mode: '0644', text: `# {{PROJECT_NAME}} agents\nid ${nonce} {{PROJECT_NAME}} and {{PROJECT_NAME}}\nkeep {{OTHER}} untouched` },
  { source: 'templates/RULES.md', destination: 'RULES.md', render: 'template', tokens: ['{{DIR}}'], mode: '0644', text: `{{DIR}}\nrules ${nonce}\n` },
  { source: 'templates/install/SPEC-HARNESS.md', destination: 'SPEC-HARNESS.md', render: 'template', tokens: ['{{PROJECT_NAME}}'], mode: '0644', text: `status ${nonce} for {{PROJECT_NAME}} {{DIR}}\n` },
  { source: 'agents/sdd-planner.md', destination: '.claude/agents/sdd-planner.md', render: 'copy', tokens: [], mode: '0644', text: `planner ${nonce}\r\nsecond line` },
  { source: 'skills/core.md', destination: 'ai_rules/rules/core.md', render: 'copy', tokens: [], mode: '0644', text: `core rule ${nonce}\n` },
  { source: 'bin/loop.sh', destination: 'loop.sh', render: 'copy', tokens: [], mode: '0755', text: `#!/usr/bin/env bash\n# ${nonce}\n` },
];
const SYNTHETIC_DIRECTORIES = ['.claude/agents', 'ai_rules/rules', 'learning/lessons', 'specs'];
const PROJECT_FILES = ['README.md', 'FACTS.md', 'roadmap.md', 'Decisions.md', 'progress.md'];

async function put(root, relative, bytes) {
  await mkdir(path.dirname(rel(root, relative)), { recursive: true });
  await writeFile(rel(root, relative), bytes);
}

async function writeSyntheticHarness(w) {
  const files = SYNTHETIC_HARNESS_FILES(randomUUID());
  for (const file of files) await put(w.sourceRoot, `vendor/spec-harness/${file.source}`, file.text);
  w.harnessFiles = files;
  w.harnessManifest = {
    schemaVersion: 1,
    harnessVersion: '9.9.9',
    description: 'synthetic',
    substitutions: {
      placeholder: '{name}',
      projectName: { default: 'basename', mustBeNonEmpty: true, forbiddenCharacters: ['LF', 'CR', 'TAB', '/', '\\'], note: 'synthetic' },
      tokens: { '{{PROJECT_NAME}}': '{name}', '{{DIR}}': '{name} (repo root - base rules)' },
      rule: 'synthetic',
    },
    renders: { copy: 'copy', template: 'template' },
    modeNote: 'synthetic',
    directories: [...SYNTHETIC_DIRECTORIES],
    loaderBlock: '## Synthetic loader\n',
    entries: files.map((file) => ({ destination: file.destination, source: file.source, render: file.render, tokens: file.tokens, sha256: digestOf(file.text), mode: file.mode })),
  };
  await writeHarnessManifest(w);
  await put(w.sourceRoot, 'vendor/SPEC-HARNESS-PIN.json', JSON.stringify({ schemaVersion: 1, repository: 'https://example.invalid/harness', commit: 'a'.repeat(40), tree: 'b'.repeat(40), harnessVersion: '9.9.9' }));
}

async function writeHarnessManifest(w) {
  await put(w.sourceRoot, 'vendor/spec-harness/install-manifest.json', JSON.stringify(w.harnessManifest));
}

// A synthetic workspace: an installed hub (real applyInstall), a plain repo directory and a
// source root with a template manifest plus a synthetic harness. Everything is a mkdtemp path.
async function world(t, { harness = true } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const w = { root, sourceRoot: path.join(root, 'source'), hub: path.join(root, 'hub'), repo: path.join(root, 'my-repo') };
  await mkdir(w.hub);
  await mkdir(w.repo);
  const nonce = randomUUID();
  const entries = [];
  const templates = [
    ['Home.md', `# Home ${nonce}\n`],
    ['01-Projects/README.md', `# Projects ${nonce}\n`],
    ...PROJECT_FILES.map((file) => [`03-Resources/_templates/project/${file}`, `# project template ${file} ${nonce}\n`]),
  ];
  for (const [destination, text] of templates) {
    await put(w.sourceRoot, `template/${destination}`, text);
    entries.push({ source: `template/${destination}`, destination, sha256: digestOf(text), mergeKind: 'managed-file' });
  }
  w.manifest = { schemaVersion: 1, metadata: { templateVersion: '1.2.0' }, entries };
  w.manifestBytes = Buffer.from(JSON.stringify(w.manifest));
  if (harness) await writeSyntheticHarness(w);
  const plan = await planInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub });
  await applyInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub, approvedDigest: plan.digest });
  return w;
}

const args = (w, extra = {}) => ({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub, repoPath: w.repo, ...extra });
const connectNow = async (w, extra = {}) => {
  const plan = await planConnect(args(w, extra));
  return applyConnect({ ...args(w, extra), approvedDigest: plan.digest });
};
const snap = async (w) => ({ hub: await treeInventory(w.hub), repo: await treeInventory(w.repo) });

const PENDING_PATTERN = /^\.second-brain\/connect-pending\/(tx-[0-9a-f-]{36})\.json$/;
const pendingIdsIn = (inventory) => Object.keys(inventory).map((key) => key.match(PENDING_PATTERN)?.[1]).filter(Boolean);

// Real hard kills: a child node process runs the engine and kills ITSELF with SIGKILL from
// inside a hook (Windows has no POSIX signals; process.kill(pid, 'SIGKILL') terminates the
// process there too, and the child falls back to process.exit(137) if that throws).
const CONNECT_CHILD = `
import { readFileSync, writeSync } from 'node:fs';
const cfg = JSON.parse(process.env.SB_CFG);
const { applyConnect } = await import(cfg.module);
const manifestBytes = readFileSync(cfg.manifest);
let calls = 0;
await applyConnect({
  manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot: cfg.sourceRoot,
  targetPath: cfg.hub, repoPath: cfg.repo, name: cfg.name, approvedDigest: cfg.digest,
  injectBeforeWrite: async (info) => {
    calls += 1;
    if (calls !== cfg.kill) return;
    writeSync(1, 'KILLED ' + JSON.stringify({ root: info.root, destination: info.destination, kind: info.kind }) + '\\n');
    try { process.kill(process.pid, 'SIGKILL'); } catch { process.exit(137); }
    await new Promise(() => {});
  },
});
`;
const ROLLBACK_CHILD = `
import { writeSync } from 'node:fs';
const cfg = JSON.parse(process.env.SB_CFG);
const { rollbackReceipt } = await import(cfg.module);
await rollbackReceipt({
  targetPath: cfg.hub, receiptId: cfg.id,
  onRollbackStep: async ({ step }) => {
    if (step !== cfg.kill) return;
    writeSync(1, 'KILLED step ' + step + '\\n');
    try { process.kill(process.pid, 'SIGKILL'); } catch { process.exit(137); }
    await new Promise(() => {});
  },
});
`;

async function spawnChild(script, config) {
  try {
    const out = await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, SB_CFG: JSON.stringify(config) }, windowsHide: true });
    return { killed: false, stdout: out.stdout };
  } catch (error) {
    return { killed: true, signal: error.signal, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function manifestFile(w) {
  if (w.sourceRoot === realSourceRoot) return path.join(realSourceRoot, 'template-manifest.json');
  const file = path.join(w.root, 'manifest.json');
  await writeFile(file, w.manifestBytes);
  return file;
}

const connectModule = pathToFileURL(path.join(realSourceRoot, 'lib', 'connect.mjs')).href;
const installerModule = pathToFileURL(path.join(realSourceRoot, 'lib', 'installer.mjs')).href;

function assertKilled(child, label) {
  assert.ok(child.killed, `${label}: the child must have been killed (stderr: ${child.stderr ?? ''})`);
  assert.ok(child.stdout.includes('KILLED'), `${label}: the child died for another reason: ${child.stderr ?? ''}`);
  if (process.platform !== 'win32') assert.equal(child.signal, 'SIGKILL', `${label}: expected a real SIGKILL`);
}

async function killConnect(w, kill, plan, extra = {}) {
  const child = await spawnChild(CONNECT_CHILD, {
    module: connectModule, manifest: await manifestFile(w), sourceRoot: w.sourceRoot, hub: w.hub, repo: w.repo, name: extra.name, digest: plan.digest, kill,
  });
  assertKilled(child, `kill ${kill}`);
  return JSON.parse(child.stdout.match(/KILLED (\{.*\})/)?.[1] ?? 'null');
}

// Kill the apply at hook position `kill`, then prove: the next plan is INTERRUPTED_CONNECT
// (never LEGACY, never a silent resume), recovery restores BOTH roots byte for byte,
// recovery is safe to repeat, and a fresh connect then succeeds and rolls back cleanly.
async function killProbe(w, kill, before, plan, note) {
  const marker = await killConnect(w, kill, plan);
  const after = await snap(w);
  const ids = pendingIdsIn(after.hub);
  const added = (a, b) => Object.keys(b).filter((key) => a[key] !== b[key] && b[key] !== 'directory');
  note.push(`kill ${kill} before ${marker.kind} ${marker.destination}: repo files ${added(before.repo, after.repo).length}, hub files ${added(before.hub, after.hub).length}, pending ${ids.length}`);
  if (marker.kind === 'pending') {
    assert.deepEqual(after, before, 'killed before the first durable write: nothing exists');
    assert.equal((await planConnect(args(w))).detection.status, 'NONE');
    return;
  }
  assert.equal(ids.length, 1, `kill ${kill}: exactly one pending record survives`);
  const error = await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)), `kill ${kill}:`);
  assert.ok(error.message.includes(ids[0]) && error.message.includes('rollbackReceipt'), 'names the pending id and the recovery call');
  await rejects('INTERRUPTED_CONNECT', () => applyConnect({ ...args(w), approvedDigest: plan.digest }), `kill ${kill} apply:`);
  await rollbackReceipt({ targetPath: w.hub, receiptId: ids[0] });
  assert.deepEqual(await snap(w), before, `kill ${kill}: recovery restores both roots byte for byte`);
  await rejects('MISSING_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: ids[0] }));
  const fresh = await connectNow(w);
  await rollbackReceipt({ targetPath: w.hub, receiptId: fresh.receiptId });
  assert.deepEqual(await snap(w), before, `kill ${kill}: a fresh connect succeeds and rolls back`);
}

async function extraRepo(w, name) {
  const directory = path.join(w.root, name);
  await mkdir(directory);
  return directory;
}

function expectedRepoDirectories(files, directories) {
  const all = new Set();
  for (const directory of [...directories, ...files.map((file) => path.posix.dirname(file.destination))]) {
    if (directory === '.') continue;
    const segments = directory.split('/');
    for (let length = 1; length <= segments.length; length += 1) all.add(segments.slice(0, length).join('/'));
  }
  return [...all].sort();
}

// ---------------------------------------------------------------------------
// Test harness self-checks (C5)
// ---------------------------------------------------------------------------

test('the expected-failure helper fails when the action resolves or throws another code', async () => {
  await assert.rejects(() => rejects('X', async () => 'resolved'), /resolved/);
  await assert.rejects(() => rejects('X', async () => { throw new InstallPlanError('Y', 'other'); }), /expected X/);
  await rejects('Z', async () => { throw new InstallPlanError('Z', 'same'); });
});

// ---------------------------------------------------------------------------
// Phase: resolve hub
// ---------------------------------------------------------------------------

test('resolve hub: refuses a hub that is not initialised, has invalid state, or is an unsafe path', async (t) => {
  const w = await world(t);
  const empty = path.join(w.root, 'empty-hub');
  await mkdir(empty);
  await rejects('HUB_NOT_INITIALISED', () => planConnect(args(w, { targetPath: empty })));
  assert.deepEqual(await treeInventory(empty), {});

  await put(w.hub, STATE, '{"schemaVersion":1}');
  await rejects('INVALID_STATE', () => planConnect(args(w)));

  await rejects('TARGET_NOT_ABSOLUTE', () => planConnect(args(w, { targetPath: 'relative/hub' })));
  await rejects('TARGET_TRAVERSAL', () => planConnect(args(w, { targetPath: `${w.hub}${path.sep}..${path.sep}hub` })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { targetPath: path.parse(w.hub).root })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { targetPath: homedir() })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { targetPath: path.join(w.sourceRoot, 'inside') })));
});

test('resolve hub: a symlinked hub path is refused', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await world(t);
  const alias = path.join(w.root, 'hub-alias');
  await symlink(w.hub, alias);
  await rejects('SYMLINK_PATH', () => planConnect(args(w, { targetPath: alias })));
});

// ---------------------------------------------------------------------------
// Phase: resolve repo
// ---------------------------------------------------------------------------

test('resolve repo: missing, file and non-absolute repo paths are refused before any write', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  await rejects('REPO_NOT_DIRECTORY', () => planConnect(args(w, { repoPath: path.join(w.root, 'missing') })));
  await put(w.root, 'a-file', 'x');
  await rejects('REPO_NOT_DIRECTORY', () => planConnect(args(w, { repoPath: path.join(w.root, 'a-file') })));
  await rejects('TARGET_NOT_ABSOLUTE', () => planConnect(args(w, { repoPath: 'relative/repo' })));
  await rejects('TARGET_NOT_ABSOLUTE', () => planConnect(args(w, { repoPath: undefined })));
  await rejects('TARGET_TRAVERSAL', () => planConnect(args(w, { repoPath: `${w.repo}${path.sep}..${path.sep}my-repo` })));
  assert.deepEqual(await snap(w), before);
});

test('resolve repo: the hub, a folder inside the hub and a folder containing the hub are UNSAFE_REPO', async (t) => {
  const w = await world(t);
  await mkdir(path.join(w.hub, 'nested'));
  await rejects('UNSAFE_REPO', () => planConnect(args(w, { repoPath: w.hub })));
  await rejects('UNSAFE_REPO', () => planConnect(args(w, { repoPath: path.join(w.hub, 'nested') })));
  await rejects('UNSAFE_REPO', () => planConnect(args(w, { repoPath: w.root })));
});

test('resolve repo: the source copy, the home directory and the filesystem root are UNSAFE_TARGET', async (t) => {
  const w = await world(t);
  await mkdir(path.join(w.sourceRoot, 'inside'));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { repoPath: w.sourceRoot })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { repoPath: path.join(w.sourceRoot, 'inside') })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { repoPath: homedir() })));
  await rejects('UNSAFE_TARGET', () => planConnect(args(w, { repoPath: path.parse(w.repo).root })));
});

test('resolve repo: a symlinked repo path is refused with SYMLINK_PATH and an empty plain folder is valid', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await world(t);
  const alias = path.join(w.root, 'repo-alias');
  await symlink(w.repo, alias);
  await rejects('SYMLINK_PATH', () => planConnect(args(w, { repoPath: alias })));
  const plan = await planConnect(args(w));
  assert.equal(plan.remote, 'unknown');
  assert.equal(plan.detection.status, 'NONE');
});

// ---------------------------------------------------------------------------
// Phase: detect (D7)
// ---------------------------------------------------------------------------

test('detect: NONE, LEGACY (marker or role file) and INITIALISED (receipt) are pure and repeatable', async (t) => {
  const w = await world(t);
  assert.deepEqual(await detectHarness({ repoReal: w.repo }), { status: 'NONE', evidence: [] });

  await put(w.repo, 'SPEC-HARNESS.md', 'marker');
  const legacyByMarker = await detectHarness({ repoReal: w.repo });
  assert.deepEqual(legacyByMarker, { status: 'LEGACY', evidence: ['SPEC-HARNESS.md'] });
  assert.deepEqual(await detectHarness({ repoReal: w.repo }), legacyByMarker);

  await rm(rel(w.repo, 'SPEC-HARNESS.md'));
  await put(w.repo, '.claude/agents/sdd-verifier.md', 'role');
  await put(w.repo, '.claude/agents/other.md', 'not a role');
  assert.deepEqual(await detectHarness({ repoReal: w.repo }), { status: 'LEGACY', evidence: ['.claude/agents/sdd-verifier.md'] });

  await put(w.repo, '.claude/agents/.init-synthesis.json', '{}');
  const initialised = await detectHarness({ repoReal: w.repo });
  assert.equal(initialised.status, 'INITIALISED');
  assert.deepEqual(initialised.evidence, ['.claude/agents/.init-synthesis.json', '.claude/agents/sdd-verifier.md']);
});

test('detect: a file or directory at a probed path fails closed with a named code (every platform)', async (t) => {
  for (const [label, prepare, code] of [
    ['.claude is a file', async (repo) => writeFile(path.join(repo, '.claude'), 'x'), 'NON_DIRECTORY'],
    ['.claude/agents is a file', async (repo) => { await mkdir(path.join(repo, '.claude')); await writeFile(rel(repo, '.claude/agents'), 'x'); }, 'NON_DIRECTORY'],
    ['marker is a directory', async (repo) => mkdir(path.join(repo, 'SPEC-HARNESS.md')), 'NON_REGULAR_FILE'],
    ['receipt is a directory', async (repo) => mkdir(rel(repo, '.claude/agents/.init-synthesis.json'), { recursive: true }), 'NON_REGULAR_FILE'],
  ]) {
    const repo = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-probe-')));
    t.after(() => rm(repo, { recursive: true, force: true }));
    await prepare(repo);
    await rejects(code, () => detectHarness({ repoReal: repo }), label);
  }
});

test('detect: a symlink at a probed path fails closed', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-outside-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  for (const [label, prepare, code] of [
    ['.claude is a symlink', async (repo) => symlink(outside, path.join(repo, '.claude')), 'SYMLINK_PATH'],
    ['marker is a symlink', async (repo) => symlink(outside, path.join(repo, 'SPEC-HARNESS.md')), 'SYMLINK_PATH'],
    ['receipt is a symlink', async (repo) => { await mkdir(rel(repo, '.claude/agents'), { recursive: true }); await symlink(outside, rel(repo, '.claude/agents/.init-synthesis.json')); }, 'SYMLINK_PATH'],
    ['role file is a symlink', async (repo) => { await mkdir(rel(repo, '.claude/agents'), { recursive: true }); await symlink(outside, rel(repo, '.claude/agents/sdd-x.md')); }, 'SYMLINK_PATH'],
  ]) {
    const repo = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-probe-')));
    t.after(() => rm(repo, { recursive: true, force: true }));
    await prepare(repo);
    await rejects(code, () => detectHarness({ repoReal: repo }));
    assert.deepEqual(await readdir(outside), [], `${label}: nothing may be written through the link`);
  }
});

// ---------------------------------------------------------------------------
// Remote reading (D12, no child_process)
// ---------------------------------------------------------------------------

test('remote: parsed from .git/config as a regular file, credentials stripped, anything odd is unknown', async (t) => {
  const w = await world(t);
  const remoteFor = async (config) => {
    await rm(rel(w.repo, '.git'), { recursive: true, force: true });
    if (config !== null) await put(w.repo, '.git/config', config);
    return (await planConnect(args(w))).remote;
  };
  assert.equal(await remoteFor(null), 'unknown');
  assert.equal(await remoteFor('[core]\n\tbare = false\n'), 'unknown');
  assert.equal(await remoteFor('[remote "origin"]\n\turl = https://example.invalid/org/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'), 'https://example.invalid/org/repo.git');
  assert.equal(await remoteFor('[remote "origin"]\r\n\turl = git@example.invalid:org/repo.git\r\n'), 'example.invalid:org/repo.git');
  const stripped = await remoteFor('[remote "origin"]\n\turl = https://builder:PLACEHOLDER-VALUE@example.invalid/org/repo.git\n');
  assert.equal(stripped, 'https://example.invalid/org/repo.git');
  assert.ok(!stripped.includes('PLACEHOLDER-VALUE'));
  assert.equal(await remoteFor('[remote "upstream"]\n\turl = https://example.invalid/other.git\n'), 'unknown');
  assert.equal(await remoteFor('[remote "origin"]\n\turl = file:///srv/local/repo\n'), 'unknown');
  assert.equal(await remoteFor('[remote "origin"]\n\turl = https://example.invalid/`touch x`\n'), 'unknown');
  // A worktree-style .git file is never followed.
  await rm(rel(w.repo, '.git'), { recursive: true, force: true });
  await put(w.repo, '.git', 'gitdir: ../elsewhere\n');
  assert.equal((await planConnect(args(w))).remote, 'unknown');
});

test('remote: no credential, token, query, fragment or user name survives in any record', async (t) => {
  const token = `SYNTH-${randomUUID()}`;
  const leaking = [
    `https://user:${token.slice(0, 5)}@${token.slice(5)}@example.invalid/org/repo.git`,
    `https://user:${token}@example.invalid/org/repo.git`,
    `https://example.invalid/org/repo.git?access_token=${token}`,
    `https://example.invalid/org/repo.git#${token}`,
    `https://${token}@example.invalid/org/repo.git`,
    `https://user:${token}@example.invalid:8443/org/repo.git?x=1#y`,
    `https://user:pa/${token}@example.invalid/org/repo.git`,
    `https://user:pa?${token}@example.invalid/org/repo.git`,
    `https://user:pa#${token}@example.invalid/org/repo.git`,
    `${token}@example.invalid:org/repo.git`,
    `ssh://${token}:x@example.invalid/org/repo.git`,
    `user:${token}@example.invalid:org/repo.git`,
  ];
  for (const url of leaking) {
    const w = await world(t);
    await put(w.repo, '.git/config', `[remote "origin"]\n\turl = ${url}\n`);
    const plan = await planConnect(args(w));
    assert.ok(!plan.remote.includes(token) && !plan.remote.includes(token.slice(5)) && !plan.remote.includes('access_token'), `${url} -> ${plan.remote}`);
    const result = await applyConnect({ ...args(w), approvedDigest: plan.digest });
    const everywhere = [
      await readFile(rel(w.hub, '01-Projects/my-repo/Connection.md'), 'utf8'),
      await readFile(rel(w.hub, CONNECTIONS), 'utf8'),
      await readFile(rel(w.hub, result.receiptPath), 'utf8'),
    ].join('\n');
    for (const needle of [token, token.slice(5), token.slice(0, 5) + '@', 'access_token']) assert.ok(!everywhere.includes(needle), `${needle} leaked from ${url}`);
  }
  // The pending record is written before the first repo write: it must not carry one either.
  const w = await world(t);
  await put(w.repo, '.git/config', `[remote "origin"]\n\turl = https://user:${token}@example.invalid/org/repo.git?t=${token}\n`);
  const plan = await planConnect(args(w));
  const marker = await killConnect(w, 2, plan);
  assert.equal(marker.kind, 'directory');
  const [pendingId] = pendingIdsIn(await treeInventory(w.hub));
  assert.ok(!(await readFile(rel(w.hub, `.second-brain/connect-pending/${pendingId}.json`), 'utf8')).includes(token));
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
  // Clean URLs are still recorded: host and path only, query and fragment dropped, no user name.
  await put(w.repo, '.git/config', '[remote "origin"]\n\turl = https://example.invalid:8443/org/repo.git?x=1#y\n');
  assert.equal((await planConnect(args(w))).remote, 'https://example.invalid:8443/org/repo.git');
});

test('remote: a symlinked .git/config or .git is refused and its target is never read', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await world(t);
  const secret = `SYNTHETIC-${randomUUID()}`;
  const outside = path.join(w.root, 'outside-config');
  await writeFile(outside, `[remote "origin"]\n\turl = https://example.invalid/${secret}\n`);
  await mkdir(rel(w.repo, '.git'));
  await symlink(outside, rel(w.repo, '.git/config'));
  const error = await rejects('SYMLINK_PATH', () => planConnect(args(w)));
  assert.ok(!error.message.includes(secret), 'the error must not echo the link target content');
  await rm(rel(w.repo, '.git'), { recursive: true });
  await symlink(path.join(w.root, 'hub'), rel(w.repo, '.git'));
  await rejects('SYMLINK_PATH', () => planConnect(args(w)));
});

// ---------------------------------------------------------------------------
// Harness manifest + rendering (D2, D3)
// ---------------------------------------------------------------------------

test('harness manifest: refuses a missing manifest, unknown schema, unknown render, multi-token entries and bad sources', async (t) => {
  const w = await world(t);
  const mutate = async (change, code) => {
    const saved = structuredClone(w.harnessManifest);
    change(w.harnessManifest);
    await writeHarnessManifest(w);
    const before = await snap(w);
    await rejects(code, () => planConnect(args(w)));
    assert.deepEqual(await snap(w), before);
    w.harnessManifest = saved;
    await writeHarnessManifest(w);
  };
  await mutate((m) => { m.schemaVersion = 2; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries[0].render = 'symlink'; }, 'UNKNOWN_RENDER');
  await mutate((m) => { m.entries[0].tokens = ['{{PROJECT_NAME}}', '{{DIR}}']; }, 'UNSUPPORTED_MULTI_TOKEN');
  await mutate((m) => { m.entries[0].tokens = ['{{NOT_DEFINED}}']; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries[3].tokens = ['{{DIR}}']; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries[0].destination = '../escape.md'; }, 'INVALID_PATH');
  await mutate((m) => { m.entries[0].source = '/etc/passwd'; }, 'INVALID_PATH');
  await mutate((m) => { m.entries[1].destination = m.entries[0].destination; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries[0].extra = true; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries[0].sha256 = 'f'.repeat(64); }, 'HARNESS_SOURCE_HASH_MISMATCH');
  await mutate((m) => { m.directories = ['AGENTS.md']; }, 'INVALID_HARNESS_MANIFEST');
  await mutate((m) => { m.entries.push({ ...m.entries[0], destination: 'AGENTS.md/child.md' }); }, 'INVALID_HARNESS_MANIFEST');

  // A missing source file fails the whole plan before any write.
  const victim = w.harnessFiles[4];
  const saved = await readFile(rel(w.sourceRoot, `vendor/spec-harness/${victim.source}`));
  await rm(rel(w.sourceRoot, `vendor/spec-harness/${victim.source}`));
  await rejects('HARNESS_SOURCE_MISSING', () => planConnect(args(w)));
  await writeFile(rel(w.sourceRoot, `vendor/spec-harness/${victim.source}`), `${saved}tampered`);
  await rejects('HARNESS_SOURCE_HASH_MISMATCH', () => planConnect(args(w)));
  await writeFile(rel(w.sourceRoot, `vendor/spec-harness/${victim.source}`), saved);
  await planConnect(args(w));

  await rm(rel(w.sourceRoot, 'vendor/spec-harness/install-manifest.json'));
  await rejects('HARNESS_MANIFEST_MISSING', () => planConnect(args(w)));
  await writeHarnessManifest(w);
  await rm(rel(w.sourceRoot, 'vendor/SPEC-HARNESS-PIN.json'));
  await rejects('INVALID_HARNESS_PIN', () => planConnect(args(w)));
});

test('rendering: only the entry own token is replaced, replacement is literal and single pass, trailing LF rule holds', async (t) => {
  const w = await world(t);
  const harness = await readHarnessManifest({ sourceRoot: w.sourceRoot });
  const byDestination = (destination) => harness.entries.find((entry) => entry.destination === destination);
  const agents = byDestination('AGENTS.md');
  // The source has no final newline and a foreign {{OTHER}} token: both survive / are fixed.
  const rendered = renderHarnessEntry(agents, 'A$&B$$C', harness);
  const nonce = w.harnessFiles[0].text.match(/id (\S+)/)[1];
  assert.equal(rendered.toString('utf8'), `# A$&B$$C agents\nid ${nonce} A$&B$$C and A$&B$$C\nkeep {{OTHER}} untouched\n`);
  assert.deepEqual(rendered, referenceRender(w.harnessManifest, w.harnessFiles[0], w.harnessFiles[0].text, 'A$&B$$C'));
  // A name that contains tokens is never rescanned.
  assert.ok(renderHarnessEntry(agents, 'X{{PROJECT_NAME}}Y', harness).toString('utf8').startsWith('# X{{PROJECT_NAME}}Y agents\n'));
  // The {{DIR}} token in an entry that does not list it is left alone.
  const marker = renderHarnessEntry(byDestination('SPEC-HARNESS.md'), 'n', harness).toString('utf8');
  assert.ok(marker.includes('n {{DIR}}'));
  assert.ok(renderHarnessEntry(byDestination('RULES.md'), 'my name', harness).toString('utf8').startsWith('my name (repo root - base rules)\n'));
  // copy keeps CRLF and missing final newline byte for byte.
  assert.deepEqual(renderHarnessEntry(byDestination('.claude/agents/sdd-planner.md'), 'n', harness), byDestination('.claude/agents/sdd-planner.md').sourceBytes);
  // A source that already ends in LF gains none; an empty one renders empty.
  const lf = { ...agents, sourceBytes: Buffer.from('a {{PROJECT_NAME}}\n') };
  assert.equal(renderHarnessEntry(lf, 'n', harness).toString('utf8'), 'a n\n');
  assert.equal(renderHarnessEntry({ ...agents, sourceBytes: Buffer.alloc(0) }, 'n', harness).length, 0);
  assert.throws(() => renderHarnessEntry({ ...agents, render: 'eval' }, 'n', harness), (error) => error.code === 'UNKNOWN_RENDER');
});

test('names: forbidden and reserved names are rejected, hostile but legal names are kept literally', async (t) => {
  const w = await world(t);
  const harness = await readHarnessManifest({ sourceRoot: w.sourceRoot });
  for (const bad of ['', 'a\nb', 'a\rb', 'a\tb', 'a/b', 'a\\b', '.', '..', 'Selected-Project', 'selected-project', 'README.md', 'a:b', 'a|b', ' lead', 'trail ', 'dot.', 'x'.repeat(101), 'C:drive']) {
    assert.throws(() => validateConnectionName(bad, harness), (error) => error.code === 'INVALID_CONNECTION_NAME', JSON.stringify(bad));
  }
  for (const good of ['A$&B$$C', 'X{{PROJECT_NAME}}Y', 'has {{DIR}} inside', 'プロジェクト', 'with space', 'my $(touch x) repo']) {
    assert.equal(validateConnectionName(good, harness), good);
  }
  await rejects('INVALID_CONNECTION_NAME', () => planConnect(args(w, { name: 'a/b' })));
  assert.equal((await planConnect(args(w))).name, 'my-repo', 'default name is the repo basename');
});


test('names: reserved Windows device names, trailing dots or spaces and case-only twins are refused on every platform', async (t) => {
  const w = await world(t);
  const harness = await readHarnessManifest({ sourceRoot: w.sourceRoot });
  const devices = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)];
  for (const device of devices) {
    for (const variant of [device, device.toLowerCase(), `${device[0]}${device.slice(1).toLowerCase()}`, `${device}.txt`, `${device.toLowerCase()}.tar.gz`]) {
      assert.throws(() => validateConnectionName(variant, harness), (error) => error.code === 'INVALID_CONNECTION_NAME', variant);
    }
  }
  for (const bad of ['name.', 'name ', 'name..', 'name. ', ' name']) {
    assert.throws(() => validateConnectionName(bad, harness), (error) => error.code === 'INVALID_CONNECTION_NAME', JSON.stringify(bad));
  }
  for (const fine of ['console', 'com10', 'lpt0', 'nulled', 'auxiliary.txt', 'a.con']) assert.equal(validateConnectionName(fine, harness), fine);
  // Case-only twins: against a recorded connection and against an existing project folder.
  const other = await extraRepo(w, 'other-repo');
  await connectNow(w, { name: 'Client-App' });
  await rejects('CONNECTION_NAME_TAKEN', () => planConnect(args(w, { repoPath: other, name: 'client-app' })));
  await rejects('CONNECTION_NAME_TAKEN', () => planConnect(args(w, { repoPath: other, name: 'CLIENT-APP' })));
  await mkdir(rel(w.hub, '01-Projects/Hand-Made'));
  await rejects('CONNECTION_NAME_TAKEN', () => planConnect(args(w, { repoPath: other, name: 'hand-made' })));
});

// ---------------------------------------------------------------------------
// Phase: plan (digest binding)
// ---------------------------------------------------------------------------

test('plan: lists both roots, is deterministic, and writes nothing', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const first = await planConnect(args(w));
  const second = await planConnect(args(w));
  assert.equal(first.digest, second.digest);
  assert.deepEqual(await snap(w), before);
  assert.deepEqual(first.roots, { hub: w.hub, repo: w.repo });
  assert.equal(first.stage, 'STAGED');
  assert.equal(first.loaderBlock, '## Synthetic loader\n');
  const repoCreates = first.entries.filter((entry) => entry.root === 'repo').map((entry) => `${entry.status}:${entry.destination}`);
  assert.deepEqual(repoCreates, w.harnessFiles.map((file) => `CREATE:${file.destination}`));
  const hubCreates = first.entries.filter((entry) => entry.root === 'hub').map((entry) => `${entry.status}:${entry.destination}`);
  assert.deepEqual(hubCreates, [
    ...PROJECT_FILES.map((file) => `CREATE:01-Projects/my-repo/${file}`),
    'CREATE:01-Projects/my-repo/Connection.md',
    `CREATE:${CONNECTIONS}`,
  ]);
  assert.deepEqual(first.directories.filter((entry) => entry.root === 'repo').map((entry) => entry.destination).sort(), expectedRepoDirectories(w.harnessFiles, SYNTHETIC_DIRECTORIES));
  assert.deepEqual(first.preserved, []);
});

test('plan: the digest binds the name, the repo, preserved bytes, both manifests, the connections state and detection', async (t) => {
  const w = await world(t);
  const base = (await planConnect(args(w))).digest;
  const other = await extraRepo(w, 'other-repo');
  assert.notEqual((await planConnect(args(w, { name: 'renamed' }))).digest, base, 'name');
  assert.notEqual((await planConnect(args(w, { repoPath: other, name: 'my-repo' }))).digest, base, 'repo path');
  assert.notEqual((await planConnect(args(w, { manifestBytes: Buffer.concat([w.manifestBytes, Buffer.from(' ')]) }))).digest, base, 'template manifest bytes');

  await put(w.repo, 'AGENTS.md', 'mine one');
  const preserved1 = (await planConnect(args(w))).digest;
  assert.notEqual(preserved1, base, 'a preserved file appears');
  await put(w.repo, 'AGENTS.md', 'mine two');
  assert.notEqual((await planConnect(args(w))).digest, preserved1, 'preserved file bytes');
  await rm(rel(w.repo, 'AGENTS.md'));
  assert.equal((await planConnect(args(w))).digest, base, 'restoring the repo restores the digest');

  await writeFile(rel(w.sourceRoot, 'vendor/spec-harness/install-manifest.json'), `${JSON.stringify(w.harnessManifest)}\n`);
  assert.notEqual((await planConnect(args(w))).digest, base, 'harness manifest bytes');
  await writeHarnessManifest(w);
  const pin = JSON.parse(await readFile(rel(w.sourceRoot, 'vendor/SPEC-HARNESS-PIN.json'), 'utf8'));
  await put(w.sourceRoot, 'vendor/SPEC-HARNESS-PIN.json', JSON.stringify({ ...pin, commit: 'c'.repeat(40) }));
  assert.notEqual((await planConnect(args(w))).digest, base, 'pin commit');
  await put(w.sourceRoot, 'vendor/SPEC-HARNESS-PIN.json', JSON.stringify(pin));
  await put(w.repo, 'SPEC-HARNESS.md', 'marker');
  assert.notEqual((await planConnect(args(w))).digest, base, 'detection status');
});

test('plan: an existing differing or identical file is PRESERVED, never CONFLICT, and apply leaves it alone', async (t) => {
  const w = await world(t);
  await put(w.repo, 'AGENTS.md', 'my own agents file');
  const identical = w.harnessFiles.find((file) => file.destination === 'ai_rules/rules/core.md');
  await put(w.repo, identical.destination, identical.text);
  const plan = await planConnect(args(w));
  const byDestination = Object.fromEntries(plan.entries.filter((entry) => entry.root === 'repo').map((entry) => [entry.destination, entry]));
  assert.equal(byDestination['AGENTS.md'].status, 'PRESERVED');
  assert.equal(byDestination['AGENTS.md'].differs, true);
  assert.equal(byDestination['ai_rules/rules/core.md'].status, 'PRESERVED');
  assert.equal(byDestination['ai_rules/rules/core.md'].differs, false);
  assert.deepEqual(plan.preserved.map((item) => item.destination), ['AGENTS.md', 'ai_rules/rules/core.md']);
  assert.ok(!plan.entries.some((entry) => entry.status === 'CONFLICT'));

  const result = await applyConnect({ ...args(w), approvedDigest: plan.digest });
  assert.equal(await readFile(rel(w.repo, 'AGENTS.md'), 'utf8'), 'my own agents file');
  const receipt = JSON.parse(await readFile(rel(w.hub, result.receiptPath), 'utf8'));
  assert.ok(!receipt.writes.some((write) => write.root === 'repo' && ['AGENTS.md', 'ai_rules/rules/core.md'].includes(write.destination)));
});

test('plan: an existing workspace file under the project folder is a CONFLICT that blocks apply in both roots', async (t) => {
  const w = await world(t);
  await put(w.hub, '01-Projects/my-repo/FACTS.md', 'a hand-made facts file');
  const plan = await planConnect(args(w));
  assert.deepEqual(plan.entries.filter((entry) => entry.status === 'CONFLICT').map((entry) => entry.destination), ['01-Projects/my-repo/FACTS.md']);
  const before = await snap(w);
  await rejects('PLAN_CONFLICT', () => applyConnect({ ...args(w), approvedDigest: plan.digest }));
  assert.deepEqual(await snap(w), before);
});

test('plan: files and directories in the wrong place fail closed with a named code (every platform)', async (t) => {
  const cases = [
    ['file named specs', async (w) => put(w.repo, 'specs', 'x'), 'NON_DIRECTORY'],
    ['file named ai_rules', async (w) => put(w.repo, 'ai_rules', 'x'), 'NON_DIRECTORY'],
    ['directory named AGENTS.md', async (w) => mkdir(rel(w.repo, 'AGENTS.md')), 'NON_REGULAR_FILE'],
    ['file named 01-Projects in the hub', async (w) => { await rm(rel(w.hub, '01-Projects'), { recursive: true }); await put(w.hub, '01-Projects', 'x'); }, 'NON_DIRECTORY'],
    ['connections.json is a directory', async (w) => mkdir(rel(w.hub, CONNECTIONS)), 'NON_REGULAR_FILE'],
    ['file named connect-pending', async (w) => put(w.hub, '.second-brain/connect-pending', 'x'), 'INVALID_NAMESPACE'],
  ];
  for (const [label, prepare, code] of cases) {
    const w = await world(t);
    await prepare(w);
    const before = await snap(w);
    await rejects(code, () => planConnect(args(w)), label);
    await rejects(code, () => applyConnect({ ...args(w), approvedDigest: '0'.repeat(64) }), label);
    assert.deepEqual(await snap(w), before, label);
  }
});

test('plan: symlinks at destinations fail closed and nothing is written through them', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-outside-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const cases = [
    ['symlinked .claude', async (w) => symlink(outside, rel(w.repo, '.claude')), 'SYMLINK_PATH'],
    ['symlinked destination file', async (w) => symlink(path.join(outside, 'x'), rel(w.repo, 'AGENTS.md')), 'SYMLINK_PATH'],
    ['symlinked project folder in the hub', async (w) => symlink(outside, rel(w.hub, '01-Projects/my-repo')), 'SYMLINK_PATH'],
    ['dangling connections.json', async (w) => symlink(path.join(outside, 'gone'), rel(w.hub, CONNECTIONS)), 'SYMLINK_PATH'],
  ];
  for (const [label, prepare, code] of cases) {
    const w = await world(t);
    await prepare(w);
    const before = await snap(w);
    await rejects(code, () => planConnect(args(w)));
    await rejects(code, () => applyConnect({ ...args(w), approvedDigest: '0'.repeat(64) }));
    assert.deepEqual(await snap(w), before, label);
    assert.deepEqual(await readdir(outside), [], `${label}: nothing written outside the roots`);
  }
});

test('plan: an invalid connections state is refused with INVALID_CONNECTIONS_STATE (exact keys, schemaVersion 1)', async (t) => {
  const record = (id) => ({ connectionId: id, name: 'n', hub: '/x', repo: '/y', detection: 'NONE', stage: 'STAGED', remote: 'unknown', ruleFiles: [], harness: { commit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), harnessVersion: '1' }, planDigest: 'c'.repeat(64) });
  const id = `tx-${randomUUID()}`;
  for (const content of ['not json', '[]', '{"schemaVersion":2,"connections":{}}', '{"schemaVersion":1}', '{"schemaVersion":1,"connections":{},"extra":1}', JSON.stringify({ schemaVersion: 1, connections: { notAnId: record(id) } }), JSON.stringify({ schemaVersion: 1, connections: { [id]: { ...record(id), extra: 1 } } }), JSON.stringify({ schemaVersion: 1, connections: { [id]: { ...record(id), detection: 'MAYBE' } } })]) {
    const w = await world(t);
    await put(w.hub, CONNECTIONS, content);
    const before = await snap(w);
    await rejects('INVALID_CONNECTIONS_STATE', () => planConnect(args(w)));
    await rejects('INVALID_CONNECTIONS_STATE', () => readConnections({ targetPath: w.hub }));
    assert.deepEqual(await snap(w), before);
  }
});

// ---------------------------------------------------------------------------
// Phase: approve
// ---------------------------------------------------------------------------

test('approve: a wrong, stale or foreign digest is refused with nothing written', async (t) => {
  const w = await world(t);
  const other = await extraRepo(w, 'other-repo');
  const plan = await planConnect(args(w));
  const planOther = await planConnect(args(w, { repoPath: other }));
  const elsewhere = await world(t);
  const planElsewhere = await planConnect(args(elsewhere));
  const before = await snap(w);
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: '0'.repeat(64) }));
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: undefined }));
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: planOther.digest }));
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: planElsewhere.digest }), 'a digest from another workspace');
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w, { name: 'renamed' }), approvedDigest: plan.digest }));
  await put(w.repo, 'AGENTS.md', 'appeared after approval');
  await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: plan.digest }));
  assert.equal((await treeInventory(w.hub))[CONNECTIONS], undefined);
  assert.deepEqual((await snap(w)).hub, before.hub);
});

// ---------------------------------------------------------------------------
// Phase: apply (success shapes)
// ---------------------------------------------------------------------------

test('apply: creates exactly the planned set in both roots, never touches installed-state.json, and records the connection', async (t) => {
  const w = await world(t);
  const stateBefore = await readFile(rel(w.hub, STATE));
  const hubBefore = await treeInventory(w.hub);
  const repoBefore = await treeInventory(w.repo);
  const plan = await planConnect(args(w));
  const result = await applyConnect({ ...args(w), approvedDigest: plan.digest });
  assert.equal(result.applied, true);
  assert.deepEqual(await readFile(rel(w.hub, STATE)), stateBefore, 'installed-state.json bytes are untouched');

  const repoAfter = await treeInventory(w.repo);
  const expectedFiles = w.harnessFiles.map((file) => file.destination).sort();
  assert.deepEqual(Object.keys(repoAfter).filter((key) => repoAfter[key] !== 'directory').sort(), expectedFiles);
  assert.deepEqual(Object.keys(repoAfter).filter((key) => repoAfter[key] === 'directory').sort(), expectedRepoDirectories(w.harnessFiles, SYNTHETIC_DIRECTORIES));
  assert.ok(!Object.keys(repoAfter).some((key) => key.startsWith('.second-brain')), 'no state, backup or receipt in the repo');
  assert.ok(!Object.keys(repoAfter).some((key) => key.endsWith('.tmp')));
  for (const file of w.harnessFiles) {
    assert.deepEqual(await readFile(rel(w.repo, file.destination)), referenceRender(w.harnessManifest, file, file.text, 'my-repo'), file.destination);
  }

  const hubAfter = await treeInventory(w.hub);
  const hubAdded = changedPaths(hubBefore, hubAfter).filter((key) => !key.endsWith('/'));
  assert.deepEqual(hubAdded.sort(), [
    CONNECTIONS,
    ...PROJECT_FILES.map((file) => `01-Projects/my-repo/${file}`),
    '01-Projects/my-repo/Connection.md',
    result.receiptPath,
  ].sort());
  for (const file of PROJECT_FILES) {
    assert.deepEqual(await readFile(rel(w.hub, `01-Projects/my-repo/${file}`)), await readFile(rel(w.sourceRoot, `template/03-Resources/_templates/project/${file}`)));
  }
  const record = await readFile(rel(w.hub, '01-Projects/my-repo/Connection.md'), 'utf8');
  for (const needle of [w.repo, 'Remote: unknown', 'Detection: NONE', 'STAGED until `.claude/agents/.init-synthesis.json` exists in the repository.', 'a'.repeat(40)]) assert.ok(record.includes(needle), needle);

  const connections = await readConnections({ targetPath: w.hub });
  assert.deepEqual(Object.keys(connections.connections), [result.connectionId]);
  assert.equal(connections.connections[result.connectionId].repo, w.repo);
  assert.equal(connections.connections[result.connectionId].stage, 'STAGED');

  const receipt = JSON.parse(await readFile(rel(w.hub, result.receiptPath), 'utf8'));
  assert.deepEqual(Object.keys(receipt).sort(), ['createdDirectories', 'detection', 'harness', 'hub', 'name', 'operation', 'planDigest', 'receiptId', 'repo', 'schemaVersion', 'templateManifestSha256', 'writes']);
  assert.equal(receipt.operation, 'connect');
  assert.equal(receipt.receiptId, result.receiptId);
  assert.equal(receipt.repo, w.repo);
  assert.equal(receipt.hub, w.hub);
  assert.ok(receipt.writes.filter((write) => write.root === 'repo').every((write) => write.preimageSha256 === null && write.backupPath === null));
  assert.equal(receipt.writes.at(-1).destination, CONNECTIONS);
  assert.deepEqual(receipt.createdDirectories.repo, expectedRepoDirectories(w.harnessFiles, SYNTHETIC_DIRECTORIES));
  assert.ok(receipt.createdDirectories.hub.includes('01-Projects/my-repo'));
  assert.equal(result.durableWrites, plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 4);
});

test('apply: existing installs keep working after a connect (verify and an upgrade plan are unchanged)', async (t) => {
  const w = await world(t);
  const verifyBefore = await verifyInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub });
  const upgradeBefore = await planInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub, operation: 'upgrade' });
  await connectNow(w);
  assert.deepEqual(await verifyInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub }), verifyBefore);
  const upgradeAfter = await planInstall({ manifest: w.manifest, manifestBytes: w.manifestBytes, sourceRoot: w.sourceRoot, targetPath: w.hub, operation: 'upgrade' });
  assert.deepEqual(upgradeAfter, upgradeBefore);
});

test('apply: INITIALISED and LEGACY repositories receive zero writes and are still registered', async (t) => {
  for (const [status, prepare] of [
    ['INITIALISED', async (w) => { await put(w.repo, '.claude/agents/.init-synthesis.json', '{}'); await put(w.repo, 'AGENTS.md', 'theirs'); }],
    ['LEGACY', async (w) => put(w.repo, 'SPEC-HARNESS.md', 'old marker')],
    ['LEGACY', async (w) => put(w.repo, '.claude/agents/sdd-planner.md', 'old role')],
  ]) {
    const w = await world(t);
    await prepare(w);
    const repoBefore = await treeInventory(w.repo);
    const plan = await planConnect(args(w));
    assert.equal(plan.detection.status, status);
    assert.equal(plan.stage, 'REGISTER-ONLY');
    assert.ok(!plan.entries.some((entry) => entry.root === 'repo'));
    assert.ok(!plan.directories.some((entry) => entry.root === 'repo'));
    const result = await applyConnect({ ...args(w), approvedDigest: plan.digest });
    assert.deepEqual(await treeInventory(w.repo), repoBefore, 'zero bytes written in the repository');
    const receipt = JSON.parse(await readFile(rel(w.hub, result.receiptPath), 'utf8'));
    assert.equal(receipt.writes.filter((write) => write.root === 'repo').length, 0);
    assert.equal(receipt.detection, status);
    const record = await readFile(rel(w.hub, '01-Projects/my-repo/Connection.md'), 'utf8');
    assert.ok(record.includes(`Detection: ${status}`) && record.includes('registered only'));
    assert.ok(!record.includes('STAGED'));
    assert.equal((await readConnections({ targetPath: w.hub })).connections[result.connectionId].detection, status);
  }
});

test('apply: rule files found are recorded by name only', async (t) => {
  const w = await world(t);
  await put(w.repo, 'CLAUDE.md', 'SECRET-LOOKING-BODY-DO-NOT-ECHO');
  await put(w.repo, 'ai_rules/x.md', 'body');
  const result = await connectNow(w);
  const record = (await readConnections({ targetPath: w.hub })).connections[result.connectionId];
  assert.deepEqual(record.ruleFiles, ['CLAUDE.md', 'ai_rules/']);
  const markdown = await readFile(rel(w.hub, '01-Projects/my-repo/Connection.md'), 'utf8');
  assert.ok(markdown.includes('Rule files found: CLAUDE.md, ai_rules/'));
  assert.ok(!markdown.includes('SECRET-LOOKING-BODY'));
});

// ---------------------------------------------------------------------------
// Repeated connect (Option A)
// ---------------------------------------------------------------------------

test('repeated: the same repo (any spelling) is ALREADY_CONNECTED and another repo with the same name is CONNECTION_NAME_TAKEN, both write nothing', async (t) => {
  const w = await world(t);
  const first = await connectNow(w);
  const other = await extraRepo(w, 'other-repo');
  const before = { ...(await snap(w)), other: await treeInventory(other) };
  const error = await rejects('ALREADY_CONNECTED', () => planConnect(args(w)));
  assert.ok(error.message.includes(first.receiptId));
  await rejects('ALREADY_CONNECTED', () => planConnect(args(w, { repoPath: `${w.repo}${path.sep}` })));
  await rejects('ALREADY_CONNECTED', () => planConnect(args(w, { repoPath: `${w.repo}${path.sep}.` })));
  await rejects('ALREADY_CONNECTED', () => applyConnect({ ...args(w), approvedDigest: '0'.repeat(64) }));
  await rejects('CONNECTION_NAME_TAKEN', () => planConnect(args(w, { repoPath: other, name: 'my-repo' })));
  await rejects('CONNECTION_NAME_TAKEN', () => planConnect(args(w, { repoPath: other, name: 'MY-REPO' })));
  await rejects('CONNECTION_NAME_TAKEN', () => applyConnect({ ...args(w, { repoPath: other, name: 'my-repo' }), approvedDigest: '0'.repeat(64) }));
  assert.deepEqual({ ...(await snap(w)), other: await treeInventory(other) }, before);
});

test('repeated: a symlinked spelling of a connected repo is refused with SYMLINK_PATH', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await world(t);
  await connectNow(w);
  const alias = path.join(w.root, 'alias');
  await symlink(w.repo, alias);
  await rejects('SYMLINK_PATH', () => planConnect(args(w, { repoPath: alias })));
});

test('two repositories connect one after another and roll back in either order (R05-3)', async (t) => {
  for (const order of ['A-first', 'B-first']) {
    const w = await world(t);
    const baseline = await snap(w);
    const other = await extraRepo(w, 'second-repo');
    const otherBefore = await treeInventory(other);
    const a = await connectNow(w);
    const afterA = await snap(w);
    const b = await connectNow(w, { repoPath: other });
    const [first, second] = order === 'A-first' ? [a, b] : [b, a];
    const survivor = order === 'A-first' ? b : a;
    await rollbackReceipt({ targetPath: w.hub, receiptId: first.receiptId });
    const listed = await readConnections({ targetPath: w.hub });
    assert.deepEqual(Object.keys(listed.connections), [survivor.receiptId], `${order}: only the other record remains, intact`);
    assert.equal(JSON.stringify(listed.connections[survivor.receiptId]), JSON.stringify((await readConnections({ targetPath: w.hub })).connections[survivor.receiptId]));
    const survivorTree = order === 'A-first' ? await treeInventory(other) : await treeInventory(w.repo);
    assert.ok(Object.keys(survivorTree).length > 5, `${order}: the surviving repo keeps its files`);
    await rollbackReceipt({ targetPath: w.hub, receiptId: second.receiptId });
    assert.deepEqual(await treeInventory(other), otherBefore);
    assert.deepEqual(await snap(w), baseline, `${order}: both rolled back to the pre-connect inventory`);
    assert.ok(afterA.hub[CONNECTIONS]);
  }
});

// ---------------------------------------------------------------------------
// Interruptions: inject a failure after EVERY durable write
// ---------------------------------------------------------------------------

async function interruptionLoop(w, extra = {}) {
  const before = await snap(w);
  const plan = await planConnect(args(w, extra));
  const expected = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file' && entry.status === 'CREATE').length + 4;
  assert.ok(expected >= 3);
  for (let position = 1; position <= expected; position += 1) {
    await rejects('INJECTED_WRITE_FAILURE', () => applyConnect({ ...args(w, extra), approvedDigest: plan.digest, injectFailureAfterWrite: position }), `position ${position} of ${expected}:`);
    assert.deepEqual(await snap(w), before, `position ${position}: both roots must be restored byte for byte`);
    assert.equal((await planConnect(args(w, extra))).digest, plan.digest, `position ${position}: the plan is reproducible afterwards`);
  }
  const done = await applyConnect({ ...args(w, extra), approvedDigest: plan.digest });
  assert.equal(done.durableWrites, expected, 'the counted positions are exactly the durable writes');
  return { before, expected, done };
}

test('interruption: a failure after every durable write (dirs, repo files, hub dirs/files, connections, receipt) restores both roots', async (t) => {
  const w = await world(t);
  const { expected } = await interruptionLoop(w);
  assert.ok(expected > 20);
});

test('interruption: the same holds for a register-only repo and for a hub whose 01-Projects folder is missing', async (t) => {
  const legacy = await world(t);
  await put(legacy.repo, 'SPEC-HARNESS.md', 'old');
  await interruptionLoop(legacy);

  const bare = await world(t);
  await rm(rel(bare.hub, '01-Projects'), { recursive: true });
  const { before } = await interruptionLoop(bare);
  assert.equal(before.hub['01-Projects'], undefined);
});

test('interruption: a pre-existing connections.json is restored to its preimage after every position', async (t) => {
  const w = await world(t);
  const other = await extraRepo(w, 'first-repo');
  await connectNow(w, { repoPath: other });
  const { before } = await interruptionLoop(w);
  assert.ok(before.hub[CONNECTIONS].startsWith('file:'));
});

test('interruption: with a pre-existing preserved file the loop still restores both roots', async (t) => {
  const w = await world(t);
  await put(w.repo, 'RULES.md', 'theirs');
  const { before } = await interruptionLoop(w);
  assert.equal(before.repo['RULES.md'], `file:${digestOf('theirs')}`);
});

test('interruption against the REAL vendored harness: pending record, first repo file, last repo file, first hub file, connections, receipt and pending clear', async (t) => {
  const real = await realWorld(t);
  const before = await snap(real);
  const plan = await planConnect(args(real));
  const repoDirs = plan.directories.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const repoFiles = plan.entries.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const hubDirs = plan.directories.filter((entry) => entry.root === 'hub' && entry.status === 'CREATE').length;
  const total = repoDirs + repoFiles + hubDirs + 6 + 4;
  for (const position of [1, 2, repoDirs + 2, repoDirs + repoFiles + 1, repoDirs + repoFiles + hubDirs + 2, total - 2, total - 1, total]) {
    await rejects('INJECTED_WRITE_FAILURE', () => applyConnect({ ...args(real), approvedDigest: plan.digest, injectFailureAfterWrite: position }));
    assert.deepEqual(await snap(real), before, `position ${position}`);
  }
});

// ---------------------------------------------------------------------------
// Concurrency and partial failure
// ---------------------------------------------------------------------------

test('a destination that appears between plan and write is CONCURRENT_MODIFICATION, the foreign file survives, everything else is rolled back', async (t) => {
  for (const [root, destination] of [['repo', 'ai_rules/rules/core.md'], ['repo', 'AGENTS.md'], ['hub', '01-Projects/my-repo/FACTS.md'], ['hub', '01-Projects/my-repo/Connection.md']]) {
    const w = await world(t);
    const before = await snap(w);
    const plan = await planConnect(args(w));
    await rejects('CONCURRENT_MODIFICATION', () => applyConnect({
      ...args(w),
      approvedDigest: plan.digest,
      injectBeforeWrite: async (info) => {
        if (info.root === root && info.destination === destination) {
          await mkdir(path.dirname(rel(root === 'repo' ? w.repo : w.hub, destination)), { recursive: true });
          await writeFile(rel(root === 'repo' ? w.repo : w.hub, destination), 'created by someone else');
        }
      },
    }));
    const after = await snap(w);
    const foreign = `file:${digestOf('created by someone else')}`;
    const target = root === 'repo' ? after.repo : after.hub;
    assert.equal(target[destination], foreign, 'the foreign file is never overwritten or removed');
    for (const key of Object.keys(target)) {
      if (key !== destination && !destination.startsWith(`${key}/`)) assert.equal(target[key], (root === 'repo' ? before.repo : before.hub)[key], `${root}:${key} restored`);
    }
    assert.deepEqual(root === 'repo' ? after.hub : after.repo, root === 'repo' ? before.hub : before.repo, 'the other root is restored byte for byte');
  }
});

test('connections.json or installed state changing after approval is CONCURRENT_MODIFICATION and rolls both roots back', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  await rejects('CONCURRENT_MODIFICATION', () => applyConnect({
    ...args(w),
    approvedDigest: plan.digest,
    injectBeforeWrite: async (info) => {
      if (info.destination === '01-Projects/my-repo/Connection.md') await put(w.hub, CONNECTIONS, JSON.stringify({ schemaVersion: 1, connections: {} }));
    },
  }));
  const after = await snap(w);
  assert.equal(after.hub[CONNECTIONS], `file:${digestOf(JSON.stringify({ schemaVersion: 1, connections: {} }))}`, 'the concurrent writer content is not clobbered');
  delete after.hub[CONNECTIONS];
  const expected = { ...before.hub };
  delete expected[CONNECTIONS];
  assert.deepEqual(after.hub, expected);
  assert.deepEqual(after.repo, before.repo);
});

test('EACCES on the first directory creation leaves nothing behind and no receipt', { skip: (!isPosix || isRoot) && 'needs POSIX permissions as a non-root user' }, async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  await chmod(w.repo, 0o500);
  t.after(() => chmod(w.repo, 0o700).catch(() => {}));
  let caught = null;
  try {
    await applyConnect({ ...args(w), approvedDigest: plan.digest });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught && caught.code === 'EACCES', `expected EACCES, got ${caught}`);
  await chmod(w.repo, 0o700);
  assert.deepEqual(await snap(w), before);
});

// ---------------------------------------------------------------------------
// Terminal ROLLBACK_FAILED (apply-time)
// ---------------------------------------------------------------------------

// After a failed rollback the next plan must show what is left: workspace leftovers as
// CONFLICT, repository leftovers as PRESERVED, or LEGACY (register only, zero repo writes)
// when a harness marker file survived. Either way a retry cannot overwrite anything.
// After a failed apply whose rollback also failed, the hub must still own the story: while a
// pending record survives, the next plan is INTERRUPTED_CONNECT (never LEGACY, never a silent
// resume), and recovering by that id restores both roots.
async function assertInterruptedThenRecover(w, before, label) {
  const after = await snap(w);
  const ids = pendingIdsIn(after.hub);
  if (ids.length === 0) {
    assert.equal((await planConnect(args(w))).detection.status, 'NONE', `${label}: no pending record means no engine debris in the repo`);
    return false;
  }
  assert.equal(ids.length, 1, label);
  const error = await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)), label);
  assert.ok(error.message.includes(ids[0]));
  assert.deepEqual(await snap(w), after, `${label}: a refused plan writes nothing`);
  await rollbackReceipt({ targetPath: w.hub, receiptId: ids[0] });
  assert.deepEqual(await snap(w), before, `${label}: recovery restores both roots`);
  return true;
}

test('apply-time rollback failure: leftovers are enumerated, the next plan is INTERRUPTED_CONNECT (never LEGACY), and recovery finishes the job', async (t) => {
  const fresh = await world(t);
  const plan = await planConnect(args(fresh));
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 4;
  let completed = false;
  let failures = 0;
  let interrupted = 0;
  for (let step = 1; step <= 120 && !completed; step += 1) {
    const w = await world(t);
    const before = await snap(w);
    const p = await planConnect(args(w));
    let caught = null;
    try {
      await applyConnect({ ...args(w), approvedDigest: p.digest, injectFailureAfterWrite: total - 1, injectFailureAfterRollbackWrite: step });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof InstallPlanError, `step ${step}: ${caught}`);
    const after = await snap(w);
    if (caught.code === 'INJECTED_WRITE_FAILURE') {
      completed = true;
      assert.deepEqual(after, before, 'once every rollback step completes the roots are restored');
      continue;
    }
    failures += 1;
    assert.equal(caught.code, 'ROLLBACK_FAILED', `step ${step}`);
    assert.deepEqual(caught.leftovers, { hub: changedPaths(before.hub, after.hub), repo: changedPaths(before.repo, after.repo) }, `step ${step}: leftovers enumerate exactly what is still on disk`);
    for (const item of [...caught.leftovers.hub, ...caught.leftovers.repo]) assert.ok(caught.message.includes(item), `message names ${item}`);
    assert.ok(caught.message.includes('INTERRUPTED_CONNECT') && caught.message.includes('rollbackReceipt'));
    if (await assertInterruptedThenRecover(w, before, `step ${step}`)) interrupted += 1;
  }
  assert.ok(completed && failures >= 10 && interrupted >= 10, `loop must cover many rollback steps (failures ${failures}, interrupted ${interrupted})`);
});

test('an engine failure whose rollback also fails never makes the repository look LEGACY', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  // Failure after the 4th durable write (pending, 3 repo dirs/files), rollback dies on its first step.
  const error = await rejects('ROLLBACK_FAILED', () => applyConnect({ ...args(w), approvedDigest: plan.digest, injectFailureAfterWrite: 12, injectFailureAfterRollbackWrite: 1 }));
  const after = await snap(w);
  assert.ok(Object.keys(after.repo).some((key) => key.endsWith('.md') || key.endsWith('.sh')), 'staged files are still in the repository');
  assert.ok(error.leftovers.repo.length > 0);
  const planError = await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)));
  assert.ok(!/LEGACY/.test(planError.message));
  await put(w.repo, 'SPEC-HARNESS.md', 'marker the engine itself would also have staged');
  await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)));
  await rm(rel(w.repo, 'SPEC-HARNESS.md'));
  // A different repository is not blocked, a different spelling of the same name is.
  const other = await extraRepo(w, 'unrelated');
  assert.equal((await planConnect(args(w, { repoPath: other, name: 'unrelated' }))).detection.status, 'NONE');
  await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w, { repoPath: other, name: 'MY-REPO' })));
  assert.equal((await listPendingConnects({ targetPath: w.hub })).length, 1);
  const [pendingId] = pendingIdsIn(after.hub);
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
  assert.deepEqual(await snap(w), before);
});

test('apply-time rollback fails for real when a created folder is read-only; recovery finishes once it is writable', { skip: (!isPosix || isRoot) && 'needs POSIX permissions as a non-root user' }, async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 4;
  const locked = rel(w.repo, 'ai_rules/rules');
  t.after(() => chmod(locked, 0o700).catch(() => {}));
  const error = await rejects('ROLLBACK_FAILED', () => applyConnect({
    ...args(w),
    approvedDigest: plan.digest,
    injectFailureAfterWrite: total - 1,
    injectBeforeWrite: async (info) => {
      if (info.kind === 'state') await chmod(locked, 0o500);
    },
  }));
  assert.ok(error.leftovers.repo.includes('ai_rules/rules/core.md'), JSON.stringify(error.leftovers));
  assert.ok(error.message.includes('ai_rules/rules/core.md'));
  await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)));
  await chmod(locked, 0o700);
  const [pendingId] = pendingIdsIn(await treeInventory(w.hub));
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
  assert.deepEqual(await snap(w), before);
});

// ---------------------------------------------------------------------------
// Rollback of a connect receipt
// ---------------------------------------------------------------------------

test('rollback restores both roots, files and created directories, and never touches installed state', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const stateBefore = await readFile(rel(w.hub, STATE));
  const result = await connectNow(w);
  assert.deepEqual(await readFile(rel(w.hub, STATE)), stateBefore);
  const rolled = await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.equal(rolled.receiptId, result.receiptId);
  assert.deepEqual(await snap(w), before);
  await rejects('MISSING_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
});

test('rollback restores a pre-existing connections.json to its preimage', async (t) => {
  const w = await world(t);
  const other = await extraRepo(w, 'first-repo');
  await connectNow(w, { repoPath: other });
  const before = await snap(w);
  const second = await connectNow(w);
  await rollbackReceipt({ targetPath: w.hub, receiptId: second.receiptId });
  assert.deepEqual(await snap(w), before);
});

test('rollback of a register-only connection removes the registration and leaves the repo alone', async (t) => {
  const w = await world(t);
  await put(w.repo, 'SPEC-HARNESS.md', 'theirs');
  const before = await snap(w);
  const result = await connectNow(w);
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.deepEqual(await snap(w), before);
});

test('rollback refuses an edited created file in EITHER root with POSTIMAGE_MISMATCH naming root and path, removing nothing; a file already gone counts as undone', async (t) => {
  for (const [root, destination] of [['repo', 'AGENTS.md'], ['repo', 'ai_rules/rules/core.md'], ['hub', '01-Projects/my-repo/README.md'], ['hub', '01-Projects/my-repo/Connection.md']]) {
    const w = await world(t);
    const baseline = await snap(w);
    const result = await connectNow(w);
    const file = rel(root === 'repo' ? w.repo : w.hub, destination);
    const original = await readFile(file);
    await writeFile(file, `${original.toString('utf8')}\nedited`);
    const frozen = await snap(w);
    const error = await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
    assert.ok(error.message.includes(`${root}: ${destination}`), error.message);
    assert.deepEqual(await snap(w), frozen, `${root}:${destination}: nothing removed in either root`);
    await rm(file);
    await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
    assert.deepEqual(await snap(w), baseline, `${root}:${destination}: deleted by the user = already undone`);
  }
});

test('rollback refuses a connection record that no longer matches the receipt, and removes nothing', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  const file = rel(w.hub, CONNECTIONS);
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.connections[result.receiptId].planDigest = 'f'.repeat(64);
  await writeFile(file, JSON.stringify(state));
  const frozen = await snap(w);
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen);
});test('rollback: a replaced file kind (directory in place of a created file) is refused readably and removes nothing', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  await rm(rel(w.repo, 'RULES.md'));
  await mkdir(rel(w.repo, 'RULES.md'));
  const frozen = await snap(w);
  await rejects('NON_REGULAR_FILE', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen);
});

test('rollback: a missing repo is REPO_NOT_DIRECTORY with nothing removed; a deleted connections.json counts as already undone', async (t) => {
  const w = await world(t);
  const baseline = await snap(w);
  const result = await connectNow(w);
  const moved = `${w.repo}-moved`;
  await rename(w.repo, moved);
  const hubFrozen = await treeInventory(w.hub);
  await rejects('REPO_NOT_DIRECTORY', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await treeInventory(w.hub), hubFrozen, 'the hub is untouched when the repo cannot be resolved');
  await rename(moved, w.repo);
  await rm(rel(w.hub, CONNECTIONS));
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.deepEqual(await snap(w), baseline, 'every file is still hash-checked individually, so the missing record is not a blocker');
});

test('rollback: a receipt copied back after a rollback creates nothing and removes only what matches', async (t) => {
  const w = await world(t);
  const baseline = await snap(w);
  const result = await connectNow(w);
  const receiptBytes = await readFile(rel(w.hub, result.receiptPath));
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  await put(w.hub, result.receiptPath, receiptBytes);
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.deepEqual(await snap(w), baseline, 'the replayed receipt is a harmless no-op that removes itself');
  await put(w.repo, 'RULES.md', 'user file at a path the old receipt names');
  await put(w.hub, result.receiptPath, receiptBytes);
  const frozen = await snap(w);
  await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen, 'a user file at a receipt path is never deleted');
});

test('rollback: a tampered or forged connect receipt is INVALID_RECEIPT and removes nothing', async (t) => {
  const tamper = [
    ['extra key', (receipt) => { receipt.extra = 1; }],
    ['missing key', (receipt) => { delete receipt.name; }],
    ['unknown root', (receipt) => { receipt.writes[0].root = 'elsewhere'; }],
    ['write outside the project folder', (receipt) => { const write = receipt.writes.find((item) => item.root === 'hub' && item.destination.startsWith('01-Projects/')); write.destination = 'Home.md'; }],
    ['repo write with a preimage', (receipt) => { receipt.writes.find((item) => item.root === 'repo').preimageSha256 = 'a'.repeat(64); }],
    ['traversing destination', (receipt) => { receipt.writes.find((item) => item.root === 'repo').destination = '../escape.md'; }],
    ['traversing created directory', (receipt) => { receipt.createdDirectories.repo.push('../outside'); }],
    ['duplicate destination', (receipt) => { receipt.writes.push({ ...receipt.writes[0] }); }],
    ['unknown detection', (receipt) => { receipt.detection = 'MAYBE'; }],
    ['schema version', (receipt) => { receipt.schemaVersion = 2; }],
  ];
  for (const [label, change] of tamper) {
    const w = await world(t);
    const result = await connectNow(w);
    const receiptPath = rel(w.hub, result.receiptPath);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    change(receipt);
    await writeFile(receiptPath, JSON.stringify(receipt));
    const frozen = await snap(w);
    let caught = null;
    try {
      await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof InstallPlanError && ['INVALID_RECEIPT', 'INVALID_PATH'].includes(caught.code), `${label}: ${caught}`);
    if (label === 'x') assert.fail();
    assert.deepEqual(await snap(w), frozen, label);
  }
});

test('rollback: a symlink swapped into a created directory is refused before anything is removed', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  const outside = path.join(w.root, 'outside-dir');
  await mkdir(outside);
  await writeFile(path.join(outside, 'core.md'), 'outside');
  await rm(rel(w.repo, 'ai_rules'), { recursive: true });
  await symlink(outside, rel(w.repo, 'ai_rules'));
  const frozenHub = await treeInventory(w.hub);
  await rejects('SYMLINK_PATH', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await treeInventory(w.hub), frozenHub);
  assert.equal(await readFile(path.join(outside, 'core.md'), 'utf8'), 'outside');
});

test('rollback keeps a created directory that is no longer empty and removes the empty ones', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  await put(w.repo, 'specs/their-feature/goal.md', 'user work');
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  const after = await treeInventory(w.repo);
  assert.deepEqual(Object.keys(after).sort(), ['specs', 'specs/their-feature', 'specs/their-feature/goal.md']);
});

test('a rollback interrupted at ANY step by a hook can be retried to completion', async (t) => {
  let completed = false;
  let failures = 0;
  for (let step = 1; step <= 120 && !completed; step += 1) {
    const w = await world(t);
    const before = await snap(w);
    const result = await connectNow(w);
    let caught = null;
    try {
      await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId, injectFailureAfterRollbackWrite: step });
    } catch (error) {
      caught = error;
    }
    const after = await snap(w);
    if (caught === null) {
      completed = true;
      assert.deepEqual(after, before);
      continue;
    }
    failures += 1;
    assert.ok(caught instanceof InstallPlanError && caught.code === 'ROLLBACK_FAILED', `step ${step}: ${caught}`);
    const afterConnect = { hub: changedPaths(before.hub, after.hub), repo: changedPaths(before.repo, after.repo) };
    assert.deepEqual(caught.leftovers, afterConnect, `step ${step}: leftovers enumerate exactly what is still on disk`);
    // The repository files go first and the receipt last, so the same call can always finish.
    if (Object.keys(after.hub).some((key) => key === result.receiptPath)) await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
    assert.deepEqual(await snap(w), before, `step ${step}: the retry completes and restores both roots`);
  }
  assert.ok(completed && failures >= 10, `saw ${failures} failing steps`);
});

test('a rollback killed for real (SIGKILL) at ANY step can be retried to completion', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  let completedAt = null;
  const seen = [];
  for (let step = 1; step <= 120 && completedAt === null; step += 1) {
    const result = await connectNow(w);
    const child = await spawnChild(ROLLBACK_CHILD, { module: installerModule, hub: w.hub, id: result.receiptId, kill: step });
    if (!child.killed) {
      completedAt = step;
      assert.deepEqual(await snap(w), before);
      continue;
    }
    assertKilled(child, `rollback step ${step}`);
    const mid = await snap(w);
    seen.push(`step ${step}: ${Object.keys(mid.repo).filter((key) => mid.repo[key] !== 'directory').length} repo files left, receipt ${Object.keys(mid.hub).some((key) => key.startsWith('.second-brain/receipts/'))}`);
    await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
    assert.deepEqual(await snap(w), before, `rollback killed at step ${step}: the retry restores both roots`);
  }
  assert.ok(completedAt !== null && completedAt > 10, `the loop covered ${completedAt} steps`);
  t.diagnostic(seen.slice(0, 3).concat(seen.slice(-3)).join(' | '));
});


// ---------------------------------------------------------------------------
// Real hard kills during connect (write-ahead pending record)
// ---------------------------------------------------------------------------

test('a SIGKILL at EVERY durable write leaves INTERRUPTED_CONNECT (never LEGACY) and recovery restores both roots', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 4;
  const note = [];
  for (let kill = 1; kill <= total; kill += 1) await killProbe(w, kill, before, plan, note);
  t.diagnostic(note.join('\n'));
  assert.equal(note.length, total);
});

test('a SIGKILL against the REAL vendored harness at the spread of positions (repo dirs, first/middle/last repo file, first hub file, before connections, before receipt, after receipt)', async (t) => {
  const w = await realWorld(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  const repoDirs = plan.directories.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const repoFiles = plan.entries.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const hubDirs = plan.directories.filter((entry) => entry.root === 'hub' && entry.status === 'CREATE').length;
  const hubFiles = plan.entries.filter((entry) => entry.root === 'hub' && entry.kind === 'file' && entry.status === 'CREATE').length;
  const total = 1 + repoDirs + repoFiles + hubDirs + hubFiles + 3;
  const positions = [2, 1 + repoDirs + 1, 1 + repoDirs + Math.floor(repoFiles / 2), 1 + repoDirs + repoFiles, 1 + repoDirs + repoFiles + hubDirs + 1, total - 2, total - 1, total];
  const note = [];
  for (const kill of positions) await killProbe(w, kill, before, plan, note);
  t.diagnostic(note.join('\n'));
  assert.deepEqual(note.map((line) => line.match(/before (\S+)/)[1]), ['directory', 'file', 'file', 'file', 'file', 'state', 'receipt', 'pending-clear']);
});

test('a recovery that is itself killed at ANY step can be run again until it finishes', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  let finishedAt = null;
  for (let step = 1; step <= 120 && finishedAt === null; step += 1) {
    await rm(rel(w.hub, '.second-brain/connect-pending'), { recursive: true, force: true }); // residue of the previous round
    await killConnect(w, 12, plan);
    const [pendingId] = pendingIdsIn((await snap(w)).hub);
    const child = await spawnChild(ROLLBACK_CHILD, { module: installerModule, hub: w.hub, id: pendingId, kill: step });
    if (!child.killed) {
      finishedAt = step;
      assert.deepEqual(await snap(w), before);
      continue;
    }
    assertKilled(child, `recovery step ${step}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ids = pendingIdsIn((await snap(w)).hub);
      const receiptIds = Object.keys((await snap(w)).hub).map((key) => key.match(/^\.second-brain\/receipts\/(tx-[0-9a-f-]{36})\.json$/)?.[1]).filter(Boolean);
      const target = ids[0] ?? receiptIds.find((id) => id === pendingId);
      if (!target) break;
      await rollbackReceipt({ targetPath: w.hub, receiptId: target });
    }
    // One narrow residue is accepted: killed between removing the pending record and removing
    // its (empty) folder, nothing is left to point at, so the empty folder stays.
    const finalTree = await snap(w);
    const residue = { ...finalTree.hub };
    if (residue['.second-brain/connect-pending'] === 'directory' && before.hub['.second-brain/connect-pending'] === undefined && !Object.keys(residue).some((key) => key.startsWith('.second-brain/connect-pending/'))) delete residue['.second-brain/connect-pending'];
    assert.deepEqual({ hub: residue, repo: finalTree.repo }, before, `recovery killed at step ${step}: running it again finishes the job`);
  }
  assert.ok(finishedAt !== null && finishedAt > 10);
});

test('recovery removes only bytes the transaction wrote: a user-edited file is refused and listed, an absent one is skipped, a second run is safe', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  const plan = await planConnect(args(w));
  await killConnect(w, 14, plan);
  const [pendingId] = pendingIdsIn((await snap(w)).hub);
  await writeFile(rel(w.repo, 'AGENTS.md'), 'my own words');
  await rm(rel(w.repo, 'RULES.md'), { force: true });
  const error = await rejects('ROLLBACK_FAILED', () => rollbackReceipt({ targetPath: w.hub, receiptId: pendingId }));
  assert.deepEqual(error.leftovers, { hub: [], repo: ['AGENTS.md'] });
  assert.equal(await readFile(rel(w.repo, 'AGENTS.md'), 'utf8'), 'my own words');
  assert.deepEqual(pendingIdsIn((await snap(w)).hub), [pendingId], 'the pending record stays until the person acts');
  await rejects('INTERRUPTED_CONNECT', () => planConnect(args(w)));
  await rejects('ROLLBACK_FAILED', () => rollbackReceipt({ targetPath: w.hub, receiptId: pendingId }));
  assert.equal(await readFile(rel(w.repo, 'AGENTS.md'), 'utf8'), 'my own words', 'a second run is safe');
  await rm(rel(w.repo, 'AGENTS.md'));
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
  assert.deepEqual(await snap(w), before);
  await rejects('MISSING_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: pendingId }));
});

test('pending records are exact-key validated and a hostile one cannot widen what recovery removes', async (t) => {
  const w = await world(t);
  const plan = await planConnect(args(w));
  await killConnect(w, 6, plan);
  const [pendingId] = pendingIdsIn((await snap(w)).hub);
  const file = rel(w.hub, `.second-brain/connect-pending/${pendingId}.json`);
  const good = JSON.parse(await readFile(file, 'utf8'));
  for (const [label, change] of [
    ['extra key', (record) => { record.extra = 1; }],
    ['traversal in a write', (record) => { record.writes[0].destination = '../outside.md'; }],
    ['traversal in a directory', (record) => { record.directories.repo.push('..'); }],
    ['unknown root', (record) => { record.writes[0].root = 'elsewhere'; }],
    ['wrong id', (record) => { record.pendingId = `tx-${randomUUID()}`; }],
  ]) {
    const record = structuredClone(good);
    change(record);
    await writeFile(file, JSON.stringify(record));
    const frozen = await snap(w);
    let caught = null;
    try {
      await planConnect(args(w));
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof InstallPlanError && ['INVALID_PENDING_CONNECT', 'INVALID_PATH'].includes(caught.code), `${label}: ${caught}`);
    assert.deepEqual(await snap(w), frozen, label);
  }
  await writeFile(file, JSON.stringify(good));
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
});

test('a moved workspace is named in the receipt and pending-record refusals', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  const moved = `${w.hub}-moved`;
  await rename(w.hub, moved);
  const error = await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: moved, receiptId: result.receiptId }));
  assert.ok(/workspace path changed/.test(error.message), error.message);
  await rename(moved, w.hub);
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  const second = await world(t);
  const plan = await planConnect(args(second));
  await killConnect(second, 3, plan);
  const [pendingId] = pendingIdsIn((await snap(second)).hub);
  const movedSecond = `${second.hub}-moved`;
  await rename(second.hub, movedSecond);
  const pendingError = await rejects('INVALID_PENDING_CONNECT', () => rollbackReceipt({ targetPath: movedSecond, receiptId: pendingId }));
  assert.ok(/workspace path changed/.test(pendingError.message), pendingError.message);
});

// ---------------------------------------------------------------------------
// Rolling back the workspace's own init or upgrade receipt (R05-7)
// ---------------------------------------------------------------------------

test('the workspace init receipt cannot be rolled back while connections or interrupted connects exist, and behaves as before without them', async (t) => {
  const w = await world(t);
  const initReceipts = Object.keys((await snap(w)).hub).filter((key) => /^\.second-brain\/receipts\/tx-/.test(key));
  assert.equal(initReceipts.length, 1);
  const initId = initReceipts[0].match(/tx-[0-9a-f-]{36}/)[0];
  const connected = await connectNow(w);
  let frozen = await snap(w);
  const error = await rejects('CONNECTIONS_PRESENT', () => rollbackReceipt({ targetPath: w.hub, receiptId: initId }));
  assert.ok(error.message.includes(connected.receiptId));
  assert.deepEqual(await snap(w), frozen, 'nothing written');
  await rollbackReceipt({ targetPath: w.hub, receiptId: connected.receiptId });
  // An interrupted connect also blocks it, and the message names the pending id.
  const plan = await planConnect(args(w));
  await killConnect(w, 4, plan);
  frozen = await snap(w);
  const [pendingId] = pendingIdsIn(frozen.hub);
  const blocked = await rejects('CONNECTIONS_PRESENT', () => rollbackReceipt({ targetPath: w.hub, receiptId: initId }));
  assert.ok(blocked.message.includes(pendingId));
  assert.deepEqual(await snap(w), frozen);
  await rollbackReceipt({ targetPath: w.hub, receiptId: pendingId });
  // With nothing left, the hub's own rollback works exactly as before.
  const done = await rollbackReceipt({ targetPath: w.hub, receiptId: initId });
  assert.equal(done.receiptId, initId);
});

// ---------------------------------------------------------------------------
// link() fallback
// ---------------------------------------------------------------------------

test('when link() is unavailable (ENOTSUP, EXDEV, EPERM) the fallback still never clobbers a file that appears', async (t) => {
  for (const code of ['ENOTSUP', 'EXDEV', 'EPERM']) {
    const works = await world(t);
    const result = await connectNow(works, { injectLinkFailure: code });
    assert.equal(result.applied, true, `${code}: the fallback path writes the same files`);
    for (const file of works.harnessFiles) {
      assert.deepEqual(await readFile(rel(works.repo, file.destination)), referenceRender(works.harnessManifest, file, file.text, 'my-repo'), `${code} ${file.destination}`);
    }
    const w = await world(t);
    const before = await snap(w);
    const plan = await planConnect(args(w));
    await rejects('CONCURRENT_MODIFICATION', () => applyConnect({
      ...args(w),
      approvedDigest: plan.digest,
      injectLinkFailure: code,
      injectBeforeWrite: async (info) => {
        if (info.root === 'repo' && info.destination === 'RULES.md') await writeFile(rel(w.repo, 'RULES.md'), 'someone else got there first');
      },
    }));
    const after = await snap(w);
    assert.equal(after.repo['RULES.md'], `file:${digestOf('someone else got there first')}`, `${code}: the foreign file is intact`);
    delete after.repo['RULES.md'];
    assert.deepEqual(after, before, `${code}: everything else is rolled back`);
  }
});

// ---------------------------------------------------------------------------
// readConnections
// ---------------------------------------------------------------------------

test('readConnections is read-only: empty when absent, symlink refused, records listed after a connect', async (t) => {
  const w = await world(t);
  const before = await snap(w);
  assert.deepEqual(await readConnections({ targetPath: w.hub }), { path: CONNECTIONS, connectionsSha256: null, connections: {} });
  assert.deepEqual(await snap(w), before);
  const result = await connectNow(w);
  const listed = await readConnections({ targetPath: w.hub });
  assert.equal(listed.connections[result.connectionId].name, 'my-repo');
  assert.equal(listed.connectionsSha256, digestOf(await readFile(rel(w.hub, CONNECTIONS))));
});

// ---------------------------------------------------------------------------
// The REAL vendored harness
// ---------------------------------------------------------------------------

async function realWorld(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-real-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestBytes = await readFile(path.join(realSourceRoot, 'template-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const w = { root, hub: path.join(root, 'hub'), repo: path.join(root, 'client repo $(touch x)'), manifest, manifestBytes, sourceRoot: realSourceRoot };
  await mkdir(w.hub);
  await mkdir(w.repo);
  const plan = await planInstall({ manifest, manifestBytes, sourceRoot: realSourceRoot, targetPath: w.hub });
  await applyInstall({ manifest, manifestBytes, sourceRoot: realSourceRoot, targetPath: w.hub, approvedDigest: plan.digest });
  return w;
}

async function readRealHarness() {
  const harness = await readHarnessManifest({ sourceRoot: realSourceRoot });
  const sources = new Map();
  for (const entry of harness.entries) sources.set(entry.destination, entry.sourceBytes.toString('utf8'));
  return { harness, sources };
}

test('real manifest: connect into an empty repo creates exactly the manifest destination set with byte-equal rendered content', async (t) => {
  const w = await realWorld(t);
  const { harness, sources } = await readRealHarness();
  const before = await snap(w);
  const stateBefore = await readFile(rel(w.hub, STATE));
  const result = await connectNow(w);
  assert.deepEqual(await readFile(rel(w.hub, STATE)), stateBefore);
  const repoAfter = await treeInventory(w.repo);
  const files = Object.keys(repoAfter).filter((key) => repoAfter[key] !== 'directory').sort();
  assert.deepEqual(files, harness.manifest.entries.map((entry) => entry.destination).sort(), 'enumerated set equality');
  const dirs = Object.keys(repoAfter).filter((key) => repoAfter[key] === 'directory').sort();
  assert.deepEqual(dirs, expectedRepoDirectories(harness.manifest.entries, harness.manifest.directories));
  for (const required of ['specs', 'learning/lessons']) assert.ok(dirs.includes(required), required);
  const name = 'client repo $(touch x)';
  for (const entry of harness.manifest.entries) {
    assert.deepEqual(await readFile(rel(w.repo, entry.destination)), referenceRender(harness.manifest, entry, sources.get(entry.destination), name), entry.destination);
  }
  assert.equal((await readdir(w.repo)).includes('x'), false, 'the $( sequence in the name never executes anything');
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.deepEqual(await snap(w), before);
});

test('real manifest: hostile names render byte-equal to the independent reference for every entry; forbidden names are refused', async (t) => {
  const { harness, sources } = await readRealHarness();
  for (const name of ['A$&B$$C', 'X{{PROJECT_NAME}}Y', 'has {{DIR}} inside', 'unicode éè 日本', 'two  spaces', "quote's $1 $` $'"]) {
    for (const entry of harness.manifest.entries) {
      const rendered = renderHarnessEntry(harness.entries.find((item) => item.destination === entry.destination), name, harness);
      assert.deepEqual(rendered, referenceRender(harness.manifest, entry, sources.get(entry.destination), name), `${name} :: ${entry.destination}`);
    }
  }
  const w = await realWorld(t);
  for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a/b', 'a\\b', '']) {
    await rejects('INVALID_CONNECTION_NAME', () => planConnect(args(w, { name: bad })));
  }
});

test('real manifest: a hostile name that is also a legal folder applies and rolls back cleanly', async (t) => {
  const w = await realWorld(t);
  const before = await snap(w);
  const result = await connectNow(w, { name: 'X{{PROJECT_NAME}}Y' });
  assert.ok((await readFile(rel(w.repo, 'SPEC-HARNESS.md'), 'utf8')).includes('X{{PROJECT_NAME}}Y'));
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  assert.deepEqual(await snap(w), before);
});

test('cross-check: the vendored bash installer and applyConnect produce the same tree (loop.sh mode is the documented difference)', { skip: !isPosix && 'bash installer is not native Windows' }, async (t) => {
  const w = await realWorld(t);
  const reference = path.join(w.root, 'bash-target');
  await mkdir(reference);
  const name = 'cross check $(x)';
  try {
    await run('bash', [path.join(realSourceRoot, 'vendor', 'spec-harness', 'bin', 'sh-install.sh'), reference, 'integrate', name], { cwd: w.root });
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('bash is not available');
    throw error;
  }
  await connectNow(w, { name });
  const bash = await treeInventory(reference);
  const ours = await treeInventory(w.repo);
  assert.deepEqual(ours, bash, 'diff -r equivalent: same files, same bytes, same directories');
  assert.ok(((await lstat(path.join(reference, 'loop.sh'))).mode & 0o111) !== 0, 'bash installer stages loop.sh executable');
  assert.equal((await lstat(rel(w.repo, 'loop.sh'))).mode & 0o111, 0, 'connect stages loop.sh without the executable bit (documented, D3-c)');
});

test('compat: a real v1.2.0 install (fixture) is connectable and its installed state, verify result and bytes are untouched', async (t) => {
  const fixture = JSON.parse(await readFile(path.join(realSourceRoot, 'test', 'fixtures', 'v1.2.0-install.json'), 'utf8'));
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-v120-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = path.join(root, 'hub');
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  for (const [destination, content] of Object.entries(fixture.files)) await put(hub, destination, content);
  await put(hub, STATE, `${(await import('../lib/installer.mjs')).stableStringify(fixture.state)}\n`);
  await put(hub, fixture.receiptPath, `${(await import('../lib/installer.mjs')).stableStringify(fixture.receipt)}\n`);
  const manifestBytes = await readFile(path.join(realSourceRoot, 'template-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const stateBefore = await readFile(rel(hub, STATE));
  const verifyArgs = { manifest, manifestBytes, sourceRoot: realSourceRoot, targetPath: hub };
  const verifyBefore = await verifyInstall(verifyArgs);
  const subject = { ...verifyArgs, repoPath: repo };
  const plan = await planConnect(subject);
  const result = await applyConnect({ ...subject, approvedDigest: plan.digest });
  assert.deepEqual(await readFile(rel(hub, STATE)), stateBefore);
  assert.deepEqual(await verifyInstall(verifyArgs), verifyBefore);
  await rollbackReceipt({ targetPath: hub, receiptId: result.receiptId });
  assert.deepEqual(await readFile(rel(hub, STATE)), stateBefore);
});

// ---------------------------------------------------------------------------
// Static guards on the engine source
// ---------------------------------------------------------------------------

const FORBIDDEN_ENGINE_PATTERN = /child_process|execFile|\bspawn\b|node:net|\bfetch\(|node:http|node:dgram|node:dns/;

test('the engine has no child_process, network or git invocation (positive control: the pattern fires on planted text)', async () => {
  assert.ok(FORBIDDEN_ENGINE_PATTERN.test("import { execFile } from 'node:child_process';"), 'control: child_process');
  assert.ok(FORBIDDEN_ENGINE_PATTERN.test('await fetch(url)'), 'control: fetch');
  const lib = path.join(realSourceRoot, 'lib');
  const names = (await readdir(lib)).filter((name) => name.endsWith('.mjs'));
  assert.ok(names.includes('connect.mjs') && names.includes('installer.mjs'), 'the scan covers the engine files');
  for (const name of names) {
    assert.ok(!FORBIDDEN_ENGINE_PATTERN.test(await readFile(path.join(lib, name), 'utf8')), `${name} must not shell out or use the network`);
  }
});
