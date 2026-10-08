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
  sha256,
  verifyInstall,
} from '../lib/installer.mjs';
import {
  RECEIPT_ID_PATTERN,
  USAGE_LINES,
  clip,
  parseArguments,
  usageError,
} from '../lib/cli-arguments.mjs';
import {
  STATE_TEMP_PATTERN,
  applyConnect,
  detectHarness,
  listPendingConnects,
  planConnect,
  readConnections,
} from '../lib/connect.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(sourceRoot, 'template-manifest.json');
const SCRIPT = path.resolve(fileURLToPath(import.meta.url));
const ROOT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'RULES.md'];
const HARNESS_RECEIPT = '.claude/agents/.init-synthesis.json';
const RECEIPT_IDS_IN_TEXT = /tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const DERIVED_TEMP_PATTERN = /^\.(tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json\.second-brain-\1\.tmp$/;
const CHANGED_SENTENCE = 'CHANGED: some files this connect wrote are missing or differ now. You can roll the connection back, or keep the files as they are.';
const LABEL_SENTENCES = {
  STAGED: 'STAGED: the harness files this connect wrote are present and unchanged, and the repository is waiting for /sdd init.',
  INITIALISED: 'INITIALISED: the repository has its harness receipt, .claude/agents/.init-synthesis.json.',
  MISSING: 'MISSING: the repository folder is not at the path the connection recorded.',
  CHANGED: CHANGED_SENTENCE,
  NO_RECEIPT: 'NO_RECEIPT: the receipt for this connection is missing, so the tool cannot roll it back.',
  REGISTERED: 'REGISTERED: this repository was registered without writing files into it; its harness state is read from disk now.',
  UNREADABLE: 'UNREADABLE: verify could not read this repository safely.',
};

// Every printed command is built here, once. Words that are not plain are double-quoted; each flag is
// emitted at most once; the script is the absolute path of this file, so the command runs from any folder.
function word(value) {
  const text = String(value);
  const plain = process.platform === 'win32' ? /^[A-Za-z0-9_.\\/:~-]+$/ : /^[A-Za-z0-9_./:-]+$/;
  if (plain.test(text)) return text;
  // win32: double quotes, the form cmd.exe and Windows argument splitting read. % is not escaped, so this
  // form targets argument splitting, not every cmd.exe expansion. Leave it unless a Windows shell test says otherwise.
  if (process.platform === 'win32') return `"${text.replace(/"/g, '\\"')}"`;
  // POSIX: single quotes, which no shell expands ($, `, !, " and \ are all literal inside them). An embedded
  // single quote is written as '\'' (close, escaped quote, reopen).
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function cliCommand(subcommand, { target, repo, name, receipt, apply } = {}) {
  const parts = ['node', word(SCRIPT), subcommand];
  if (target !== undefined) parts.push('--target', word(target));
  if (repo !== undefined) parts.push('--repo', word(repo));
  if (name !== undefined) parts.push('--name', word(name));
  if (receipt !== undefined) parts.push('--receipt', word(receipt));
  if (apply !== undefined) parts.push('--apply', word(apply));
  return parts.join(' ');
}

function help() {
  return `Second Brain Starter 1.3.0

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
Run one connect at a time per workspace; two running together can fail one of them with a missing-file error.
Commands this CLI prints use the absolute path of this script, so they run from any folder.`;
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
  output.write(`Apply this exact plan with: ${cliCommand(plan.operation, { target: plan.target, apply: plan.digest })}\n`);
}

// Ctrl-C and end of input at the prompt are a cancel that exits 1, as connect's prompt does. An empty answer is the
// cancel init always had, and it keeps exit code 0. Only the interruption changes exit code.
async function confirmInteractive(plan, suppliedDigest) {
  if (!input.isTTY || !output.isTTY) return { answer: suppliedDigest, interrupted: false };
  if (suppliedDigest) throw usageError('Use the terminal prompt for approval; --apply is for non-interactive use.');
  const prompt = createInterface({ input, output, terminal: true });
  const interrupted = new Promise((resolve) => {
    prompt.once('SIGINT', () => resolve({ answer: null, interrupted: true }));
    prompt.once('close', () => resolve({ answer: null, interrupted: true }));
  });
  try {
    const answer = prompt.question('Type the exact plan digest to apply, or press Enter to cancel: ').then((text) => ({ answer: text, interrupted: false }));
    return await Promise.race([answer, interrupted]);
  } finally {
    prompt.close();
  }
}

async function runPlan(command, targetPath, suppliedDigest) {
  const payload = await source();
  const plan = await planInstall({ ...payload, targetPath, operation: command });
  printPlan(plan);
  const { answer, interrupted } = await confirmInteractive(plan, suppliedDigest);
  if (interrupted) {
    output.write('Plan not applied.\n');
    process.exitCode = 1;
    return;
  }
  const approvedDigest = answer;
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
  // The engine code appears once, in parentheses, for support; the words a person reads are plain.
  if (detection.status === 'LEGACY') return `Detection: this repository already has Spec Harness files (engine code: LEGACY; evidence: ${detection.evidence.join(', ')})`;
  const evidence = detection.evidence.length > 0 ? ` (evidence: ${detection.evidence.join(', ')})` : ' (no harness files found)';
  return `Detection: ${detection.status}${evidence}`;
}

// The reason a person reads never uses the engine's internal code word; the detection line carries it.
function registerOnlyReason(detection) {
  if (detection.status === 'INITIALISED') return `the harness receipt ${HARNESS_RECEIPT} exists.`;
  return 'this repository already has Spec Harness files, so connect will only register it and will not write into it. If a teammate added the harness, that is expected. If /sdd commands do not work there, run /sdd init inside that repository.';
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
  output.write(`Apply this exact plan with: ${cliCommand('connect', { target: plan.hub, repo: plan.repo, name: plan.name, apply: plan.digest })}\n`);
}

function printConnectHandoff(plan, receiptId) {
  const lines = [`Applied receipt: ${receiptId}`];
  if (plan.detection.status === 'NONE') {
    lines.push(
      'Status: STAGED',
      `Next: open ${plan.repo} in your client and run /sdd init there. The repository is STAGED until ${HARNESS_RECEIPT} exists.`,
    );
  } else if (plan.detection.status === 'INITIALISED') {
    lines.push('Status: INITIALISED, registered', 'Next: no repository file was written. Open the repository in your client as usual.');
  } else {
    lines.push('Status: already has harness files, registered', 'Next: no repository file was written. If /sdd commands do not work in this repository, run /sdd init inside it.');
  }
  lines.push(`Record: ${path.join(plan.hub, '01-Projects', plan.name, 'Connection.md')}`);
  if (plan.detection.status === 'NONE') {
    lines.push('Nothing is committed: connect ran no git command. The files it created are uncommitted; your team decides whether they go in by pull request.');
  } else {
    lines.push('Nothing is committed: connect ran no git command and wrote no repository files.');
  }
  lines.push('Optional: spec-harness index needs Python 3.11 or newer and does not run on native Windows. See vendor/spec-harness/docs/GETTING-STARTED.md in the starter copy.');
  lines.push(`To undo this connect: ${cliCommand('rollback', { target: plan.hub, receipt: receiptId })}`);
  output.write(`${lines.join('\n')}\n`);
  const preserved = plan.entries.filter((entry) => entry.status === 'PRESERVED' && entry.root === 'repo' && ROOT_INSTRUCTION_FILES.includes(entry.destination));
  if (preserved.length > 0) {
    output.write(`\nAdd this block by hand to the preserved ${preserved.map((entry) => entry.destination).join(' or ')} so your client loads the harness:\n\n`);
    output.write(plan.loaderBlock);
    output.write('The harness is not loaded by your client until you add that block.\n');
  }
}

// connect owns its prompt: Ctrl-C, end of input and a broken prompt are all a cancel, so the terminal run says
// "Plan not applied." and exits 1 instead of ending silently. init keeps its own prompt, unchanged.
async function approvalForConnect(plan, suppliedDigest) {
  if (!input.isTTY || !output.isTTY) return suppliedDigest;
  if (suppliedDigest) throw usageError('Use the terminal prompt for approval; --apply is for non-interactive use.');
  const prompt = createInterface({ input, output, terminal: true });
  const cancelled = new Promise((resolve) => {
    prompt.once('SIGINT', () => resolve(null));
    prompt.once('close', () => resolve(null));
  });
  try {
    return await Promise.race([prompt.question('Type the exact plan digest to apply, or press Enter to cancel: '), cancelled]) ?? null;
  } catch {
    return null;
  } finally {
    prompt.close();
  }
}

async function runConnect({ targetPath, repoPath, name, approvedDigest }) {
  const payload = await source();
  const plan = await planConnect({ ...payload, targetPath, repoPath, name });
  printConnectPlan(plan);
  const approved = await approvalForConnect(plan, approvedDigest);
  if (!approved) {
    output.write('Plan not applied.\n');
    if (input.isTTY && output.isTTY) process.exitCode = 1;
    return;
  }
  if (approved !== plan.digest) throw usageError('Plan digest did not match. No files were changed.', 'PLAN_DIGEST_MISMATCH');
  const result = await applyConnect({ ...payload, targetPath, repoPath, name, approvedDigest: approved });
  printConnectHandoff(result.plan, result.receiptId);
}

// ---------------------------------------------------------------------------
// verify: states read from disk, read-only
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

async function stagedState(targetPath, record) {
  const receipt = await readJsonOrNull(receiptFileFor(targetPath, record.connectionId));
  if (!receipt || !Array.isArray(receipt.writes)) {
    // No receipt means the tool has no record of what it wrote, so it cannot roll this connection back. No command is printed for it.
    return {
      label: 'NO_RECEIPT',
      lines: [
        'Without its receipt this connection cannot be rolled back by the tool. Nothing was changed. Connection.md does not list the staged files: it only names the repository.',
        'Next: the tool has no command for this connection. Keep the files, or delete them yourself. To stop verify listing it, delete its entry from .second-brain/connections.json by hand; that does not delete the files.',
      ],
    };
  }
  const problems = [];
  let missing = 0;
  let differ = 0;
  for (const write of receipt.writes.filter((item) => item.root === 'repo')) {
    const file = path.join(record.repo, ...write.destination.split('/'));
    const stat = await lstat(file).catch(() => null);
    if (!stat?.isFile()) {
      missing += 1;
      problems.push(write.destination);
    } else if (sha256(await readFile(file)) !== write.postimageSha256) {
      differ += 1;
      problems.push(write.destination);
    }
  }
  if (problems.length === 0) return { label: 'STAGED' };
  return {
    label: 'CHANGED',
    lines: [
      `CHANGED: ${missing} staged ${missing === 1 ? 'file' : 'files'} missing, ${differ} ${differ === 1 ? 'differs' : 'differ'}; first: ${problems.slice(0, 3).join(', ')}`,
      `To roll the connection back: ${cliCommand('rollback', { target: targetPath, receipt: record.connectionId })}`,
    ],
  };
}

// The ruled order: missing folder; harness receipt present; staged and intact; staged but changed; registered only.
async function connectionState(targetPath, record) {
  const stat = await lstat(record.repo).catch(() => null);
  if (stat?.isSymbolicLink()) return { label: 'UNREADABLE', text: 'UNREADABLE (SYMLINK_PATH)' };
  if (!stat || !stat.isDirectory()) return { label: 'MISSING' };
  if ((await lstat(path.join(record.repo, ...HARNESS_RECEIPT.split('/'))).catch(() => null))?.isFile()) return { label: 'INITIALISED' };
  if (record.stage === 'STAGED') return stagedState(targetPath, record);
  try {
    const { status } = await detectHarness({ repoReal: record.repo });
    return { label: 'REGISTERED', text: status === 'NONE' ? 'REGISTERED (now: no harness files found)' : 'REGISTERED (now: harness present)' };
  } catch (error) {
    if (error instanceof InstallPlanError) return { label: 'UNREADABLE', text: `UNREADABLE (${error.code})` };
    throw error;
  }
}

async function runVerify(targetPath) {
  const payload = await source();
  const result = await verifyInstall({ ...payload, targetPath });
  for (const entry of result.entries) output.write(`${entry.status}\t${entry.destination}\n`);
  for (const issue of result.issues) output.write(`${issue.code}\t${issue.path}\t${issue.message}\n`);
  const connections = Object.values((await readConnections({ targetPath })).connections).sort((left, right) => left.name.localeCompare(right.name));
  const printedLabels = new Set();
  const labels = [];
  for (const record of connections) {
    const state = await connectionState(targetPath, record);
    labels.push(state.label);
    output.write(`CONNECTION\t${record.name}\t${record.repo}\t${state.text ?? state.label}\t${record.connectionId}\n`);
    for (const line of state.lines ?? []) output.write(`  ${line}\n`);
    if (!printedLabels.has(state.label)) {
      printedLabels.add(state.label);
      output.write(`  ${LABEL_SENTENCES[state.label]}\n`);
    }
  }
  let blocked = false;
  const pendingIds = new Set();
  for (const item of await listPendingConnects({ targetPath })) {
    if (item.kind === 'pending') {
      blocked = true;
      pendingIds.add(item.pendingId);
      const command = cliCommand('rollback', { target: targetPath, receipt: item.pendingId });
      if (item.committed) {
        output.write(`PENDING\t${item.pendingId}\t${item.name}\t${item.repo}\tfinished connect, not yet cleared; this command only clears the marker and keeps the connection: ${command}\n`);
      } else {
        output.write(`PENDING\t${item.pendingId}\t${item.name}\t${item.repo}\tinterrupted connect; recover with: ${command}\n`);
      }
    } else {
      output.write(`RESIDUE\t.second-brain/connect-pending/.${item.pendingId}.json.second-brain-${item.pendingId}.tmp\tthe first write of a connect; the next approved connect, a rollback or a recovery clears it.\n`);
    }
  }
  for (const line of await inertResidueLines(targetPath, pendingIds)) output.write(`${line}\n`);
  // D18-a: connections never change the exit code. The summary says what needs attention, so "Verification: OK" is not misread.
  if (connections.length > 0) {
    const attention = [...new Set(labels.filter((label) => ['CHANGED', 'MISSING', 'NO_RECEIPT'].includes(label)))];
    if (attention.length > 0) {
      const named = attention.length > 1 ? `${attention.slice(0, -1).join(', ')} and ${attention.at(-1)}` : attention[0];
      const count = labels.filter((label) => attention.includes(label)).length;
      output.write(`Connections: ${count} of ${connections.length} need attention (see ${named} above). This does not affect the workspace's own files.\n`);
    } else {
      output.write(`Connections: ${connections.length}, all as recorded.\n`);
    }
  }
  const ok = result.ok && !blocked;
  output.write(ok ? 'Verification: OK\n' : 'Verification: FAILED\n');
  if (!ok) process.exitCode = 1;
}

// Inert leftovers the engine clears on the next approved connect, rollback or recovery. Listed, never removed here.
async function inertResidueLines(targetPath, livePendingIds) {
  const lines = [];
  const pendingFolder = path.join(targetPath, '.second-brain', 'connect-pending');
  const pendingStat = await lstat(pendingFolder).catch(() => null);
  if (pendingStat?.isDirectory() && (await readdir(pendingFolder)).length === 0) {
    lines.push('RESIDUE\t.second-brain/connect-pending/\tan empty folder left behind by a connect; the next approved connect, a rollback or a recovery removes it.');
  }
  const receiptFolder = path.join(targetPath, '.second-brain', 'receipts');
  if ((await lstat(receiptFolder).catch(() => null))?.isDirectory()) {
    for (const name of (await readdir(receiptFolder)).sort()) {
      if (DERIVED_TEMP_PATTERN.test(name)) {
        lines.push(`RESIDUE\t.second-brain/receipts/${name}\tthe temporary copy of a receipt left behind by a connect; the next approved connect or a rollback clears it.`);
      }
    }
  }
  const stateFolder = path.join(targetPath, '.second-brain');
  if ((await lstat(stateFolder).catch(() => null))?.isDirectory()) {
    for (const name of (await readdir(stateFolder)).sort()) {
      const match = name.match(STATE_TEMP_PATTERN);
      if (match && !livePendingIds.has(match[1])) {
        lines.push(`RESIDUE\t.second-brain/${name}\tan unfinished copy of a connection state file left behind by a connect; the next approved connect, a rollback or a recovery clears it.`);
      }
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// rollback (receipts and interrupted connects)
// ---------------------------------------------------------------------------

async function runRollback({ targetPath, receiptId }) {
  const receipt = await readJsonOrNull(receiptFileFor(targetPath, receiptId));
  const result = await rollbackReceipt({ targetPath, receiptId });
  if ('pendingId' in result) {
    if (result.nothingToRecover) {
      output.write(`Nothing to recover for ${receiptId}: no interrupted connect or leftover file exists for it. Nothing was changed.\n`);
    } else if (result.completed) {
      output.write(`Interrupted connect ${receiptId} had already finished. Its receipt and connection record were kept; only its pending marker was cleared.\n`);
      output.write('Nothing was removed. The repository stays connected.\n');
      output.write(`Next: ${cliCommand('verify', { target: targetPath })}\n`);
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
// Plain-words refusals. Every engine code a person can meet is translated here;
// anything else keeps the engine's own `CODE: message` line.
// ---------------------------------------------------------------------------

async function pendingIds(targetPath) {
  try {
    return (await listPendingConnects({ targetPath })).filter((item) => item.kind === 'pending').map((item) => item.pendingId);
  } catch {
    return [];
  }
}

async function connectionFor(targetPath, id) {
  try {
    return (await readConnections({ targetPath })).connections[id] ?? null;
  } catch {
    return null;
  }
}

async function connectionForRepository(targetPath, repoPath) {
  try {
    return Object.values((await readConnections({ targetPath })).connections).find((record) => record.repo === repoPath) ?? null;
  } catch {
    return null;
  }
}

async function explain(error, context) {
  const code = error?.code;
  const message = error?.message ?? String(error);
  const hub = context.targetPath;
  const repo = context.repoPath ?? '<repository path>';
  // A name is suggested back only when it is plain: short, and with no slash, backslash or control character.
  const name = context.name && context.name.length <= 60 && !/[\\/\u0000-\u001f]/.test(context.name) ? context.name : undefined;
  // Echoed user input is clipped, so a long value is never printed in full.
  const echo = (text) => (context.name && text.includes(context.name) ? text.split(context.name).join(clip(context.name)) : text);
  const next = (text) => `Next: ${text}`;
  const lines = (...items) => `${items.join('\n')}\n`;
  const generic = () => (code === 'LOADER_CONFLICT' ? `Manual resolution required: ${message}\n` : `${code ?? 'ERROR'}: ${message}\n`);
  const ids = (text) => [...new Set(text.match(RECEIPT_IDS_IN_TEXT) ?? [])];
  const list = (items) => (items.length > 0 ? items.join(', ') : 'none');
  const connectCmd = (overrides = {}) => cliCommand('connect', { target: hub, repo, name, ...overrides });
  const rollbackCmd = (id) => cliCommand('rollback', { target: hub, receipt: id });
  const verifyCmd = () => cliCommand('verify', { target: hub });
  const notChanged = (text = 'Not changed: nothing was written.') => text;

  if (context.parsing) {
    const usage = USAGE_LINES[context.command] ? `Usage: ${USAGE_LINES[context.command]}` : 'Usage: run this script with --help to list every command.';
    const hint = message.includes('--receipt <receipt id>')
      ? ['Receipt ids are printed on the Applied receipt: line of connect or init, shown on each CONNECTION line of verify, and named by the files in .second-brain/receipts/.']
      : [];
    return lines(`USAGE: ${message}`, ...(message.includes('Nothing was changed') ? [] : ['Nothing was changed.']), usage, ...hint);
  }

  switch (code) {
    case 'INTERRUPTED_CONNECT': {
      const pending = await pendingIds(hub);
      const head = `INTERRUPTED_CONNECT: an earlier connect for this repository or name did not finish${pending.length > 0 ? ` (pending ${pending.join(', ')})` : ''}.`;
      const after = pending.length > 0 ? pending.map((id) => next(rollbackCmd(id))) : [next(verifyCmd())];
      return lines(head, 'Not changed: this command wrote nothing. The repository may hold part of that connect\'s files.', ...after);
    }
    case 'ROLLBACK_FAILED': {
      const leftovers = error.leftovers ?? { hub: [], repo: [] };
      const id = context.receiptId ?? (await pendingIds(hub))[0];
      return lines(
        'ROLLBACK_FAILED: undoing this connect did not finish. Some of its files are still in place.',
        `Left in the workspace: ${list(leftovers.hub)}`,
        `Left in the repository: ${list(leftovers.repo)}`,
        'Not changed: files that are not listed were removed by the undo. The connect stays interrupted, and connect for this repository is refused until the listed files are dealt with.',
        'These files no longer hold what the connect wrote, so they were left untouched. If the change is yours and you want to keep it, move the file out of the repository (do not delete it), then run the same rollback command again. If you do not need it, you may delete it yourself.',
        next(id ? rollbackCmd(id) : verifyCmd()),
      );
    }
    case 'RECEIPT_SUPERSEDED':
      return lines(
        `RECEIPT_SUPERSEDED: this receipt's connection record is gone, and ${ids(message).join(', ') || 'a newer connect'} now claims the same repository files.`,
        'Not changed: nothing was removed in either root.',
        next(verifyCmd()),
      );
    case 'CONNECTIONS_PRESENT': {
      const found = ids(message);
      const after = found.length > 0
        ? [next(rollbackCmd(found[0])), ...found.slice(1).map((id) => `Then: ${rollbackCmd(id)}`)]
        : [next(verifyCmd())];
      return lines(
        'CONNECTIONS_PRESENT: this workspace still has connections or interrupted connects, so the init or upgrade cannot be rolled back yet.',
        'Not changed: nothing was removed.',
        ...after,
      );
    }
    case 'ALREADY_CONNECTED': {
      const id = ids(message)[0];
      const record = id ? await connectionFor(hub, id) : null;
      return lines(
        `ALREADY_CONNECTED: this repository is already connected to this workspace by receipt ${id}${record ? ` (folder 01-Projects/${record.name})` : ''}.`,
        notChanged(),
        next(verifyCmd()),
        `To undo that connection instead, run: ${rollbackCmd(id)}`,
      );
    }
    case 'CONNECTION_NAME_TAKEN':
      return lines(
        `CONNECTION_NAME_TAKEN: ${echo(message)}`,
        notChanged(),
        next(connectCmd({ name: '<a name no other connection uses>' })),
      );
    case 'INVALID_CONNECTION_NAME':
      // The user's name is never echoed back as a flag value: the suggestion is a placeholder.
      return lines(
        `INVALID_CONNECTION_NAME: ${echo(message)}`,
        ...(context.name ? [] : ['The default name comes from the repository folder name, and that name cannot be used. Pass --name with a plain folder name.']),
        notChanged(),
        next(connectCmd({ name: '<one plain folder name>' })),
      );
    case 'UNSAFE_REPO':
      return lines(
        `UNSAFE_REPO: ${echo(message)}`,
        notChanged(),
        next(connectCmd({ repo: '<a repository folder outside the workspace>' })),
      );
    case 'SYMLINK_PATH': {
      if (context.command !== 'connect') return generic();
      const given = await lstat(context.repoPath).catch(() => null);
      const real = await realpath(context.repoPath).catch(() => null);
      const head = given?.isSymbolicLink()
        ? `SYMLINK_PATH: the path you gave is a symlink to ${real ?? 'another folder'}.`
        : `SYMLINK_PATH: a folder on the path you gave is a symlink: ${message.replace(/^Repository contains a symlink: /, '')}`;
      const existing = real ? await connectionForRepository(hub, real) : null;
      if (existing) {
        return lines(
          head,
          notChanged(),
          `That repository is already connected (receipt ${existing.connectionId}, folder 01-Projects/${existing.name}).`,
          next(verifyCmd()),
        );
      }
      return lines(head, notChanged(), next(connectCmd({ repo: real ?? '<the real path of the repository>' })));
    }
    case 'REPO_NOT_DIRECTORY': {
      if (context.command === 'rollback') {
        const receipt = await readJsonOrNull(receiptFileFor(hub, context.receiptId));
        const recorded = receipt?.repo ?? '<the repository of this connect>';
        return lines(
          'REPO_NOT_DIRECTORY: the repository of this connect is no longer an existing folder, so its files cannot be removed yet. Nothing was removed.',
          next(`put the folder back at ${recorded} (or move it back), then run: ${rollbackCmd(context.receiptId)}`),
        );
      }
      if (context.command !== 'connect') return generic();
      return lines(
        `REPO_NOT_DIRECTORY: ${echo(repo)} is not an existing folder.`,
        notChanged(),
        next(connectCmd({ repo: '<an existing folder>' })),
      );
    }
    case 'PLAN_DIGEST_MISMATCH':
      if (context.command !== 'connect') return generic();
      return lines(
        `PLAN_DIGEST_MISMATCH: ${message}`,
        'Not changed: no files were changed.',
        next(connectCmd()),
      );
    case 'INVALID_PENDING_CONNECT': {
      const unparsed = message.match(/Pending connect record (.+?) is empty or truncated/);
      if (context.command === 'rollback' && /different workspace path/.test(message)) {
        const recorded = (await readJsonOrNull(pendingFileFor(hub, context.receiptId)))?.hub ?? '<the path the workspace had when the connect started>';
        return lines(
          `INVALID_PENDING_CONNECT: ${message}`,
          'Not changed: the record was not acted on.',
          next(`move the workspace back to ${recorded}, then run: ${cliCommand('rollback', { target: recorded, receipt: context.receiptId })}`),
        );
      }
      if (unparsed) {
        return lines(
          `INVALID_PENDING_CONNECT: ${message}`,
          'Not changed: the record was never acted on, so nothing was written.',
          next(`delete ${word(unparsed[1])} (it never parsed), then run: ${connectCmd()}`),
        );
      }
      return lines(`INVALID_PENDING_CONNECT: ${message}`, 'Not changed: the record was not acted on.', next(verifyCmd()));
    }
    case 'INVALID_RECEIPT': {
      if (/different workspace path/.test(message) && context.receiptId) {
        const recorded = (await readJsonOrNull(receiptFileFor(hub, context.receiptId)))?.hub;
        if (recorded) {
          return lines(
            `INVALID_RECEIPT: this receipt was written for a workspace at ${recorded}, and this workspace is at ${hub}.`,
            'Not changed: nothing was removed.',
            next(cliCommand('rollback', { target: recorded, receipt: context.receiptId })),
          );
        }
      }
      return lines(`INVALID_RECEIPT: ${message}`, 'Not changed: nothing was removed.', next(verifyCmd()));
    }
    case 'PLAN_CONFLICT':
      if (context.command !== 'connect') return generic();
      return lines(
        `PLAN_CONFLICT: ${message}`,
        notChanged(),
        next(`move the files listed above aside by hand, then run: ${connectCmd()}`),
      );
    case 'HUB_NOT_INITIALISED':
      if (context.command !== 'connect') return generic();
      return lines(
        `HUB_NOT_INITIALISED: the folder ${hub} is not an initialised workspace yet, so connect has nothing to register into.`,
        notChanged(),
        next(cliCommand('init', { target: hub })),
      );
    case 'UNSAFE_TARGET': {
      if (context.command !== 'connect') return generic();
      const named = /^Repository/.test(message) ? repo : hub;
      return lines(
        `UNSAFE_TARGET: The path ${echo(named)} cannot be used here. ${message}`,
        notChanged(),
        next(connectCmd({ target: '<a workspace folder>' })),
      );
    }
    case 'MISSING_RECEIPT':
      if (context.command !== 'rollback') return generic();
      return lines(
        `MISSING_RECEIPT: no receipt or interrupted connect with the id ${context.receiptId} exists in this workspace. It was probably rolled back already.`,
        'Not changed: nothing was removed.',
        next(verifyCmd()),
      );
    case 'POSTIMAGE_MISMATCH':
      return lines(
        `POSTIMAGE_MISMATCH: ${message}`,
        'The files named above differ from what connect wrote, so they were left untouched. If the change is yours and you want to keep it, move the file out of the repository (do not delete it), then run the same rollback command again. If you do not need it, you may delete it yourself.',
        next(rollbackCmd(context.receiptId)),
      );
    case 'TARGET_TRAVERSAL':
      return lines(`TARGET_TRAVERSAL: ${message}`, notChanged(), next('run the command again with the full absolute path, without .. segments.'));
    default:
      // Codes without their own wording: the code and message, what is not changed, and verify as the next command.
      if (['connect', 'rollback'].includes(context.command) && code !== 'LOADER_CONFLICT') {
        return lines(
          `${code ?? 'ERROR'}: ${message}`,
          next(verifyCmd()),
        );
      }
      return generic();
  }
}

async function run(context) {
  context.parsing = true;
  const parsed = parseArguments(process.argv.slice(2));
  context.parsing = false;
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

const context = { command: process.argv[2] };
run(context).catch(async (error) => {
  output.write(await explain(error, context));
  process.exitCode = 1;
});
