#!/usr/bin/env node
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  InstallPlanError,
  applyInstall,
  planInstall,
  rollbackReceipt,
  verifyInstall,
} from '../lib/installer.mjs';
import {
  applyConnect,
  detectHarness,
  listPendingConnects,
  planConnect,
  readConnections,
} from '../lib/connect.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(sourceRoot, 'template-manifest.json');
const commands = new Set(['init', 'upgrade', 'connect', 'verify', 'rollback']);
const FLAGS = ['--target', '--apply', '--receipt', '--repo', '--name'];
const ROOT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'RULES.md'];
const RECEIPT_ID_PATTERN = /tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const DERIVED_TEMP_PATTERN = /^\.(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json\.second-brain-\1\.tmp$/;

function help() {
  return `Second Brain Starter 1.2.0

Usage:
  second-brain init --target /absolute/path [--apply PLAN_DIGEST]
  second-brain upgrade --target /absolute/path [--apply PLAN_DIGEST]
  second-brain connect --target /absolute/path --repo /absolute/repository [--name NAME] [--apply PLAN_DIGEST]
  second-brain verify --target /absolute/path
  second-brain rollback --target /absolute/path --receipt RECEIPT_ID

init and upgrade always print a complete plan. In a terminal, type the exact
plan digest when prompted. Outside a terminal, they only plan unless --apply
supplies that exact digest. Differing files are conflicts; --force is not
available in V1.

connect stages Spec Harness into the named repository and registers it here; it never runs git. Files it creates are uncommitted; your team decides whether they go in by pull request.
Run one connect at a time per workspace; two running together can fail one of them with a missing-file error.`;
}

function usageError(message, code = 'USAGE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  if (!commands.has(command)) throw usageError(`Unknown command: ${command}`);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!FLAGS.includes(flag) || value === undefined || Object.hasOwn(values, flag)) {
      throw usageError(`Invalid arguments for ${command}.`);
    }
    values[flag] = value;
  }
  if (!values['--target'] || !path.isAbsolute(values['--target'])) {
    throw usageError('An explicit absolute --target path is required.');
  }
  if (command === 'rollback') {
    if (!values['--receipt'] || values['--apply']) throw usageError('rollback requires --receipt and does not accept --apply.');
  } else if (values['--receipt']) {
    throw usageError(`${command} does not accept --receipt.`);
  }
  if (command === 'connect') {
    if (!values['--repo']) throw usageError('connect requires --repo with an absolute path to the repository.');
    if (!path.isAbsolute(values['--repo'])) throw usageError('An explicit absolute --repo path is required.');
  } else {
    if (Object.hasOwn(values, '--repo')) throw usageError(`${command} does not accept --repo.`);
    if (Object.hasOwn(values, '--name')) throw usageError(`${command} does not accept --name.`);
  }
  if (!['init', 'upgrade', 'connect'].includes(command) && values['--apply']) {
    throw usageError(`${command} does not accept --apply.`);
  }
  return {
    command,
    targetPath: values['--target'],
    approvedDigest: values['--apply'] ?? null,
    receiptId: values['--receipt'] ?? null,
    repoPath: values['--repo'] ?? null,
    name: values['--name'] ?? null,
  };
}

async function source() {
  const manifestBytes = await readFile(manifestPath);
  return { manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, sourceRoot };
}

function printPlan(plan) {
  output.write(`Plan: ${plan.operation}\nTarget: ${plan.target}\n`);
  for (const entry of plan.entries) {
    output.write(`${entry.status}\t${entry.destination}\tundo=${entry.undo.action}\n`);
    if (entry.status === 'CONFLICT' && entry.mergeKind === 'managed-block') {
      output.write(`Manual resolution required: ${entry.destination} has unmanaged or malformed loader markers.\n`);
    }
  }
  output.write(`Plan digest: ${plan.digest}\n`);
}

async function confirmInteractive(plan, suppliedDigest) {
  if (!input.isTTY || !output.isTTY) return suppliedDigest;
  if (suppliedDigest) throw usageError('Use the terminal prompt for approval; --apply is for non-interactive use.');
  const prompt = createInterface({ input, output, terminal: true });
  try {
    return await prompt.question('Type the exact plan digest to apply, or press Enter to cancel: ');
  } finally {
    prompt.close();
  }
}

async function runPlan(command, targetPath, suppliedDigest) {
  const payload = await source();
  const plan = await planInstall({ ...payload, targetPath, operation: command });
  printPlan(plan);
  const approvedDigest = await confirmInteractive(plan, suppliedDigest);
  if (!approvedDigest) {
    output.write('Plan not applied.\n');
    return;
  }
  if (approvedDigest !== plan.digest) throw usageError('Plan digest did not match. No files were changed.');
  const result = await applyInstall({ ...payload, targetPath, operation: command, approvedDigest });
  if (result.applied) output.write(`Applied receipt: ${result.receiptId}\n`);
  else output.write('No changes needed.\n');
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

function detectionLine(detection) {
  const evidence = detection.evidence.length > 0 ? ` (evidence: ${detection.evidence.join(', ')})` : ' (no harness files found)';
  return `Detection: ${detection.status}${evidence}`;
}

function registerOnlyReason(detection) {
  if (detection.status === 'INITIALISED') return 'the harness receipt .claude/agents/.init-synthesis.json exists.';
  return 'harness files exist without a receipt; this may be an older or partial install; nothing is written into the repository; run the harness\'s own migrate guidance inside it if you want to upgrade it.';
}

function printConnectPlan(plan) {
  const lines = [
    'Plan: connect',
    `Target: ${plan.hub}`,
    `Repository: ${plan.repo}`,
    `Name: ${plan.name}`,
    detectionLine(plan.detection),
  ];
  if (plan.detection.status === 'NONE') {
    lines.push('Repository writes: harness files will be staged; files that already exist are kept as they are.');
  } else {
    lines.push('Repository writes: none (register only)', `Reason: ${registerOnlyReason(plan.detection)}`);
  }
  for (const directory of plan.directories) {
    if (directory.status === 'CREATE') lines.push(`CREATE\t${directory.root}:${directory.destination}/\tundo=remove-created-directory`);
  }
  for (const entry of plan.entries) {
    const suffix = entry.status === 'PRESERVED' && entry.differs ? ' (differs)' : '';
    lines.push(`${entry.status}\t${entry.root}:${entry.destination}\tundo=${entry.undo.action}${suffix}`);
  }
  const preserved = plan.entries.filter((entry) => entry.status === 'PRESERVED');
  lines.push(`Preserved: ${preserved.length} files kept unchanged`);
  for (const entry of preserved) lines.push(`  ${entry.root}:${entry.destination}${entry.differs ? ' (differs)' : ''}`);
  if (plan.entries.some((entry) => entry.status === 'CONFLICT')) {
    lines.push('Blocked: the workspace already has files that connect would write (CONFLICT lines above). Nothing will be written until you move them aside by hand and plan again.');
  }
  output.write(`${lines.join('\n')}\n`);

  const instructionFiles = preserved
    .filter((entry) => entry.root === 'repo' && ROOT_INSTRUCTION_FILES.includes(entry.destination))
    .map((entry) => entry.destination);
  if (instructionFiles.length > 0) {
    output.write(`\nAdd this block by hand to the preserved ${instructionFiles.join(' or ')} so your client loads the harness:\n\n`);
    output.write(plan.loaderBlock);
    output.write('The harness is not loaded by your client until you add that block.\n');
  }
  if (plan.detection.status === 'NONE') {
    output.write('Nothing is committed. These files are uncommitted in the repository; the team decides whether they go in by pull request.\n');
  } else {
    output.write('Nothing is committed: connect writes no repository files for this repository.\n');
  }
  output.write(`Harness: spec-harness ${plan.harness.harnessVersion} at ${plan.harness.commit}\n`);
  output.write(`Plan digest: ${plan.digest}\n`);
}

function printConnectHandoff(plan, receiptId) {
  const lines = [`Applied receipt: ${receiptId}`];
  if (plan.detection.status === 'NONE') {
    lines.push(
      'Status: STAGED',
      `Next: open ${plan.repo} in your client and run /sdd init there. The repository is STAGED until .claude/agents/.init-synthesis.json exists.`,
    );
  } else if (plan.detection.status === 'INITIALISED') {
    lines.push('Status: INITIALISED, registered', 'Next: no repository file was written. Open the repository in your client as usual.');
  } else {
    lines.push('Status: LEGACY, registered', 'Next: no repository file was written. To upgrade an older install, run the harness\'s own migrate guidance inside the repository.');
  }
  lines.push(`Record: ${path.join(plan.hub, '01-Projects', plan.name, 'Connection.md')}`);
  if (plan.detection.status === 'NONE') {
    lines.push('Nothing is committed: connect ran no git command. The files it created are uncommitted; your team decides whether they go in by pull request.');
  } else {
    lines.push('Nothing is committed: connect ran no git command and wrote no repository files.');
  }
  lines.push('Optional: spec-harness index needs Python 3.11 or newer and does not run on native Windows. See vendor/spec-harness/docs/GETTING-STARTED.md in the starter copy.');
  output.write(`${lines.join('\n')}\n`);
}

async function runConnect({ targetPath, repoPath, name, approvedDigest }) {
  const payload = await source();
  const plan = await planConnect({ ...payload, targetPath, repoPath, name });
  printConnectPlan(plan);
  const approved = await confirmInteractive(plan, approvedDigest);
  if (!approved) {
    output.write('Plan not applied.\n');
    return;
  }
  if (approved !== plan.digest) throw usageError('Plan digest did not match. No files were changed.', 'PLAN_DIGEST_MISMATCH');
  const result = await applyConnect({ ...payload, targetPath, repoPath, name, approvedDigest: approved });
  printConnectHandoff(result.plan, result.receiptId);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

// The files a connect staged are harness files without a receipt, which the engine's detection reads as LEGACY.
// So a connection whose own staged files are all still present, and that has no receipt yet, is STAGED.
async function stagedFilesStillPresent(targetPath, record) {
  const receipt = await readJsonOrNull(receiptFileFor(targetPath, record.connectionId));
  if (!receipt || !Array.isArray(receipt.writes)) return false;
  for (const write of receipt.writes.filter((item) => item.root === 'repo')) {
    const stat = await lstat(path.join(record.repo, ...write.destination.split('/'))).catch(() => null);
    if (!stat?.isFile()) return false;
  }
  return true;
}

async function connectionStatus(targetPath, record) {
  const stat = await lstat(record.repo).catch(() => null);
  if (stat?.isSymbolicLink()) return 'UNREADABLE (SYMLINK_PATH)';
  if (!stat || !stat.isDirectory()) return 'MISSING';
  try {
    const { status } = await detectHarness({ repoReal: record.repo });
    if (status === 'NONE') return 'STAGED';
    if (status === 'LEGACY' && record.stage === 'STAGED' && await stagedFilesStillPresent(targetPath, record)) return 'STAGED';
    return status;
  } catch (error) {
    if (error instanceof InstallPlanError) return `UNREADABLE (${error.code})`;
    throw error;
  }
}

// Inert leftovers the engine clears on the next approved connect, rollback or recovery. Listed, never removed here.
async function inertResidueLines(targetPath) {
  const lines = [];
  const pendingFolder = path.join(targetPath, '.second-brain', 'connect-pending');
  const pendingStat = await lstat(pendingFolder).catch(() => null);
  if (pendingStat?.isDirectory() && (await readdir(pendingFolder)).length === 0) {
    lines.push('RESIDUE\t.second-brain/connect-pending/\tan empty folder left by an interrupted connect; the next approved connect, a rollback or a recovery removes it.');
  }
  const receiptFolder = path.join(targetPath, '.second-brain', 'receipts');
  const receiptStat = await lstat(receiptFolder).catch(() => null);
  if (receiptStat?.isDirectory()) {
    for (const name of (await readdir(receiptFolder)).sort()) {
      if (DERIVED_TEMP_PATTERN.test(name)) {
        lines.push(`RESIDUE\t.second-brain/receipts/${name}\tthe temporary copy of a receipt left by an interrupted connect; the next approved connect or a rollback clears it.`);
      }
    }
  }
  return lines;
}

async function runVerify(targetPath) {
  const payload = await source();
  const result = await verifyInstall({ ...payload, targetPath });
  for (const entry of result.entries) output.write(`${entry.status}\t${entry.destination}\n`);
  for (const issue of result.issues) output.write(`${issue.code}\t${issue.path}\t${issue.message}\n`);
  const connections = Object.values((await readConnections({ targetPath })).connections).sort((left, right) => left.name.localeCompare(right.name));
  for (const record of connections) {
    output.write(`CONNECTION\t${record.name}\t${record.repo}\t${await connectionStatus(targetPath, record)}\n`);
  }
  let blocked = false;
  for (const item of await listPendingConnects({ targetPath })) {
    if (item.kind === 'pending') {
      blocked = true;
      output.write(`PENDING\t${item.pendingId}\t${item.name}\t${item.repo}\tinterrupted connect; recover with: node ./bin/second-brain.mjs rollback --target ${targetPath} --receipt ${item.pendingId}\n`);
    } else {
      output.write(`RESIDUE\t.second-brain/connect-pending/.${item.pendingId}.json.second-brain-${item.pendingId}.tmp\tthe first write of an interrupted connect; the next approved connect, a rollback or a recovery clears it.\n`);
    }
  }
  for (const line of await inertResidueLines(targetPath)) output.write(`${line}\n`);
  const ok = result.ok && !blocked;
  output.write(ok ? 'Verification: OK\n' : 'Verification: FAILED\n');
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// rollback (receipts and interrupted connects)
// ---------------------------------------------------------------------------

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const receiptFileFor = (targetPath, id) => path.join(targetPath, '.second-brain', 'receipts', `${id}.json`);
const pendingFileFor = (targetPath, id) => path.join(targetPath, '.second-brain', 'connect-pending', `${id}.json`);

async function runRollback({ targetPath, receiptId }) {
  const receipt = await readJsonOrNull(receiptFileFor(targetPath, receiptId));
  const result = await rollbackReceipt({ targetPath, receiptId });
  if ('pendingId' in result) {
    if (result.nothingToRecover) {
      output.write(`Nothing to recover for ${receiptId}: no interrupted connect or leftover file exists for it. Nothing was changed.\n`);
    } else if (result.completed) {
      output.write(`Interrupted connect ${receiptId} had already finished. Its receipt and connection record were kept; only its pending marker was cleared.\n`);
      output.write('Nothing was removed. The repository stays connected.\n');
      output.write(`Next: node ./bin/second-brain.mjs verify --target ${targetPath} lists the connection.\n`);
    } else {
      output.write(`Recovered interrupted connect ${receiptId}: the files it had written were removed, so both roots are back to their state before the connect. Nothing was committed.\n`);
      output.write('Next: run connect again when you are ready; it prints a new plan.\n');
    }
    return;
  }
  output.write(`Rolled back receipt: ${result.receiptId}\n`);
  if (receipt?.operation === 'connect') {
    const touchedRepository = result.rolledBackPaths.some((item) => item.startsWith('repo:'));
    output.write(touchedRepository
      ? 'Both roots are back to their state before the connect. Nothing was committed.\n'
      : 'The registration is removed. The repository was not changed.\n');
  }
  for (const destination of result.rolledBackPaths) output.write(`ROLLED_BACK\t${destination}\n`);
}

// ---------------------------------------------------------------------------
// Plain-words refusals. Every engine code that a person can meet is translated here;
// anything else keeps the engine's own `CODE: message` line.
// ---------------------------------------------------------------------------

async function pendingIds(targetPath) {
  try {
    return (await listPendingConnects({ targetPath })).filter((item) => item.kind === 'pending').map((item) => item.pendingId);
  } catch {
    return [];
  }
}

async function connectionFolderFor(targetPath, id) {
  try {
    const record = (await readConnections({ targetPath })).connections[id];
    return record ? record.name : null;
  } catch {
    return null;
  }
}

async function explain(error, context) {
  const code = error?.code;
  const message = error?.message ?? String(error);
  const hub = context.targetPath;
  const cmd = (args) => `node ./bin/second-brain.mjs ${args}`;
  const next = (text) => `Next: ${text}`;
  const connectCommand = (extra = '') => {
    const name = context.name ? ` --name ${context.name}` : '';
    return cmd(`connect --target ${hub} --repo ${context.repoPath}${name}${extra}`);
  };
  const generic = () => (code === 'LOADER_CONFLICT' ? `Manual resolution required: ${message}\n` : `${code ?? 'ERROR'}: ${message}\n`);
  const lines = (...items) => `${items.join('\n')}\n`;
  const ids = (text) => [...new Set(text.match(RECEIPT_ID_PATTERN) ?? [])];

  switch (code) {
    case 'INTERRUPTED_CONNECT': {
      const pending = await pendingIds(hub);
      const head = `INTERRUPTED_CONNECT: an earlier connect for this repository or name did not finish${pending.length > 0 ? ` (pending ${pending.join(', ')})` : ''}.`;
      const after = pending.length > 0
        ? pending.map((id) => next(cmd(`rollback --target ${hub} --receipt ${id}`)))
        : [next(cmd(`verify --target ${hub}`))];
      return lines(head, 'Not changed: this command wrote nothing. The repository may hold part of that connect\'s files.', ...after);
    }
    case 'ROLLBACK_FAILED': {
      const leftovers = error.leftovers ?? { hub: [], repo: [] };
      const list = (items) => (items.length > 0 ? items.join(', ') : 'none');
      const id = context.receiptId ?? (await pendingIds(hub))[0];
      const after = id
        ? next(`restore or remove the files listed above, then run: ${cmd(`rollback --target ${hub} --receipt ${id}`)}`)
        : next(`restore or remove the files listed above, then run: ${cmd(`verify --target ${hub}`)}`);
      return lines(
        'ROLLBACK_FAILED: undoing this connect did not finish. Some of its files are still in place.',
        `Left in the workspace: ${list(leftovers.hub)}`,
        `Left in the repository: ${list(leftovers.repo)}`,
        'Not changed: files that are not listed were removed by the undo. The connect stays interrupted, and connect for this repository is refused until the listed files are dealt with.',
        after,
      );
    }
    case 'RECEIPT_SUPERSEDED':
      return lines(
        `RECEIPT_SUPERSEDED: this receipt's connection record is gone, and ${ids(message).join(', ') || 'a newer connect'} now claims the same repository files.`,
        'Not changed: nothing was removed in either root.',
        next(cmd(`verify --target ${hub}`)),
      );
    case 'CONNECTIONS_PRESENT': {
      const found = ids(message);
      const after = found.length > 0
        ? [next(cmd(`rollback --target ${hub} --receipt ${found[0]}`)), ...(found.length > 1 ? [`Then repeat the same command for: ${found.slice(1).join(', ')}`] : [])]
        : [next(cmd(`verify --target ${hub}`))];
      return lines(
        'CONNECTIONS_PRESENT: this workspace still has connections or interrupted connects, so the init or upgrade cannot be rolled back yet.',
        'Not changed: nothing was removed.',
        ...after,
      );
    }
    case 'ALREADY_CONNECTED': {
      const id = ids(message)[0];
      const folder = id ? await connectionFolderFor(hub, id) : null;
      return lines(
        `ALREADY_CONNECTED: this repository is already connected to this workspace by receipt ${id}${folder ? ` (folder 01-Projects/${folder})` : ''}.`,
        'Not changed: nothing was written.',
        next(cmd(`verify --target ${hub}`)),
        `To undo that connection instead, run: ${cmd(`rollback --target ${hub} --receipt ${id}`)}`,
      );
    }
    case 'CONNECTION_NAME_TAKEN':
      return lines(
        `CONNECTION_NAME_TAKEN: ${message}`,
        'Not changed: nothing was written.',
        next(connectCommand(' --name <a name no other connection uses>')),
      );
    case 'INVALID_CONNECTION_NAME':
      return lines(
        `INVALID_CONNECTION_NAME: ${message}`,
        'Not changed: nothing was written.',
        next(connectCommand(' --name <one plain folder name>')),
      );
    case 'UNSAFE_REPO':
      return lines(
        `UNSAFE_REPO: ${message}`,
        'Not changed: nothing was written.',
        next(cmd(`connect --target ${hub} --repo <a repository folder outside the workspace>`)),
      );
    case 'SYMLINK_PATH': {
      if (context.command !== 'connect') return generic();
      const real = await realpath(context.repoPath).catch(() => null);
      return lines(
        `SYMLINK_PATH: ${message}`,
        'If this is another spelling of a repository already connected here, that is the reason.',
        'Not changed: nothing was written.',
        next(cmd(`connect --target ${hub} --repo ${real ?? '<the real path of the repository>'}`)),
      );
    }
    case 'REPO_NOT_DIRECTORY': {
      if (context.command === 'rollback') {
        const receipt = await readJsonOrNull(receiptFileFor(hub, context.receiptId));
        const repo = receipt?.repo ?? '<the repository of this connect>';
        return lines(
          'REPO_NOT_DIRECTORY: the repository of this connect is no longer an existing folder, so its files cannot be removed yet. Nothing was removed.',
          next(`put the folder back at ${repo} (or move it back), then run: ${cmd(`rollback --target ${hub} --receipt ${context.receiptId}`)}`),
        );
      }
      if (context.command !== 'connect') return generic();
      return lines(
        `REPO_NOT_DIRECTORY: ${context.repoPath} is not an existing folder.`,
        'Not changed: nothing was written.',
        next(cmd(`connect --target ${hub} --repo <an existing folder>`)),
      );
    }
    case 'PLAN_DIGEST_MISMATCH':
      if (context.command !== 'connect') return generic();
      return lines(
        `PLAN_DIGEST_MISMATCH: ${message}`,
        'Not changed: no files were changed.',
        next(connectCommand()),
      );
    case 'INVALID_PENDING_CONNECT': {
      const unparsed = message.match(/Pending connect record (.+?) is empty or truncated/);
      if (context.command === 'rollback' && /different workspace path/.test(message)) {
        const recorded = (await readJsonOrNull(pendingFileFor(hub, context.receiptId)))?.hub ?? '<the path the workspace had when the connect started>';
        return lines(
          `INVALID_PENDING_CONNECT: ${message}`,
          'Not changed: the record was not acted on.',
          next(`move the workspace back to ${recorded}, then run: ${cmd(`rollback --target ${recorded} --receipt ${context.receiptId}`)}`),
        );
      }
      if (unparsed) {
        return lines(
          `INVALID_PENDING_CONNECT: ${message}`,
          'Not changed: the record was never acted on, so nothing was written.',
          next(`delete ${unparsed[1]} (it never parsed), then run: ${connectCommand()}`),
        );
      }
      return lines(
        `INVALID_PENDING_CONNECT: ${message}`,
        'Not changed: the record was not acted on.',
        next(cmd(`verify --target ${hub}`)),
      );
    }
    case 'INVALID_RECEIPT': {
      if (/different workspace path/.test(message) && context.receiptId) {
        const recorded = (await readJsonOrNull(receiptFileFor(hub, context.receiptId)))?.hub;
        if (recorded) {
          return lines(
            `INVALID_RECEIPT: this receipt was written for a workspace at ${recorded}, and this workspace is at ${hub}.`,
            'Not changed: nothing was removed.',
            next(cmd(`rollback --target ${recorded} --receipt ${context.receiptId}`)),
          );
        }
      }
      return lines(`INVALID_RECEIPT: ${message}`, 'Not changed: nothing was removed.', next(cmd(`verify --target ${hub}`)));
    }
    case 'PLAN_CONFLICT':
      if (context.command !== 'connect') return generic();
      return lines(
        `PLAN_CONFLICT: ${message}`,
        'Not changed: nothing was written.',
        next(`move the files listed above aside by hand, then run: ${connectCommand()}`),
      );
    case 'MISSING_RECEIPT':
      if (context.command !== 'rollback') return generic();
      return lines(
        `MISSING_RECEIPT: no receipt or interrupted connect with the id ${context.receiptId} exists in this workspace. It was probably rolled back already.`,
        'Not changed: nothing was removed.',
        next(cmd(`verify --target ${hub}`)),
      );
    case 'POSTIMAGE_MISMATCH':
      return lines(
        `POSTIMAGE_MISMATCH: ${message}`,
        next(`put back the bytes the connect wrote (or move the changed file aside), then run: ${cmd(`rollback --target ${hub} --receipt ${context.receiptId}`)}`),
      );
    case 'TARGET_TRAVERSAL':
      return lines(`TARGET_TRAVERSAL: ${message}`, 'Not changed: nothing was written.', next('run the command again with the full absolute path, without .. segments.'));
    default:
      return generic();
  }
}

async function run(context) {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    output.write(`${help()}\n`);
    return;
  }
  Object.assign(context, parsed);
  if (parsed.command === 'init' || parsed.command === 'upgrade') {
    await runPlan(parsed.command, parsed.targetPath, parsed.approvedDigest);
    return;
  }
  if (parsed.command === 'connect') {
    await runConnect(parsed);
    return;
  }
  if (parsed.command === 'verify') {
    await runVerify(parsed.targetPath);
    return;
  }
  await runRollback(parsed);
}

const context = {};
run(context).catch(async (error) => {
  output.write(await explain(error, context));
  process.exitCode = 1;
});
