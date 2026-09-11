import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export const sourceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export async function consumerRoot(prefix = 'second-brain-consumer-') {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export function cleanup(test, directory) {
  test.after(() => rm(directory, { recursive: true, force: true }));
}

export async function runCli(args, { checkout = sourceRoot, cwd = checkout } = {}) {
  const bin = path.join(checkout, 'bin', 'second-brain.mjs');
  try {
    return await execFile(process.execPath, [bin, ...args], { cwd, windowsHide: true });
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
  }
}

export function planDigest(output) {
  return output.match(/^Plan digest: ([a-f0-9]{64})$/m)?.[1] ?? null;
}

export function appliedReceipt(output) {
  return output.match(/^Applied receipt: (tx-[a-f0-9-]+)$/m)?.[1] ?? null;
}

export async function fixtureBytes(name) {
  return readFile(path.join(sourceRoot, 'test', 'fixtures', name));
}
