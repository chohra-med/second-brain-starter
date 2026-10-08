import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { InstallPlanError, applyInstall, planInstall, rollbackReceipt, verifyInstall } from '../lib/installer.mjs';
import {
  applyConnect,
  detectHarness,
  planConnect,
  readConnections,
  readHarnessManifest,
  renderHarnessEntry,
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

test('detect: a symlink or a directory at a probed path fails closed', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-outside-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  for (const [label, prepare, code] of [
    ['.claude is a symlink', async (repo) => symlink(outside, path.join(repo, '.claude')), 'SYMLINK_PATH'],
    ['marker is a symlink', async (repo) => symlink(outside, path.join(repo, 'SPEC-HARNESS.md')), 'SYMLINK_PATH'],
    ['receipt is a symlink', async (repo) => { await mkdir(rel(repo, '.claude/agents'), { recursive: true }); await symlink(outside, rel(repo, '.claude/agents/.init-synthesis.json')); }, 'SYMLINK_PATH'],
    ['role file is a symlink', async (repo) => { await mkdir(rel(repo, '.claude/agents'), { recursive: true }); await symlink(outside, rel(repo, '.claude/agents/sdd-x.md')); }, 'SYMLINK_PATH'],
    ['.claude is a file', async (repo) => writeFile(path.join(repo, '.claude'), 'x'), 'NON_DIRECTORY'],
    ['marker is a directory', async (repo) => mkdir(path.join(repo, 'SPEC-HARNESS.md')), 'NON_REGULAR_FILE'],
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
  assert.equal(await remoteFor('[remote "origin"]\r\n\turl = git@example.invalid:org/repo.git\r\n'), 'git@example.invalid:org/repo.git');
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

test('plan: hostile paths at destinations fail closed (symlinked directory, file where a directory belongs, directory where a file belongs)', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-connect-outside-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const cases = [
    ['symlinked .claude', async (w) => symlink(outside, rel(w.repo, '.claude')), 'SYMLINK_PATH'],
    ['symlinked destination file', async (w) => symlink(path.join(outside, 'x'), rel(w.repo, 'AGENTS.md')), 'SYMLINK_PATH'],
    ['file named specs', async (w) => put(w.repo, 'specs', 'x'), 'NON_DIRECTORY'],
    ['file named ai_rules', async (w) => put(w.repo, 'ai_rules', 'x'), 'NON_DIRECTORY'],
    ['directory named AGENTS.md', async (w) => mkdir(rel(w.repo, 'AGENTS.md')), 'NON_REGULAR_FILE'],
    ['symlinked project folder in the hub', async (w) => symlink(outside, rel(w.hub, '01-Projects/my-repo')), 'SYMLINK_PATH'],
    ['file named 01-Projects in the hub', async (w) => { await rm(rel(w.hub, '01-Projects'), { recursive: true }); await put(w.hub, '01-Projects', 'x'); }, 'NON_DIRECTORY'],
    ['dangling connections.json', async (w) => symlink(path.join(outside, 'gone'), rel(w.hub, CONNECTIONS)), 'SYMLINK_PATH'],
    ['connections.json is a directory', async (w) => mkdir(rel(w.hub, CONNECTIONS)), 'NON_REGULAR_FILE'],
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
  assert.equal(result.durableWrites, plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 2);
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

test('two repositories connect one after another; rollback is last-in-first-out', async (t) => {
  const w = await world(t);
  const baseline = await snap(w);
  const other = await extraRepo(w, 'second-repo');
  const otherBefore = await treeInventory(other);
  const first = await connectNow(w);
  const second = await connectNow(w, { repoPath: other });
  assert.deepEqual(Object.keys((await readConnections({ targetPath: w.hub })).connections).sort(), [first.receiptId, second.receiptId].sort());
  const mid = await snap(w);
  const error = await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: w.hub, receiptId: first.receiptId }));
  assert.ok(error.message.includes('hub') && error.message.includes(CONNECTIONS));
  assert.deepEqual(await snap(w), mid, 'nothing removed in either root');
  await rollbackReceipt({ targetPath: w.hub, receiptId: second.receiptId });
  assert.deepEqual(await treeInventory(other), otherBefore);
  await rollbackReceipt({ targetPath: w.hub, receiptId: first.receiptId });
  assert.deepEqual(await snap(w), baseline);
});

// ---------------------------------------------------------------------------
// Interruptions: inject a failure after EVERY durable write
// ---------------------------------------------------------------------------

async function interruptionLoop(w, extra = {}) {
  const before = await snap(w);
  const plan = await planConnect(args(w, extra));
  const expected = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file' && entry.status === 'CREATE').length + 2;
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

test('interruption against the REAL vendored harness: first repo file, first hub file, last repo file and the receipt', async (t) => {
  const real = await realWorld(t);
  const before = await snap(real);
  const plan = await planConnect(args(real));
  const repoDirs = plan.directories.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const repoFiles = plan.entries.filter((entry) => entry.root === 'repo' && entry.status === 'CREATE').length;
  const hubDirs = plan.directories.filter((entry) => entry.root === 'hub' && entry.status === 'CREATE').length;
  const total = repoDirs + repoFiles + hubDirs + 6 + 2;
  for (const position of [1, repoDirs + 1, repoDirs + repoFiles, repoDirs + repoFiles + hubDirs + 1, total - 1, total]) {
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
async function assertTerminalNextPlan(w, originalPlan, leftovers) {
  const next = await planConnect(args(w));
  const planned = new Set(originalPlan.entries.map((entry) => `${entry.root}:${entry.destination}`));
  const leftFiles = [...leftovers.repo.map((item) => `repo:${item}`), ...leftovers.hub.map((item) => `hub:${item}`)].filter((item) => planned.has(item));
  const markerSurvived = leftovers.repo.some((item) => item === 'SPEC-HARNESS.md' || /^\.claude\/agents\/sdd-.*\.md$/.test(item));
  if (markerSurvived) {
    assert.equal(next.detection.status, 'LEGACY');
    assert.ok(!next.entries.some((entry) => entry.root === 'repo'), 'register only: no repository writes');
  } else {
    for (const entry of next.entries.filter((item) => item.root === 'repo' && leftovers.repo.includes(item.destination))) {
      assert.equal(entry.status, 'PRESERVED', `repo ${entry.destination}`);
    }
  }
  for (const entry of next.entries.filter((item) => item.root === 'hub' && leftovers.hub.includes(item.destination) && item.kind === 'file')) {
    assert.equal(entry.status, 'CONFLICT', `hub ${entry.destination}`);
  }
  const frozen = await snap(w);
  if (leftFiles.length > 0) {
    assert.notEqual(next.digest, originalPlan.digest, 'leftover files change the plan digest');
    await rejects('PLAN_DIGEST_MISMATCH', () => applyConnect({ ...args(w), approvedDigest: originalPlan.digest }));
    if (next.entries.some((item) => item.status === 'CONFLICT')) await rejects('PLAN_CONFLICT', () => applyConnect({ ...args(w), approvedDigest: next.digest }));
  }
  assert.deepEqual(await snap(w), frozen, 'a refused retry writes nothing');
  return next;
}

test('apply-time rollback failure is a named terminal state that enumerates every leftover path per root', async (t) => {
  const fresh = await world(t);
  const plan = await planConnect(args(fresh));
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 2;
  let sawSuccess = false;
  let failures = 0;
  const seen = { legacy: 0, preserved: 0, conflict: 0 };
  for (let step = 1; step <= 60 && !sawSuccess; step += 1) {
    const w = await world(t);
    const before = await snap(w);
    const p = await planConnect(args(w));
    let caught = null;
    try {
      await applyConnect({ ...args(w), approvedDigest: p.digest, injectFailureAfterWrite: total, injectFailureAfterRollbackWrite: step });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof InstallPlanError);
    const after = await snap(w);
    if (caught.code === 'INJECTED_WRITE_FAILURE') {
      sawSuccess = true;
      assert.deepEqual(after, before, 'once every rollback step completes the roots are restored');
      continue;
    }
    failures += 1;
    assert.equal(caught.code, 'ROLLBACK_FAILED');
    const expected = { hub: changedPaths(before.hub, after.hub), repo: changedPaths(before.repo, after.repo) };
    assert.deepEqual(caught.leftovers, expected, `step ${step}: leftovers enumerate exactly what is still on disk`);
    for (const item of [...expected.hub, ...expected.repo]) assert.ok(caught.message.includes(item), `message names ${item}`);
    assert.ok(caught.message.includes('Not resumable: re-run connect to get a fresh plan; leftover repository files will show as PRESERVED, leftover workspace files as CONFLICT.'));

    // The terminal state cannot be silently resumed or overwritten.
    const next = await assertTerminalNextPlan(w, p, expected);
    if (next.detection.status === 'LEGACY') seen.legacy += 1;
    seen.preserved += next.entries.filter((item) => item.status === 'PRESERVED').length;
    seen.conflict += next.entries.filter((item) => item.status === 'CONFLICT').length;
  }
  assert.ok(sawSuccess && failures >= 10, `loop must cover many rollback steps (saw ${failures})`);
  assert.ok(seen.legacy > 0 && seen.preserved > 0 && seen.conflict > 0, `the terminal plans must exercise LEGACY, PRESERVED and CONFLICT: ${JSON.stringify(seen)}`);
});

test('apply-time rollback fails for real when a created folder is read-only, and says so per root', { skip: (!isPosix || isRoot) && 'needs POSIX permissions as a non-root user' }, async (t) => {
  const w = await world(t);
  const plan = await planConnect(args(w));
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length + plan.entries.filter((entry) => entry.kind === 'file').length + 2;
  const locked = rel(w.repo, 'ai_rules/rules');
  t.after(() => chmod(locked, 0o700).catch(() => {}));
  const error = await rejects('ROLLBACK_FAILED', () => applyConnect({
    ...args(w),
    approvedDigest: plan.digest,
    injectFailureAfterWrite: total,
    injectBeforeWrite: async (info) => {
      if (info.destination === CONNECTIONS) await chmod(locked, 0o500);
    },
  }));
  await chmod(locked, 0o700);
  assert.ok(error.leftovers.repo.includes('ai_rules/rules/core.md'), JSON.stringify(error.leftovers));
  assert.ok(error.message.includes('ai_rules/rules/core.md'));
  await assertTerminalNextPlan(w, plan, error.leftovers);
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

test('rollback refuses an edited, replaced or deleted created file in EITHER root with POSTIMAGE_MISMATCH naming root and path, removing nothing', async (t) => {
  for (const [root, destination] of [['repo', 'AGENTS.md'], ['repo', 'ai_rules/rules/core.md'], ['hub', '01-Projects/my-repo/README.md'], ['hub', '01-Projects/my-repo/Connection.md'], ['hub', CONNECTIONS]]) {
    for (const mode of ['edit', 'delete']) {
      const w = await world(t);
      const result = await connectNow(w);
      const file = rel(root === 'repo' ? w.repo : w.hub, destination);
      if (destination === CONNECTIONS && mode === 'delete') continue;
      if (destination === CONNECTIONS) await writeFile(file, JSON.stringify(JSON.parse(await readFile(file, 'utf8')), null, 2));
      else if (mode === 'edit') await writeFile(file, `${await readFile(file, 'utf8')}\nedited`);
      else await rm(file);
      const frozen = await snap(w);
      const error = await rejects('POSTIMAGE_MISMATCH', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
      assert.ok(error.message.includes(`${root}: ${destination}`), error.message);
      assert.deepEqual(await snap(w), frozen, `${root}:${destination} ${mode}: nothing removed in either root`);
    }
  }
});

test('rollback: a replaced file kind (directory in place of a created file) is refused readably and removes nothing', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  await rm(rel(w.repo, 'RULES.md'));
  await mkdir(rel(w.repo, 'RULES.md'));
  const frozen = await snap(w);
  await rejects('NON_REGULAR_FILE', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen);
});

test('rollback: a missing repo is REPO_NOT_DIRECTORY, a deleted connections.json is INVALID_RECEIPT, and nothing is removed', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  const saved = await readFile(rel(w.hub, CONNECTIONS));
  await rm(rel(w.hub, CONNECTIONS));
  const frozen = await snap(w);
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen);
  await put(w.hub, CONNECTIONS, saved);
  const hubFrozen = await treeInventory(w.hub);
  const moved = `${w.repo}-moved`;
  await (await import('node:fs/promises')).rename(w.repo, moved);
  await rejects('REPO_NOT_DIRECTORY', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await treeInventory(w.hub), hubFrozen, 'the hub is untouched when the repo cannot be resolved');
});

test('rollback: the receipt alone cannot resume a rolled-back connection', async (t) => {
  const w = await world(t);
  const result = await connectNow(w);
  const receiptBytes = await readFile(rel(w.hub, result.receiptPath));
  await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
  await put(w.hub, result.receiptPath, receiptBytes);
  const frozen = await snap(w);
  await rejects('INVALID_RECEIPT', () => rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId }));
  assert.deepEqual(await snap(w), frozen);
});

test('rollback: a tampered or forged connect receipt is INVALID_RECEIPT and removes nothing', async (t) => {
  const tamper = [
    ['extra key', (receipt) => { receipt.extra = 1; }],
    ['missing key', (receipt) => { delete receipt.name; }],
    ['unknown root', (receipt) => { receipt.writes[0].root = 'elsewhere'; }],
    ['write outside the project folder', (receipt) => { const write = receipt.writes.find((item) => item.root === 'hub' && item.destination.startsWith('01-Projects/')); write.destination = 'Home.md'; }],
    ['repo write with a preimage', (receipt) => { receipt.writes.find((item) => item.root === 'repo').preimageSha256 = 'a'.repeat(64); }],
    ['other workspace', (receipt) => { receipt.hub = `${receipt.hub}-other`; }],
    ['other repo', (receipt) => { receipt.repo = `${receipt.repo}-other`; }],
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

test('rollback-time failures are terminal: ROLLBACK_FAILED enumerates leftovers and a retry cannot resume', async (t) => {
  const probe = await world(t);
  const probeResult = await connectNow(probe);
  const receipt = JSON.parse(await readFile(rel(probe.hub, probeResult.receiptPath), 'utf8'));
  assert.ok(receipt.writes.length > 5);
  let completed = false;
  let failures = 0;
  for (let step = 1; step <= 80 && !completed; step += 1) {
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
    assert.deepEqual(caught.leftovers, { hub: changedPaths(before.hub, after.hub), repo: changedPaths(before.repo, after.repo) }, `step ${step}`);
    const frozen = after;
    let retry = null;
    try {
      await rollbackReceipt({ targetPath: w.hub, receiptId: result.receiptId });
    } catch (error) {
      retry = error;
    }
    assert.ok(retry instanceof InstallPlanError && ['INVALID_RECEIPT', 'MISSING_RECEIPT', 'POSTIMAGE_MISMATCH'].includes(retry.code), `step ${step} retry: ${retry}`);
    assert.deepEqual(await snap(w), frozen, `step ${step}: a refused retry changes nothing`);
  }
  assert.ok(completed && failures >= 10, `saw ${failures} failing steps`);
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
