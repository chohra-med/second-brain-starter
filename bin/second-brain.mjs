#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
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

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(sourceRoot, 'template-manifest.json');
const commands = new Set(['init', 'upgrade', 'verify', 'rollback']);

function help() {
  return `Second Brain Starter 1.1.0

Usage:
  second-brain init --target /absolute/path [--apply PLAN_DIGEST]
  second-brain upgrade --target /absolute/path [--apply PLAN_DIGEST]
  second-brain verify --target /absolute/path
  second-brain rollback --target /absolute/path --receipt RECEIPT_ID

init and upgrade always print a complete plan. In a terminal, type the exact
plan digest when prompted. Outside a terminal, they only plan unless --apply
supplies that exact digest. Differing files are conflicts; --force is not
available in V1.`;
}

function usageError(message) {
  const error = new Error(message);
  error.code = 'USAGE';
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
    if (!['--target', '--apply', '--receipt'].includes(flag) || value === undefined || Object.hasOwn(values, flag)) {
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
  if (!['init', 'upgrade'].includes(command) && values['--apply']) {
    throw usageError(`${command} does not accept --apply.`);
  }
  return { command, targetPath: values['--target'], approvedDigest: values['--apply'] ?? null, receiptId: values['--receipt'] ?? null };
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

async function run() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    output.write(`${help()}\n`);
    return;
  }
  if (parsed.command === 'init' || parsed.command === 'upgrade') {
    await runPlan(parsed.command, parsed.targetPath, parsed.approvedDigest);
    return;
  }
  if (parsed.command === 'verify') {
    const result = await verifyInstall({ ...(await source()), targetPath: parsed.targetPath });
    for (const entry of result.entries) output.write(`${entry.status}\t${entry.destination}\n`);
    for (const issue of result.issues) output.write(`${issue.code}\t${issue.path}\t${issue.message}\n`);
    output.write(result.ok ? 'Verification: OK\n' : 'Verification: FAILED\n');
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const result = await rollbackReceipt({ targetPath: parsed.targetPath, receiptId: parsed.receiptId });
  output.write(`Rolled back receipt: ${result.receiptId}\n`);
  for (const destination of result.rolledBackPaths) output.write(`ROLLED_BACK\t${destination}\n`);
}

run().catch((error) => {
  if (error instanceof InstallPlanError && error.code === 'LOADER_CONFLICT') {
    output.write(`Manual resolution required: ${error.message}\n`);
  } else {
    output.write(`${error.code ?? 'ERROR'}: ${error.message}\n`);
  }
  process.exitCode = 1;
});
