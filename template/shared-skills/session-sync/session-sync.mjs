// session-sync: one lead session, several worker sessions, one folder of small files.
// usage: node session-sync.mjs <init|join|post|inbox|hook|wait|follow|status|doctor|snippet|close> [options]   (see SKILL.md)
// Node.js standard library only. No network. No child process unless doctor is given --claude-version.
// Exit codes: 0 done, 2 usage or read error, 3 doctor found a FAIL, 4 wait or follow reached its timeout.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const STATES = ['working', 'needs-person', 'needs-lead', 'blocked', 'done', 'ended', 'unknown'];
const POST_KINDS = ['report', 'question', 'pointer', 'person-said', 'note'];
const SCRIPT = fileURLToPath(import.meta.url);

class Usage extends Error {}
const usage = (message) => new Usage(message);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file); };
const cap = (text, size = 200) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, size);
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('.', '');
const tilde = (p) => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length).split(path.sep).join('/')}` : p);
const syncHome = () => path.resolve(process.env.SESSION_SYNC_HOME || path.join(os.homedir(), '.session-sync'));
const runDir = (run) => path.join(syncHome(), run);
const fileHash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const age = (ms) => (ms === null ? '-' : ms < 60_000 ? `${Math.floor(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : ms < 172_800_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    if (['peek', 'json', 'claude-version', 'pin'].includes(key)) { out[key] = true; continue; }
    if (argv[i + 1] === undefined) throw usage(`--${key} needs a value`);
    i += 1;
    if (['member', 'ref'].includes(key)) (out[key] ??= []).push(argv[i]); else out[key] = argv[i];
  }
  return out;
}

const needName = (value, what) => { if (!NAME.test(value ?? '')) throw usage(`${what} must be 1 to 40 letters, digits, dots, hyphens or underscores`); return value; };
const openRuns = () => (readJson(path.join(syncHome(), 'active.json'))?.runs ?? []).filter((entry) => NAME.test(entry?.run ?? ''));
function pickRun(o) {
  const id = o.run ?? process.env.SESSION_SYNC_RUN;
  if (id) return needName(id, 'the run id');
  const runs = openRuns();
  if (runs.length === 1) return runs[0].run;
  throw usage(runs.length ? `several runs are open (${runs.map((r) => r.run).join(', ')}); add --run <id>` : 'no run is open; run init first');
}
const needMe = (o) => needName(o.me ?? process.env.SESSION_SYNC_ME, '--me');
const metaOf = (run) => { const meta = readJson(path.join(runDir(run), 'run.json')); if (!meta) throw usage(`run ${run} has no run.json`); return meta; };
const seenFile = (run, name) => path.join(runDir(run), 'seen', `${name}.json`);
const seenAll = (run) => { try { return fs.readdirSync(path.join(runDir(run), 'seen')).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(path.join(runDir(run), 'seen', f))).filter((s) => s && NAME.test(s.name ?? '')); } catch { return []; } };
const isClosed = (run) => fs.existsSync(path.join(runDir(run), 'closed.json'));
const knownNames = (run, meta) => new Set([meta.lead, ...(meta.members ?? []).map((m) => m.name), ...seenAll(run).map((s) => s.name), 'all']);

function loadEvents(run) {
  const dir = path.join(runDir(run), 'events');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no events yet */ }
  const ok = [];
  const bad = [];
  for (const file of files) {
    const e = readJson(path.join(dir, file));
    if (e && e.v === 1 && e.id === file.slice(0, -5) && ['from', 'to', 'kind', 'at'].every((k) => typeof e[k] === 'string')) ok.push(e); else bad.push(file);
  }
  return { ok, bad };
}

function writeEvent(run, f) {
  if (!NAME.test(f.from ?? '')) throw usage('a session name is 1 to 40 letters, digits, dots, hyphens or underscores');
  for (let i = 0; i < 5; i += 1) {
    const now = new Date();
    const id = `${stamp(now)}-${f.from}-${randomBytes(2).toString('hex')}`;
    const event = { v: 1, id, at: now.toISOString(), from: f.from, to: f.to, label: cap(f.label, 80), kind: f.kind, state: f.state ?? 'unknown', text: cap(f.text), refs: f.refs ?? [], by: f.by };
    try { fs.writeFileSync(path.join(runDir(run), 'events', `${id}.json`), `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' }); return event; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('could not create an event file');
}

// What counts as news for a reader, and how it is shown.
export const wakeWorthy = (e) => ['turn-failed', 'session-end', 'question', 'pointer', 'person-said'].includes(e.kind) || (['turn-end', 'report'].includes(e.kind) && e.state !== 'working');
const unread = (events, me, floor) => events.filter((e) => e.id > (floor ?? '') && e.from !== me && e.kind !== 'session-start' && (e.to === me || e.to === 'all'));
function collapse(list) {
  const newest = new Map();
  for (const e of list) if (e.kind === 'turn-end') newest.set(e.from, e.id);
  return list.filter((e) => e.kind !== 'turn-end' || newest.get(e.from) === e.id);
}
const line = (e) => `${hhmm(e.at)} ${e.from.padEnd(10)} ${(['turn-end', 'report'].includes(e.kind) ? e.state : e.kind).padEnd(12)} ${e.label ? `"${e.label}": ` : ''}${e.text}`.trimEnd();
function digest(run, events, me, floor) {
  const items = collapse(unread(events, me, floor));
  if (items.length === 0) return null;
  const shown = items.slice(0, 12);
  const before = events.find((e) => e.id === floor);
  const lines = [`session-sync run ${run}: ${items.length} new since ${before ? hhmm(before.at) : 'start'}`, ...shown.map(line)];
  if (items.length > 12) lines.push(`+${items.length - 12} more`);
  return { text: lines.join('\n'), cursor: shown.at(-1).id };
}

export function parseSync(message) {
  if (typeof message !== 'string') return null;
  let hit = null;
  for (const text of message.split(/\r?\n/)) {
    const m = text.match(/^[\s>*`_]*SYNC:\s*([a-z-]+)\s+[-\u2013\u2014]\s+(.*?)[\s*`_]*$/);
    if (m && STATES.includes(m[1])) hit = { state: m[1], text: m[2] };
  }
  return hit;
}

// ---- commands that write ----------------------------------------------------------------------------------------

function cmdInit(o) {
  const lead = needName(o.lead, '--lead');
  const run = needName(o.run ?? `R${stamp(new Date()).slice(0, 15)}`, 'the run id');
  if (fs.existsSync(runDir(run))) throw usage(`run ${run} already exists`);
  const members = (o.member ?? []).map((spec) => { const [name, label = '', kind = ''] = spec.split(':'); return { name: needName(name, 'a member name'), session_id: null, label, kind }; });
  for (const sub of ['events', 'seen', 'wait']) fs.mkdirSync(path.join(runDir(run), sub), { recursive: true });
  const started = new Date().toISOString();
  writeJson(path.join(runDir(run), 'run.json'), { v: 1, run, started, lead, members, auto: o['auto-join'] ? [path.resolve(o['auto-join'])] : [] });
  writeJson(seenFile(run, lead), { v: 1, name: lead, session_id: o.session === 'none' ? null : (o.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? null), label: 'lead', kind: 'lead', joined: started, cursor: null });
  const file = path.join(syncHome(), 'active.json');
  writeJson(file, { v: 1, runs: [...openRuns().filter((r) => r.run !== run), { run, started }] });
  console.log(`run ${run} opened in ${tilde(runDir(run))}\nscript: ${SCRIPT}\nworkers join with: node "${SCRIPT}" join --me <name> --run ${run}`);
}

function cmdJoin(o) {
  const run = pickRun(o);
  const me = needMe(o);
  const planned = metaOf(run).members?.find((m) => m.name === me);
  const old = readJson(seenFile(run, me));
  const record = { v: 1, name: me, session_id: o.session === 'none' ? null : (o.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? old?.session_id ?? null), label: o.label ?? old?.label ?? planned?.label ?? '', kind: o.kind ?? old?.kind ?? planned?.kind ?? '', joined: old?.joined ?? new Date().toISOString(), cursor: old?.cursor ?? null };
  const clash = record.session_id && seenAll(run).find((s) => s.session_id === record.session_id && s.name !== me);
  if (clash?.kind === 'auto') fs.rmSync(seenFile(run, clash.name), { force: true });
  else if (clash) throw usage(`this session is already ${clash.name} in run ${run}; a subagent shares its parent's id: join with --session none and report with post`);
  writeJson(seenFile(run, me), record);
  console.log(`${me} joined run ${run}${record.session_id ? '' : '; no session id yet, so hooks cannot report for it (add --session <id> when you know it)'}`);
}

function cmdPost(o) {
  const run = pickRun(o);
  const me = needMe(o);
  const meta = metaOf(run);
  const mine = readJson(seenFile(run, me));
  if (!mine) throw usage(`${me} has not joined run ${run}; run join first`);
  if (!POST_KINDS.includes(o.kind)) throw usage(`--kind is one of ${POST_KINDS.join(', ')}`);
  const state = o.state ?? 'unknown';
  if (!STATES.includes(state)) throw usage(`--state is one of ${STATES.join(', ')}`);
  const to = o.to ?? meta.lead;
  if (!knownNames(run, meta).has(to)) throw usage(`${to} is not a member of run ${run}`);
  if (!o.text) throw usage('--text is needed');
  if (o.text.length > 200) console.error('text cut to 200 characters; put long text in a file and give it with --ref');
  const event = writeEvent(run, { from: me, to, label: o.label ?? mine.label, kind: o.kind, state, text: o.text, refs: o.ref ?? [], by: 'session' });
  console.log(`posted ${event.id}`);
}

function cmdInbox(o) {
  const run = pickRun(o);
  const me = needMe(o);
  const mine = readJson(seenFile(run, me));
  if (!mine) throw usage(`${me} has not joined run ${run}; run join first`);
  const result = digest(run, loadEvents(run).ok, me, mine.cursor);
  if (!result) { console.log(`session-sync run ${run}: no new events`); return; }
  console.log(result.text);
  if (!o.peek) writeJson(seenFile(run, me), { ...mine, cursor: result.cursor });
}

function cmdClose(o) {
  const run = pickRun(o);
  if (needMe(o) !== metaOf(run).lead) throw usage('only the lead closes a run');
  fs.writeFileSync(path.join(runDir(run), 'closed.json'), `${JSON.stringify({ v: 1, at: new Date().toISOString(), by: o.me })}\n`);
  writeJson(path.join(syncHome(), 'active.json'), { v: 1, runs: openRuns().filter((r) => r.run !== run) });
  console.log(`run ${run} closed`);
}

// ---- hook: runs for every session, so it is silent, fast and never fails ---------------------------------------------

function memberFor(run, meta, input) {
  const found = seenAll(run).find((s) => s.session_id === input.session_id);
  if (found) return found;
  const cwd = typeof input.cwd === 'string' && input.cwd ? path.resolve(input.cwd) : null;
  if (!cwd || !(meta.auto ?? []).some((root) => typeof root === 'string' && (cwd === root || cwd.startsWith(root + path.sep)))) return null;
  const name = `${path.basename(cwd).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 30) || 'session'}-${input.session_id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}`;
  if (!NAME.test(name) || fs.existsSync(seenFile(run, name))) return null;
  const record = { v: 1, name, session_id: input.session_id, label: cap(input.session_title ?? path.basename(cwd), 80), kind: 'auto', joined: new Date().toISOString(), cursor: null };
  writeJson(seenFile(run, name), record);
  return record;
}

function cmdHook() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (!input || typeof input.session_id !== 'string' || typeof input.hook_event_name !== 'string') return;
  const runs = openRuns();
  if (runs.length === 0) return;
  const kinds = { Stop: ['turn-end'], StopFailure: ['turn-failed', 'blocked'], SessionEnd: ['session-end', 'ended'], SessionStart: ['session-start', 'working'] }[input.hook_event_name];
  if (!kinds) return;
  for (const { run } of runs) {
    const meta = readJson(path.join(runDir(run), 'run.json'));
    const me = meta && NAME.test(meta.lead ?? '') && memberFor(run, meta, input);
    if (!me) continue;
    let state = kinds[1];
    let text = '';
    if (input.hook_event_name === 'Stop') {
      const sync = parseSync(input.last_assistant_message);
      state = sync?.state ?? (Array.isArray(input.background_tasks) && input.background_tasks.length > 0 ? 'working' : 'unknown');
      text = sync?.text ?? cap(input.last_assistant_message);
    } else if (input.hook_event_name === 'StopFailure') text = `${cap(input.error, 40) || 'unknown'} (session still open)`;
    else if (input.hook_event_name === 'SessionEnd') text = cap(input.reason, 60) || 'other';
    else text = cap(input.source, 20);
    writeEvent(run, { from: me.name, to: meta.lead, label: me.label, kind: kinds[0], state, text, by: 'hook' });
    if (input.hook_event_name === 'SessionStart' && ['startup', 'resume', 'clear'].includes(input.source)) {
      const news = digest(run, loadEvents(run).ok, me.name, me.cursor);
      if (news) process.stdout.write(`${news.text}\n`);
      if (me.name === meta.lead) { const lock = readJson(path.join(runDir(run), 'wait', `${me.name}.json`)); if (!(lock?.pid && alive(lock.pid))) process.stdout.write(`session-sync: you lead run ${run} and no wait is armed. Arm: node "${SCRIPT}" follow --me ${me.name} --settle 60 --run ${run}\n`); }
    }
    return;
  }
  if (input.hook_event_name === 'SessionStart' && ['startup', 'resume', 'clear'].includes(input.source)) {
    process.stdout.write(`session-sync: run ${runs[0].run} is open${runs.length > 1 ? ` (and ${runs.length - 1} more)` : ''}. This session's id: ${input.session_id}. Only if the lead asked you to join: node "${SCRIPT}" join --me <name> --run ${runs[0].run}\n`);
  }
}

// ---- wait and follow: block with no model call until there is news ---------------------------------------------------

function listen(o, forever) {
  const run = pickRun(o);
  const me = needMe(o);
  const lockFile = path.join(runDir(run), 'wait', `${me}.json`);
  const old = readJson(lockFile);
  if (old?.pid && old.pid !== process.pid && alive(old.pid)) throw usage(`a wait is already armed for ${me} (process ${old.pid})`);
  const settle = Number(o.settle ?? 10) * 1000;
  const interval = Math.max(200, Number(o.interval ?? 15) * 1000);
  const deadline = o.timeout ? Date.now() + Number(o.timeout) * 60_000 : Infinity;
  if (![settle, interval, deadline].every((n) => n >= 0)) throw usage('--settle, --interval and --timeout are numbers');
  const staleMs = Number(o.stale ?? 30) * 60_000;
  const leads = metaOf(run).lead === me;
  const lock = { v: 1, pid: process.pid, started: new Date().toISOString(), delivered: old?.delivered ?? null, stale: old?.stale ?? [] };
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  writeJson(lockFile, lock);
  return new Promise((resolve) => {
    let first = null;
    let watcher = null;
    let timer = null; let deadlineTimer = null;
    const finish = (code) => {
      clearInterval(timer); clearTimeout(deadlineTimer);
      clearTimeout(first?.timer);
      try { watcher?.close(); } catch { /* already closed */ }
      try { writeJson(lockFile, { ...lock, pid: null }); } catch { /* run folder gone */ }
      resolve(code);
    };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => finish(0));
    const scan = () => {
      if (isClosed(run)) { console.log(`session-sync run ${run}: closed`); finish(0); return; }
      if (Date.now() >= deadline) { finish(4); return; }
      const events = loadEvents(run).ok;
      const floor = [readJson(seenFile(run, me))?.cursor, lock.delivered].filter(Boolean).sort().at(-1) ?? null;
      if (leads) for (const s of seenAll(run)) {
        const last = events.filter((e) => e.from === s.name).at(-1);
        const quiet = last && last.state === 'working' && Date.now() - Date.parse(last.at) > staleMs;
        if (!quiet) { lock.stale = lock.stale.filter((n) => n !== s.name); continue; }
        if (s.name === me || lock.stale.includes(s.name)) continue;
        console.log(`${hhmm(Date.now())} ${s.name.padEnd(10)} STALE        no event for ${age(Date.now() - Date.parse(last.at))}`);
        lock.stale.push(s.name); writeJson(lockFile, lock);
        if (!forever) { finish(0); return; }
      }
      if (!unread(events, me, floor).some(wakeWorthy)) return;
      first ??= { at: Date.now(), timer: null };
      const wait = first.at + settle - Date.now();
      if (wait > 0) { if (!first.timer) first.timer = setTimeout(() => { first.timer = null; scan(); }, wait); return; }
      const news = digest(run, events, me, floor);
      clearTimeout(first.timer);
      first = null;
      if (!news) return;
      console.log(news.text);
      lock.delivered = news.cursor;
      writeJson(lockFile, lock);
      const mine = readJson(seenFile(run, me));
      if (mine) writeJson(seenFile(run, me), { ...mine, cursor: news.cursor });
      if (!forever) finish(0);
    };
    try { watcher = fs.watch(path.join(runDir(run), 'events'), () => scan()); watcher.on('error', () => { try { watcher?.close(); } catch { /* already closed */ } watcher = null; }); } catch { /* the slow check below still runs */ }
    timer = setInterval(scan, interval);
    if (Number.isFinite(deadline)) { deadlineTimer = setTimeout(scan, Math.max(0, deadline - Date.now() + 5)); deadlineTimer.unref(); }
    scan();
  });
}

// ---- status ---------------------------------------------------------------------------------------------------------

function cmdStatus(o) {
  const run = pickRun(o);
  const meta = metaOf(run);
  const events = loadEvents(run).ok;
  const stale = Number(o.stale ?? 30) * 60_000;
  const names = [...new Set([meta.lead, ...(meta.members ?? []).map((m) => m.name), ...seenAll(run).map((s) => s.name)])];
  const rows = names.map((name) => {
    const own = events.filter((e) => e.from === name);
    const newest = own.at(-1);
    const news = own.filter((e) => ['turn-end', 'report', 'question'].includes(e.kind)).at(-1);
    const seen = readJson(seenFile(run, name));
    const beat = newest ? Date.now() - Date.parse(newest.at) : null;
    const state = newest?.state ?? 'unknown';
    return { name, label: seen?.label ?? '', state, last: news ? Date.now() - Date.parse(news.at) : null, beat, unread: unread(events, name, seen?.cursor).length, by: newest?.by ?? 'none', stale: beat !== null && !['done', 'ended'].includes(state) && beat > stale };
  });
  if (o.json) { console.log(JSON.stringify({ run, lead: meta.lead, open: !isClosed(run), members: rows }, null, 2)); return; }
  console.log(`run ${run} lead=${meta.lead} members=${rows.length} ${isClosed(run) ? 'closed' : 'open'}`);
  for (const r of rows) console.log(`${r.name.padEnd(10)} state=${r.state} last=${age(r.last)} beat=${age(r.beat)} unread=${r.unread} by=${r.by}${r.stale ? ' STALE' : ''}`);
}

// ---- doctor: reads only; prints names, counts and ages, never event text -------------------------------------------

export const checkNode = (version) => (Number(String(version).replace(/^v/, '').split('.')[0]) >= 22 ? { status: 'OK', text: `Node.js ${version}` } : { status: 'FAIL', text: `Node.js ${version} is older than 22` });
const rank = { OK: 0, SKIP: 0, WARN: 1, FAIL: 2 };

async function checkVersion() {
  const { execFileSync } = await import('node:child_process');
  try {
    const found = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 }).match(/(\d+)\.(\d+)\.(\d+)/);
    if (!found) return { status: 'WARN', text: 'the claude version could not be read' };
    const [a, b, c] = found.slice(1).map(Number);
    const ok = a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 224)));
    return { status: ok ? 'OK' : 'WARN', text: `claude ${found[0]}${ok ? '' : ': cross-session messages need 2.1.224 or later'}` };
  } catch { return { status: 'WARN', text: 'the claude command was not found or did not answer' }; }
}

function settingsFiles(workspace) {
  return [path.join(os.homedir(), '.claude', 'settings.json'), path.join(workspace, '.claude', 'settings.json'), path.join(workspace, '.claude', 'settings.local.json')].map((file) => ({ file, data: readJson(file) })).filter((s) => s.data && typeof s.data === 'object');
}
const hookCommands = (data) => Object.values(data.hooks ?? {}).flat().flatMap((group) => group?.hooks ?? []).map((h) => h?.command).filter((c) => typeof c === 'string');
const listFiles = (dir, depth = 3) => { try { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth > 0 && e.name !== 'skills' ? listFiles(path.join(dir, e.name), depth - 1) : []) : [path.join(dir, e.name)])); } catch { return []; } };

async function cmdDoctor(o) {
  if (o.dir) process.env.SESSION_SYNC_HOME = o.dir;
  const workspace = path.resolve(o.workspace ?? process.cwd());
  const settings = settingsFiles(workspace);
  const checks = [];
  const add = (id, status, text, row = '') => checks.push({ id, status, text, row });
  const home = syncHome();
  const runs = o.run ? [{ run: needName(o.run, 'the run id') }] : openRuns();

  if (o['claude-version']) { const v = await checkVersion(); add('D1', v.status, `version: ${v.text}`, 'It works on one computer only'); } else add('D1', 'SKIP', 'version: not checked (add --claude-version)');

  const notes = [];
  for (const { data } of settings) {
    if (['refuse', 'hold'].includes(data.crossSessionInbound)) notes.push(`crossSessionInbound=${data.crossSessionInbound}`);
    if ((data.permissions?.deny ?? []).some((rule) => /^(SendMessage|ListAgents)\b/.test(rule))) notes.push('a deny rule on SendMessage or ListAgents');
    if (data.permissions?.defaultMode === 'bypassPermissions') notes.push('a bypass default mode');
    if ('dialogExpiry' in data) notes.push('dialogExpiry is set');
  }
  add('D2', notes.length ? 'WARN' : 'OK', notes.length ? `settings: ${[...new Set(notes)].join('; ')}` : `settings: ${settings.length} file(s) read, nothing blocks live messages`, 'A message was sent but nothing happened');

  const node = checkNode(process.version);
  add('D3', node.status, `environment: ${node.text}`, 'It works on one computer only');

  const missing = [];
  let commands = 0;
  let runsHook = 0;
  for (const { data } of settings) {
    for (const command of hookCommands(data)) {
      commands += 1;
      if (/session-sync\.mjs["']?\s+hook\b/.test(command)) runsHook += 1;
      for (const m of command.matchAll(/"([^"]+\.(?:mjs|cjs|js|sh|py))"|(\S+\.(?:mjs|cjs|js|sh|py))/g)) {
        const named = (m[1] ?? m[2]).replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, workspace);
        const raw = named.startsWith('~/') ? path.join(os.homedir(), named.slice(2)) : named;
        if (!fs.existsSync(path.resolve(workspace, raw))) missing.push(path.basename(raw));
      }
    }
  }
  // No hook command at all, or hook commands of which none runs `session-sync.mjs hook`, is the state of a computer where the snippet was never applied.
  const noSyncHook = commands > 0 && missing.length === 0 && runsHook === 0;
  add('D4', commands === 0 ? 'WARN' : missing.length ? 'FAIL' : noSyncHook ? 'WARN' : 'OK', commands === 0 ? 'hooks: no hook command in the settings files. Apply the hook entries from `snippet`, or use tier B: `post` at the end of every turn' : missing.length ? `hooks: script path missing on this computer for ${[...new Set(missing)].join(', ')}` : noSyncHook ? `hooks: ${commands} hook command(s) exist, but none runs session-sync.mjs hook. Apply the hook entries from \`snippet\`, or use tier B: \`post\` at the end of every turn` : `hooks: ${commands} hook command(s), every script path exists, ${runsHook} run session-sync.mjs hook`, missing.length ? 'It works on one computer only' : 'Hooks write nothing');

  const lacking = [];
  for (const file of ['.claude/commands', '.claude/agents', '.claude/start-manager', '.agents'].flatMap((dir) => listFiles(path.join(workspace, dir)))) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/report(?:s|ed)? back|report to (?:the )?(?:lead|master|manager)/i.test(text) && !/session-sync|lead-session/.test(text)) lacking.push(path.basename(file));
  }
  add('D5', lacking.length ? 'WARN' : 'OK', lacking.length ? `instructions: ${lacking.join(', ')} tell a session to report but do not name session-sync` : 'instructions: every command, brief and role file that asks for a report names session-sync', 'Two sessions report different rules');

  const boards = new Map();
  for (const file of listFiles(path.join(workspace, '01-Projects'), 3)) {
    if (path.basename(path.dirname(file)) === 'factory' && /^board(?: \d+| \(.*\))?\.(?:md|json)$/.test(path.basename(file))) boards.set(file.split(path.sep).at(-3), (boards.get(file.split(path.sep).at(-3)) ?? 0) + 1);
  }
  const doubled = [...boards].filter(([, n]) => n > 1).map(([project]) => project);
  add('D6', boards.size === 0 ? 'SKIP' : doubled.length ? 'FAIL' : 'OK', boards.size === 0 ? 'boards: none found' : doubled.length ? `boards: more than one board file in ${doubled.join(', ')} (a twin or conflicted copy)` : `boards: ${boards.size} project(s), one board file each`, 'The board shows old state');

  const problems = [];
  const warnings = [];
  const summary = [];
  const now = Date.now();
  for (const { run } of runs) {
    const meta = readJson(path.join(runDir(run), 'run.json'));
    if (!meta || !NAME.test(meta.lead ?? '')) { problems.push(`${run}: run.json missing or invalid`); continue; }
    const { ok, bad } = loadEvents(run);
    const names = knownNames(run, meta);
    if (bad.length) problems.push(`${run}: ${bad.length} event file(s) do not parse or do not match their name`);
    const unknown = ok.filter((e) => !names.has(e.to));
    if (unknown.length) problems.push(`${run}: ${unknown.length} event(s) addressed to a name that is not in the run`);
    const future = ok.filter((e) => Date.parse(e.at) > now + 120_000);
    if (future.length) problems.push(`${run}: ${future.length} event(s) dated more than 2 minutes ahead`);
    const unjoined = (meta.members ?? []).filter((m) => !fs.existsSync(seenFile(run, m.name))).map((m) => m.name);
    if (unjoined.length) warnings.push(`${run}: ${unjoined.join(', ')} listed but never joined`);
    summary.push(`${run}: ${ok.length} events`);
  }
  add('D7', runs.length === 0 ? 'SKIP' : problems.length ? 'FAIL' : warnings.length ? 'WARN' : 'OK', runs.length === 0 ? 'sync folder: no run is open' : `sync folder: ${[...problems, ...warnings, ...(problems.length + warnings.length ? [] : summary)].join('; ')}`, 'The lead never hears from a worker');

  let writable = true;
  let probe = home;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try { fs.accessSync(probe, fs.constants.R_OK | fs.constants.W_OK); } catch { writable = false; }
  const cloud = /Dropbox|iCloud|Mobile Documents|OneDrive|Google ?Drive|CloudStorage/i.test(home);
  const shown = (p) => (p === os.homedir() ? '~' : tilde(p));
  add('D8', !writable ? 'FAIL' : cloud ? 'WARN' : 'OK', `access: ${probe === home ? shown(home) : `${shown(home)} does not exist yet; ${shown(probe)}`} is ${writable ? 'readable and writable' : 'not writable by this user'}${cloud ? ' but looks cloud-synced, which makes conflict copies' : ''}`, 'The board shows old state');

  const quiet = [];
  for (const { run } of runs) {
    const meta = readJson(path.join(runDir(run), 'run.json'));
    if (!meta) continue;
    const hooked = new Set(loadEvents(run).ok.filter((e) => e.by === 'hook').map((e) => e.from));
    for (const name of new Set([meta.lead, ...(meta.members ?? []).map((m) => m.name)])) if (!hooked.has(name)) quiet.push(`${run}/${name}`);
  }
  const installed = settings.some(({ data }) => hookCommands(data).some((c) => c.includes('session-sync')));
  add('D9', runs.length === 0 ? 'SKIP' : quiet.length || !installed ? 'WARN' : 'OK', runs.length === 0 ? 'hooks per member: no run is open' : `hooks per member: ${installed ? 'a session-sync hook is in the settings files' : 'no session-sync hook in the settings files'}${quiet.length ? `; no hook event yet from ${quiet.join(', ')}` : ''}`, 'Hooks write nothing');

  const unarmed = runs.filter(({ run }) => { const lock = readJson(path.join(runDir(run), 'wait', `${readJson(path.join(runDir(run), 'run.json'))?.lead}.json`)); return !(lock?.pid && alive(lock.pid)); }).map((r) => r.run);
  add('D10', runs.length === 0 ? 'SKIP' : unarmed.length ? 'WARN' : 'OK', runs.length === 0 ? 'wake: no run is open' : unarmed.length ? `wake: no wait or follow is armed for the lead of ${unarmed.join(', ')}` : 'wake: a wait or follow is armed for every lead', 'The lead is never woken');

  const listed = new Set(openRuns().map((r) => r.run));
  const folders = (() => { try { return fs.readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(home, e.name, 'run.json'))).map((e) => e.name); } catch { return null; } })();
  const orphan = [...listed].filter((r) => !folders?.includes(r));
  const idle = [...listed].filter((r) => folders?.includes(r)).filter((r) => { const newest = loadEvents(r).ok.at(-1)?.at ?? readJson(path.join(runDir(r), 'run.json'))?.started; return newest && now - Date.parse(newest) > 86_400_000; });
  const forgotten = (folders ?? []).filter((r) => !listed.has(r) && !isClosed(r));
  add('D11', folders === null ? 'SKIP' : orphan.length ? 'FAIL' : forgotten.length || idle.length ? 'WARN' : 'OK', folders === null ? 'active list: no sync folder yet' : orphan.length ? `active list: ${orphan.join(', ')} listed but its folder is missing` : forgotten.length ? `active list: ${forgotten.join(', ')} not closed and not listed` : idle.length ? `active list: ${idle.join(', ')} open with no event for over 24 hours; close it, and run status for stale members` : `active list: ${listed.size} open run(s) match their folders`, 'The board shows old state');

  const hookScripts = new Set();
  for (const { data } of settings) for (const command of hookCommands(data)) {
    const m = command.match(/"([^"]*session-sync\.mjs)"\s+hook\b|(\S*session-sync\.mjs)\s+hook\b/);
    if (m) { const named = (m[1] ?? m[2]).replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, workspace); hookScripts.add(path.resolve(workspace, named.startsWith('~/') ? path.join(os.homedir(), named.slice(2)) : named)); }
  }
  const trust = [];
  for (const script of hookScripts) {
    const inside = path.relative(workspace, script);
    const skillCopy = ['.claude', '.agents'].map((c) => path.join(workspace, c, 'skills', 'session-sync', 'session-sync.mjs')).find((p) => fs.existsSync(p));
    const recorded = (() => { try { return fs.readFileSync(path.join(path.dirname(script), 'session-sync.sha256'), 'utf8').trim(); } catch { return null; } })();
    if (!fs.existsSync(script)) continue;
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) trust.push(`${tilde(script)} is inside the workspace, where agents can edit it; run \`snippet --pin\` and apply the new hooks`);
    else if (recorded && recorded !== fileHash(script)) trust.push(`${tilde(script)} changed since it was pinned; read it, then run \`snippet --pin\` again`);
    else if (skillCopy && skillCopy !== script && fileHash(skillCopy) !== fileHash(script)) trust.push(`${tilde(script)} differs from the skill copy in the workspace; read the change, then run \`snippet --pin\` again`);
  }
  add('D12', hookScripts.size === 0 ? 'SKIP' : trust.length ? 'WARN' : 'OK', hookScripts.size === 0 ? 'hook script: no session-sync hook in the settings files' : trust.length ? `hook script: ${trust.join('; ')}` : `hook script: ${hookScripts.size} script(s) outside the workspace, matching the skill copy`);

  const fail = checks.some((c) => c.status === 'FAIL');
  if (o.json) console.log(JSON.stringify({ verdict: fail ? 'FAIL' : checks.some((c) => rank[c.status] === 1) ? 'WARN' : 'OK', checks }, null, 2));
  else for (const c of checks) console.log(`${c.status} ${c.id} ${c.text}${c.row && c.status !== 'OK' && c.status !== 'SKIP' ? `  [HOW-IT-WORKS: "${c.row}"]` : ''}`);
  return fail ? 3 : 0;
}

// `--pin` copies this script to a folder agents do not write, records its hash and points every hook at the copy, so a
// changed script inside the workspace does not run in every later session. Writes only under the sync home.
function cmdSnippet(o) {
  let script = SCRIPT;
  if (o.pin) {
    const dir = path.join(syncHome(), 'bin');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    script = path.join(dir, 'session-sync.mjs');
    if (script !== SCRIPT) fs.copyFileSync(SCRIPT, script);
    fs.writeFileSync(path.join(dir, 'session-sync.sha256'), `${fileHash(script)}\n`);
    console.error(`pinned ${tilde(script)}\nsha256 ${fileHash(script)}\nCompare it with the skill copy before you apply the hooks. After a skill update, read the change, then run snippet --pin again.`);
  }
  const entry = (extra) => [{ hooks: [{ type: 'command', ...extra, command: `node "${script}" hook` }] }];
  const start = entry({ timeout: 5 });
  start[0].matcher = 'startup|resume|clear';
  console.log(JSON.stringify({ hooks: { Stop: entry({ async: true }), StopFailure: entry({ async: true }), SessionEnd: entry({ timeout: 5 }), SessionStart: start } }, null, 2));
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'hook') { try { cmdHook(); } catch { /* a hook never fails */ } return 0; }
  try {
    const o = parseArgs(rest);
    const sync = { init: cmdInit, join: cmdJoin, post: cmdPost, inbox: cmdInbox, close: cmdClose, status: cmdStatus, snippet: cmdSnippet };
    if (sync[command]) { sync[command](o); return 0; }
    if (command === 'doctor') return await cmdDoctor(o);
    if (command === 'wait' || command === 'follow') return await listen(o, command === 'follow');
    throw usage(`usage: session-sync.mjs <init|join|post|inbox|hook|wait|follow|status|doctor|snippet|close> [options]; see SKILL.md${command ? `; unknown command ${command}` : ''}`);
  } catch (error) {
    console.error(`session-sync: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL((() => { try { return fs.realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()).href) process.exitCode = await main(process.argv.slice(2));
