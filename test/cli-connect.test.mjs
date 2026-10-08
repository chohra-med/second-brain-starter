import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { applyConnect, listPendingConnects, planConnect } from '../lib/connect.mjs';
import { rollbackReceipt } from '../lib/installer.mjs';
import { appliedReceipt, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const run = promisify(execFileCallback);
const isPosix = process.platform !== 'win32';
const RECEIPT_ID = /tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (root, posixPath) => path.join(root, ...posixPath.split('/'));
const linesOf = (text) => text.split(/\r?\n/);
const hasLine = (text, line) => linesOf(text).includes(line);

// Regular files and folders under a root, with a content digest per file (same shape as the engine tests).
async function inventory(root) {
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

const snapshot = async (w) => ({ hub: await inventory(w.hub), repo: await inventory(w.repo) });
const regularFiles = (inv) => Object.keys(inv).filter((key) => inv[key].startsWith('file:')).sort();

async function vendoredManifest() {
  return JSON.parse(await readFile(path.join(sourceRoot, 'vendor', 'spec-harness', 'install-manifest.json'), 'utf8'));
}

// One workspace initialised by the real CLI (plan, then the exact digest), and one plain repository named "app".
async function workspace(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-cli-connect-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = path.join(root, 'hub');
  const repo = path.join(root, 'app');
  await mkdir(repo);
  const planned = await runCli(['init', '--target', hub]);
  const initialised = await runCli(['init', '--target', hub, '--apply', planDigest(planned.stdout)]);
  assert.equal(initialised.code, undefined, initialised.stdout);
  return { root, hub, repo, initReceipt: appliedReceipt(initialised.stdout) };
}

const connectArgs = (w, extra = []) => ['connect', '--target', w.hub, '--repo', w.repo, ...extra];

// The engine, called in-process for setup only (no spawned process). Same inputs as the CLI.
async function engine(w, extra = {}) {
  const manifestBytes = await readFile(path.join(sourceRoot, 'template-manifest.json'));
  return { manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot, targetPath: w.hub, repoPath: w.repo, ...extra };
}

async function connectInProcess(w, extra = {}) {
  const args = await engine(w, extra);
  const plan = await planConnect(args);
  return applyConnect({ ...args, approvedDigest: plan.digest });
}

// An apply that fails and whose undo also fails: a pending record survives and some files are still in place.
async function interruptedApply(w) {
  const args = await engine(w);
  const plan = await planConnect(args);
  let caught = null;
  try {
    // Positions: the pending record (1), the repository folders the plan creates, then repository files in plan order.
    // This fails right after the second repository file: the undo removes the first and fails before the second.
    const repoFolders = plan.directories.filter((item) => item.root === 'repo' && item.status === 'CREATE').length;
    await applyConnect({ ...args, approvedDigest: plan.digest, injectFailureAfterWrite: 3 + repoFolders, injectFailureAfterRollbackWrite: 1 });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, 'ROLLBACK_FAILED', 'the injected apply must leave a pending record');
  const [pending] = (await listPendingConnects({ targetPath: w.hub })).filter((item) => item.kind === 'pending');
  assert.ok(pending, 'a pending record exists');
  return pending;
}

const KILL_CHILD = `
import { readFileSync, writeSync } from 'node:fs';
const cfg = JSON.parse(process.env.SB_CFG);
const { applyConnect } = await import(cfg.module);
const manifestBytes = readFileSync(cfg.manifest);
let calls = 0;
await applyConnect({
  manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot: cfg.sourceRoot,
  targetPath: cfg.hub, repoPath: cfg.repo, approvedDigest: cfg.digest,
  injectBeforeWrite: async (info) => {
    calls += 1;
    if (calls !== cfg.kill) return;
    writeSync(1, 'KILLED ' + JSON.stringify({ kind: info.kind }) + '\\n');
    try { process.kill(process.pid, 'SIGKILL'); } catch { process.exit(137); }
    await new Promise(() => {});
  },
});
`;

// A real SIGKILL at the point after the pending record is cleared: the connect is committed, only the marker is left.
async function killedAfterCommit(w) {
  const args = await engine(w);
  const plan = await planConnect(args);
  const total = plan.directories.filter((entry) => entry.status === 'CREATE').length
    + plan.entries.filter((entry) => entry.kind === 'file' && entry.status === 'CREATE').length + 4;
  const config = { module: pathToFileURL(path.join(sourceRoot, 'lib', 'connect.mjs')).href, manifest: path.join(sourceRoot, 'template-manifest.json'), sourceRoot, hub: w.hub, repo: w.repo, digest: plan.digest, kill: total };
  let child = null;
  try {
    await run(process.execPath, ['--input-type=module', '-e', KILL_CHILD], { env: { ...process.env, SB_CFG: JSON.stringify(config) }, windowsHide: true });
  } catch (error) {
    child = error;
  }
  assert.ok(child, 'the child must have been killed, not finished');
  assert.match(String(child.stdout), /KILLED \{"kind":"pending-clear"\}/);
}

// ---------------------------------------------------------------------------
// Plan, approval and apply
// ---------------------------------------------------------------------------

test('connect without --apply prints the complete two-root plan, the digest, and writes nothing in either root', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const planned = await runCli(connectArgs(w));
  assert.equal(planned.code, undefined, planned.stdout + planned.stderr);
  const out = planned.stdout;
  assert.ok(hasLine(out, 'Plan: connect'));
  assert.ok(hasLine(out, `Target: ${w.hub}`));
  assert.ok(hasLine(out, `Repository: ${w.repo}`));
  assert.ok(hasLine(out, 'Name: app'));
  assert.ok(hasLine(out, 'Detection: NONE (no harness files found)'));
  assert.ok(hasLine(out, 'CREATE\trepo:AGENTS.md\tundo=remove-created-file'));
  assert.ok(hasLine(out, 'CREATE\thub:01-Projects/app/FACTS.md\tundo=remove-created-file'));
  assert.ok(hasLine(out, 'Preserved: 0 files kept unchanged'));
  assert.ok(hasLine(out, 'Nothing is committed. These files are uncommitted in the repository; the team decides whether they go in by pull request.'));
  assert.match(out, /^Harness: spec-harness \S+ at [0-9a-f]{40}$/m);
  assert.match(out, /^Plan digest: [a-f0-9]{64}$/m);
  assert.ok(hasLine(out, 'Plan not applied.'), 'without --apply, the non-terminal run only plans');
  const again = await runCli(connectArgs(w));
  assert.equal(planDigest(again.stdout), planDigest(out), 'the same inputs give the same digest');
  assert.deepEqual(await snapshot(w), before);
});

test('connect --apply with a digest for another name or another repository is refused with nothing written', async (t) => {
  const w = await workspace(t);
  const other = path.join(w.root, 'other');
  await mkdir(other);
  const before = await snapshot(w);
  const forApp = planDigest((await runCli(connectArgs(w))).stdout);
  const otherName = await runCli(connectArgs(w, ['--name', 'mine']));
  const wrongName = await runCli(connectArgs(w, ['--name', 'mine', '--apply', forApp]));
  assert.equal(wrongName.code, 1);
  assert.match(wrongName.stdout, /^PLAN_DIGEST_MISMATCH: Plan digest did not match\. No files were changed\.$/m);
  const wrongRepo = await runCli(['connect', '--target', w.hub, '--repo', other, '--apply', forApp]);
  assert.equal(wrongRepo.code, 1);
  assert.match(wrongRepo.stdout, /PLAN_DIGEST_MISMATCH/);
  assert.ok(planDigest(otherName.stdout) !== forApp);
  assert.deepEqual(await snapshot(w), before);
  assert.deepEqual(await inventory(other), {});
});

test('connect --apply stages the full harness set, says STAGED with the next step, and never says initialised for a NONE repository', async (t) => {
  const w = await workspace(t);
  const planned = await runCli(connectArgs(w));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.equal(applied.code, undefined, applied.stdout + applied.stderr);
  const out = applied.stdout;
  assert.ok(appliedReceipt(out), 'prints Applied receipt');
  assert.ok(hasLine(out, 'Status: STAGED'));
  assert.match(out, /^Next: open .+ in your client and run \/sdd init there\. The repository is STAGED until \.claude\/agents\/\.init-synthesis\.json exists\.$/m);
  assert.ok(hasLine(out, 'Nothing is committed: connect ran no git command. The files it created are uncommitted; your team decides whether they go in by pull request.'));
  for (const text of [planned.stdout, out]) {
    const outside = linesOf(text).map((line) => line.replace('.claude/agents/.init-synthesis.json', ''));
    assert.deepEqual(outside.filter((line) => /initiali[sz]ed/i.test(line)), [], 'no line outside the receipt path says initialised');
  }
  const manifest = await vendoredManifest();
  assert.deepEqual(regularFiles(await inventory(w.repo)), manifest.entries.map((entry) => entry.destination).sort(), 'the staged set is exactly the vendored manifest destinations');
  for (const destination of ['01-Projects/app/README.md', '01-Projects/app/Connection.md']) {
    assert.ok((await lstat(rel(w.hub, destination))).isFile(), destination);
  }
  assert.ok((await lstat(rel(w.repo, '.claude/commands/sdd.md'))).isFile(), 'the harness entry the hand-off names');
  assert.ok(hasLine(out, `Record: ${path.join(w.hub, '01-Projects', 'app', 'Connection.md')}`));
});

test('connect with a differing root AGENTS.md prints the vendored loader block verbatim, and the file is byte-identical after apply', async (t) => {
  const w = await workspace(t);
  await writeFile(path.join(w.repo, 'AGENTS.md'), '# My own rules\n');
  const planned = await runCli(connectArgs(w));
  assert.ok(hasLine(planned.stdout, 'PRESERVED\trepo:AGENTS.md\tundo=none (differs)'));
  assert.ok(hasLine(planned.stdout, 'Preserved: 1 files kept unchanged'));
  assert.ok(hasLine(planned.stdout, '  repo:AGENTS.md (differs)'));
  assert.ok(hasLine(planned.stdout, 'Add this block by hand to the preserved AGENTS.md so your client loads the harness:'));
  const manifest = await vendoredManifest();
  assert.ok(planned.stdout.includes(manifest.loaderBlock), 'the loader block is printed byte for byte from the vendored manifest');
  assert.ok(hasLine(planned.stdout, 'The harness is not loaded by your client until you add that block.'));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.equal(applied.code, undefined, applied.stdout);
  assert.equal(await readFile(path.join(w.repo, 'AGENTS.md'), 'utf8'), '# My own rules\n');
});

test('connect registers an INITIALISED and a LEGACY repository with zero repository writes', async (t) => {
  const w = await workspace(t);
  const ready = path.join(w.root, 'ready');
  await mkdir(path.join(ready, '.claude', 'agents'), { recursive: true });
  await writeFile(path.join(ready, '.claude', 'agents', '.init-synthesis.json'), '{}\n');
  const older = path.join(w.root, 'older');
  await mkdir(older);
  await writeFile(path.join(older, 'SPEC-HARNESS.md'), '# an older copy\n');
  const cases = [
    [ready, 'INITIALISED', '.claude/agents/.init-synthesis.json', 'Reason: the harness receipt .claude/agents/.init-synthesis.json exists.'],
    [older, 'LEGACY', 'SPEC-HARNESS.md', 'nothing is written into the repository'],
  ];
  for (const [repo, status, evidence, reason] of cases) {
    const before = await inventory(repo);
    const planned = await runCli(['connect', '--target', w.hub, '--repo', repo]);
    assert.equal(planned.code, undefined, planned.stdout);
    assert.ok(hasLine(planned.stdout, `Detection: ${status} (evidence: ${evidence})`));
    assert.ok(hasLine(planned.stdout, 'Repository writes: none (register only)'));
    assert.ok(planned.stdout.includes(reason), `${status} reason`);
    const applied = await runCli(['connect', '--target', w.hub, '--repo', repo, '--apply', planDigest(planned.stdout)]);
    assert.equal(applied.code, undefined, applied.stdout);
    assert.ok(hasLine(applied.stdout, `Status: ${status}, registered`));
    assert.deepEqual(await inventory(repo), before, `${status}: the repository is unchanged`);
    assert.ok((await lstat(path.join(w.hub, '01-Projects', path.basename(repo), 'Connection.md'))).isFile(), `${status}: the hub record exists`);
    const listed = await runCli(['verify', '--target', w.hub]);
    assert.ok(hasLine(listed.stdout, `CONNECTION\t${path.basename(repo)}\t${repo}\t${status}`), `${status}: verify lists the status`);
  }
});

test('rollback --receipt restores both roots, names each root in ROLLED_BACK lines, and verify stops listing the connection', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const planned = await runCli(connectArgs(w));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  const receipt = appliedReceipt(applied.stdout);
  const rolledBack = await runCli(['rollback', '--target', w.hub, '--receipt', receipt]);
  assert.equal(rolledBack.code, undefined, rolledBack.stdout + rolledBack.stderr);
  assert.ok(hasLine(rolledBack.stdout, 'ROLLED_BACK\trepo:AGENTS.md'));
  assert.ok(hasLine(rolledBack.stdout, 'ROLLED_BACK\thub:01-Projects/app/FACTS.md'));
  assert.ok(hasLine(rolledBack.stdout, 'Both roots are back to their state before the connect. Nothing was committed.'));
  assert.deepEqual(await snapshot(w), before);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(!verified.stdout.split(/\r?\n/).some((line) => line.startsWith('CONNECTION\t')));
});

test('usage errors: a missing or relative --repo, --repo on init, --receipt on connect and --name on verify are refused', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const cases = [
    [['connect', '--target', w.hub], /^USAGE: connect requires --repo with an absolute path to the repository\.$/m],
    [['connect', '--target', w.hub, '--repo', 'app'], /^USAGE: An explicit absolute --repo path is required\.$/m],
    [['init', '--target', w.hub, '--repo', w.repo], /^USAGE: init does not accept --repo\.$/m],
    [['connect', '--target', w.hub, '--repo', w.repo, '--receipt', 'tx-x'], /^USAGE: connect does not accept --receipt\.$/m],
    [['verify', '--target', w.hub, '--name', 'app'], /^USAGE: verify does not accept --name\.$/m],
  ];
  for (const [args, pattern] of cases) {
    const result = await runCli(args);
    assert.equal(result.code, 1, `${args.join(' ')} must exit 1`);
    assert.match(result.stdout, pattern, args.join(' '));
  }
  assert.deepEqual(await snapshot(w), before);
});

test('help names the connect usage, says it never runs git, says files are uncommitted, and warns about one connect at a time', async () => {
  const printed = await runCli(['--help']);
  assert.equal(printed.code, undefined, printed.stderr);
  assert.ok(printed.stdout.includes('second-brain connect --target /absolute/path --repo /absolute/repository [--name NAME] [--apply PLAN_DIGEST]'));
  assert.ok(printed.stdout.includes('connect stages Spec Harness into the named repository and registers it here; it never runs git. Files it creates are uncommitted; your team decides whether they go in by pull request.'));
  assert.match(printed.stdout, /one connect at a time per workspace/);
});

test('the CLI cannot reach the test-only hooks: bin names none of them and imports only the public engine entries', async () => {
  const source = await readFile(path.join(sourceRoot, 'bin', 'second-brain.mjs'), 'utf8');
  const hooks = /injectFailureAfterWrite|injectBeforeWrite|injectFailureAfterRollbackWrite|injectLinkFailure|injectBetweenTempAndLink|onRollbackStep/;
  assert.equal(hooks.test(source), false, 'bin/second-brain.mjs must not name a test-only hook');
  assert.equal(hooks.test('injectFailureAfterWrite: 2'), true, 'positive control: the pattern fires on a planted hook');
  const allowed = new Set(['node:fs/promises', 'node:readline/promises', 'node:process', 'node:url', 'node:path', '../lib/installer.mjs', '../lib/connect.mjs']);
  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, 'the import scan found the bin imports');
  for (const specifier of specifiers) assert.ok(allowed.has(specifier), `bin imports only the public entries, saw ${specifier}`);
});

// ---------------------------------------------------------------------------
// Plain-words refusals: one test per engine code (what happened, what was not changed, the next command)
// ---------------------------------------------------------------------------

test('INTERRUPTED_CONNECT: a connect for a repository whose earlier connect did not finish names the pending id and the recovery command', async (t) => {
  const w = await workspace(t);
  const pending = await interruptedApply(w);
  const before = await snapshot(w);
  const refused = await runCli(connectArgs(w));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^INTERRUPTED_CONNECT: an earlier connect for this repository or name did not finish \(pending tx-/m);
  assert.ok(refused.stdout.includes(pending.pendingId));
  assert.ok(hasLine(refused.stdout, 'Not changed: this command wrote nothing. The repository may hold part of that connect\'s files.'));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${pending.pendingId}`));
  assert.deepEqual(await snapshot(w), before);
});

test('ROLLBACK_FAILED: an undo that cannot finish prints the leftover list in full, per root, and the recovery command', async (t) => {
  const w = await workspace(t);
  const pending = await interruptedApply(w);
  const record = JSON.parse(await readFile(rel(w.hub, `.second-brain/connect-pending/${pending.pendingId}.json`), 'utf8'));
  const stillThere = [];
  for (const write of record.writes.filter((item) => item.root === 'repo')) {
    try {
      await lstat(rel(w.repo, write.destination));
      stillThere.push(write.destination);
    } catch {
      // already removed by the undo
    }
  }
  const edited = stillThere[0];
  await writeFile(rel(w.repo, edited), 'my own edit\n');
  const failed = await runCli(['rollback', '--target', w.hub, '--receipt', pending.pendingId]);
  assert.equal(failed.code, 1, failed.stdout);
  assert.match(failed.stdout, /^ROLLBACK_FAILED: undoing this connect did not finish\. Some of its files are still in place\.$/m);
  assert.ok(hasLine(failed.stdout, 'Left in the workspace: none'));
  assert.ok(hasLine(failed.stdout, `Left in the repository: ${edited}`));
  assert.ok(hasLine(failed.stdout, `Next: restore or remove the files listed above, then run: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${pending.pendingId}`));
  assert.equal(await readFile(rel(w.repo, edited), 'utf8'), 'my own edit\n', 'the edited file is left alone');
  await rm(rel(w.repo, edited));
  const recovered = await runCli(['rollback', '--target', w.hub, '--receipt', pending.pendingId]);
  assert.equal(recovered.code, undefined, recovered.stdout);
  assert.ok(recovered.stdout.includes(`Recovered interrupted connect ${pending.pendingId}`), recovered.stdout);
});

test('RECEIPT_SUPERSEDED: a stale receipt whose record is gone is refused, names the newer connect, and removes nothing', async (t) => {
  const w = await workspace(t);
  const first = await connectInProcess(w);
  const oldReceipt = await readFile(rel(w.hub, first.receiptPath));
  await rollbackReceipt({ targetPath: w.hub, receiptId: first.receiptId });
  const second = await connectInProcess(w);
  await writeFile(rel(w.hub, first.receiptPath), oldReceipt);
  const frozen = await snapshot(w);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', first.receiptId]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^RECEIPT_SUPERSEDED: this receipt's connection record is gone/m);
  assert.ok(refused.stdout.includes(second.receiptId));
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was removed in either root.'));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs verify --target ${w.hub}`));
  assert.deepEqual(await snapshot(w), frozen);
});

test('CONNECTIONS_PRESENT: an init that still has a connection cannot be rolled back, and the message names the connection to roll back first', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', w.initReceipt]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^CONNECTIONS_PRESENT: this workspace still has connections/m);
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${connected.receiptId}`));
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was removed.'));
});

test('ALREADY_CONNECTED: connecting a repository that is connected already names its receipt and folder and writes nothing', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const before = await snapshot(w);
  const refused = await runCli(connectArgs(w));
  assert.equal(refused.code, 1, refused.stdout);
  assert.ok(refused.stdout.includes(`ALREADY_CONNECTED: this repository is already connected to this workspace by receipt ${connected.receiptId} (folder 01-Projects/app).`));
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs verify --target ${w.hub}`));
  assert.deepEqual(await snapshot(w), before);
});

test('CONNECTION_NAME_TAKEN: a second repository with the same connection name is refused and nothing is written', async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  const second = path.join(w.root, 'second', 'app');
  await mkdir(second, { recursive: true });
  const before = await snapshot(w);
  const refused = await runCli(['connect', '--target', w.hub, '--repo', second]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^CONNECTION_NAME_TAKEN: The workspace already has a connection named app/m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs connect --target ${w.hub} --repo ${second} --name <a name no other connection uses>`));
  assert.deepEqual(await snapshot(w), before);
  assert.deepEqual(await inventory(second), {});
});

test('INVALID_CONNECTION_NAME: a name with a slash is refused with the reason and nothing is written', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const refused = await runCli(connectArgs(w, ['--name', 'team/app']));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^INVALID_CONNECTION_NAME: Connection name contains a character the harness forbids/m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.deepEqual(await snapshot(w), before);
});

test('UNSAFE_REPO: the workspace itself, a folder inside it and a folder that contains it are each refused and nothing is written', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const inside = path.join(w.hub, '01-Projects');
  const cases = [[w.hub, /^UNSAFE_REPO: Repository is the workspace itself\.$/m], [inside, /^UNSAFE_REPO: Repository is inside the workspace\.$/m], [w.root, /^UNSAFE_REPO: Repository contains the workspace\.$/m]];
  for (const [repo, pattern] of cases) {
    const refused = await runCli(['connect', '--target', w.hub, '--repo', repo]);
    assert.equal(refused.code, 1, repo);
    assert.match(refused.stdout, pattern, repo);
    assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  }
  assert.deepEqual(await snapshot(w), before);
});

test('SYMLINK_PATH: a symlinked spelling of a repository is refused, and the next command uses the real path', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  const link = path.join(w.root, 'app-link');
  await symlink(w.repo, link);
  const before = await snapshot(w);
  const refused = await runCli(['connect', '--target', w.hub, '--repo', link]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^SYMLINK_PATH: Repository contains a symlink: /m);
  assert.ok(hasLine(refused.stdout, 'If this is another spelling of a repository already connected here, that is the reason.'));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs connect --target ${w.hub} --repo ${w.repo}`));
  assert.deepEqual(await snapshot(w), before);
});

test('REPO_NOT_DIRECTORY: a missing repository is refused on connect, and on rollback the message says the folder must come back first', async (t) => {
  const w = await workspace(t);
  const missing = path.join(w.root, 'not-there');
  const refused = await runCli(['connect', '--target', w.hub, '--repo', missing]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^REPO_NOT_DIRECTORY: /m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  const connected = await connectInProcess(w);
  await rename(w.repo, `${w.repo}-moved`);
  const rollbackRefused = await runCli(['rollback', '--target', w.hub, '--receipt', connected.receiptId]);
  assert.equal(rollbackRefused.code, 1, rollbackRefused.stdout);
  assert.match(rollbackRefused.stdout, /^REPO_NOT_DIRECTORY: the repository of this connect is no longer an existing folder/m);
  assert.ok(hasLine(rollbackRefused.stdout, `Next: put the folder back at ${w.repo} (or move it back), then run: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${connected.receiptId}`));
});

test('PLAN_DIGEST_MISMATCH: an approval that is not the current digest is refused and names the plan command to run again', async (t) => {
  const w = await workspace(t);
  const planned = await runCli(connectArgs(w));
  const refused = await runCli(connectArgs(w, ['--apply', '0'.repeat(64)]));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^PLAN_DIGEST_MISMATCH: Plan digest did not match\. No files were changed\.$/m);
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs connect --target ${w.hub} --repo ${w.repo}`));
  assert.ok(planDigest(planned.stdout));
});

test('INVALID_PENDING_CONNECT: an unparseable pending record is refused with its absolute path, and the message says it can be deleted', async (t) => {
  const w = await workspace(t);
  const id = `tx-${randomUUID()}`;
  const file = rel(w.hub, `.second-brain/connect-pending/${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"schemaVersion":1,"pendingId"');
  const refused = await runCli(connectArgs(w));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^INVALID_PENDING_CONNECT: Pending connect record /m);
  assert.ok(refused.stdout.includes(file), 'the absolute path of the record is printed');
  assert.ok(refused.stdout.includes(`Next: delete ${file} (it never parsed), then run: node ./bin/second-brain.mjs connect --target ${w.hub} --repo ${w.repo}`), refused.stdout);
});

test('INVALID_RECEIPT: a receipt for a workspace that was moved is refused and the message gives the path it was written at', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const originalHub = w.hub;
  const movedHub = path.join(w.root, 'hub-moved');
  await rename(originalHub, movedHub);
  const refused = await runCli(['rollback', '--target', movedHub, '--receipt', connected.receiptId]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^INVALID_RECEIPT: this receipt was written for a workspace at /m);
  assert.ok(refused.stdout.includes(originalHub));
  assert.ok(hasLine(refused.stdout, `Next: node ./bin/second-brain.mjs rollback --target ${originalHub} --receipt ${connected.receiptId}`));
  await rename(movedHub, originalHub);
});

test('PLAN_CONFLICT: a workspace file that connect would create blocks the apply, and nothing is written', async (t) => {
  const w = await workspace(t);
  await mkdir(path.join(w.hub, '01-Projects', 'app'), { recursive: true });
  await writeFile(path.join(w.hub, '01-Projects', 'app', 'FACTS.md'), 'my own facts\n');
  const before = await snapshot(w);
  const planned = await runCli(connectArgs(w));
  assert.ok(hasLine(planned.stdout, 'CONFLICT\thub:01-Projects/app/FACTS.md\tundo=none'));
  assert.ok(planned.stdout.includes('Blocked: the workspace already has files that connect would write'));
  const refused = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^PLAN_CONFLICT: Plan contains conflicts: hub: 01-Projects\/app\/FACTS\.md$/m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.deepEqual(await snapshot(w), before);
});

test('POSTIMAGE_MISMATCH: a rollback refuses a file the person changed, names it, and removes nothing', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const written = await readFile(path.join(w.repo, 'AGENTS.md'));
  await writeFile(path.join(w.repo, 'AGENTS.md'), 'changed after connect\n');
  const before = await snapshot(w);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', connected.receiptId]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^POSTIMAGE_MISMATCH: Rollback refused because repo: AGENTS\.md no longer has this receipt's postimage\. Nothing was removed in either root\.$/m);
  assert.ok(refused.stdout.includes(`then run: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${connected.receiptId}`), refused.stdout);
  assert.deepEqual(await snapshot(w), before);
  await writeFile(path.join(w.repo, 'AGENTS.md'), written);
  const undone = await runCli(['rollback', '--target', w.hub, '--receipt', connected.receiptId]);
  assert.equal(undone.code, undefined, undone.stdout);
});

test('MISSING_RECEIPT: a second rollback of the same receipt says it was already rolled back and changes nothing', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  await rollbackReceipt({ targetPath: w.hub, receiptId: connected.receiptId });
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', connected.receiptId]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^MISSING_RECEIPT: no receipt or interrupted connect with the id /m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was removed.'));
});

// ---------------------------------------------------------------------------
// Rollback outcomes (each shape of the engine's result)
// ---------------------------------------------------------------------------

test('rollback of an interrupted connect reports it as recovered, in plain words', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const pending = await interruptedApply(w);
  const recovered = await runCli(['rollback', '--target', w.hub, '--receipt', pending.pendingId]);
  assert.equal(recovered.code, undefined, recovered.stdout);
  assert.ok(recovered.stdout.includes(`Recovered interrupted connect ${pending.pendingId}: the files it had written were removed`));
  assert.deepEqual(await snapshot(w), before);
});

test('rollback of a connect that committed before the kill reports it as completed and keeps its receipt', { skip: !isPosix && 'the kill helper uses SIGKILL' }, async (t) => {
  const w = await workspace(t);
  await killedAfterCommit(w);
  const [pending] = (await listPendingConnects({ targetPath: w.hub })).filter((item) => item.kind === 'pending');
  const completed = await runCli(['rollback', '--target', w.hub, '--receipt', pending.pendingId]);
  assert.equal(completed.code, undefined, completed.stdout);
  assert.ok(completed.stdout.includes(`Interrupted connect ${pending.pendingId} had already finished.`));
  assert.ok(completed.stdout.includes('Nothing was removed. The repository stays connected.'));
  assert.ok((await lstat(rel(w.hub, `.second-brain/receipts/${pending.pendingId}.json`))).isFile(), 'the committed receipt is kept');
});

test('rollback of an id with nothing to recover says so and clears an empty pending folder', async (t) => {
  const w = await workspace(t);
  const folder = rel(w.hub, '.second-brain/connect-pending');
  await mkdir(folder, { recursive: true });
  const id = `tx-${randomUUID()}`;
  const nothing = await runCli(['rollback', '--target', w.hub, '--receipt', id]);
  assert.equal(nothing.code, undefined, nothing.stdout);
  assert.ok(nothing.stdout.includes(`Nothing to recover for ${id}: no interrupted connect or leftover file exists for it. Nothing was changed.`));
  await assert.rejects(lstat(folder), /ENOENT/);
});

// ---------------------------------------------------------------------------
// verify: connection listing, pending records and inert residue
// ---------------------------------------------------------------------------

test('verify lists each connection by re-detection (STAGED, then INITIALISED, then MISSING), writes nothing, and exits 0', async (t) => {
  const w = await workspace(t);
  const planned = await runCli(connectArgs(w));
  await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  const before = await snapshot(w);
  const staged = await runCli(['verify', '--target', w.hub]);
  assert.equal(staged.code, undefined, staged.stdout);
  assert.ok(hasLine(staged.stdout, `CONNECTION\tapp\t${w.repo}\tSTAGED`));
  assert.ok(hasLine(staged.stdout, 'Verification: OK'));
  assert.deepEqual(await snapshot(w), before, 'verify changed nothing in either root');

  await mkdir(path.join(w.repo, '.claude', 'agents'), { recursive: true });
  await writeFile(path.join(w.repo, '.claude', 'agents', '.init-synthesis.json'), '{}\n');
  const initialised = await runCli(['verify', '--target', w.hub]);
  assert.equal(initialised.code, undefined, initialised.stdout);
  assert.ok(hasLine(initialised.stdout, `CONNECTION\tapp\t${w.repo}\tINITIALISED`));

  const moved = `${w.repo}-away`;
  await rename(w.repo, moved);
  const missing = await runCli(['verify', '--target', w.hub]);
  assert.equal(missing.code, undefined, 'a missing repository does not change the exit code');
  assert.ok(hasLine(missing.stdout, `CONNECTION\tapp\t${w.repo}\tMISSING`));
  await rename(moved, w.repo);
});

test('verify lists a pending record with its id and the recovery command, and exits non-zero', async (t) => {
  const w = await workspace(t);
  const pending = await interruptedApply(w);
  const before = await snapshot(w);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, 1, verified.stdout);
  assert.ok(hasLine(verified.stdout, `PENDING\t${pending.pendingId}\tapp\t${w.repo}\tinterrupted connect; recover with: node ./bin/second-brain.mjs rollback --target ${w.hub} --receipt ${pending.pendingId}`));
  assert.ok(hasLine(verified.stdout, 'Verification: FAILED'));
  assert.deepEqual(await snapshot(w), before);
});

test('verify lists inert residue (an empty connect-pending folder, then an unlinked pending temp) without changing the exit code', async (t) => {
  const w = await workspace(t);
  const folder = rel(w.hub, '.second-brain/connect-pending');
  await mkdir(folder, { recursive: true });
  const empty = await runCli(['verify', '--target', w.hub]);
  assert.equal(empty.code, undefined, empty.stdout);
  assert.ok(hasLine(empty.stdout, 'RESIDUE\t.second-brain/connect-pending/\tan empty folder left by an interrupted connect; the next approved connect, a rollback or a recovery removes it.'));
  assert.ok(hasLine(empty.stdout, 'Verification: OK'));
  const id = `tx-${randomUUID()}`;
  const temp = `.${id}.json.second-brain-${id}.tmp`;
  await writeFile(path.join(folder, temp), '{"partial":');
  const before = await snapshot(w);
  const withTemp = await runCli(['verify', '--target', w.hub]);
  assert.equal(withTemp.code, undefined, withTemp.stdout);
  assert.ok(withTemp.stdout.includes(`RESIDUE\t.second-brain/connect-pending/${temp}\t`));
  assert.ok(withTemp.stdout.includes('the next approved connect, a rollback or a recovery clears it.'));
  assert.deepEqual(await snapshot(w), before, 'verify removes no residue');
});
