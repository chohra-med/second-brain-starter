import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { cleanup, consumerRoot, planDigest, runCli, sourceRoot, appliedReceipt } from './helpers/consumer-cli.mjs';

const execFile = promisify(execFileCallback);
const isWindows = process.platform === 'win32';
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');

// The approval prompt needs a terminal on both ends. A pseudo-terminal is made by python3 (standard library only,
// run with -I), because node has no terminal without a native dependency. The Windows leg skips this file: it has no pty.
const DRIVER = `
import os, pty, sys, select, time
action = sys.argv[1]
cmd = sys.argv[sys.argv.index('--') + 1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
buf = b''
sent = False
deadline = time.time() + 30
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    buf += chunk
    if not sent and b'Type the exact plan digest' in buf:
        sent = True
        time.sleep(0.3)
        os.write(fd, {'ctrl-c': b'\\x03', 'eof': b'\\x04', 'enter': b'\\n'}[action])
_, status = os.waitpid(pid, 0)
sys.stdout.write(buf.decode('utf8', 'replace').replace('\\r', ''))
sys.stdout.write('\\nEXIT=%d PROMPT=%s\\n' % (os.waitstatus_to_exitcode(status), sent))
`;

// Runs one CLI command in a pseudo-terminal, answers the approval prompt with one key, and returns its output and exit code.
async function prompted(key, args) {
  const { stdout } = await execFile('python3', ['-I', '-c', DRIVER, key, '--', process.execPath, bin, ...args], { timeout: 60000, windowsHide: true });
  const match = stdout.match(/\nEXIT=(-?\d+) PROMPT=(True|False)\n$/);
  assert.ok(match, `the driver reported an exit code: ${stdout.slice(-200)}`);
  assert.equal(match[2], 'True', `the approval prompt appeared before the key was sent:\n${stdout}`);
  return { text: stdout.slice(0, match.index), code: Number(match[1]) };
}

async function fresh(t, prefix) {
  const root = await realpath(await consumerRoot(prefix));
  cleanup(t, root);
  const target = path.join(root, 'target');
  await mkdir(target);
  return { root, target };
}

// A workspace already initialised by the CLI, for upgrade and connect cases.
async function initialised(t, prefix) {
  const { root, target } = await fresh(t, prefix);
  const planned = await runCli(['init', '--target', target]);
  const applied = await runCli(['init', '--target', target, '--apply', planDigest(planned.stdout)]);
  assert.equal(applied.code, undefined, applied.stdout);
  return { root, target };
}

// The same quoting rule the CLI uses for printed commands: plain words stay bare, anything else is quoted.
function word(value) {
  const text = String(value);
  const plain = isWindows ? /^[A-Za-z0-9_.\\/:~-]+$/ : /^[A-Za-z0-9_./:-]+$/;
  if (plain.test(text)) return text;
  if (isWindows) return `"${text.replace(/"/g, '\\"')}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
const cliScript = word;

// ---------------------------------------------------------------------------
// The approval prompt of init and upgrade matches connect: a cancel prints "Plan not applied." and Ctrl-C or end of input exits 1.
// ---------------------------------------------------------------------------

test('init: Ctrl-C at the approval prompt prints Plan not applied. and exits 1', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'sb-approval-init-ctrlc-');
  const result = await prompted('ctrl-c', ['init', '--target', target]);
  assert.equal(result.code, 1, result.text);
  assert.ok(result.text.includes('Plan not applied.'), result.text);
  await assert.rejects(readFile(path.join(target, 'Home.md')));
});

test('init: end of input at the approval prompt prints Plan not applied. and exits 1', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'sb-approval-init-eof-');
  const result = await prompted('eof', ['init', '--target', target]);
  assert.equal(result.code, 1, result.text);
  assert.ok(result.text.includes('Plan not applied.'), result.text);
});

test('upgrade: Ctrl-C at the approval prompt prints Plan not applied. and exits 1', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await initialised(t, 'sb-approval-upgrade-ctrlc-');
  const result = await prompted('ctrl-c', ['upgrade', '--target', target]);
  assert.equal(result.code, 1, result.text);
  assert.ok(result.text.includes('Plan not applied.'), result.text);
});

test('init: an empty answer at the prompt prints Plan not applied. and keeps exit code 0 (unchanged)', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'sb-approval-init-enter-');
  const result = await prompted('enter', ['init', '--target', target]);
  assert.equal(result.code, 0, result.text);
  assert.ok(result.text.includes('Plan not applied.'), result.text);
  await assert.rejects(readFile(path.join(target, 'Home.md')));
});

test('connect: Ctrl-C at the approval prompt still prints Plan not applied. and exits 1 (pinned)', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { root, target } = await initialised(t, 'sb-approval-connect-ctrlc-');
  const repo = path.join(root, 'app');
  await mkdir(repo);
  const result = await prompted('ctrl-c', ['connect', '--target', target, '--repo', repo]);
  assert.equal(result.code, 1, result.text);
  assert.ok(result.text.includes('Plan not applied.'), result.text);
});

// ---------------------------------------------------------------------------
// Parity: the plan of init and upgrade ends with the exact apply command, as connect's plan does.
// ---------------------------------------------------------------------------

test('init: the plan prints the exact apply command after the digest, and that command applies the same digest', async (t) => {
  const { target } = await fresh(t, 'sb-approval-init-command-');
  const planned = await runCli(['init', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const expected = `Apply this exact plan with: node ${cliScript(bin)} init --target ${cliScript(target)} --apply ${digest}`;
  assert.ok(planned.stdout.split('\n').includes(expected), planned.stdout.slice(-400));
  if (isWindows) return;
  const command = expected.slice('Apply this exact plan with: '.length);
  const { stdout } = await execFile('/bin/sh', ['-c', command], { windowsHide: true });
  assert.ok(appliedReceipt(stdout), stdout);
  await readFile(path.join(target, 'Home.md'));
});

test('upgrade: the plan prints the exact upgrade command after the digest', async (t) => {
  const { target } = await initialised(t, 'sb-approval-upgrade-command-');
  const planned = await runCli(['upgrade', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const expected = `Apply this exact plan with: node ${cliScript(bin)} upgrade --target ${cliScript(target)} --apply ${digest}`;
  assert.ok(planned.stdout.split('\n').includes(expected), planned.stdout.slice(-400));
});
