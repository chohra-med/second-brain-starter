import path from 'node:path';

// Argument parsing and printing helpers for bin/second-brain.mjs. Pure: no file access, no subprocess.
export const COMMANDS = new Set(['init', 'upgrade', 'connect', 'verify', 'rollback', 'workspace-plan', 'status']);
const FLAGS = ['--target', '--apply', '--receipt', '--repo', '--name', '--adopt', '--parent', '--proposal'];
// Flags that take no value.
const SWITCHES = ['--records', '--list-projects'];
// The only command each switch is accepted by.
const SWITCH_COMMAND = { '--records': 'verify', '--list-projects': 'workspace-plan' };
// The only command each value flag is accepted by, when it is not accepted by every command.
const VALUE_COMMAND = { '--proposal': 'upgrade' };
// Flags that may be given more than once; their values are collected in order.
const REPEATABLE_FLAGS = ['--adopt'];
export const RECEIPT_ID_PATTERN = /^tx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const USAGE_LINES = {
  init: 'second-brain init --target /absolute/path [--apply PLAN_DIGEST]',
  upgrade: 'second-brain upgrade --target /absolute/path [--apply PLAN_DIGEST | --proposal PATH]',
  connect: 'second-brain connect --target /absolute/path --repo /absolute/repository [--name NAME] [--apply PLAN_DIGEST]',
  verify: 'second-brain verify --target /absolute/path [--records | --adopt PATH ... [--apply PLAN_DIGEST]]',
  rollback: 'second-brain rollback --target /absolute/path --receipt RECEIPT_ID',
  'workspace-plan': 'second-brain workspace-plan --parent /absolute/folder [--list-projects]',
  status: 'second-brain status --target /absolute/path',
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
  const repeated = Object.fromEntries(REPEATABLE_FLAGS.map((flag) => [flag, []]));
  const switches = new Set();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (SWITCHES.includes(flag)) {
      if (switches.has(flag)) throw usageError(`Invalid arguments for ${command}.`);
      switches.add(flag);
      index -= 1;
      continue;
    }
    const value = rest[index + 1];
    if (REPEATABLE_FLAGS.includes(flag) && value !== undefined && !value.startsWith('--')) {
      repeated[flag].push(value);
      continue;
    }
    if (!FLAGS.includes(flag) || REPEATABLE_FLAGS.includes(flag) || value === undefined || Object.hasOwn(values, flag)) {
      throw usageError(`Invalid arguments for ${command}.`);
    }
    values[flag] = value;
  }
  const adopt = repeated['--adopt'];
  const records = switches.has('--records');
  const listProjects = switches.has('--list-projects');
  for (const flag of switches) {
    if (SWITCH_COMMAND[flag] !== command) throw usageError(`${command} does not accept ${flag}.`);
  }
  for (const flag of Object.keys(VALUE_COMMAND)) {
    if (Object.hasOwn(values, flag) && VALUE_COMMAND[flag] !== command) throw usageError(`${command} does not accept ${flag}.`);
  }
  if (Object.hasOwn(values, '--proposal')) {
    const proposal = values['--proposal'];
    if (values['--apply']) throw usageError('upgrade --proposal prints a proposal and does not accept --apply. Nothing was changed.');
    if (proposal.startsWith('/') || proposal.includes('\\') || proposal.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw usageError('--proposal takes a workspace-relative path such as 00-Meta/Route.md. Nothing was changed.');
    }
  }
  if (command === 'workspace-plan') {
    // A plan that only reads: no target, no digest, no receipt, and no repository or adoption flags.
    for (const flag of ['--target', '--apply', '--receipt', '--repo', '--name']) {
      if (Object.hasOwn(values, flag)) throw usageError(`workspace-plan does not accept ${flag}. Nothing was changed.`);
    }
    if (adopt.length > 0) throw usageError('workspace-plan does not accept --adopt. Nothing was changed.');
    if (!values['--parent'] || !path.isAbsolute(values['--parent']) || values['--parent'].includes('\\')) {
      throw usageError('workspace-plan requires --parent with an absolute folder path. Nothing was changed.');
    }
    return { command, parentPath: values['--parent'], listProjects, records: false, adopt: [] };
  }
  if (Object.hasOwn(values, '--parent')) throw usageError(`${command} does not accept --parent.`);
  if (listProjects) throw usageError(`${command} does not accept --list-projects.`);
  if (records && command !== 'verify') throw usageError(`${command} does not accept --records.`);
  if (records && (adopt.length > 0 || values['--apply'])) throw usageError('verify --records reads only; it does not take --adopt or --apply.');
  if (adopt.length > 0 && command !== 'verify') throw usageError(`${command} does not accept --adopt.`);
  for (const item of adopt) {
    if (path.isAbsolute(item) || item.includes('\\') || item.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw usageError('--adopt takes a workspace-relative path such as 00-Meta/AGENTS.md. Nothing was changed.');
    }
  }
  if (!values['--target'] || !path.isAbsolute(values['--target'])) {
    throw usageError('An explicit absolute --target path is required.');
  }
  if (command === 'rollback') {
    if (!Object.hasOwn(values, '--receipt')) throw usageError('rollback requires --receipt <receipt id>. Nothing was changed.');
    if (!RECEIPT_ID_PATTERN.test(values['--receipt'])) {
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
  if (!['init', 'upgrade', 'connect'].includes(command) && values['--apply'] && !(command === 'verify' && adopt.length > 0)) {
    throw usageError(command === 'verify' ? 'verify accepts --apply only with --adopt.' : `${command} does not accept --apply.`);
  }
  return {
    command,
    parentPath: null,
    listProjects: false,
    targetPath: values['--target'],
    approvedDigest: values['--apply'] ?? null,
    proposalPath: values['--proposal'] ?? null,
    receiptId: values['--receipt'] ?? null,
    repoPath: values['--repo'] ?? null,
    name: values['--name'] ?? null,
    adopt,
    records,
  };
}
