import path from 'node:path';

// Argument parsing and printing helpers for bin/second-brain.mjs. Pure: no file access, no subprocess.
export const COMMANDS = new Set(['init', 'upgrade', 'connect', 'verify', 'rollback']);
const FLAGS = ['--target', '--apply', '--receipt', '--repo', '--name'];
export const RECEIPT_ID_PATTERN = /^tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const USAGE_LINES = {
  init: 'second-brain init --target /absolute/path [--apply PLAN_DIGEST]',
  upgrade: 'second-brain upgrade --target /absolute/path [--apply PLAN_DIGEST]',
  connect: 'second-brain connect --target /absolute/path --repo /absolute/repository [--name NAME] [--apply PLAN_DIGEST]',
  verify: 'second-brain verify --target /absolute/path',
  rollback: 'second-brain rollback --target /absolute/path --receipt RECEIPT_ID',
};

// Echoed user input is cut to this many characters, so a very long value is never printed in full.
export function clip(text, limit = 60) {
  const value = String(text);
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function usageError(message, code = 'USAGE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseArguments(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) throw usageError(`Unknown command: ${clip(command)}`);
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
    if (!Object.hasOwn(values, '--receipt') || !RECEIPT_ID_PATTERN.test(values['--receipt'])) {
      throw usageError('rollback --receipt must be a receipt id: tx- followed by a UUID. Nothing was changed.');
    }
    if (values['--apply']) throw usageError('rollback requires --receipt and does not accept --apply.');
  } else if (values['--receipt']) {
    throw usageError(`${command} does not accept --receipt.`);
  }
  if (command === 'connect') {
    if (!values['--repo']) throw usageError('connect requires --repo with an absolute path to the repository. Nothing was changed.');
    if (!path.isAbsolute(values['--repo'])) throw usageError('An explicit absolute --repo path is required. Nothing was changed.');
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
