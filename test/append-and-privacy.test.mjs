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
import os, pty, re, sys, select, time
action = sys.argv[1]
cmd = sys.argv[sys.argv.index('--') + 1:]

def answer(action, buf, cmd):
    if action == 'digest':
        return re.search(rb'Plan digest: ([a-f0-9]{64})', buf).group(1) + b'\\n'
    if action == 'file-then-yes':
        target = cmd[cmd.index('--target') + 1]
        with open(os.path.join(target, 'notes.txt'), 'w') as handle:
            handle.write('written while the prompt was open\\n')
        return b'yes\\n'
    return {'ctrl-c': b'\\x03', 'eof': b'\\x04', 'enter': b'\\n', 'yes': b'yes\\n', 'no': b'no\\n'}[action]

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
        os.write(fd, answer(action, buf, cmd))
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
  assert.match(plan, /^Privacy: the \.gitignore block \(CREATE\) makes git ignore: \.second-brain\/, 05-Daily\/\*, /m);
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

// Each of these has the loader stem (or a cut-off part of it) in a form that is not exactly one well-formed block.
// Every one is a CONFLICT, and a CONFLICT is never appended to.
const DAMAGED_LOADERS = [
  ['a truncated end marker', `${USER_RULES}<!-- second-brain:loader:end\n`],
  ['a lone full end marker', `${USER_RULES}${LOADER_END}\n`],
  ['a start marker with no end, and text after it', `${USER_RULES}${LOADER_START}\nmine\n`],
  ['an upper-case marker with a full end', `${USER_RULES}<!-- SECOND-BRAIN:LOADER:START -->\nmine\n${LOADER_END}\n`],
  ['a mixed-case start marker with a full end', `${USER_RULES}<!-- Second-Brain:loader:start -->\nmine\n${LOADER_END}\n`],
  ['a lower-case marker with the end marker missing', `${USER_RULES}<!-- second-brain:loader:start -->\nmine\n`],
  ['a marker with extra spaces', `${USER_RULES}<!--  second-brain:loader:start  -->\nmine\n`],
  ['two start markers and one end', `${USER_RULES}${LOADER_START}\nmine\n${LOADER_START}\n${LOADER_END}\n`],
];

test('a damaged loader marker in a root AGENTS.md is a CONFLICT, never an APPEND, and the plan refuses to apply', async (t) => {
  for (const [label, content] of DAMAGED_LOADERS) {
    const { target } = await fresh(t, 'second-brain-damaged-');
    await mkdir(target);
    await writeFile(path.join(target, 'AGENTS.md'), content);

    const plan = await planOnly(['init', '--target', target]);
    assert.match(plan, /^CONFLICT\tAGENTS\.md\tundo=none$/m, label);
    assert.doesNotMatch(plan, /^APPEND\t/m, label);

    const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stdout, /PLAN_CONFLICT/, label);
    assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), Buffer.from(content), `${label}: the file is unchanged`);
  }
});

test('a damaged privacy marker in an existing .gitignore is a CONFLICT too', async (t) => {
  const { target } = await fresh(t, 'second-brain-damaged-gitignore-');
  await mkdir(target);
  const content = `node_modules/\n${PRIVACY_START}\n.second-brain/\n`;
  await writeFile(path.join(target, '.gitignore'), content);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^CONFLICT\t\.gitignore\tundo=none$/m);
  assert.doesNotMatch(plan, /^APPEND\t\.gitignore/m);
  const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.match(rejected.stdout, /PLAN_CONFLICT/);
  assert.deepEqual(await readFile(path.join(target, '.gitignore')), Buffer.from(content));
});

test('a typed no at the yes prompt on an empty folder prints Plan not applied. and writes nothing', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-typed-no-');
  await mkdir(target);
  const run = await prompted('no', ['init', '--target', target]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /Plan not applied\./);
  assert.doesNotMatch(run.text, /Plan digest did not match/);
  assert.equal(await exists(path.join(target, 'AGENTS.md')), false);
});

test('the typed digest still applies on an empty folder', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-typed-digest-empty-');
  await mkdir(target);
  const run = await prompted('digest', ['init', '--target', target]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /Applied receipt: tx-/);
  assert.match(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), /second-brain:loader:start/);
});

test('a file created while the yes prompt is open refuses yes, and nothing is written by the install', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-yes-race-');
  await mkdir(target);
  const run = await prompted('file-then-yes', ['init', '--target', target]);
  assert.equal(run.code, 1, run.text);
  assert.match(run.text, /no longer empty/);
  assert.match(run.text, /exact plan digest/);
  assert.equal(await exists(path.join(target, 'AGENTS.md')), false, 'the install wrote nothing');
  assert.equal(await readFile(path.join(target, 'notes.txt'), 'utf8'), 'written while the prompt was open\n');
});

test('a .gitignore with user lines and an exception below the block still plans, upgrades and verifies clean', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-exception-');
  await mkdir(target);
  await planAndApply(target);
  const block = await readFile(path.join(target, '.gitignore'), 'utf8');
  await writeFile(path.join(target, '.gitignore'), `${block}node_modules/\n!00-Meta/Profile.md\n`);

  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^IDENTICAL\t\.gitignore\t/m);
  const upgradePlan = await planOnly(['upgrade', '--target', target]);
  assert.match(upgradePlan, /^IDENTICAL\t\.gitignore\t/m);
  assert.doesNotMatch(upgradePlan, /^CONFLICT\t/m);
  const upgraded = await runCli(['upgrade', '--target', target, '--apply', planDigest(upgradePlan)]);
  assert.equal(upgraded.code, undefined, upgraded.stdout);

  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
  assert.match(await readFile(path.join(target, '.gitignore'), 'utf8'), /\n!00-Meta\/Profile\.md\n$/);
});

test('verify still fails when a line inside the privacy block is edited', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-edited-block-');
  await mkdir(target);
  await planAndApply(target);
  const block = await readFile(path.join(target, '.gitignore'), 'utf8');
  await writeFile(path.join(target, '.gitignore'), block.replace('.second-brain/', '.second-brain-edited/'));

  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, 1, verified.stdout);
  assert.match(verified.stdout, /CORRUPT\t\.gitignore/);
  assert.match(verified.stdout, /Verification: FAILED/);
});

async function gitIgnores(target, relative) {
  try {
    await execFile('git', ['-C', target, 'check-ignore', '-q', relative]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

test('the privacy block keeps the shipped daily template tracked and still ignores other daily notes', async (t) => {
  const { target } = await fresh(t, 'second-brain-gitignore-daily-');
  await mkdir(target);
  await planAndApply(target);
  await execFile('git', ['init', '-q', target]);

  assert.equal(await gitIgnores(target, '05-Daily/daily-template.md'), false, 'the shipped template is not ignored');
  assert.equal(await gitIgnores(target, '05-Daily/2026-10-13.md'), true, 'a dated daily note is ignored');
});

// The marker rule for a root AGENTS.md, one row per case. The row names the plan kind. A CONFLICT row names the reason
// ('unclosed' or 'comment') and the line of the comment that caused it. Apply refuses every CONFLICT, and the file keeps
// every byte.
const AGENTS_RULE_TABLE = [
  ['user prose only', USER_RULES, 'APPEND'],
  ['prose that mentions second-brain:loader in a sentence', `${USER_RULES}The loader is second-brain:loader in prose.\n`, 'APPEND'],
  ['a YAML-style line second-brain: notes', `${USER_RULES}second-brain: notes\n`, 'APPEND'],
  ['an unclosed comment with any text', `${USER_RULES}<!-- my note with no end\n`, 'CONFLICT', 'unclosed', 4],
  ['a comment cut off after second-brain', `${USER_RULES}<!-- second-brain\n`, 'CONFLICT', 'unclosed', 4],
  ['a start marker with a space for the hyphen', `${USER_RULES}<!-- second brain:loader:start -->\nmine\n`, 'CONFLICT', 'comment', 4],
  ['a start marker with an underscore', `${USER_RULES}<!-- second_brain:loader:start -->\nmine\n`, 'CONFLICT', 'comment', 4],
  ['an upper-case start marker alone', `${USER_RULES}<!-- SECOND-BRAIN:LOADER:START -->\nmine\n`, 'CONFLICT', 'comment', 4],
  ['a start marker without an end', `${USER_RULES}${LOADER_START}\nmine\n`, 'CONFLICT', 'comment', 4],
  ['an end marker without a start', `${USER_RULES}${LOADER_END}\nmine\n`, 'CONFLICT', 'comment', 4],
  ['an end marker before the start marker', `${USER_RULES}${LOADER_END}\nmine\n${LOADER_START}\n`, 'CONFLICT', 'comment', 4],
  ['two clean blocks', `${USER_RULES}${LOADER_START}\na\n${LOADER_END}\n${LOADER_START}\nb\n${LOADER_END}\n`, 'CONFLICT', 'comment', 7],
  ['an unrelated closed comment', `${USER_RULES}<!-- my note -->\n`, 'APPEND'],
  ['an empty comment that HTML closes early', `${USER_RULES}<!-->\n`, 'CONFLICT', 'unclosed', 4],
];

const REASON_PHRASE = {
  unclosed: 'has an HTML comment that is never closed',
  comment: 'has a comment that names second-brain but is not the one clean managed block',
};

test('the marker rule for AGENTS.md: each row plans the kind it names, and a CONFLICT refuses apply and changes no byte', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  for (const [label, content, kind, cause, line] of AGENTS_RULE_TABLE) {
    const { target } = await fresh(t, 'second-brain-rule-agents-');
    await mkdir(target);
    await writeFile(path.join(target, 'AGENTS.md'), content);

    const plan = await planOnly(['init', '--target', target]);
    assert.match(plan, new RegExp(`^${kind}\\tAGENTS\\.md\\t`, 'm'), label);
    if (kind === 'APPEND') {
      const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
      assert.equal(applied.code, undefined, `${label}: ${applied.stdout}`);
      assert.ok((await readFile(path.join(target, 'AGENTS.md'), 'utf8')).startsWith(content), `${label}: the user bytes stay in front`);
      continue;
    }
    assert.ok(plan.includes(`Manual resolution required: AGENTS.md line ${line} ${REASON_PHRASE[cause]}`), `${label}: ${plan}`);
    const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stdout, /PLAN_CONFLICT/, label);
    assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), Buffer.from(content), `${label}: the file is unchanged`);
  }
});

test('the marker rule for AGENTS.md: one clean block plans IDENTICAL when it is the shipped text, and CONFLICT when its text differs', async (t) => {
  const shipped = await readFile(path.join(sourceRoot, 'template', 'AGENTS.md'), 'utf8');
  const { target } = await fresh(t, 'second-brain-rule-agents-clean-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), shipped);
  const same = await planOnly(['init', '--target', target]);
  assert.match(same, /^IDENTICAL\tAGENTS\.md\t/m);

  const edited = await fresh(t, 'second-brain-rule-agents-edited-');
  await mkdir(edited.target);
  const changed = shipped.replace('Keep project-specific instructions', 'Keep my own instructions');
  assert.notEqual(changed, shipped);
  await writeFile(path.join(edited.target, 'AGENTS.md'), changed);
  const plan = await planOnly(['init', '--target', edited.target]);
  assert.match(plan, /^CONFLICT\tAGENTS\.md\t/m);
  assert.match(plan, /Manual resolution required: AGENTS\.md has a loader block whose text differs from the block this tool ships, and this tool has no install record/);
  assert.doesNotMatch(plan, /malformed/);
  assert.doesNotMatch(plan, /installed/);
  const rejected = await runCli(['init', '--target', edited.target, '--apply', planDigest(plan)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.deepEqual(await readFile(path.join(edited.target, 'AGENTS.md')), Buffer.from(changed));
});

test('the marker rule for CLAUDE.md: an unclosed comment is a CONFLICT and a plain mention is an APPEND', async (t) => {
  const { target } = await fresh(t, 'second-brain-rule-claude-');
  await mkdir(target);
  await writeFile(path.join(target, 'CLAUDE.md'), `${USER_RULES}<!-- second-brain\n`);
  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^CONFLICT\tCLAUDE\.md\t/m);
  assert.ok(plan.includes('Manual resolution required: CLAUDE.md line 4 has an HTML comment that is never closed'), plan);

  const mention = await fresh(t, 'second-brain-rule-claude-mention-');
  await mkdir(mention.target);
  await writeFile(path.join(mention.target, 'CLAUDE.md'), `${USER_RULES}Written by second-brain: see AGENTS.md.\n`);
  assert.match(await planOnly(['init', '--target', mention.target]), /^APPEND\tCLAUDE\.md\t/m);
});

// The same rule for .gitignore, with # lines. The shipped block has one line that names the tool, and it is inside the
// block, so it is allowed. Any other # line that names the tool is a CONFLICT. Other lines never block.
const GITIGNORE_RULE_TABLE = [
  ['user lines only', 'node_modules/\n.env\n', 'APPEND'],
  ['a plain line that names the tool, outside any comment', 'node_modules/\nsecond-brain:privacy:start\n', 'APPEND'],
  ['a user comment that names the tool is not a marker', 'node_modules/\n# second-brain notes\n', 'APPEND'],
  ['a comment shaped like a privacy marker, not exact', 'node_modules/\n# second-brain:privacy: notes\n', 'CONFLICT', 'comment', 2],
  ['a start marker alone', `node_modules/\n${PRIVACY_START}\n.second-brain/\n`, 'CONFLICT', 'comment', 2],
  ['a start marker with extra spaces after the hash', 'node_modules/\n#  second-brain:privacy:start\n', 'CONFLICT', 'comment', 2],
  ['an upper-case start marker and a full end', `node_modules/\n# SECOND-BRAIN:PRIVACY:START\n${PRIVACY_END}\n`, 'CONFLICT', 'comment', 2],
  ['an end marker before the start marker', `node_modules/\n${PRIVACY_END}\n${PRIVACY_START}\n`, 'CONFLICT', 'comment', 2],
  ['two clean blocks', `node_modules/\n${PRIVACY_START}\na/\n${PRIVACY_END}\n${PRIVACY_START}\nb/\n${PRIVACY_END}\n`, 'CONFLICT', 'comment', 5],
  ['an unrelated comment', 'node_modules/\n# my note\n', 'APPEND'],
];

test('the marker rule for .gitignore: each row plans the kind it names, and a CONFLICT refuses apply and changes no byte', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  for (const [label, content, kind, cause, line] of GITIGNORE_RULE_TABLE) {
    const { target } = await fresh(t, 'second-brain-rule-gitignore-');
    await mkdir(target);
    await writeFile(path.join(target, '.gitignore'), content);

    const plan = await planOnly(['init', '--target', target]);
    assert.match(plan, new RegExp(`^${kind}\\t\\.gitignore\\t`, 'm'), label);
    if (kind === 'APPEND') {
      const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
      assert.equal(applied.code, undefined, `${label}: ${applied.stdout}`);
      assert.ok((await readFile(path.join(target, '.gitignore'), 'utf8')).startsWith(content), `${label}: the user lines stay in front`);
      continue;
    }
    assert.ok(plan.includes(`Manual resolution required: .gitignore line ${line} ${REASON_PHRASE[cause]}`), `${label}: ${plan}`);
    const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stdout, /PLAN_CONFLICT/, label);
    assert.deepEqual(await readFile(path.join(target, '.gitignore')), Buffer.from(content), `${label}: the file is unchanged`);
  }
});

test('the marker rule for .gitignore: the shipped block is IDENTICAL, a user comment after it is not a marker, and a marker-shaped line after it is a CONFLICT', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const shipped = await readFile(path.join(sourceRoot, 'template', 'privacy-gitignore.txt'), 'utf8');
  const same = await fresh(t, 'second-brain-rule-gitignore-shipped-');
  await mkdir(same.target);
  await writeFile(path.join(same.target, '.gitignore'), shipped);
  assert.match(await planOnly(['init', '--target', same.target]), /^IDENTICAL\t\.gitignore\t/m);

  const after = await fresh(t, 'second-brain-rule-gitignore-after-');
  await mkdir(after.target);
  await writeFile(path.join(after.target, '.gitignore'), `${shipped}# second-brain notes: keep\n`);
  const comment = await planOnly(['init', '--target', after.target]);
  assert.match(comment, /^IDENTICAL\t\.gitignore\t/m);
  assert.doesNotMatch(comment, /^CONFLICT\t/m);

  const shaped = await fresh(t, 'second-brain-rule-gitignore-shaped-');
  await mkdir(shaped.target);
  await writeFile(path.join(shaped.target, '.gitignore'), `${shipped}# second_brain:privacy: notes\n`);
  const plan = await planOnly(['init', '--target', shaped.target]);
  assert.match(plan, /^CONFLICT\t\.gitignore\t/m);
  assert.ok(plan.includes(`Manual resolution required: .gitignore line ${shipped.split('\n').length} ${REASON_PHRASE.comment}`), plan);
});

test('a plain sentence that names the tool in an installed AGENTS.md is no marker: upgrade plans IDENTICAL and verify passes', async (t) => {
  const { target } = await fresh(t, 'second-brain-installed-mention-');
  await mkdir(target);
  await planAndApply(target);
  const agents = path.join(target, 'AGENTS.md');
  await writeFile(agents, `${await readFile(agents, 'utf8')}Notes: config lives under second-brain: see below.\n`);

  const plan = await planOnly(['upgrade', '--target', target]);
  assert.match(plan, /^IDENTICAL\tAGENTS\.md\t/m);
  assert.doesNotMatch(plan, /^CONFLICT\t/m);

  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('verify checks only the AGENTS.md block: text above or below it passes for a created file and an appended one', async (t) => {
  const created = await fresh(t, 'second-brain-verify-created-');
  await mkdir(created.target);
  await planAndApply(created.target);
  const createdBytes = await readFile(path.join(created.target, 'AGENTS.md'), 'utf8');
  assert.equal((await runCli(['verify', '--target', created.target])).code, undefined, 'the untouched created file verifies');
  await writeFile(path.join(created.target, 'AGENTS.md'), `${createdBytes}mine\n`);
  const createdBelow = await runCli(['verify', '--target', created.target]);
  assert.equal(createdBelow.code, undefined, createdBelow.stdout);
  assert.match(createdBelow.stdout, /Verification: OK/);
  assert.match(await planOnly(['upgrade', '--target', created.target]), /^IDENTICAL\tAGENTS\.md\t/m);

  const appended = await fresh(t, 'second-brain-verify-appended-');
  await mkdir(appended.target);
  await writeFile(path.join(appended.target, 'AGENTS.md'), USER_RULES);
  await planAndApply(appended.target);
  const appendedBytes = await readFile(path.join(appended.target, 'AGENTS.md'), 'utf8');
  assert.equal((await runCli(['verify', '--target', appended.target])).code, undefined, 'the untouched appended file verifies');
  await writeFile(path.join(appended.target, 'AGENTS.md'), `mine\n${appendedBytes}`);
  const appendedAbove = await runCli(['verify', '--target', appended.target]);
  assert.equal(appendedAbove.code, undefined, appendedAbove.stdout);
  assert.match(appendedAbove.stdout, /Verification: OK/);
  assert.match(await planOnly(['upgrade', '--target', appended.target]), /^IDENTICAL\tAGENTS\.md\t/m);
});

test('verify reports a change inside the AGENTS.md block, and a deleted end marker, as CORRUPT', async (t) => {
  const edited = await fresh(t, 'second-brain-verify-inside-');
  await mkdir(edited.target);
  await planAndApply(edited.target);
  const shippedBlock = await readFile(path.join(edited.target, 'AGENTS.md'), 'utf8');
  await writeFile(path.join(edited.target, 'AGENTS.md'), shippedBlock.replace('Keep project-specific instructions', 'Keep my own instructions'));
  const inside = await runCli(['verify', '--target', edited.target]);
  assert.equal(inside.code, 1, inside.stdout);
  assert.match(inside.stdout, /CORRUPT\tAGENTS\.md/);

  const deleted = await fresh(t, 'second-brain-verify-end-deleted-');
  await mkdir(deleted.target);
  await planAndApply(deleted.target);
  const bytes = await readFile(path.join(deleted.target, 'AGENTS.md'), 'utf8');
  await writeFile(path.join(deleted.target, 'AGENTS.md'), bytes.replace(`${LOADER_END}\n`, ''));
  const endGone = await runCli(['verify', '--target', deleted.target]);
  assert.equal(endGone.code, 1, endGone.stdout);
  assert.match(endGone.stdout, /CORRUPT\tAGENTS\.md/);
});

test('verify checks .gitignore by its block, and a comment that is not marker-shaped below it passes', async (t) => {
  const { target } = await fresh(t, 'second-brain-verify-gitignore-comment-');
  await mkdir(target);
  await planAndApply(target);
  const block = await readFile(path.join(target, '.gitignore'), 'utf8');
  await writeFile(path.join(target, '.gitignore'), `${block}# second-brain notes: keep\n`);
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
  assert.match(await planOnly(['upgrade', '--target', target]), /^IDENTICAL\t\.gitignore\t/m);

  await writeFile(path.join(target, '.gitignore'), `${block}# second-brain:privacy: notes\n`);
  const shaped = await runCli(['verify', '--target', target]);
  assert.equal(shaped.code, 1, shaped.stdout);
  assert.match(shaped.stdout, /CORRUPT\t\.gitignore/);
});

test('verify compares .gitignore by its block only: a user line above or below the block still verifies', async (t) => {
  const { target } = await fresh(t, 'second-brain-verify-gitignore-block-');
  await mkdir(target);
  await planAndApply(target);
  const block = await readFile(path.join(target, '.gitignore'), 'utf8');
  await writeFile(path.join(target, '.gitignore'), `mine/\n${block}!00-Meta/Profile.md\n`);
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('an edit inside an installed .gitignore block is named as an edited block, not as malformed markers', async (t) => {
  const { target } = await fresh(t, 'second-brain-inblock-wording-');
  await mkdir(target);
  await planAndApply(target);
  const block = await readFile(path.join(target, '.gitignore'), 'utf8');
  await writeFile(path.join(target, '.gitignore'), block.replace('.second-brain/', '.second-brain-edited/'));
  const plan = await planOnly(['upgrade', '--target', target]);
  assert.match(plan, /^CONFLICT\t\.gitignore\t/m);
  assert.ok(plan.includes('Manual resolution required: .gitignore has a managed block whose text differs from the block this tool installed'), plan);
  assert.doesNotMatch(plan, /malformed/);
});

test('a typed no at the prompt in a non-empty folder prints Plan not applied. and writes nothing', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  const { target } = await fresh(t, 'second-brain-typed-no-nonempty-');
  await mkdir(target);
  await writeFile(path.join(target, 'notes.txt'), 'mine\n');
  const run = await prompted('no', ['init', '--target', target]);
  assert.equal(run.code, 0, run.text);
  assert.match(run.text, /Plan not applied\./);
  assert.doesNotMatch(run.text, /Plan digest did not match/);
  assert.equal(await exists(path.join(target, 'AGENTS.md')), false);
  assert.equal(await readFile(path.join(target, 'notes.txt'), 'utf8'), 'mine\n');
});

test('a refused install rollback names this receipt, not connect', async (t) => {
  const { target } = await fresh(t, 'second-brain-rollback-wording-');
  await mkdir(target);
  const receipt = await planAndApply(target);
  await writeFile(path.join(target, '.gitignore'), `${await readFile(path.join(target, '.gitignore'), 'utf8')}mine/\n`);
  const rolledBack = await runCli(['rollback', '--target', target, '--receipt', receipt]);
  assert.equal(rolledBack.code, 1, rolledBack.stdout);
  assert.match(rolledBack.stdout, /POSTIMAGE_MISMATCH/);
  assert.match(rolledBack.stdout, /differ from what this receipt wrote/);
  assert.doesNotMatch(rolledBack.stdout, /connect wrote/);
  assert.equal(await readFile(path.join(target, '.gitignore'), 'utf8').then((text) => text.endsWith('mine/\n')), true, 'the user line stays');
});

// A root file that is not plain UTF-8 text. The marker scan reads bytes, so a UTF-16 file can hide an unclosed comment.
// Each CONFLICT row must refuse apply and keep every byte. The UTF-8 byte-order mark is allowed: the block goes after the text.
const UTF16_LE_BOM = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${USER_RULES}<!-- my note\n`, 'utf16le')]);
const UTF16_BE_BOM = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`${USER_RULES}<!-- my note\n`, 'utf16le').swap16()]);
const UTF16_NO_BOM = Buffer.from(`${USER_RULES}<!-- my note\n`, 'utf16le');
const UTF8_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(USER_RULES, 'utf8')]);

test('a root AGENTS.md that is UTF-16 with a byte-order mark, or has null bytes, is a CONFLICT and apply changes no byte', { skip: isWindows && 'no pseudo-terminal on win32' }, async (t) => {
  for (const [label, bytes] of [['UTF-16LE with a byte-order mark', UTF16_LE_BOM], ['UTF-16BE with a byte-order mark', UTF16_BE_BOM], ['UTF-16 without a byte-order mark', UTF16_NO_BOM]]) {
    const { target } = await fresh(t, 'second-brain-utf-conflict-');
    await mkdir(target);
    await writeFile(path.join(target, 'AGENTS.md'), bytes);
    const plan = await planOnly(['init', '--target', target]);
    assert.match(plan, /^CONFLICT\tAGENTS\.md\tundo=none$/m, label);
    assert.doesNotMatch(plan, /^APPEND\t/m, label);
    assert.ok(plan.includes('AGENTS.md is not UTF-8 text'), `${label}: ${plan}`);
    assert.ok(plan.includes('convert the file to UTF-8 text first'), `${label}: ${plan}`);
    const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stdout, /PLAN_CONFLICT/, label);
    assert.deepEqual(await readFile(path.join(target, 'AGENTS.md')), bytes, `${label}: the file is byte-identical`);
  }
});

test('a root .gitignore that is UTF-16 is a CONFLICT too', async (t) => {
  const { target } = await fresh(t, 'second-brain-utf-gitignore-');
  await mkdir(target);
  const bytes = Buffer.from('node_modules/\n', 'utf16le');
  await writeFile(path.join(target, '.gitignore'), bytes);
  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^CONFLICT\t\.gitignore\tundo=none$/m);
  assert.ok(plan.includes('.gitignore is not UTF-8 text'), plan);
  const rejected = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.deepEqual(await readFile(path.join(target, '.gitignore')), bytes);
});

test('a root AGENTS.md with a UTF-8 byte-order mark is APPENDed: the mark stays first, the block goes after the text, and verify passes', async (t) => {
  const { target } = await fresh(t, 'second-brain-utf8-bom-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), UTF8_BOM);
  const plan = await planOnly(['init', '--target', target]);
  assert.match(plan, /^APPEND\tAGENTS\.md\tundo=restore-preimage$/m);
  const applied = await runCli(['init', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(applied.code, undefined, applied.stdout);
  const bytes = await readFile(path.join(target, 'AGENTS.md'));
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]), 'the byte-order mark is kept at the start');
  assert.deepEqual(bytes.subarray(3, 3 + USER_RULES.length), Buffer.from(USER_RULES), 'the user text follows, unchanged');
  assert.ok(bytes.toString('utf8').endsWith(`${LOADER_END}\n`), 'the block ends the file');
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('an installed AGENTS.md whose marker lines were removed is refused with the line to put back, and restoring them plans IDENTICAL', async (t) => {
  const { target } = await fresh(t, 'second-brain-markers-removed-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), USER_RULES);
  await planAndApply(target);
  const installed = await readFile(path.join(target, 'AGENTS.md'), 'utf8');
  const block = installed.slice(installed.indexOf(LOADER_START));
  const withoutMarkers = `${USER_RULES}my own text\n`;
  await writeFile(path.join(target, 'AGENTS.md'), withoutMarkers);

  const plan = await planOnly(['upgrade', '--target', target]);
  assert.match(plan, /^CONFLICT\tAGENTS\.md\t/m);
  assert.ok(plan.includes('Manual resolution required: AGENTS.md has no loader marker lines, but this tool installed the file'), plan);
  assert.ok(plan.includes('put back the two loader marker lines exactly as shipped, keeping your own text'), plan);
  const rejected = await runCli(['upgrade', '--target', target, '--apply', planDigest(plan)]);
  assert.equal(rejected.code, 1, rejected.stdout);
  assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), withoutMarkers, 'the file is unchanged');

  await writeFile(path.join(target, 'AGENTS.md'), `${withoutMarkers}${block}`);
  assert.match(await planOnly(['upgrade', '--target', target]), /^IDENTICAL\tAGENTS\.md\t/m);
});

test('an unclosed comment that is written as <!--> is told to write the comment in full', async (t) => {
  const { target } = await fresh(t, 'second-brain-empty-comment-wording-');
  await mkdir(target);
  await writeFile(path.join(target, 'AGENTS.md'), `${USER_RULES}<!-->\n`);
  const plan = await planOnly(['init', '--target', target]);
  assert.ok(plan.includes('AGENTS.md line 4 has an HTML comment that is never closed'), plan);
  assert.ok(plan.includes('write the comment in full, ending with -->'), plan);
  assert.doesNotMatch(plan, /close the comment/);
});
