import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { appliedReceipt, cleanup, consumerRoot, planDigest, runCli, sourceRoot } from './helpers/consumer-cli.mjs';

const execFile = promisify(execFileCallback);
const isWindows = process.platform === 'win32';
const bin = path.join(sourceRoot, 'bin', 'second-brain.mjs');
const LOADER_START = '<!-- second-brain:loader:start -->';
const LOADER_END = '<!-- second-brain:loader:end -->';
const PRIVACY_START = '# second-brain:privacy:start';
const PRIVACY_END = '# second-brain:privacy:end';
const USER_RULES = '# My rules\n\nBe brief.\n';

// Same pseudo-terminal driver as cli-approval.test.mjs, with one more answer: a plain yes. The driver answers the
// first prompt that contains "Type the exact plan digest", which both prompt wordings contain.
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
        os.write(fd, {'ctrl-c': b'\\x03', 'eof': b'\\x04', 'enter': b'\\n', 'yes': b'yes\\n'}[action])
_, status = os.waitpid(pid, 0)
sys.stdout.write(buf.decode('utf8', 'replace').replace('\\r', ''))
sys.stdout.write('\\nEXIT=%d PROMPT=%s\\n' % (os.waitstatus_to_exitcode(status), sent))
`;

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
  return { root, target: path.join(root, 'project') };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function planOnly(args) {
  const result = await runCli(args);
  assert.equal(result.code, undefined, result.stdout);
  return result.stdout;
}

// Plans, then applies the exact digest of that plan. Returns the receipt id.
async function planAndApply(target) {
  const plan = await planOnly(['init', '--target', target]);
  const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(applied.code, undefined, applied.stdout);
  return appliedReceipt(applied.stdout);
}

test('init appends the managed block after the bytes of a root AGENTS.md that has no markers', async (t) => {
  const { target } = await fresh(t, 'second-brain-append-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), USER_RULES);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^APPEND\tAGENTS\.md\tundo=restore-preimage$/m);
  assert.doesNotMatch(plan, /^CONFLICT\t/m);
  assert.doesNotMatch(plan, /Manual resolution required/);

  const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(applied.code, undefined, applied.stdout);
  const bytes = await readFile(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(bytes.startsWith(USER_RULES), 'the user bytes stay in front, unchanged');
  assert.equal(bytes.split(LOADER_START).length, 2, 'exactly one loader block was added');
  assert.ok(bytes.endsWith(`${LOADER_END}\n`), 'the block ends the file');

  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('init keeps a root AGENTS.md with a lone loader start marker as a CONFLICT and refuses to apply', async (t) => {
  const { target } = await fresh(t, 'second-brain-half-marker-');
  await mkdir(target);
  const broken = `${USER_RULES}${LOADER_START}\nmy own text\n`;
  await writeFile(path.join(target, 'AGENTS.md'), broken);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^CONFLICT\tAGENTS\.md\tundo=none$/m);
  assert.doesNotMatch(plan, /^APPEND\tAGENTS\.md/m);

  const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), Buffer.from(broken));
});

test('rollback after an append restores the root AGENTS.md byte for byte and removes what the install created', async (t) => {
  const { target } = await fresh(t, 'second-brain-append-rollback-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), USER_RULES);
  const receipt = await planAndApply(target);
  assert.match(receipt, /^tx-/);

  const rolledBack = await runCli(['rollback', '--target', target, '--receipt', receipt]);
  assert.equal(rolledBack.code, undefined, rolledBack.stdout);
  assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), Buffer.from(USER_RULES));
  assert.equal(await exists(path.join(target, '.gitignore')), false, 'the privacy file the install created is removed');
});

test('upgrade treats an appended AGENTS.md as its managed block and plans no conflict', async (t) => {
  const { target } = await fresh(t, 'second-brain-append-upgrade-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), USER_RULES);
  await planAndApply(target);

  const plan = await planOnly(['upgrade', '--target', target]);
  assert.match(plan, /^IDENTICAL\tAGENTS\.md\t/m);
  assert.doesNotMatch(plan, /^CONFLICT\t/m);
});

test('a new .gitignore is created with the privacy block, and the plan names the paths it hides', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-none-');
  await mkdir(target);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^CREATE\t\.gitignore\tundo=remove-created-file$/m);
  assert.match(plan, /^Privacy: the \.gitignore block \(CREATE\) makes git ignore: \.second-brain\/, 05-Daily\/, /m);
  await planAndApply(target);
  const gitignore = await readFile(path.join(target, '.gitignore'), 'utf8');
  assert.ok(gitignore.startsWith(`${PRIVACY_START}\n`) && gitignore.endsWith(`${PRIVACY_END}\n`));
  assert.ok(gitignore.includes('\n01-Projects/**/Connection.md\n'));
});

test('an existing .gitignore with no privacy block keeps its lines and gets the block appended', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-append-');
  await mkdir(target);
  const own = 'node_modules/\n.env\n';
  await writeFile(path.join(target, '.gitignore'), own);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^APPEND\t\.gitignore\tundo=restore-preimage$/m);
  await planAndApply(target);
  const gitignore = await readFile(path.join(target, '.gitignore'), 'utf8');
  assert.ok(gitignore.startsWith(own), 'the existing lines stay in front, unchanged');
  assert.equal(gitignore.split(PRIVACY_START).length, 2);
});

test('a .gitignore that already has the privacy block is IDENTICAL on the next plan', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-block-');
  await mkdir(target);
  await planAndApply(target);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^IDENTICAL\t\.gitignore\t/m);
  assert.doesNotMatch(plan, /^CONFLICT\t/m);
});

test('a plain yes at the prompt approves a missing target', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-yes-missing-');
  const run = await prompted('yes', ['init', '--target', target]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /Applied receipt: tx-/);
  assert.match(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), /second-brain:loader:start/);
});

test('a plain yes at the prompt approves an existing empty folder', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-yes-empty-');
  await mkdir(target);
  const run = await prompted('yes', ['init', '--target', target]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /Applied receipt: tx-/);
});

test('a non-empty target still needs the typed digest: a typed yes is refused and nothing is written', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-yes-nonempty-');
  await mkdir(target);
  await writeFile(path.join(target, 'notes.txt'), 'mine\n');
  const run = await prompted('yes', ['init', '--target', target]);
  assert.equal(run.code, 1, run.text);
  assert.match(run.text, /Plan digest did not match\. No files were changed\./);
  assert.equal(await exists(path.join(target, 'AGENTS.md')), false);
});

test('the three refusals at the prompt on a new folder: Enter exits 0, Ctrl-C and end of input exit 1', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const cases = [['enter', 0], ['ctrl-c', 1], ['eof', 1]];
  for (const [key, expectedCode] of cases) {
    const { target } = await fresh(t, `second-brain-refuse-${key}-`);
    const run = await prompted(key, ['init', '--target', target]);
    assert.equal(run.code, expectedCode, `${key}: ${run.text}`);
    assert.match(run.text, /Plan not applied\./, key);
    assert.equal(await exists(path.join(target, 'AGENTS.md')), false, `${key} wrote nothing`);
  }
});

test('the non-interactive path does not accept yes: --apply yes is refused and nothing is written', async (t) => {
  const { target } = await fresh(t, 'second-brain-yes-apply-');
  const run = await runCli(['init', '--target', target, '--apply', 'yes']);
  assert.equal(run.code, 1, run.stdout);
  assert.match(run.stdout, /Plan digest did not match/);
  assert.equal(await exists(path.join(target, 'AGENTS.md')), false);
});
