import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseArguments } from '../lib/cli-arguments.mjs';
import { applyConnect, listPendingConnects, planConnect } from '../lib/connect.mjs';
import { applyInstall, planInstall, rollbackReceipt } from '../lib/installer.mjs';
import { appliedReceipt, planDigest, runCli as baseRunCli, sourceRoot } from './helpers/consumer-cli.mjs';

const run = promisify(execFileCallback);
const isPosix = process.platform !== 'win32';
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');
// The same quoting rule as the CLI, so expected command lines match what it prints on every platform.
function word(value) {
  const text = String(value);
  const plain = process.platform === 'win32' ? /^[A-Za-z0-9_.\\/:~-]+$/ : /^[A-Za-z0-9_./:-]+$/;
  if (plain.test(text)) return text;
  if (process.platform === 'win32') return `"${text.replace(/"/g, '\\"')}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
const cliScript = word(bin);
const ph = (text) => word(text);
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (root, posixPath) => path.join(root, ...posixPath.split('/'));
const linesOf = (text) => text.split(/\r?\n/);
const registerLine = (text) => linesOf(text).find((line) => line.startsWith('Reason: ')) ?? '';
const hasLine = (text, line) => linesOf(text).includes(line);

// Every CLI output in this file is kept, so the final tests can scan all of them.
const observed = [];
async function runCli(args, options) {
  const result = await baseRunCli(args, options);
  observed.push(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result;
}

// Regular files and folders under a root, with a content digest per file.
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

// A workspace initialised in-process (same engine calls as `init`), plus a repository. Setup only:
// tests about `init` itself run the CLI.
async function workspace(t, { hubName = 'hub', repoName = 'app' } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-cli-connect-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = path.join(root, hubName);
  const repo = path.join(root, repoName);
  await mkdir(repo);
  const manifestBytes = await readFile(path.join(sourceRoot, 'template-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const plan = await planInstall({ manifest, manifestBytes, sourceRoot, targetPath: hub, operation: 'init' });
  const applied = await applyInstall({ manifest, manifestBytes, sourceRoot, targetPath: hub, operation: 'init', approvedDigest: plan.digest });
  return { root, hub, repo, initReceipt: applied.receiptId };
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
  // Positions: the pending record (1), the repository folders the plan creates, then repository files in plan order.
  // This fails right after the second repository file: the undo removes the first and fails before the second.
  const repoFolders = plan.directories.filter((item) => item.root === 'repo' && item.status === 'CREATE').length;
  try {
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

// POSIX-shell splitting of one printed command: words separated by spaces, double quotes group,
// and inside double quotes a backslash escapes only " \ $ and backtick.
function splitCommand(line) {
  const words = [];
  let current = null;
  let index = 0;
  const start = () => { current ??= ''; };
  while (index < line.length) {
    const character = line[index];
    if (character === ' ') {
      if (current !== null) words.push(current);
      current = null;
      index += 1;
    } else if (character === '\'') {
      // single quotes: everything up to the next single quote is literal
      const end = line.indexOf('\'', index + 1);
      assert.ok(end !== -1, `unterminated single quote in: ${line}`);
      start();
      current += line.slice(index + 1, end);
      index = end + 1;
    } else if (character === '"') {
      // double quotes: a backslash escapes only " \ $ and backtick
      start();
      index += 1;
      let closed = false;
      while (index < line.length) {
        const inner = line[index];
        if (inner === '"') { closed = true; index += 1; break; }
        const escapes = process.platform === 'win32' ? '"' : '"\\$`';
        if (inner === '\\' && escapes.includes(line[index + 1])) { current += line[index + 1]; index += 2; continue; }
        current += inner;
        index += 1;
      }
      assert.ok(closed, `unterminated double quote in: ${line}`);
    } else if (character === '\\' && index + 1 < line.length && process.platform !== 'win32') {
      // outside quotes a backslash makes the next character literal
      start();
      current += line[index + 1];
      index += 2;
    } else {
      start();
      current += character;
      index += 1;
    }
  }
  if (current !== null) words.push(current);
  return words;
}

// Every printed command of the form `node ${cliScript} ...`, from one output.
function printedCommands(text) {
  return [...text.matchAll(/node \S*second-brain\.mjs.*$/gm)].map((match) => match[0].trimEnd());
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
  assert.ok(hasLine(out, `Apply this exact plan with: node ${cliScript} connect --target ${w.hub} --repo ${w.repo} --name app --apply ${planDigest(out)}`), 'the plan prints the exact apply command');
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

test('connect with a differing root AGENTS.md prints the vendored loader block verbatim, repeats it after apply, and leaves the file byte-identical', async (t) => {
  const w = await workspace(t);
  await writeFile(path.join(w.repo, 'AGENTS.md'), '# My own rules\n');
  const manifest = await vendoredManifest();
  const planned = await runCli(connectArgs(w));
  assert.ok(hasLine(planned.stdout, 'PRESERVED\trepo:AGENTS.md\tundo=none (differs)'));
  assert.ok(hasLine(planned.stdout, 'Preserved: 1 files kept unchanged'));
  assert.ok(hasLine(planned.stdout, '  repo:AGENTS.md (differs)'));
  assert.ok(hasLine(planned.stdout, 'Add this block by hand to the preserved AGENTS.md so your client loads the harness:'));
  assert.ok(planned.stdout.includes(manifest.loaderBlock), 'the loader block is printed byte for byte from the vendored manifest');
  assert.ok(hasLine(planned.stdout, 'The harness is not loaded by your client until you add that block.'));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.equal(applied.code, undefined, applied.stdout);
  assert.ok(hasLine(applied.stdout, 'Add this block by hand to the preserved AGENTS.md so your client loads the harness:'), 'the hand-off repeats the instruction');
  assert.ok(applied.stdout.includes(manifest.loaderBlock), 'the hand-off repeats the loader block verbatim');
  assert.equal(await readFile(path.join(w.repo, 'AGENTS.md'), 'utf8'), '# My own rules\n');
});

test('connect registers an INITIALISED and a LEGACY repository with zero repository writes, and verify states what is on disk', async (t) => {
  const w = await workspace(t);
  const ready = path.join(w.root, 'ready');
  await mkdir(path.join(ready, '.claude', 'agents'), { recursive: true });
  await writeFile(path.join(ready, '.claude', 'agents', '.init-synthesis.json'), '{}\n');
  const older = path.join(w.root, 'older');
  await mkdir(older);
  await writeFile(path.join(older, 'SPEC-HARNESS.md'), '# an older copy\n');
  const cases = [
    [ready, 'INITIALISED', '.claude/agents/.init-synthesis.json', 'Reason: the harness receipt .claude/agents/.init-synthesis.json exists.', 'INITIALISED'],
    [older, 'LEGACY', 'SPEC-HARNESS.md', 'will not write into it', 'REGISTERED (now: harness present)'],
  ];
  for (const [repo, status, evidence, reason, listed] of cases) {
    const before = await inventory(repo);
    const planned = await runCli(['connect', '--target', w.hub, '--repo', repo]);
    assert.equal(planned.code, undefined, planned.stdout);
    assert.ok(hasLine(planned.stdout, status === 'LEGACY' ? `Detection: this repository already has Spec Harness files (engine code: LEGACY; evidence: ${evidence})` : `Detection: ${status} (evidence: ${evidence})`));
    assert.ok(hasLine(planned.stdout, 'Repository writes: none (register only)'));
    assert.ok(planned.stdout.includes(reason), `${status} reason`);
    const applied = await runCli(['connect', '--target', w.hub, '--repo', repo, '--apply', planDigest(planned.stdout)]);
    assert.equal(applied.code, undefined, applied.stdout);
    assert.ok(hasLine(applied.stdout, status === 'LEGACY' ? 'Status: already has harness files, registered' : `Status: ${status}, registered`));
    const handoff = applied.stdout.slice(applied.stdout.indexOf('Applied receipt:'));
    assert.ok(!/\bLEGACY\b/.test(handoff), 'the hand-off never shows the code word');
    assert.ok(!/\bLEGACY\b/.test(applied.stdout.replace('(engine code: LEGACY', '')), 'the apply output shows the code word once, in the plan detection line');
    if (status === 'LEGACY') {
      assert.ok(hasLine(applied.stdout, 'Next: no repository file was written. If /sdd commands do not work in this repository, run /sdd init inside it.'), 'the hand-off says what to do');
      assert.ok(!registerLine(planned.stdout).includes('LEGACY') && !planned.stdout.includes('migrate'), 'the reason a person reads never uses the code word or migrate guidance');
    }
    assert.deepEqual(await inventory(repo), before, `${status}: the repository is unchanged`);
    assert.ok((await lstat(path.join(w.hub, '01-Projects', path.basename(repo), 'Connection.md'))).isFile(), `${status}: the hub record exists`);
    const verified = await runCli(['verify', '--target', w.hub]);
    assert.ok(hasLine(verified.stdout, `CONNECTION\t${path.basename(repo)}\t${repo}\t${listed}`), `${status}: verify states ${listed}`);
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
  assert.ok(!linesOf(verified.stdout).some((line) => line.startsWith('CONNECTION\t')));
});

test('usage errors: a missing or relative --repo, --repo on init, --receipt on connect and --name on verify are refused', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const cases = [
    [['connect', '--target', w.hub], /^USAGE: connect requires --repo with an absolute path to the repository\. Nothing was changed\.$/m],
    [['connect', '--target', w.hub, '--repo', 'app'], /^USAGE: An explicit absolute --repo path is required\. Nothing was changed\.$/m],
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

// The test-only hooks are reachable neither as a flag nor as an environment variable of the real CLI.
const HOOKS = ['injectFailureAfterWrite', 'injectBeforeWrite', 'injectFailureAfterRollbackWrite', 'injectLinkFailure', 'injectBetweenTempAndLink', 'onRollbackStep'];

test('the test-only hooks are refused as flags and ignored as environment variables by the real CLI', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  for (const hook of HOOKS) {
    const asFlag = await runCli(connectArgs(w, [`--${hook}`, '1']));
    assert.equal(asFlag.code, 1, hook);
    assert.match(asFlag.stdout, /^USAGE: Invalid arguments for connect\.$/m, hook);
  }
  const env = Object.fromEntries(HOOKS.map((hook) => [hook, '1']));
  const asEnv = await run(process.execPath, [bin, ...connectArgs(w)], { cwd: sourceRoot, env: { ...process.env, ...env }, windowsHide: true });
  assert.ok(hasLine(asEnv.stdout, 'Plan not applied.'), 'the plan prints as usual');
  assert.ok(!asEnv.stdout.includes('INJECTED'), 'no injected failure appears');
  assert.deepEqual(await snapshot(w), before);
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
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} rollback --target ${w.hub} --receipt ${pending.pendingId}`));
  assert.deepEqual(await snapshot(w), before);
});

test('ROLLBACK_FAILED: an undo that cannot finish prints the leftover list in full, says what to do with a changed file, and gives the rollback command', async (t) => {
  const w = await workspace(t);
  const pending = await interruptedApply(w);
  const record = JSON.parse(await readFile(rel(w.hub, `.second-brain/connect-pending/${pending.pendingId}.json`), 'utf8'));
  const stillThere = [];
  for (const write of record.writes.filter((item) => item.root === 'repo')) {
    if (await lstat(rel(w.repo, write.destination)).catch(() => null)) stillThere.push(write.destination);
  }
  const edited = stillThere[0];
  await writeFile(rel(w.repo, edited), 'my own edit\n');
  const failed = await runCli(['rollback', '--target', w.hub, '--receipt', pending.pendingId]);
  assert.equal(failed.code, 1, failed.stdout);
  assert.match(failed.stdout, /^ROLLBACK_FAILED: undoing this connect did not finish\. Some of its files are still in place\.$/m);
  assert.ok(hasLine(failed.stdout, 'Left in the workspace: none'));
  assert.ok(hasLine(failed.stdout, `Left in the repository: ${edited}`));
  assert.ok(failed.stdout.includes('left untouched'), 'says the listed files were left untouched');
  assert.ok(failed.stdout.includes('move the file out of the repository (do not delete it)'), 'says to move a file of yours out, not delete it');
  assert.ok(failed.stdout.includes('If you do not need it, you may delete it yourself.'));
  assert.ok(hasLine(failed.stdout, `Next: node ${cliScript} rollback --target ${w.hub} --receipt ${pending.pendingId}`));
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
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} verify --target ${w.hub}`));
  assert.deepEqual(await snapshot(w), frozen);
});

test('CONNECTIONS_PRESENT: an init that still has a connection cannot be rolled back, and the message names the connection to roll back first', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', w.initReceipt]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^CONNECTIONS_PRESENT: this workspace still has connections/m);
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} rollback --target ${w.hub} --receipt ${connected.receiptId}`));
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
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} verify --target ${w.hub}`));
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
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${w.hub} --repo ${second} --name ${ph('<a name no other connection uses>')}`));
  assert.deepEqual(await snapshot(w), before);
  assert.deepEqual(await inventory(second), {});
});

test('CONNECTION_NAME_TAKEN with --name given prints one --name in the Next command, and that command parses', async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  const second = path.join(w.root, 'second', 'app');
  await mkdir(second, { recursive: true });
  const refused = await runCli(['connect', '--target', w.hub, '--repo', second, '--name', 'app']);
  assert.equal(refused.code, 1, refused.stdout);
  const next = linesOf(refused.stdout).find((line) => line.startsWith('Next: '));
  assert.equal(next, `Next: node ${cliScript} connect --target ${w.hub} --repo ${second} --name ${ph('<a name no other connection uses>')}`);
  assert.equal(next.split('--name').length - 1, 1, 'the flag appears once');
  parseArguments(splitCommand(next.slice('Next: '.length)).slice(2).map((item) => (item.startsWith('<') ? '/placeholder' : item)));
});

test('INVALID_CONNECTION_NAME: a name with a slash is refused with the reason, its Next command names one plain folder name, and nothing is written', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const refused = await runCli(connectArgs(w, ['--name', 'team/app']));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^INVALID_CONNECTION_NAME: Connection name contains a character the harness forbids/m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${w.hub} --repo ${w.repo} --name ${ph('<one plain folder name>')}`));
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
  assert.match(refused.stdout, /^SYMLINK_PATH: the path you gave is a symlink to /m);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  // The real path is already connected here, so the next step is verify, not connect (see T06-6).
  assert.ok(hasLine(refused.stdout, `That repository is already connected (receipt ${(await readConnectionsFor(w)).connectionId}, folder 01-Projects/app).`));
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} verify --target ${w.hub}`));
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
  assert.ok(hasLine(rollbackRefused.stdout, `Next: put the folder back at ${w.repo} (or move it back), then run: node ${cliScript} rollback --target ${w.hub} --receipt ${connected.receiptId}`));
});

test('PLAN_DIGEST_MISMATCH: an approval that is not the current digest is refused and names the plan command to run again', async (t) => {
  const w = await workspace(t);
  const planned = await runCli(connectArgs(w));
  const refused = await runCli(connectArgs(w, ['--apply', '0'.repeat(64)]));
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^PLAN_DIGEST_MISMATCH: Plan digest did not match\. No files were changed\.$/m);
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${w.hub} --repo ${w.repo}`));
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
  assert.ok(refused.stdout.includes(`Next: delete ${file} (it never parsed), then run: node ${cliScript} connect --target ${w.hub} --repo ${w.repo}`), refused.stdout);
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
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} rollback --target ${originalHub} --receipt ${connected.receiptId}`));
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

test('POSTIMAGE_MISMATCH: a rollback refuses a file the person changed, names it, says to move it out rather than delete it, and removes nothing', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const written = await readFile(path.join(w.repo, 'AGENTS.md'));
  await writeFile(path.join(w.repo, 'AGENTS.md'), 'changed after connect\n');
  const before = await snapshot(w);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', connected.receiptId]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^POSTIMAGE_MISMATCH: Rollback refused because repo: AGENTS\.md no longer has this receipt's postimage\. Nothing was removed in either root\.$/m);
  assert.ok(refused.stdout.includes('left untouched'));
  assert.ok(refused.stdout.includes('move the file out of the repository (do not delete it)'));
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} rollback --target ${w.hub} --receipt ${connected.receiptId}`));
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

test('HUB_NOT_INITIALISED: connecting into a folder that was never initialised says what it means and the init command', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-cli-connect-uninit-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = path.join(root, 'hub');
  const repo = path.join(root, 'app');
  await mkdir(hub);
  await mkdir(repo);
  const refused = await runCli(['connect', '--target', hub, '--repo', repo]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^HUB_NOT_INITIALISED: /m);
  assert.ok(refused.stdout.includes('is not an initialised workspace yet'), refused.stdout);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} init --target ${hub}`));
  assert.deepEqual(await inventory(repo), {});
});

test('UNSAFE_TARGET: a workspace path that is the filesystem root is refused, the path and the reason are named, and nothing is written', async (t) => {
  const w = await workspace(t);
  const root = path.parse(w.root).root;
  const refused = await runCli(['connect', '--target', root, '--repo', w.repo]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^UNSAFE_TARGET: /m);
  assert.ok(refused.stdout.includes(`The path ${root} cannot be used`), refused.stdout);
  assert.ok(refused.stdout.includes('Target cannot be the filesystem root.'));
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${ph('<a workspace folder>')} --repo ${w.repo}`));
  assert.deepEqual(await inventory(w.repo), {});
});

test('USAGE: a connect with no --repo prints the usage line for connect after the message', async (t) => {
  const w = await workspace(t);
  const refused = await runCli(['connect', '--target', w.hub]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^USAGE: connect requires --repo/m);
  assert.ok(hasLine(refused.stdout, 'Usage: second-brain connect --target /absolute/path --repo /absolute/repository [--name NAME] [--apply PLAN_DIGEST]'), refused.stdout);
});

test('rollback --receipt is checked for shape before any path is built: a traversal, an absolute path and an empty value are refused', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  for (const value of ['../../x', '/etc/passwd', '']) {
    const refused = await runCli(['rollback', '--target', w.hub, '--receipt', value]);
    assert.equal(refused.code, 1, JSON.stringify(value));
    assert.match(refused.stdout, /^USAGE: rollback --receipt must be a receipt id: tx- followed by a UUID\. Nothing was changed\.$/m, JSON.stringify(value));
  }
  assert.deepEqual(await snapshot(w), before);
});

test('verify: a pending record that never parsed prints a usable command with a placeholder, never null', async (t) => {
  const w = await workspace(t);
  const id = `tx-${randomUUID()}`;
  const file = rel(w.hub, `.second-brain/connect-pending/${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"schemaVersion":1');
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, 1, verified.stdout);
  assert.doesNotMatch(verified.stdout, /\bnull\b/);
  assert.ok(verified.stdout.includes(`--repo ${ph('<repository path>')}`), verified.stdout);
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
// verify: connection states read from disk, pending records and inert residue
// ---------------------------------------------------------------------------

const CHANGED_SENTENCE = 'CHANGED: some files this connect wrote are missing or differ now. You can roll the connection back, or keep the files as they are.';

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

test('verify: a connection whose staged files were all deleted is CHANGED, never STAGED, and counts the missing files', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  const receipt = JSON.parse(await readFile(rel(w.hub, `.second-brain/receipts/${connected.receiptId}.json`), 'utf8'));
  const created = receipt.writes.filter((item) => item.root === 'repo').map((item) => item.destination);
  for (const destination of created) await rm(rel(w.repo, destination));
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.ok(hasLine(verified.stdout, `CONNECTION\tapp\t${w.repo}\tCHANGED`), verified.stdout);
  assert.ok(hasLine(verified.stdout, `  CHANGED: ${created.length} staged files missing, 0 differ; first: ${created.slice(0, 3).join(', ')}`), verified.stdout);
  assert.equal(verified.stdout.split(CHANGED_SENTENCE).length - 1, 1, 'the CHANGED sentence is printed once');
});

test('verify: one deleted staged file is CHANGED with a count of one missing, not LEGACY', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  await rm(rel(w.repo, 'AGENTS.md'));
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(verified.stdout, `CONNECTION\tapp\t${w.repo}\tCHANGED`), verified.stdout);
  assert.ok(hasLine(verified.stdout, '  CHANGED: 1 staged file missing, 0 differ; first: AGENTS.md'), verified.stdout);
  assert.ok(!verified.stdout.includes('LEGACY'), 'a staged repository is never labelled LEGACY');
  assert.ok(connected.receiptId);
});

test('verify: an edited staged file is CHANGED with a count of one that differs', async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  await writeFile(path.join(w.repo, 'AGENTS.md'), 'my own words\n');
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(verified.stdout, `CONNECTION\tapp\t${w.repo}\tCHANGED`), verified.stdout);
  assert.ok(hasLine(verified.stdout, '  CHANGED: 0 staged files missing, 1 differs; first: AGENTS.md'), verified.stdout);
});

test('verify: a register-only repository is REGISTERED with what detection finds now, and never STAGED', async (t) => {
  const w = await workspace(t);
  const older = path.join(w.root, 'older');
  await mkdir(older);
  await writeFile(path.join(older, 'SPEC-HARNESS.md'), '# an older copy\n');
  const planned = await runCli(['connect', '--target', w.hub, '--repo', older]);
  await runCli(['connect', '--target', w.hub, '--repo', older, '--apply', planDigest(planned.stdout)]);
  const present = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(present.stdout, `CONNECTION\tolder\t${older}\tREGISTERED (now: harness present)`), present.stdout);
  await rm(path.join(older, 'SPEC-HARNESS.md'));
  const removed = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(removed.stdout, `CONNECTION\tolder\t${older}\tREGISTERED (now: no harness files found)`), removed.stdout);
  assert.ok(!removed.stdout.includes('STAGED'), 'never STAGED');
});

test('verify lists a pending record with its id and the recovery command, and exits non-zero', async (t) => {
  const w = await workspace(t);
  const pending = await interruptedApply(w);
  const before = await snapshot(w);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, 1, verified.stdout);
  assert.ok(hasLine(verified.stdout, `PENDING\t${pending.pendingId}\tapp\t${w.repo}\tinterrupted connect; recover with: node ${cliScript} rollback --target ${w.hub} --receipt ${pending.pendingId}`));
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

// ---------------------------------------------------------------------------
// Printed commands: quoting, and what a shell and the parser make of them
// ---------------------------------------------------------------------------

test('quoting: a hub and a repository with spaces print Next commands that a POSIX shell splits back into the right arguments, and running them does what they say', async (t) => {
  const w = await workspace(t, { hubName: 'my hub', repoName: 'my app' });
  const pending = await interruptedApply(w);
  const refused = await runCli(connectArgs(w));
  const next = printedCommands(refused.stdout).find((line) => line.includes('rollback'));
  const words = splitCommand(next);
  assert.deepEqual(words.slice(0, 2), ['node', bin]);
  assert.deepEqual(words.slice(2), ['rollback', '--target', w.hub, '--receipt', pending.pendingId], next);
  const ran = await run(process.execPath, [bin, ...words.slice(2)], { cwd: sourceRoot, windowsHide: true });
  assert.ok(ran.stdout.includes(`Recovered interrupted connect ${pending.pendingId}`), ran.stdout);
  assert.deepEqual(await inventory(w.repo), {}, 'the recovery removed the files it had written');

  await connectInProcess(w);
  const already = await runCli(connectArgs(w));
  const verifyNext = printedCommands(already.stdout).find((line) => line.includes('verify'));
  const verifyWords = splitCommand(verifyNext);
  assert.deepEqual(verifyWords.slice(2), ['verify', '--target', w.hub], verifyNext);
  const listed = await run(process.execPath, [bin, ...verifyWords.slice(2)], { cwd: sourceRoot, windowsHide: true });
  assert.ok(linesOf(listed.stdout).some((line) => line.startsWith('CONNECTION\tmy app\t')), listed.stdout);
});

test('T06-1, T06-7: a name that is refused is never echoed as a flag, and a long echoed name is clipped to 60 characters', async (t) => {
  const w = await workspace(t);
  const refused = await runCli(connectArgs(w, ['--name', 'x'.repeat(300)]));
  const missing = await runCli(['connect', '--target', w.hub, '--repo', path.join(w.root, 'absent'), '--name', 'team/app']);
  assert.ok(!missing.stdout.includes('team/app'), 'an invalid name is never suggested back');
  assert.equal(refused.code, 1, refused.stdout);
  assert.ok(!refused.stdout.includes('x'.repeat(61)), 'the 300-character name is never printed in full');
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${w.hub} --repo ${w.repo} --name ${ph('<one plain folder name>')}`), refused.stdout);
  const ninety = 'n'.repeat(90);
  await mkdir(path.join(w.root, 'ninety'));
  await connectInProcess(w, { repoPath: path.join(w.root, 'ninety'), name: ninety });
  const taken = path.join(w.root, 'ninety-again');
  await mkdir(taken);
  const clash = await runCli(['connect', '--target', w.hub, '--repo', taken, '--name', ninety]);
  assert.equal(clash.code, 1, clash.stdout);
  assert.ok(!clash.stdout.includes(ninety), 'the 90-character name is not printed in full');
  assert.ok(clash.stdout.includes(`${'n'.repeat(60)}...`), 'the echoed name is clipped with an ellipsis');
});

test('T06-4: a repository that already has harness files gets a plain reason, names the engine code once in the detection line, and never mentions migrate guidance', async (t) => {
  const w = await workspace(t);
  const older = path.join(w.root, 'older');
  await mkdir(older);
  await writeFile(path.join(older, 'SPEC-HARNESS.md'), '# an older copy\n');
  const planned = await runCli(['connect', '--target', w.hub, '--repo', older]);
  assert.ok(hasLine(planned.stdout, 'Detection: this repository already has Spec Harness files (engine code: LEGACY; evidence: SPEC-HARNESS.md)'));
  assert.ok(registerLine(planned.stdout).includes('a teammate added the harness'), registerLine(planned.stdout));
  assert.ok(!registerLine(planned.stdout).includes('LEGACY'), 'the reason a person reads never shows the code word');
  assert.ok(!planned.stdout.includes('migrate'));
});

test('T06-5: the printed commands run from the workspace folder and from an unrelated folder, with the absolute script path', async (t) => {
  const w = await workspace(t);
  await interruptedApply(w);
  const unrelated = await realpath(await mkdtemp(path.join(tmpdir(), 'sb-cli-unrelated-')));
  t.after(() => rm(unrelated, { recursive: true, force: true }));
  const refused = await runCli(connectArgs(w));
  const words = splitCommand(printedCommands(refused.stdout).find((line) => line.includes('rollback')));
  assert.equal(words[1], bin, 'the script is printed as its absolute path');
  // Run from the workspace folder first (recovers), then from an unrelated folder: it loads and answers in plain words.
  const fromHub = await run(process.execPath, words.slice(1), { cwd: w.hub, windowsHide: true });
  assert.ok(fromHub.stdout.includes('Recovered interrupted connect'), fromHub.stdout);
  const fromElsewhere = await run(process.execPath, words.slice(1), { cwd: unrelated, windowsHide: true }).catch((error) => error);
  assert.ok(String(fromElsewhere.stdout ?? '').includes('MISSING_RECEIPT'), `from an unrelated folder: ${fromElsewhere.stderr ?? fromElsewhere.message}`);
});
test('T06-6: a symlink to a repository that is already connected says so and sends the person to verify, not to connect', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  const link = path.join(w.root, 'app-alias');
  await symlink(w.repo, link);
  const refused = await runCli(['connect', '--target', w.hub, '--repo', link]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
  assert.ok(hasLine(refused.stdout, `That repository is already connected (receipt ${(await readConnectionsFor(w)).connectionId}, folder 01-Projects/app).`), refused.stdout);
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} verify --target ${w.hub}`), refused.stdout);
  assert.ok(!refused.stdout.includes(' connect --target '), 'no connect command is suggested');
});

async function readConnectionsFor(w) {
  const { readConnections } = await import('../lib/connect.mjs');
  return Object.values((await readConnections({ targetPath: w.hub })).connections)[0];
}

test('T06-6: a symlink on a parent folder says that, and the real path is offered when it is not connected', { skip: !isPosix && 'symlinks need privileges on win32' }, async (t) => {
  const w = await workspace(t);
  const parentLink = path.join(w.root, 'alias-parent');
  await symlink(path.join(w.root, 'real-parent'), parentLink);
  await mkdir(path.join(w.root, 'real-parent', 'project'), { recursive: true });
  const refused = await runCli(['connect', '--target', w.hub, '--repo', path.join(parentLink, 'project')]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^SYMLINK_PATH: a folder on the path you gave is a symlink: /m);
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} connect --target ${w.hub} --repo ${await realpath(path.join(w.root, 'real-parent', 'project'))}`), refused.stdout);
  assert.ok(hasLine(refused.stdout, 'Not changed: nothing was written.'));
});

test('T06-8: a derived temp directly under .second-brain/ is listed by verify, left alone by planning and verify, and removed by an approved connect', async (t) => {
  const w = await workspace(t);
  const id = `tx-${randomUUID()}`;
  const temp = `.connections.json.second-brain-${id}.tmp`;
  await writeFile(rel(w.hub, `.second-brain/${temp}`), '{"partial":');
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.ok(hasLine(verified.stdout, `RESIDUE\t.second-brain/${temp}\tan unfinished copy of a connection state file left by an interrupted connect; the next approved connect, a rollback or a recovery clears it.`), verified.stdout);
  const before = await snapshot(w);
  const planned = await runCli(connectArgs(w));
  assert.equal(planned.code, undefined, planned.stdout);
  assert.deepEqual(await snapshot(w), before, 'planning and verify leave the temp in place');
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.equal(applied.code, undefined, applied.stdout);
  assert.equal((await lstat(rel(w.hub, `.second-brain/${temp}`)).catch(() => null)), null, 'the approved connect removes it');
});

test('T06-9: rollback with no --receipt says the flag is required, nothing was changed, and where to find the ids', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const refused = await runCli(['rollback', '--target', w.hub]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.ok(hasLine(refused.stdout, 'USAGE: rollback requires --receipt <receipt id>. Nothing was changed.'), refused.stdout);
  assert.ok(hasLine(refused.stdout, 'Usage: second-brain rollback --target /absolute/path --receipt RECEIPT_ID'), refused.stdout);
  assert.ok(refused.stdout.includes('Applied receipt: line'), 'says where the ids are printed');
  assert.ok(!refused.stdout.includes('must be a receipt id'), 'the malformed-value message is not used for a missing flag');
  assert.deepEqual(await snapshot(w), before);
});

test('T06-9: rollback with a malformed --receipt keeps the format message', async (t) => {
  const w = await workspace(t);
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', 'tx-not-a-uuid']);
  assert.equal(refused.code, 1, refused.stdout);
  assert.ok(hasLine(refused.stdout, 'USAGE: rollback --receipt must be a receipt id: tx- followed by a UUID. Nothing was changed.'), refused.stdout);
});

test('T06-10: all connections as recorded: verify prints the summary before the footer, and exits 0', async (t) => {
  const w = await workspace(t);
  await connectInProcess(w);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.ok(hasLine(verified.stdout, 'Connections: 1, all as recorded.'), verified.stdout);
  assert.ok(linesOf(verified.stdout).indexOf('Connections: 1, all as recorded.') < linesOf(verified.stdout).indexOf('Verification: OK'), 'the summary is printed before the footer');
});

test('T06-10: CHANGED and MISSING connections print the attention line, and the exit code stays 0 (D18-a)', async (t) => {
  const w = await workspace(t);
  for (const name of ['a', 'b', 'c']) await mkdir(path.join(w.root, name));
  await connectInProcess(w, { repoPath: path.join(w.root, 'a') });
  await connectInProcess(w, { repoPath: path.join(w.root, 'b') });
  await connectInProcess(w, { repoPath: path.join(w.root, 'c') });
  await rm(path.join(w.root, 'a', 'AGENTS.md'));
  await rename(path.join(w.root, 'b'), path.join(w.root, 'b-away'));
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, 'the exit code does not change for a connection');
  assert.ok(hasLine(verified.stdout, "Connections: 2 of 3 need attention (see CHANGED and MISSING above). This does not affect the workspace's own files."), verified.stdout);
  assert.ok(hasLine(verified.stdout, 'Verification: OK'));
});

test('T06-10: with no connections nothing new is printed, and the footer is unchanged', async (t) => {
  const w = await workspace(t);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.ok(!verified.stdout.includes('Connections:'), 'no summary line without connections');
  assert.ok(hasLine(verified.stdout, 'Verification: OK'));
});

test('T06-11: a successful staged connect prints the undo command with its receipt id, absolute and quoted', async (t) => {
  const w = await workspace(t);
  const planned = await runCli(connectArgs(w));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  const receipt = appliedReceipt(applied.stdout);
  assert.ok(receipt);
  assert.ok(hasLine(applied.stdout, `To undo this connect: node ${cliScript} rollback --target ${w.hub} --receipt ${receipt}`), applied.stdout);
});

test('T06-11: a register-only connect prints the same undo line', async (t) => {
  const w = await workspace(t);
  const older = path.join(w.root, 'older');
  await mkdir(older);
  await writeFile(path.join(older, 'SPEC-HARNESS.md'), '# an older copy\n');
  const planned = await runCli(['connect', '--target', w.hub, '--repo', older]);
  const applied = await runCli(['connect', '--target', w.hub, '--repo', older, '--apply', planDigest(planned.stdout)]);
  const receipt = appliedReceipt(applied.stdout);
  assert.ok(hasLine(applied.stdout, `To undo this connect: node ${cliScript} rollback --target ${w.hub} --receipt ${receipt}`), applied.stdout);
});

test('T06-11: a connection whose receipt file is missing is NO_RECEIPT: no rollback command is printed, and it says what was not changed', async (t) => {
  const w = await workspace(t);
  const connected = await connectInProcess(w);
  await rm(rel(w.hub, `.second-brain/receipts/${connected.receiptId}.json`));
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.ok(hasLine(verified.stdout, `CONNECTION\tapp\t${w.repo}\tNO_RECEIPT`), verified.stdout);
  assert.ok(verified.stdout.includes('cannot be rolled back by the tool'), verified.stdout);
  assert.ok(verified.stdout.includes('Nothing was changed.'));
  assert.ok(verified.stdout.includes('Connection.md does not list the staged files'));
  assert.ok(!verified.stdout.includes('rollback --target'), 'no command that cannot work is printed');
});

test('T06-12: grammar: one missing file is singular, two are plural, and "differs" follows one', async (t) => {
  const w = await workspace(t);
  for (const name of ['one', 'two']) await mkdir(path.join(w.root, name));
  const one = await connectInProcess(w, { repoPath: path.join(w.root, 'one') });
  await rm(path.join(w.root, 'one', 'AGENTS.md'));
  const two = await connectInProcess(w, { repoPath: path.join(w.root, 'two') });
  await rm(path.join(w.root, 'two', 'AGENTS.md'));
  await rm(path.join(w.root, 'two', 'RULES.md'));
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(verified.stdout, '  CHANGED: 1 staged file missing, 0 differ; first: AGENTS.md'), verified.stdout);
  assert.ok(hasLine(verified.stdout, '  CHANGED: 2 staged files missing, 0 differ; first: AGENTS.md, RULES.md'), verified.stdout);
  assert.ok(one.receiptId && two.receiptId);
});

test('T06-12: grammar: two differing files read "2 differ", and one read "1 differs"', async (t) => {
  const w = await workspace(t);
  await mkdir(path.join(w.root, 'edited'));
  await connectInProcess(w, { repoPath: path.join(w.root, 'edited') });
  await writeFile(path.join(w.root, 'edited', 'AGENTS.md'), 'changed\n');
  await writeFile(path.join(w.root, 'edited', 'RULES.md'), 'changed\n');
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(hasLine(verified.stdout, '  CHANGED: 0 staged files missing, 2 differ; first: AGENTS.md, RULES.md'), verified.stdout);
});

test('T06-14: a connect that finished but whose pending marker was not cleared is named as finished, and verify writes nothing', { skip: !isPosix && 'the kill helper uses SIGKILL' }, async (t) => {
  const w = await workspace(t);
  await killedAfterCommit(w);
  const before = await snapshot(w);
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.equal(verified.code, 1, 'a pending marker still fails the workspace check');
  assert.ok(verified.stdout.includes('finished connect, not yet cleared'), verified.stdout);
  assert.ok(verified.stdout.includes('only clears the marker and keeps the connection'), verified.stdout);
  assert.ok(!verified.stdout.includes('interrupted connect; recover with'), 'the finished case is not described as interrupted');
  assert.deepEqual(await snapshot(w), before, 'verify changed nothing');
});

test('T06-15: CONNECTIONS_PRESENT prints one full rollback command per connection, not a list of ids', async (t) => {
  const w = await workspace(t);
  for (const name of ['first', 'second']) await mkdir(path.join(w.root, name));
  const first = await connectInProcess(w, { repoPath: path.join(w.root, 'first') });
  const second = await connectInProcess(w, { repoPath: path.join(w.root, 'second') });
  const refused = await runCli(['rollback', '--target', w.hub, '--receipt', w.initReceipt]);
  assert.equal(refused.code, 1, refused.stdout);
  // One Next and one Then, each a full command ending in one connection's receipt id (the engine's order decides which).
  const printed = linesOf(refused.stdout);
  const ids = [first.receiptId, second.receiptId];
  const next = printed.filter((line) => line.startsWith('Next: node '));
  const then = printed.filter((line) => line.startsWith('Then: node '));
  assert.equal(next.length, 1, refused.stdout);
  assert.equal(then.length, 1, refused.stdout);
  assert.ok(ids.some((id) => next[0] === `Next: node ${cliScript} rollback --target ${w.hub} --receipt ${id}`), refused.stdout);
  assert.ok(ids.some((id) => then[0] === `Then: node ${cliScript} rollback --target ${w.hub} --receipt ${id}`) && then[0] !== next[0], refused.stdout);
  assert.ok(!refused.stdout.includes('Then repeat the same command for'), 'no list of bare ids');
});

test('R06-15: a planted derived temp with another prefix under .second-brain/ is neither listed nor removed', async (t) => {
  const w = await workspace(t);
  const id = `tx-${randomUUID()}`;
  const temp = `.anything.second-brain-${id}.tmp`;
  await writeFile(rel(w.hub, `.second-brain/${temp}`), '{"partial":');
  const verified = await runCli(['verify', '--target', w.hub]);
  assert.ok(!verified.stdout.includes(temp), 'verify does not list a name outside the two state files');
  const planned = await runCli(connectArgs(w));
  await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.ok((await lstat(rel(w.hub, `.second-brain/${temp}`))).isFile(), 'an approved connect does not remove it either');
});

test('R06-16: printed commands run through the real POSIX shell for paths with a space, $, backtick, !, double and single quotes, and nothing else executes', { skip: !isPosix && 'the POSIX shell is not available on win32' }, async (t) => {
  const names = ['a b', 'a$b', 'a`b`', 'a!b', 'a"b', "a'b", '$(touch SHOULD_NOT_EXIST)'];
  for (const name of names) {
    const w = await workspace(t, { hubName: name, repoName: 'app' });
    const pending = await interruptedApply(w);
    const refused = await runCli(connectArgs(w));
    const command = printedCommands(refused.stdout).find((line) => line.includes('rollback'));
    assert.ok(command, refused.stdout);
    // The printed form is single-quoted: double quotes leave ! open to history expansion in interactive shells.
    assert.ok(command.includes(`'${w.hub.replace(/'/g, "'\\''")}'`), `${name}: the hub path is printed in single quotes: ${command}`);
    const ran = await run('sh', ['-c', command], { cwd: w.root, windowsHide: true });
    assert.ok(ran.stdout.includes(`Recovered interrupted connect ${pending.pendingId}`), `${name}: ${ran.stdout}`);
    await assert.rejects(lstat(path.join(w.root, 'SHOULD_NOT_EXIST')), /ENOENT/, `${name}: the shell did not run the $(...) text`);
  }
});

test('R06-5 drift: every error code the libraries can throw is translated in the CLI or listed here as generic', async () => {
  const codes = new Set();
  for (const file of ['installer.mjs', 'connect.mjs', 'cli-arguments.mjs']) {
    const source = await readFile(path.join(sourceRoot, 'lib', file), 'utf8');
    for (const match of source.matchAll(/(?:fail|InstallPlanError|usageError)\(\s*'([A-Z_]+)'/g)) codes.add(match[1]);
  }
  const bin = await readFile(path.join(sourceRoot, 'bin', 'second-brain.mjs'), 'utf8');
  const translated = new Set([...bin.matchAll(/case '([A-Z_]+)'/g)].map((match) => match[1]));
  // Codes without their own wording: the generic branch prints the code, the message, what is not changed, and verify.
  const generic = new Set(['AMBIGUOUS_OWNER', 'CONCURRENT_MODIFICATION', 'DUPLICATE_DESTINATION', 'HARNESS_MANIFEST_MISSING', 'HARNESS_SOURCE_HASH_MISMATCH', 'HARNESS_SOURCE_MISSING', 'INJECTED_WRITE_FAILURE', 'INVALID_APPROVED_CHANGE', 'INVALID_DEPENDENCY', 'INVALID_EDITION', 'INVALID_HARNESS_MANIFEST', 'INVALID_HARNESS_PIN', 'INVALID_MANIFEST', 'INVALID_NAMESPACE', 'INVALID_OPERATION', 'INVALID_OWNER', 'INVALID_PATH', 'INVALID_PLAN', 'INVALID_STATE', 'LOADER_CONFLICT', 'MISSING_PROJECT_TEMPLATE', 'MISSING_SOURCE', 'NON_DIRECTORY', 'NON_REGULAR_FILE', 'POSTIMAGE_HASH_MISMATCH', 'SECRET_BEARING_CONTENT', 'SOURCE_ESCAPE', 'SOURCE_HASH_MISMATCH', 'STALE_PREIMAGE', 'TARGET_ESCAPE', 'TARGET_NOT_ABSOLUTE', 'TARGET_NOT_DIRECTORY', 'UNDECLARED_OWNER', 'UNKNOWN_RENDER', 'UNSUPPORTED_MULTI_TOKEN', 'INVALID_CONNECTIONS_STATE', 'INVALID_CONNECTION_NAME_STATE']);
  for (const code of codes) {
    assert.ok(translated.has(code) || generic.has(code), `${code} has no translation and is not listed as generic`);
  }
});

test('the generic branch of connect prints the code, what is not changed, and verify as the next command', async (t) => {
  const w = await workspace(t);
  const file = path.join(w.root, 'a-file');
  await writeFile(file, 'not a folder\n');
  const refused = await runCli(['connect', '--target', file, '--repo', w.repo]);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stdout, /^TARGET_NOT_DIRECTORY: /m);
  assert.ok(hasLine(refused.stdout, 'Not changed: if the message above does not say a file was written, none was. Run verify to see what is on disk.'), refused.stdout);
  assert.ok(hasLine(refused.stdout, `Next: node ${cliScript} verify --target ${file}`), refused.stdout);
});

test('no printed output in this file contains null or undefined', () => {
  assert.ok(observed.length > 20, 'the earlier tests produced output to scan');
  for (const text of observed) {
    assert.doesNotMatch(text, /\b(null|undefined)\b/, text.slice(0, 300));
  }
  assert.match('connect --target H --repo null', /\bnull\b/, 'positive control: the scan fires on a planted null');
});

test('every printed command parses with the real argument parser, with no duplicate flag and only flags that exist', () => {
  const commands = observed.flatMap((text) => printedCommands(text));
  assert.ok(commands.length > 10, 'the earlier tests printed commands to check');
  for (const command of commands) {
    const words = splitCommand(command);
    const argv = words.slice(2).map((word) => (word.startsWith('<') ? '/placeholder' : word));
    const flags = argv.filter((word) => word.startsWith('--'));
    assert.equal(new Set(flags).size, flags.length, `no duplicate flag in: ${command}`);
    assert.doesNotThrow(() => parseArguments(argv), command);
  }
});

// ---------------------------------------------------------------------------
// Receipt rollback: planned repository writes and a stored receipt are the only things removed
// ---------------------------------------------------------------------------

test('rollback removes exactly the files of its receipt and reports the result per root', async (t) => {
  const w = await workspace(t);
  const before = await snapshot(w);
  const planned = await runCli(connectArgs(w));
  const applied = await runCli(connectArgs(w, ['--apply', planDigest(planned.stdout)]));
  assert.ok(appliedReceipt(applied.stdout));
  const rolledBack = await runCli(['rollback', '--target', w.hub, '--receipt', appliedReceipt(applied.stdout)]);
  assert.equal(rolledBack.code, undefined, rolledBack.stdout);
  assert.deepEqual(await snapshot(w), before);
});
