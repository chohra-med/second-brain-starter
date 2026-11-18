// Tests for template/shared-skills/session-sync: the record format, the hook, the wake, the digest, the doctor and the
// shape of SKILL.md and HOW-IT-WORKS.md. Every run uses a fresh temporary home and sync folder; nothing outside it is touched.
//   node --test test/session-sync-skill.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(sourceRoot, 'template', 'shared-skills', 'session-sync');
const SCRIPT = path.join(SKILL_DIR, 'session-sync.mjs');
const CHECK = path.join(sourceRoot, 'template', 'shared-skills', 'security-check', 'check.mjs');
const read = (rel) => readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8');
const STATES = ['working', 'needs-person', 'needs-lead', 'blocked', 'done', 'ended', 'unknown'];

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-sync-')));
  const home = path.join(dir, 'home');
  const sync = path.join(home, '.session-sync');
  const workspace = path.join(dir, 'workspace');
  for (const folder of [home, workspace]) mkdirSync(folder, { recursive: true });
  t.after(() => { try { chmodSync(sync, 0o755); } catch { /* may not exist */ } rmSync(dir, { recursive: true, force: true }); });
  const env = { ...process.env, TZ: 'UTC', HOME: home, USERPROFILE: home, SESSION_SYNC_HOME: sync, PATH: process.env.PATH };
  delete env.CLAUDE_CODE_SESSION_ID; // this machine sets it; a test passes it on purpose or not at all
  return { dir, home, sync, workspace, env };
}

function cli(sb, args, { input, env = {}, cwd } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input, cwd: cwd ?? sb.workspace, env: { ...sb.env, ...env } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// A run with a lead and two workers, all joined with session ids.
function setup(sb) {
  const init = cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--session', 's-lead', '--member', 'writer:Article:writer', '--member', 'reviewer:Page:reviewer']);
  assert.equal(init.code, 0, init.err);
  assert.equal(cli(sb, ['join', '--me', 'writer', '--session', 's-writer', '--label', 'Article', '--kind', 'writer']).code, 0);
  assert.equal(cli(sb, ['join', '--me', 'reviewer', '--session', 's-reviewer', '--label', 'Page', '--kind', 'reviewer']).code, 0);
}

const eventsOf = (sb, run = 'R1') => readdirSync(path.join(sb.sync, run, 'events')).sort().map((file) => JSON.parse(readFileSync(path.join(sb.sync, run, 'events', file), 'utf8')));
const hook = (sb, input) => cli(sb, ['hook'], { input: typeof input === 'string' ? input : JSON.stringify(input) });
const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace('.', '');

// A fixture event written straight into the folder, with a chosen time.
function plant(sb, fields, run = 'R1') {
  const at = fields.at ?? new Date().toISOString();
  const id = `${stamp(new Date(at))}-${fields.from ?? 'writer'}-${Math.random().toString(16).slice(2, 6)}`;
  const event = { v: 1, id, at, from: 'writer', to: 'lead', label: 'Article', kind: 'turn-end', state: 'done', text: 'x', refs: [], by: 'hook', ...fields };
  writeFileSync(path.join(sb.sync, run, 'events', `${id}.json`), `${JSON.stringify(event, null, 2)}\n`);
  return id;
}

function treeHash(root, skip = () => false) {
  const sums = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = path.join(directory, entry);
      if (skip(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else sums.push(`${path.relative(root, full)}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
    }
  };
  if (existsSync(root)) walk(root);
  return sums.join('\n');
}

const stopInput = (message, extra = {}) => ({ session_id: 's-writer', transcript_path: 'x.jsonl', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: message, background_tasks: [], session_crons: [], ...extra });

test('RED: the script is missing until it is written', () => {
  assert.ok(existsSync(SCRIPT), 'session-sync.mjs exists');
});

test('init, join and post write the documented files: run.json, active.json, seen and one event per message', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const run = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'run.json'), 'utf8'));
  assert.deepEqual(Object.keys(run), ['v', 'run', 'started', 'lead', 'members', 'auto']);
  assert.deepEqual(run.auto, [], 'auto-join is off by default');
  assert.equal(run.v, 1);
  assert.equal(run.lead, 'lead');
  assert.deepEqual(run.members.map((member) => member.name), ['writer', 'reviewer']);
  assert.deepEqual(Object.keys(run.members[0]), ['name', 'session_id', 'label', 'kind']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(sb.sync, 'active.json'), 'utf8')).runs.map((entry) => entry.run), ['R1']);
  const seen = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'seen', 'writer.json'), 'utf8'));
  assert.deepEqual(Object.keys(seen), ['v', 'name', 'session_id', 'label', 'kind', 'joined', 'cursor']);
  assert.equal(seen.session_id, 's-writer');
  assert.equal(seen.cursor, null);

  const before = Date.now();
  const post = cli(sb, ['post', '--me', 'writer', '--kind', 'report', '--state', 'done', '--text', 'draft ready', '--ref', 'drafts/a.md']);
  assert.equal(post.code, 0, post.err);
  const [event] = eventsOf(sb);
  assert.deepEqual(Object.keys(event), ['v', 'id', 'at', 'from', 'to', 'label', 'kind', 'state', 'text', 'refs', 'by']);
  assert.deepEqual([event.v, event.from, event.to, event.label, event.kind, event.state, event.text, event.refs, event.by], [1, 'writer', 'lead', 'Article', 'report', 'done', 'draft ready', ['drafts/a.md'], 'session']);
  assert.match(event.id, /^\d{8}T\d{9}Z-writer-[0-9a-f]{4}$/);
  assert.ok(existsSync(path.join(sb.sync, 'R1', 'events', `${event.id}.json`)), 'the file name is the id');
  assert.ok(Math.abs(Date.parse(event.at) - before) < 10_000, 'at comes from the system clock');
  assert.ok(STATES.includes(event.state));
});

test('post caps the text at 200 characters, refuses an unknown kind, state or recipient, and never loses a message', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(cli(sb, ['post', '--me', 'writer', '--kind', 'note', '--text', 'a'.repeat(500)]).code, 0);
  assert.equal(eventsOf(sb)[0].text.length, 200);
  for (const bad of [['--kind', 'go'], ['--kind', 'approve'], ['--kind', 'report', '--state', 'maybe'], ['--kind', 'note', '--to', 'nobody']]) {
    const result = cli(sb, ['post', '--me', 'writer', '--text', 'x', ...bad]);
    assert.equal(result.code, 2, bad.join(' '));
  }
  assert.equal(cli(sb, ['post', '--me', 'stranger', '--kind', 'note', '--text', 'x']).code, 2, 'a name that never joined cannot post');
  for (let i = 0; i < 20; i += 1) assert.equal(cli(sb, ['post', '--me', 'reviewer', '--kind', 'note', '--text', `m${i}`]).code, 0);
  assert.equal(new Set(eventsOf(sb).map((event) => event.id)).size, 21, 'exclusive create: 21 distinct files');
  assert.match(readFileSync(SCRIPT, 'utf8'), /'wx'/, 'events are created with the exclusive flag');
});

test('hook: Stop with a SYNC line writes one turn-end event with that state and prints nothing', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const result = hook(sb, stopInput('Review finished.\nSYNC: done - review of page "Home" finished, 3 findings, see notes/home.md'));
  assert.deepEqual([result.code, result.out, result.err], [0, '', '']);
  const [event] = eventsOf(sb);
  assert.deepEqual([event.kind, event.state, event.from, event.to, event.by, event.label], ['turn-end', 'done', 'writer', 'lead', 'hook', 'Article']);
  assert.equal(event.text, 'review of page "Home" finished, 3 findings, see notes/home.md');
});

test('hook: without a SYNC line the state is unknown and the text is the first 200 characters; open background work counts as working', (t) => {
  const sb = sandbox(t);
  setup(sb);
  hook(sb, stopInput(`${'w'.repeat(30)} `.repeat(10)));
  hook(sb, stopInput('Waiting for the test run.', { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'tests' }] }));
  const [plain, background] = eventsOf(sb);
  assert.equal(plain.state, 'unknown');
  assert.equal(plain.text.length, 200);
  assert.equal(background.state, 'working');
});

test('SYNC line parsing: the last line wins, any known state, a dash with spaces, text capped, an unknown state is ignored', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const cases = [
    ['a\nSYNC: working - one\nb\nSYNC: needs-person - pick a thumbnail', 'needs-person', 'pick a thumbnail'],
    ['SYNC: blocked - waiting for a key', 'blocked', 'waiting for a key'],
    ['SYNC: needs-lead - which file?', 'needs-lead', 'which file?'],
    [`SYNC: done - ${'z'.repeat(400)}`, 'done', 'z'.repeat(200)],
    ['SYNC: finished - not a state', 'unknown', null],
  ];
  for (const [message] of cases) hook(sb, stopInput(message));
  const events = eventsOf(sb);
  cases.forEach(([, state, text], index) => {
    assert.equal(events[index].state, state, cases[index][0].slice(0, 30));
    if (text) assert.equal(events[index].text, text);
  });
});

test('hook: StopFailure writes turn-failed, SessionEnd writes session-end, and neither prints', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const failure = hook(sb, { session_id: 's-reviewer', cwd: '.', hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429', last_assistant_message: 'API Error: Rate limit reached' });
  const end = hook(sb, { session_id: 's-reviewer', cwd: '.', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  assert.deepEqual([failure.code, failure.out, end.code, end.out], [0, '', 0, '']);
  const [turnFailed, sessionEnd] = eventsOf(sb);
  assert.deepEqual([turnFailed.kind, turnFailed.state, turnFailed.from], ['turn-failed', 'blocked', 'reviewer']);
  assert.match(turnFailed.text, /rate_limit/);
  assert.deepEqual([sessionEnd.kind, sessionEnd.state], ['session-end', 'ended']);
  assert.match(sessionEnd.text, /prompt_input_exit/);
});

test('hook: SessionStart writes session-start; a joined session sees only its unread digest, a stranger sees its own id once', (t) => {
  const sb = sandbox(t);
  setup(sb);
  writeFileSync(path.join(sb.sync, 'R1', 'wait', 'lead.json'), JSON.stringify({ v: 1, pid: process.pid, started: new Date().toISOString(), delivered: null }));
  const quiet = hook(sb, { session_id: 's-lead', cwd: '.', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(quiet.code, 0);
  assert.equal(quiet.out, '', 'a joined session with no unread events gets no text');
  assert.equal(eventsOf(sb).at(-1).kind, 'session-start');
  assert.equal(eventsOf(sb).at(-1).state, 'working');
  hook(sb, stopInput('SYNC: done - draft ready'));
  const resumed = hook(sb, { session_id: 's-lead', cwd: '.', hook_event_name: 'SessionStart', source: 'resume' });
  assert.match(resumed.out, /session-sync run R1: 1 new/);
  assert.match(resumed.out, /writer\s+done\s+"Article": draft ready/);
  const stranger = hook(sb, { session_id: 's-other', cwd: '.', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(stranger.code, 0);
  assert.match(stranger.out, /session-sync: run R1 is open/);
  assert.ok(stranger.out.includes('s-other'), 'it prints the session id');
  assert.equal(eventsOf(sb).filter((event) => event.from === 's-other').length, 0);
  assert.ok(stranger.out.split('\n').filter(Boolean).length <= 2, 'one or two short lines');
});

test('hook is silent and exits 0 on every input, garbage included, and writes nothing when no run is open or the session joined none', (t) => {
  const sb = sandbox(t);
  const inputs = ['', 'not json', '{}', '[]', 'null', '123', '"Stop"', '{"hook_event_name":"Stop"}', '{"session_id":5,"hook_event_name":["Stop"]}', stopInput('SYNC: done - x'), '{"hook_event_name":"Stop","session_id":"s"', 'x'.repeat(2_000_000)];
  for (const input of inputs) {
    const result = hook(sb, input);
    assert.deepEqual([result.code, result.out, result.err], [0, '', ''], String(input).slice(0, 30));
  }
  assert.equal(existsSync(sb.sync), false, 'no folder is created when no run is open');
  setup(sb);
  const before = treeHash(sb.sync);
  for (const input of [stopInput('SYNC: done - x', { session_id: 's-unknown' }), { session_id: 's-unknown', hook_event_name: 'SessionEnd', reason: 'other' }, ...inputs.slice(0, 9)]) {
    const result = hook(sb, input);
    assert.deepEqual([result.code, result.out, result.err], [0, '', ''], JSON.stringify(input).slice(0, 40));
  }
  assert.equal(treeHash(sb.sync), before, 'a session that joined no run writes nothing');
  const eventsDir = path.join(sb.sync, 'R1', 'events');
  chmodSync(eventsDir, 0o500);
  const readonly = hook(sb, stopInput('SYNC: done - x'));
  chmodSync(eventsDir, 0o755);
  assert.deepEqual([readonly.code, readonly.out], [0, ''], 'a write error does not surface');
});

test('hook returns in under 300 ms when no run is open', (t) => {
  const sb = sandbox(t);
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const start = process.hrtime.bigint();
    hook(sb, stopInput('SYNC: done - x'));
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  assert.ok(Math.min(...times) < 300, `fastest of three: ${times.join(', ')} ms`);
});

test('inbox: a digest of events after the cursor only, one line each, at most 12 lines then +N more; the cursor moves, peek leaves it', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.match(cli(sb, ['inbox', '--me', 'lead']).out, /no new events/);
  for (let i = 0; i < 15; i += 1) plant(sb, { from: i % 2 ? 'writer' : 'reviewer', kind: 'report', state: 'done', text: `finished item ${i}`, label: i % 2 ? 'Article' : 'Page', at: new Date(Date.now() - (20 - i) * 1000).toISOString() });
  const peek = cli(sb, ['inbox', '--me', 'lead', '--peek']);
  const lines = peek.out.trim().split('\n');
  assert.match(lines[0], /^session-sync run R1: 15 new since /);
  assert.equal(lines.length, 1 + 12 + 1);
  assert.match(lines.at(-1), /^\+3 more$/);
  assert.equal(JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'seen', 'lead.json'), 'utf8')).cursor, null, 'peek moves nothing');
  const first = cli(sb, ['inbox', '--me', 'lead']);
  assert.match(first.out, /\+3 more/);
  const second = cli(sb, ['inbox', '--me', 'lead']);
  assert.match(second.out, /^session-sync run R1: 3 new since /m, 'only events after the cursor');
  assert.equal(second.out.trim().split('\n').length, 4);
  assert.match(cli(sb, ['inbox', '--me', 'lead']).out, /no new events/);
  plant(sb, { from: 'lead', to: 'all', kind: 'note', state: 'working', text: 'mine' });
  assert.match(cli(sb, ['inbox', '--me', 'lead']).out, /no new events/, 'my own events are not news to me');
  assert.match(cli(sb, ['inbox', '--me', 'writer']).out, /mine/, 'an event to all reaches the others');
});

test('digest: several turn-end events of one worker collapse to the newest; a line shows the time, the name, the state and the label with the text', (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { text: 'first try', state: 'unknown', at: '2026-01-05T14:05:00.000Z' });
  plant(sb, { text: 'second try', state: 'done', at: '2026-01-05T14:07:00.000Z' });
  plant(sb, { from: 'reviewer', label: 'Page', kind: 'turn-failed', state: 'blocked', text: 'rate_limit (session still open)', at: '2026-01-05T14:11:00.000Z' });
  const out = cli(sb, ['inbox', '--me', 'lead', '--peek']).out;
  assert.match(out, /^session-sync run R1: 2 new since /);
  assert.ok(!out.includes('first try'));
  assert.match(out, /^14:07 writer\s+done\s+"Article": second try$/m);
  assert.match(out, /^14:11 reviewer\s+turn-failed\s+"Page": rate_limit \(session still open\)$/m);
});

// A background process of the script, with its output collected.
function start(sb, args) {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: sb.workspace, env: sb.env });
  const state = { out: '', err: '', code: undefined };
  child.stdout.on('data', (chunk) => { state.out += chunk; });
  child.stderr.on('data', (chunk) => { state.err += chunk; });
  state.done = new Promise((resolve) => child.on('exit', (code) => { state.code = code; resolve(state); }));
  state.kill = () => child.kill('SIGTERM');
  return state;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('wait exits 0 with the digest on a wake-worthy event, and not on a working event, a session-start or a note', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  const waiter = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1']);
  await pause(600);
  plant(sb, { kind: 'turn-end', state: 'working', text: 'busy' });
  plant(sb, { kind: 'session-start', state: 'working', text: 'startup' });
  plant(sb, { kind: 'note', state: 'working', text: 'fyi', by: 'session' });
  await pause(1600);
  assert.equal(waiter.code, undefined, 'still waiting');
  plant(sb, { kind: 'turn-end', state: 'done', text: 'all finished' });
  await waiter.done;
  assert.equal(waiter.code, 0, waiter.err);
  assert.match(waiter.out, /all finished/);
});

test('wait exits 4 on a timeout when only quiet events arrived; an event already there wakes it at once; a delivered event does not wake the next wait', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { kind: 'turn-end', state: 'working', text: 'busy' });
  const quiet = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.03']);
  await quiet.done;
  assert.equal(quiet.code, 4);
  plant(sb, { kind: 'question', state: 'needs-lead', text: 'which file?', by: 'session' });
  const first = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.2']);
  await first.done;
  assert.equal(first.code, 0);
  assert.match(first.out, /which file\?/);
  const again = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.03']);
  await again.done;
  assert.equal(again.code, 4, 'the same news does not wake a second wait');
});

test('wait with a settle time merges a burst into one wake and collapses a worker\'s turn-end events to the newest', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  const waiter = start(sb, ['wait', '--me', 'lead', '--settle', '2', '--interval', '1']);
  await pause(500);
  plant(sb, { text: 'draft one', state: 'done' });
  await pause(400);
  plant(sb, { text: 'draft two', state: 'done' });
  plant(sb, { from: 'reviewer', label: 'Page', kind: 'question', state: 'needs-lead', text: 'which page?', by: 'session' });
  await waiter.done;
  assert.equal(waiter.code, 0);
  assert.ok(!waiter.out.includes('draft one'));
  assert.ok(waiter.out.includes('draft two') && waiter.out.includes('which page?'), waiter.out);
  assert.equal(waiter.out.trim().split('\n').length, 3, 'one wake: a header and two lines');
});

test('follow prints a digest per wake and keeps running; it stops with the timeout (4) and writes only its lock file', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  const quietly = (full) => full.endsWith(`${path.sep}wait`) || full.endsWith(`${path.sep}events`) || full.endsWith(`${path.sep}seen${path.sep}lead.json`);
  const before = treeHash(sb.sync, quietly);
  const follower = start(sb, ['follow', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.1']);
  await pause(500);
  plant(sb, { text: 'one done', state: 'done' });
  await pause(1500);
  plant(sb, { from: 'reviewer', label: 'Page', text: 'two done', state: 'done' });
  await follower.done;
  assert.equal(follower.code, 4);
  assert.ok(follower.out.includes('one done') && follower.out.includes('two done'));
  assert.equal((follower.out.match(/^session-sync run R1:/gm) ?? []).length, 2, 'two wakes');
  const lock = path.join(sb.sync, 'R1', 'wait', 'lead.json');
  assert.ok(existsSync(lock));
  assert.equal(treeHash(sb.sync, quietly), before, 'nothing else changed');
});

test('doctor, status and inbox --peek change no file; the lock is the only file wait writes', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { text: 'secret text', state: 'done' });
  const settings = path.join(sb.home, '.claude');
  mkdirSync(settings, { recursive: true });
  writeFileSync(path.join(settings, 'settings.json'), '{"crossSessionInbound":"refuse"}\n');
  const everything = () => `${treeHash(sb.dir)}`;
  const before = everything();
  for (const args of [['doctor'], ['doctor', '--json'], ['status'], ['status', '--json'], ['inbox', '--me', 'lead', '--peek'], ['snippet']]) {
    const result = cli(sb, args);
    assert.ok([0, 3].includes(result.code), `${args.join(' ')}: ${result.err}`);
    assert.equal(everything(), before, `${args.join(' ')} wrote a file`);
  }
  const waiter = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1']);
  await waiter.done;
  assert.equal(waiter.code, 0);
  const own = path.join(sb.sync, 'R1', 'seen', 'lead.json');
  const after = treeHash(sb.dir, (full) => full.endsWith(`${path.sep}wait`) || full === own);
  assert.equal(after, before.replace(/^home\/\.session-sync\/R1\/seen\/lead\.json:.*\n?/m, '').replace(/\n$/, ''), 'only the wait lock and the caller\'s own cursor changed');
  assert.ok(existsSync(path.join(sb.sync, 'R1', 'wait', 'lead.json')));
  assert.notEqual(JSON.parse(readFileSync(own, 'utf8')).cursor, null, 'the wake moved the cursor');
});

test('status: one line per member with state, ages and unread count; a member whose beat is old is marked STALE; by says hook or session', (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { from: 'writer', state: 'working', text: 'busy', at: new Date(Date.now() - 2 * 3600_000).toISOString() });
  plant(sb, { from: 'reviewer', label: 'Page', kind: 'report', state: 'done', by: 'session', text: 'ok', at: new Date(Date.now() - 60_000).toISOString() });
  const out = cli(sb, ['status', '--stale', '30']).out;
  assert.match(out, /^run R1 lead=lead members=3 open/m);
  assert.match(out, /^writer\b.*state=working.*beat=2h.*unread=\d+.*by=hook.*STALE/m);
  assert.match(out, /^reviewer\b.*state=done.*beat=1m.*by=session/m);
  assert.doesNotMatch(out.split('\n').find((line) => line.startsWith('reviewer')), /STALE/);
  const json = JSON.parse(cli(sb, ['status', '--json']).out);
  assert.deepEqual(json.members.map((member) => member.name).sort(), ['lead', 'reviewer', 'writer']);
});

// --- doctor -------------------------------------------------------------------------------------------------------

const doctorLine = (result, id) => result.out.split('\n').find((line) => new RegExp(`^(OK|WARN|FAIL|SKIP) ${id} `).test(line))?.split(' ')[0];

function claudeStub(sb, version) {
  const bin = path.join(sb.dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = path.join(bin, 'claude');
  writeFileSync(stub, `#!/bin/sh\ntouch "${path.join(sb.dir, 'claude-was-run')}"\necho "${version} (Claude Code)"\n`);
  chmodSync(stub, 0o755);
  return { ...sb.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('doctor: D1 to D11 each have a passing and a failing fixture, and the exit code follows', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { from: 'writer', text: 'x', state: 'done' });
  plant(sb, { from: 'reviewer', label: 'Page', text: 'y', state: 'done' });
  plant(sb, { from: 'lead', to: 'lead', kind: 'turn-end', state: 'done', text: 'z' });
  const settingsFile = path.join(sb.home, '.claude', 'settings.json');
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  const script = path.join(sb.dir, 'hook.sh');
  writeFileSync(script, '#!/bin/sh\n');
  const good = { hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${SCRIPT}" hook` }, { type: 'command', command: `sh ${script}` }] }] } };
  writeFileSync(settingsFile, JSON.stringify(good));
  mkdirSync(path.join(sb.workspace, '.claude', 'commands'), { recursive: true });
  writeFileSync(path.join(sb.workspace, '.claude', 'commands', 'lead.md'), 'The lead opens workers and reads each report back with session-sync.\n');
  mkdirSync(path.join(sb.workspace, '01-Projects', 'p', 'factory'), { recursive: true });
  writeFileSync(path.join(sb.workspace, '01-Projects', 'p', 'factory', 'board.md'), '# board\n');
  assert.equal(cli(sb, ['inbox', '--me', 'lead']).code, 0);
  const waiter = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '1']);
  await pause(800);

  const clean = cli(sb, ['doctor', '--workspace', sb.workspace], { env: claudeStub(sb, '2.1.300') });
  const flagged = (result) => ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'].map((id) => `${id}:${doctorLine(result, id)}`).join(' ');
  assert.equal(clean.code, 0, clean.out);
  assert.match(flagged(clean), /^D1:SKIP D2:OK D3:OK D4:OK D5:OK D6:OK D7:OK D8:OK D9:OK D10:OK D11:OK$/, clean.out);
  assert.equal(existsSync(path.join(sb.dir, 'claude-was-run')), false, 'no child process without --claude-version');
  const withVersion = cli(sb, ['doctor', '--workspace', sb.workspace, '--claude-version'], { env: claudeStub(sb, '2.1.300') });
  assert.equal(doctorLine(withVersion, 'D1'), 'OK');
  assert.equal(existsSync(path.join(sb.dir, 'claude-was-run')), true, 'the child process runs behind the flag');
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace, '--claude-version'], { env: claudeStub(sb, '2.1.100') }), 'D1'), 'WARN');
  waiter.kill();
  await waiter.done;

  // D2: settings that stop live messages.
  writeFileSync(settingsFile, JSON.stringify({ ...good, crossSessionInbound: 'refuse', permissions: { deny: ['SendMessage'], defaultMode: 'bypassPermissions' } }));
  const d2 = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d2, 'D2'), 'WARN');
  assert.match(d2.out, /D2 .*crossSessionInbound.*SendMessage.*bypass/s);
  // D4: no hook command at all (a computer where the snippet was never applied) is a WARN with the same fix, not a SKIP.
  writeFileSync(settingsFile, JSON.stringify({ permissions: { allow: [] } }));
  const d4empty = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d4empty, 'D4'), 'WARN');
  assert.equal(d4empty.code, 0, 'a WARN is not a failure');
  assert.match(d4empty.out, /D4 hooks: no hook command in the settings files\. Apply the hook entries from `snippet`, or use tier B: `post` at the end of every turn {2}\[HOW-IT-WORKS: "Hooks write nothing"\]/);
  // D4: hook commands exist but none runs session-sync.mjs hook (the snippet was never applied): a WARN that names the fix.
  writeFileSync(settingsFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `sh ${script}` }] }] } }));
  const d4none = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d4none, 'D4'), 'WARN');
  assert.equal(d4none.code, 0, 'a WARN is not a failure');
  assert.match(d4none.out, /D4 hooks: 1 hook command\(s\) exist, but none runs session-sync\.mjs hook\. Apply the hook entries from `snippet`, or use tier B: `post` at the end of every turn {2}\[HOW-IT-WORKS: "Hooks write nothing"\]/);
  // The same settings with the snippet applied are clean again, and the JSON output carries the same text.
  const snippetSettings = JSON.parse(cli(sb, ['snippet']).out);
  writeFileSync(settingsFile, JSON.stringify(snippetSettings));
  const d4applied = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d4applied, 'D4'), 'OK');
  assert.match(d4applied.out, /D4 hooks: 4 hook command\(s\), every script path exists, 4 run session-sync\.mjs hook/);
  writeFileSync(settingsFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `sh ${script}` }] }] } }));
  const d4json = JSON.parse(cli(sb, ['doctor', '--workspace', sb.workspace, '--json']).out);
  assert.equal(d4json.checks.find((check) => check.id === 'D4').status, 'WARN');
  assert.equal(d4json.verdict, 'WARN');
  // D4: a hook script that does not exist.
  writeFileSync(settingsFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'sh /nowhere/missing-hook.sh' }] }] } }));
  const d4 = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d4, 'D4'), 'FAIL');
  assert.equal(d4.code, 3);
  assert.equal(doctorLine(d4, 'D9'), 'WARN', 'no session-sync hook in any settings file');
  writeFileSync(settingsFile, JSON.stringify(good));
  // D5: a command that reports back but never names the skill.
  writeFileSync(path.join(sb.workspace, '.claude', 'commands', 'lead.md'), 'The lead opens workers. Each worker must report back to the lead.\n');
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D5'), 'WARN');
  // D6: a second board file, and a conflicted copy.
  writeFileSync(path.join(sb.workspace, '01-Projects', 'p', 'factory', 'board 2.md'), '# board\n');
  const d6 = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(d6, 'D6'), 'FAIL');
  assert.equal(d6.code, 3);
  rmSync(path.join(sb.workspace, '01-Projects', 'p', 'factory', 'board 2.md'));
  // D10: nothing armed any more (the wait above has ended).
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D10'), 'WARN');
});

test('doctor D7: a broken event, an event to an unknown name, a time in the future and a member with no seen file each fail or warn; D11 fails when active.json names a missing run', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D7'), 'OK');
  assert.equal(cli(sb, ['doctor', '--workspace', sb.workspace]).code, 0);
  const unknown = plant(sb, { to: 'nobody', text: 'x' });
  let result = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(result, 'D7'), 'FAIL');
  assert.equal(result.code, 3);
  rmSync(path.join(sb.sync, 'R1', 'events', `${unknown}.json`));
  plant(sb, { at: new Date(Date.now() + 600_000).toISOString(), text: 'later' });
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D7'), 'FAIL', 'a time more than two minutes ahead');
  for (const file of readdirSync(path.join(sb.sync, 'R1', 'events'))) rmSync(path.join(sb.sync, 'R1', 'events', file));
  writeFileSync(path.join(sb.sync, 'R1', 'events', '20260101T000000000Z-writer-aaaa.json'), '{ broken');
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D7'), 'FAIL', 'an event that does not parse');
  rmSync(path.join(sb.sync, 'R1', 'events', '20260101T000000000Z-writer-aaaa.json'));
  rmSync(path.join(sb.sync, 'R1', 'seen', 'reviewer.json'));
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D7'), 'WARN', 'a listed member that never joined');
  writeFileSync(path.join(sb.sync, 'active.json'), JSON.stringify({ v: 1, runs: [{ run: 'R1', started: 'x' }, { run: 'R9', started: 'x' }] }));
  result = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(result, 'D11'), 'FAIL');
  assert.equal(result.code, 3);
});

test('doctor D8: an unwritable sync folder fails, a cloud-synced folder warns, an ordinary one passes; D3 judges the Node version', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D8'), 'OK');
  chmodSync(sb.sync, 0o500); // Windows ignores the mode bits, so the folder stays writable there
  const blocked = cli(sb, ['doctor', '--workspace', sb.workspace]);
  chmodSync(sb.sync, 0o755);
  if (process.getuid?.() !== 0 && process.platform !== 'win32') {
    assert.equal(doctorLine(blocked, 'D8'), 'FAIL');
    assert.equal(blocked.code, 3);
  }
  const cloud = path.join(sb.home, 'Library', 'Mobile Documents', 'sync');
  mkdirSync(cloud, { recursive: true });
  const warned = cli(sb, ['doctor', '--workspace', sb.workspace], { env: { SESSION_SYNC_HOME: cloud } });
  assert.equal(doctorLine(warned, 'D8'), 'WARN');
  const { checkNode } = await import(SCRIPT);
  assert.equal(checkNode('v22.0.0').status, 'OK');
  assert.equal(checkNode('v20.11.0').status, 'FAIL');
});

test('doctor prints no event text and no full home path; --json carries the same checks; an unknown command is exit 2', (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { text: 'TOPSECRET-line', state: 'done' });
  const out = cli(sb, ['doctor', '--workspace', sb.workspace]).out;
  assert.ok(!out.includes('TOPSECRET'));
  assert.ok(!out.includes(sb.home), out);
  assert.match(out, /~\/\.session-sync/);
  const json = JSON.parse(cli(sb, ['doctor', '--workspace', sb.workspace, '--json']).out);
  assert.deepEqual(json.checks.map((check) => check.id), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12']);
  assert.ok(!JSON.stringify(json).includes(sb.home));
  assert.equal(cli(sb, ['nonsense']).code, 2);
  assert.equal(cli(sb, []).code, 2);
  assert.equal(cli(sb, ['post', '--kind', 'note']).code, 2, 'a missing --me');
});

test('snippet prints the four hooks with the real script path; SessionEnd and SessionStart get a short timeout, Stop and StopFailure are async', (t) => {
  const sb = sandbox(t);
  const result = cli(sb, ['snippet']);
  assert.equal(result.code, 0);
  const { hooks } = JSON.parse(result.out);
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionEnd', 'SessionStart', 'Stop', 'StopFailure']);
  for (const [name, groups] of Object.entries(hooks)) {
    const entry = groups[0].hooks[0];
    assert.equal(entry.type, 'command');
    assert.equal(entry.command, `node "${SCRIPT}" hook`, name);
  }
  assert.equal(hooks.Stop[0].hooks[0].async, true);
  assert.equal(hooks.StopFailure[0].hooks[0].async, true);
  assert.equal(hooks.SessionEnd[0].hooks[0].timeout, 5);
  assert.equal(hooks.SessionStart[0].hooks[0].timeout, 5);
  assert.equal(hooks.SessionStart[0].matcher, 'startup|resume|clear');
});

test('close removes the run from active.json, writes closed.json, and the hook then writes nothing', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(cli(sb, ['close', '--me', 'writer']).code, 2, 'only the lead closes a run');
  const closed = cli(sb, ['close', '--me', 'lead']);
  assert.equal(closed.code, 0, closed.err);
  assert.deepEqual(JSON.parse(readFileSync(path.join(sb.sync, 'active.json'), 'utf8')).runs, []);
  assert.ok(existsSync(path.join(sb.sync, 'R1', 'closed.json')));
  const before = treeHash(sb.sync);
  hook(sb, stopInput('SYNC: done - x'));
  assert.equal(treeHash(sb.sync), before);
  assert.match(cli(sb, ['status', '--run', 'R1']).out, /closed/);
});

test('with two open runs a command needs --run; with one it finds it', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(cli(sb, ['init', '--lead', 'lead2', '--run', 'R2']).code, 0);
  assert.equal(cli(sb, ['status']).code, 2);
  assert.equal(cli(sb, ['status', '--run', 'R2']).code, 0);
});

test('control characters are replaced before they reach an event, for post and for a hook message', (t) => {
  const sb = sandbox(t);
  setup(sb);
  assert.equal(cli(sb, ['post', '--me', 'writer', '--kind', 'note', '--text', 'a\u001b[31mred\u001b[0m\u0007bell\u009bx\ttab\nline']).code, 0);
  hook(sb, stopInput('SYNC: done - ok\u001b]0;title\u0007 after'));
  hook(sb, stopInput('plain \u001b[2Jwipe\u0000nul'));
  for (const event of eventsOf(sb)) {
    assert.doesNotMatch(event.text, /[\u0000-\u001f\u007f-\u009f]/, JSON.stringify(event.text));
    assert.doesNotMatch(event.label, /[\u0000-\u001f\u007f-\u009f]/);
  }
  assert.doesNotMatch(cli(sb, ['inbox', '--me', 'lead', '--peek']).out.replace(/\n/g, ''), /[\u0000-\u001f\u007f-\u009f]/, 'nor the digest');
});

test('a wake moves the lead\'s cursor, so the next inbox shows only newer events', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { text: 'first report', state: 'done' });
  const waiter = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1']);
  await waiter.done;
  assert.match(waiter.out, /first report/);
  assert.match(cli(sb, ['inbox', '--me', 'lead', '--peek']).out, /no new events/, 'no second payment for the same lines');
  plant(sb, { text: 'later report', state: 'done', from: 'reviewer', label: 'Page' });
  const next = cli(sb, ['inbox', '--me', 'lead', '--peek']).out;
  assert.match(next, /later report/);
  assert.doesNotMatch(next, /first report/);
});

test('join keeps the label and kind planned at init, and an explicit label wins', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const seen = (name) => JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'seen', `${name}.json`), 'utf8'));
  assert.equal(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']).code, 0);
  assert.deepEqual([seen('writer').label, seen('writer').kind], ['Article', 'writer'], 'a join without --label keeps the planned one');
  assert.equal(cli(sb, ['init', '--lead', 'lead3', '--run', 'R3', '--member', 'w1:Planned title:writer']).code, 0);
  assert.equal(cli(sb, ['join', '--me', 'w1', '--run', 'R3']).code, 0);
  const planned = JSON.parse(readFileSync(path.join(sb.sync, 'R3', 'seen', 'w1.json'), 'utf8'));
  assert.deepEqual([planned.label, planned.kind], ['Planned title', 'writer']);
  assert.equal(cli(sb, ['join', '--me', 'w1', '--run', 'R3', '--label', 'Own label']).code, 0);
  assert.equal(JSON.parse(readFileSync(path.join(sb.sync, 'R3', 'seen', 'w1.json'), 'utf8')).label, 'Own label');
});

test('init prints the full script path for the briefs', (t) => {
  const sb = sandbox(t);
  const out = cli(sb, ['init', '--lead', 'lead', '--run', 'R1']).out;
  assert.ok(out.includes(`script: ${SCRIPT}`), out);
});

test('doctor D11 warns when an open run has had no event for 24 hours, and points to status; a recent event clears it', (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { text: 'old', at: new Date(Date.now() - 30 * 3600_000).toISOString() });
  const stale = cli(sb, ['doctor', '--workspace', sb.workspace]);
  assert.equal(doctorLine(stale, 'D11'), 'WARN');
  assert.match(stale.out, /D11 .*24 hours.*close it.*status/);
  assert.equal(stale.code, 0, 'a warning is not a failure');
  plant(sb, { text: 'fresh' });
  assert.equal(doctorLine(cli(sb, ['doctor', '--workspace', sb.workspace]), 'D11'), 'OK');
});

// --- join without being told the id (A1) ------------------------------------------------------------------------

const seenOf = (sb, name, run = 'R1') => JSON.parse(readFileSync(path.join(sb.sync, run, 'seen', `${name}.json`), 'utf8'));

test('init and join read the session id from CLAUDE_CODE_SESSION_ID; --session none stores null; an explicit --session still wins', (t) => {
  const sb = sandbox(t);
  const init = cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--member', 'w1:One:writer'], { env: { CLAUDE_CODE_SESSION_ID: 'S1' } });
  assert.equal(init.code, 0, init.err);
  assert.equal(seenOf(sb, 'lead').session_id, 'S1');
  assert.equal(cli(sb, ['join', '--me', 'w1'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0);
  assert.equal(seenOf(sb, 'w1').session_id, 'S2');
  assert.equal(cli(sb, ['join', '--me', 'w1', '--session', 'none'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0);
  assert.equal(seenOf(sb, 'w1').session_id, null);
  assert.equal(cli(sb, ['join', '--me', 'w1', '--session', 'S5'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0);
  assert.equal(seenOf(sb, 'w1').session_id, 'S5', 'an explicit id wins over the variable');
  const plain = cli(sb, ['join', '--me', 'w3', '--label', 'x']);
  assert.equal(plain.code, 0);
  assert.equal(seenOf(sb, 'w3').session_id, null, 'no variable and no flag: null, as before');
  assert.match(plain.out, /no session id yet/);
});

test('join refuses an id another name already holds in the run, writes nothing for it, and a re-join replaces the old id and keeps the cursor', (t) => {
  const sb = sandbox(t);
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--member', 'w1:One:writer', '--member', 'w2:Two:writer']).code, 0);
  assert.equal(cli(sb, ['join', '--me', 'w1'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0);
  const clash = cli(sb, ['join', '--me', 'w2'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } });
  assert.equal(clash.code, 2);
  assert.match(clash.err, /already w1.*--session none.*post/s);
  assert.equal(existsSync(path.join(sb.sync, 'R1', 'seen', 'w2.json')), false, 'no seen file for the refused name');
  assert.equal(cli(sb, ['join', '--me', 'w2', '--session', 'none'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0, 'a subagent joins with --session none');
  const file = path.join(sb.sync, 'R1', 'seen', 'w1.json');
  writeFileSync(file, `${JSON.stringify({ ...seenOf(sb, 'w1'), cursor: 'c-123' })}\n`);
  assert.equal(cli(sb, ['join', '--me', 'w1'], { env: { CLAUDE_CODE_SESSION_ID: 'S9' } }).code, 0);
  assert.deepEqual([seenOf(sb, 'w1').session_id, seenOf(sb, 'w1').cursor], ['S9', 'c-123']);
  assert.equal(cli(sb, ['join', '--me', 'w1']).code, 0, 'a re-join with no variable keeps the id it has');
  assert.equal(seenOf(sb, 'w1').session_id, 'S9');
});

// --- a reopened lead is told to arm again (A2) ------------------------------------------------------------------------

test('SessionStart for the lead prints the re-arm line when no live wait lock exists, and not when one does', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const start = (source = 'resume') => hook(sb, { session_id: 's-lead', cwd: '.', hook_event_name: 'SessionStart', source });
  const open = start();
  assert.equal(open.code, 0);
  assert.match(open.out, /^session-sync: you lead run R1 and no wait is armed\. Arm: node ".*session-sync\.mjs" follow --me lead --settle 60 --run R1$/m);
  const lock = path.join(sb.sync, 'R1', 'wait', 'lead.json');
  writeFileSync(lock, JSON.stringify({ v: 1, pid: process.pid, started: new Date().toISOString(), delivered: null }));
  assert.equal(start().out, '', 'a live lock: no line');
  writeFileSync(lock, JSON.stringify({ v: 1, pid: null, started: new Date().toISOString(), delivered: null }));
  assert.match(start().out, /^session-sync: you lead run R1 and no wait is armed/m, 'an ended wait counts as no wait');
  assert.doesNotMatch(hook(sb, { session_id: 's-writer', cwd: '.', hook_event_name: 'SessionStart', source: 'resume' }).out, /you lead run/, 'only the lead is told');
});

// --- opt-in auto-join (A3) ------------------------------------------------------------------------------------------

test('init --auto-join stores the absolute folder in run.json; without the flag auto is empty', (t) => {
  const sb = sandbox(t);
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'run.json'), 'utf8')).auto, []);
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R2', '--auto-join', 'writing'], { cwd: sb.workspace }).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(sb.sync, 'R2', 'run.json'), 'utf8')).auto, [path.join(sb.workspace, 'writing')]);
});

test('auto-join: an unknown session inside the folder is registered once as kind auto with one event; outside the folder, a folder that only shares a prefix, or a run with no auto folder, nothing is written', (t) => {
  const sb = sandbox(t);
  const folder = path.join(sb.workspace, 'articles');
  mkdirSync(path.join(folder, 'deep', 'er'), { recursive: true });
  mkdirSync(`${folder}-other`, { recursive: true });
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--auto-join', folder]).code, 0);
  const seenCount = () => readdirSync(path.join(sb.sync, 'R1', 'seen')).length;
  const base = seenCount();
  const before = treeHash(sb.sync);
  for (const cwd of [sb.workspace, `${folder}-other`, path.dirname(folder), '', undefined, 5]) {
    const result = hook(sb, stopInput('SYNC: done - x', { session_id: 'auto-1111', cwd }));
    assert.deepEqual([result.code, result.out, result.err], [0, '', ''], String(cwd));
  }
  assert.equal(treeHash(sb.sync), before, 'outside the folder: nothing is written');
  const inside = hook(sb, stopInput('SYNC: done - first article drafted', { session_id: 'auto-1111', cwd: path.join(folder, 'deep', 'er'), session_title: 'Draft the Home page' }));
  assert.deepEqual([inside.code, inside.out, inside.err], [0, '', '']);
  assert.equal(seenCount(), base + 1);
  const member = seenOf(sb, 'er-auto');
  assert.deepEqual([member.kind, member.session_id, member.label, member.cursor, member.v], ['auto', 'auto-1111', 'Draft the Home page', null, 1]);
  assert.deepEqual(Object.keys(member).sort(), ['cursor', 'joined', 'kind', 'label', 'name', 'session_id', 'v']);
  const [event] = eventsOf(sb);
  assert.deepEqual([event.from, event.to, event.kind, event.state, event.by, event.text], ['er-auto', 'lead', 'turn-end', 'done', 'hook', 'first article drafted']);
  hook(sb, stopInput('SYNC: done - second', { session_id: 'auto-1111', cwd: folder }));
  assert.equal(seenCount(), base + 1, 'the same session is registered once');
  assert.equal(eventsOf(sb).length, 2);
  const exact = hook(sb, stopInput('SYNC: done - at the root', { session_id: 'auto-2222', cwd: folder }));
  assert.equal(exact.code, 0);
  assert.equal(seenOf(sb, 'articles-auto').session_id, 'auto-2222', 'the folder itself matches; the name is the folder name plus 4 characters of the id');
});

test('auto-join never overwrites an existing member, and a run with no auto folder writes nothing for an unknown session', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const folder = path.join(sb.workspace, 'pages');
  mkdirSync(folder, { recursive: true });
  const before = treeHash(sb.sync);
  hook(sb, stopInput('SYNC: done - x', { session_id: 'xyz-1234', cwd: folder }));
  assert.equal(treeHash(sb.sync), before, 'the default run has no auto folder');
  assert.equal(cli(sb, ['init', '--lead', 'lead2', '--run', 'R2', '--auto-join', folder]).code, 0);
  writeFileSync(path.join(sb.sync, 'R2', 'seen', 'pages-xyz1.json'), `${JSON.stringify({ v: 1, name: 'pages-xyz1', session_id: 'other', label: 'mine', kind: 'writer', joined: 'x', cursor: null })}\n`);
  const guard = treeHash(path.join(sb.sync, 'R2'));
  hook(sb, stopInput('SYNC: done - x', { session_id: 'xyz-1234', cwd: folder }));
  assert.equal(treeHash(path.join(sb.sync, 'R2')), guard, 'a taken name is left alone and no event is written');
  assert.equal(seenOf(sb, 'pages-xyz1', 'R2').label, 'mine');
});

test('init --session none stores no id (null, not the text none)', (t) => {
  const sb = sandbox(t);
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--session', 'none'], { env: { CLAUDE_CODE_SESSION_ID: 'S1' } }).code, 0);
  assert.equal(seenOf(sb, 'lead').session_id, null);
});

test('a named join takes over an id that an auto record holds: no second member, the lead keeps the id, and its own turn ends are not auto events', (t) => {
  const sb = sandbox(t);
  const folder = path.join(sb.workspace, 'work');
  mkdirSync(folder, { recursive: true });
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--auto-join', folder, '--session', 'none']).code, 0);
  const started = hook(sb, { session_id: 'L2', cwd: folder, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(started.code, 0);
  assert.equal(seenOf(sb, 'work-L2').kind, 'auto', 'the hook registered the lead session as an auto member');
  const joined = cli(sb, ['join', '--me', 'lead'], { env: { CLAUDE_CODE_SESSION_ID: 'L2' } });
  assert.equal(joined.code, 0, joined.err);
  assert.equal(existsSync(path.join(sb.sync, 'R1', 'seen', 'work-L2.json')), false, 'the auto record is removed');
  assert.equal(seenOf(sb, 'lead').session_id, 'L2');
  hook(sb, stopInput('SYNC: done - mine', { session_id: 'L2', cwd: folder }));
  const own = eventsOf(sb).filter((event) => event.kind === 'turn-end');
  assert.deepEqual(own.map((event) => event.from), ['lead'], 'the turn end is from the lead, to the lead');
  assert.equal(readdirSync(path.join(sb.sync, 'R1', 'seen')).length, 1, 'no auto member appears again');
  // The wake does not count the lead's own event as news for the lead: no self-wake loop.
  assert.match(cli(sb, ['inbox', '--me', 'lead', '--peek']).out, /no new events/);
});

test('a named join still refuses an id held by another named member', (t) => {
  const sb = sandbox(t);
  assert.equal(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--member', 'w1:One:writer', '--member', 'w2:Two:writer']).code, 0);
  assert.equal(cli(sb, ['join', '--me', 'w1'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 0);
  assert.equal(cli(sb, ['join', '--me', 'w2'], { env: { CLAUDE_CODE_SESSION_ID: 'S2' } }).code, 2);
  assert.equal(seenOf(sb, 'w1').session_id, 'S2');
});

test('doctor D8 says when the sync folder does not exist yet, and prints no full home path', (t) => {
  const sb = sandbox(t);
  const result = cli(sb, ['doctor', '--workspace', sb.workspace]);
  const d8 = result.out.split('\n').find((line) => /^(OK|WARN|FAIL) D8 /.test(line));
  assert.match(d8, /D8 access: ~\/\.session-sync does not exist yet; ~ is readable and writable/);
  assert.ok(!result.out.includes(sb.home), 'no full home path');
  const folder = path.join(sb.home, 'deeper', 'sync');
  const nested = cli(sb, ['doctor', '--workspace', sb.workspace], { env: { SESSION_SYNC_HOME: folder } });
  assert.match(nested.out, /D8 access: ~\/deeper\/sync does not exist yet; ~ is readable and writable/);
});

// --- a quiet worker wakes the lead once (A4) --------------------------------------------------------------------------

test('wait --stale: one STALE line for a member whose only event is an old working turn-end; not repeated by the next wait; never for done, needs-person, blocked, ended or unknown', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { from: 'writer', kind: 'turn-end', state: 'working', text: 'busy', at: new Date(Date.now() - 5_000).toISOString() });
  const first = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.3']);
  await first.done;
  assert.equal(first.code, 0, first.err);
  assert.equal((first.out.match(/STALE/g) ?? []).length, 1, first.out);
  assert.match(first.out, /writer\s+STALE\s+no event for \d+s/);
  const second = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.05']);
  await second.done;
  assert.equal(second.code, 4, second.out);
  assert.doesNotMatch(second.out, /STALE/, 'the lock remembers the member');
  plant(sb, { from: 'writer', kind: 'turn-end', state: 'done', text: 'finished' });
  const finished = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.3']);
  await finished.done;
  assert.equal(finished.code, 0);
  assert.match(finished.out, /finished/);
  assert.doesNotMatch(finished.out, /STALE/, 'a member who is done is never quiet');
  for (const state of ['done', 'needs-person', 'blocked', 'ended', 'unknown']) {
    const other = sandbox(t);
    setup(other);
    plant(other, { from: 'writer', kind: 'turn-end', state, text: 'x', at: new Date(Date.now() - 5_000).toISOString() });
    const waiter = start(other, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.05']);
    await waiter.done;
    assert.doesNotMatch(waiter.out, /STALE/, state);
  }
});

test('wait --stale does nothing for a worker that waits (only the lead gets the line) and a lead never reports itself as stale', async (t) => {
  const sb = sandbox(t);
  setup(sb);
  plant(sb, { from: 'lead', to: 'lead', kind: 'turn-end', state: 'working', text: 'me', at: new Date(Date.now() - 5_000).toISOString() });
  plant(sb, { from: 'reviewer', label: 'Page', kind: 'turn-end', state: 'working', text: 'busy', at: new Date(Date.now() - 5_000).toISOString() });
  const worker = start(sb, ['wait', '--me', 'writer', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.05']);
  await worker.done;
  assert.doesNotMatch(worker.out, /STALE/);
  const lead = start(sb, ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--stale', '0.001', '--timeout', '0.3']);
  await lead.done;
  assert.match(lead.out, /reviewer\s+STALE/);
  assert.doesNotMatch(lead.out, /lead\s+STALE/);
});

// --- the shipped text ---------------------------------------------------------------------------------------------

// Company and product terms are checked by the packer's own scan, not named here.
const SHIPPED_BLOCK = [/(?:\/Users|\/home)\/[a-z]/, /[\w.%+-]+@[\w-]+\.(?:com|de|org|net)\b/];

// Names become file names. A name with a slash or a leading dot must never reach a path, from any entry point.
const filesUnder = (root) => readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath, e.name)));

test('names are checked at every entry point: a slash or a leading dot is refused with exit 2 and writes nothing', (t) => {
  const sb = sandbox(t);
  setup(sb);
  const before = filesUnder(sb.dir).sort();
  for (const bad of ['../x', 'a/b', '.hidden', '..', 'x/../../y', '']) {
    for (const args of [['join', '--me', bad], ['post', '--me', bad, '--kind', 'note', '--text', 'x'], ['post', '--me', 'writer', '--to', bad, '--kind', 'note', '--text', 'x'], ['inbox', '--me', bad], ['init', '--lead', bad, '--run', 'R2'], ['init', '--lead', 'l2', '--run', bad], ['init', '--lead', 'l3', '--run', 'R3', '--member', `${bad}:x:y`]]) {
      const result = cli(sb, args);
      assert.equal(result.code, 2, `${args.join(' ')} -> ${result.out}${result.err}`);
    }
  }
  assert.deepEqual(filesUnder(sb.dir).sort(), before, 'a refused name wrote nothing');
});

test('a planted member file or run.json with a path in its name makes the hook write nothing outside events/', (t) => {
  for (const evil of ['../../../escaped', 'x/../../../escaped', '/tmp/escaped', '.escaped']) {
    const sb = sandbox(t);
    setup(sb);
    mkdirSync(path.join(sb.sync, 'R1', 'events', 'x'), { recursive: true });
    writeFileSync(path.join(sb.sync, 'R1', 'seen', 'zz.json'), JSON.stringify({ v: 1, name: evil, session_id: 's-evil', label: 'x', kind: 'auto', joined: 'x', cursor: null }));
    const before = filesUnder(sb.dir).sort();
    hook(sb, { session_id: 's-evil', hook_event_name: 'Stop', last_assistant_message: 'hello' });
    assert.deepEqual(filesUnder(sb.dir).sort(), before, `a member named ${evil} wrote a file`);
    // A lead named with a path in run.json: the run is skipped, the hook still writes nothing.
    const meta = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'run.json'), 'utf8'));
    writeFileSync(path.join(sb.sync, 'R1', 'run.json'), JSON.stringify({ ...meta, lead: evil }));
    hook(sb, { session_id: 's-writer', hook_event_name: 'Stop', last_assistant_message: 'hello' });
    assert.deepEqual(filesUnder(sb.dir).sort(), before, `a lead named ${evil} wrote a file`);
  }
});

// Pinned hook script: the user-level hooks must not run a script that agents can edit inside the workspace.
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const d12 = (sb) => cli(sb, ['doctor', '--workspace', sb.workspace]).out.split('\n').find((line) => /^(OK|WARN|FAIL|SKIP) D12 /.test(line)) ?? '';

test('snippet --pin copies the script outside the workspace, records its hash, prints it, and points every hook at the copy', (t) => {
  const sb = sandbox(t);
  const before = filesUnder(sb.dir).sort();
  const result = cli(sb, ['snippet', '--pin']);
  assert.equal(result.code, 0, result.err);
  const pinned = path.join(sb.sync, 'bin', 'session-sync.mjs');
  assert.equal(sha256(pinned), sha256(SCRIPT), 'the pinned copy is the skill copy, byte for byte');
  assert.equal(readFileSync(path.join(sb.sync, 'bin', 'session-sync.sha256'), 'utf8').trim(), sha256(SCRIPT));
  assert.ok(result.err.includes(sha256(SCRIPT)), 'the hash is printed');
  for (const groups of Object.values(JSON.parse(result.out).hooks)) assert.equal(groups[0].hooks[0].command, `node "${pinned}" hook`);
  assert.deepEqual(filesUnder(sb.dir).sort().filter((f) => !before.includes(f)), [path.join('home', '.session-sync', 'bin', 'session-sync.mjs'), path.join('home', '.session-sync', 'bin', 'session-sync.sha256')].sort(), 'only the pinned copy and its hash are written');
  assert.equal(cli(sb, ['snippet']).out.includes(path.join(sb.sync, 'bin')), false, 'plain snippet is unchanged and writes nothing');
});

test('doctor D12 warns when the hook script lives inside the workspace, when the pinned copy changed, and when it differs from the skill copy', (t) => {
  const sb = sandbox(t);
  const settingsFile = path.join(sb.home, '.claude', 'settings.json');
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  const apply = (out) => writeFileSync(settingsFile, JSON.stringify(JSON.parse(out)));
  assert.match(d12(sb), /^SKIP D12/, 'no session-sync hook, nothing to check');
  // A hook that runs the installed copy inside the workspace.
  const inside = path.join(sb.workspace, '.claude', 'skills', 'session-sync');
  mkdirSync(inside, { recursive: true });
  writeFileSync(path.join(inside, 'session-sync.mjs'), readFileSync(SCRIPT));
  writeFileSync(settingsFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(inside, 'session-sync.mjs')}" hook` }] }] } }));
  assert.match(d12(sb), /^WARN D12 .*inside the workspace.*snippet --pin/);
  // Pinned and identical to the skill copy: clean.
  apply(cli(sb, ['snippet', '--pin']).out);
  assert.match(d12(sb), /^OK D12/);
  // The skill copy in the workspace changes: the pinned hook still runs the old script, and the doctor says so.
  writeFileSync(path.join(inside, 'session-sync.mjs'), `${readFileSync(SCRIPT, 'utf8')}\n// edited\n`);
  assert.match(d12(sb), /^WARN D12 .*differs from the skill copy/);
  // The pinned copy itself changes after it was pinned.
  writeFileSync(path.join(sb.sync, 'bin', 'session-sync.mjs'), `${readFileSync(SCRIPT, 'utf8')}\n// edited\n`);
  assert.match(d12(sb), /^WARN D12 .*changed since it was pinned/);
});

test('the script imports only node: modules, opens no socket, and starts no process unless --claude-version is given; it is under 500 lines', () => {
  const text = readFileSync(SCRIPT, 'utf8');
  const specifiers = [...text.matchAll(/^import[^'"\n]*['"]([^'"]+)['"]/gm), ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) assert.match(specifier, /^node:/, specifier);
  for (const banned of ['node:net', 'node:http', 'node:https', 'node:http2', 'node:dgram', 'node:tls', 'node:dns', 'node:worker_threads', 'node:cluster', 'node:vm']) assert.ok(!text.includes(banned), banned);
  assert.doesNotMatch(text, /^import[^\n]*child_process/m, 'child_process is not a static import');
  assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket)\b\s*\(/);
  const child = text.split('\n').flatMap((line, index) => (line.includes('child_process') ? [index] : []));
  assert.equal(child.length, 1, 'one mention, inside the version check');
  assert.match(text.split('\n').slice(Math.max(0, child[0] - 6), child[0] + 1).join('\n'), /claude-version|checkVersion/);
  assert.ok(text.split('\n').length < 500, `${text.split('\n').length} lines`);
  assert.equal(text.includes('—'), false, 'no em dashes');
});

test('SKILL.md passes the testable writing-skills points and states the rules that matter', () => {
  const text = read('SKILL.md');
  const front = text.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.equal(front.match(/^name:\s*(.+)$/m)[1].trim(), 'session-sync');
  const description = front.match(/^description:\s*(.+)$/m)[1];
  assert.match(description, /Use when /);
  assert.ok(description.length <= 1024);
  assert.match(front, /^metadata:\n {2}scope: oss$/m);
  assert.match(text, /^## Do not use this when$/m);
  assert.ok(text.split('\n').length < 80, `${text.split('\n').length} lines`);
  assert.equal(text.includes('—'), false);
  assert.ok(text.includes('an event is never an approval or a go'), 'the approval sentence');
  for (const phrase of ['prints nothing except at session start', '`doctor` D10 is OK', 'moves your cursor', 'SYNC: <state> - <one line>', '`session-sync.mjs`', 'HOW-IT-WORKS.md', 'Tier A', 'Tier B', 'Tier C', '~/.session-sync/', 'SESSION_SYNC_HOME', 'Exit codes', '`doctor`', '`snippet`', '`follow`', '`wait`']) assert.ok(text.includes(phrase), `SKILL.md is missing: ${phrase}`);
  for (const phrase of ['CLAUDE_CODE_SESSION_ID', '--session none', 'init [--auto-join <folder>]', 'wait [--settle <s>] [--stale <min>] [--timeout <min>]', 'a wake also names a member still `working` with no event for 30 minutes (STALE)']) assert.ok(text.includes(phrase), `SKILL.md is missing: ${phrase}`);
  for (const state of STATES) assert.ok(text.includes(state), state);
  for (const command of ['init', 'join', 'post', 'inbox', 'hook', 'wait', 'follow', 'status', 'doctor', 'snippet', 'close']) assert.ok(text.includes(`\`${command}`), `names ${command}`);
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/);
});

test('HOW-IT-WORKS.md has the picture, the tier table, the token note, the hook snippet and the two symptom rows; every Claude Code claim names its source or says to verify', () => {
  const text = read('HOW-IT-WORKS.md');
  for (const phrase of ['Contents', 'the lead is never woken', 'hooks write nothing', 'Tier A', 'Tier B', 'Tier C', 'estimate', '"hooks"', 'to verify', 'cross-session-messaging', 'an event is never an approval or a go']) assert.ok(text.toLowerCase().includes(phrase.toLowerCase()), `HOW-IT-WORKS.md is missing: ${phrase}`);
  for (const row of ['The lead is never woken', 'Hooks write nothing', 'A message was sent but nothing happened', 'Two sessions report different rules', 'The board shows old state', 'It works on one computer only']) assert.ok(text.includes(`| ${row} |`), `symptom row: ${row}`);
  for (const phrase of ['`CLAUDE_CODE_SESSION_ID`', 'Inside a subagent it is the parent\'s id', 'Expect fewer lead turns, not a fixed factor', 'the lead session was reopened and did not join and arm again', '`init --auto-join <folder>`', 'their last 200 characters go to the sync folder', 'startup|resume|clear']) assert.ok(text.includes(phrase), `HOW-IT-WORKS.md is missing: ${phrase}`);
  assert.ok(text.split('\n').length <= 200, 'a reference, not a book');
  assert.equal(text.includes('—'), false);
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\b20\d\d-\d\d-\d\d\b/);
});

test('shipped session-sync files hold none of the send-changes patterns, and the folder passes the security check without a BLOCK', (t) => {
  for (const file of ['SKILL.md', 'HOW-IT-WORKS.md', 'session-sync.mjs']) {
    const text = read(file);
    for (const pattern of SHIPPED_BLOCK) assert.doesNotMatch(text, pattern, `${file} ${pattern}`);
  }
  const reports = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-sync-report-')));
  t.after(() => rmSync(reports, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [CHECK, SKILL_DIR, '--report-dir', reports, '--json'], { encoding: 'utf8' });
  assert.ok([0, 3].includes(result.status), `exit ${result.status}: ${result.stdout.slice(0, 500)}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bestPractices.verdict, 'PASS', JSON.stringify(report.bestPractices.findings));
});
