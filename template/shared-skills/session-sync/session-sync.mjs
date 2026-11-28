// session-sync: one lead session, several worker sessions, one folder of small files.
// usage: node session-sync.mjs <init|join|register|post|inbox|ack|hook|wait|follow|status|doctor|snippet|close|ledger-*> [options]   (see SKILL.md)
// Node.js standard library only. No network. No child process unless doctor is given --claude-version (doctor.mjs).
// state.mjs (register, ack, ledger-*, the open list) and doctor.mjs load on demand; this file alone still writes every event.
// Exit codes: 0 done, 2 usage or read error, 3 doctor found a FAIL or ledger-stale found a stale ask, 4 wait or follow reached its timeout.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const STATES = ['working', 'needs-person', 'needs-lead', 'blocked', 'done', 'ended', 'unknown'];
const POST_KINDS = ['report', 'question', 'pointer', 'person-said', 'note', 'resolved'];
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/;
let STATE = null; // state.mjs, when it sits beside this file and the command needs it
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
const tokenOf = (run, me, id) => createHash('sha256').update(`${run}\n${me}\n${id}`).digest('hex').slice(0, 10); // the ack token names the last event a digest showed
const fileHash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const age = (ms) => (ms === null ? '-' : ms < 60_000 ? `${Math.floor(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : ms < 172_800_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    if (['peek', 'json', 'claude-version', 'pin', 'replace'].includes(key)) { out[key] = true; continue; }
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
// Members the lead registered: members/<name>.json, written by the lead only. Read here so the hook needs no other file.
const registered = (run) => { const dir = path.join(runDir(run), 'members'); try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => { const m = readJson(path.join(dir, f)); return m && m.v === 2 && m.reg === 'lead' && m.name === f.slice(0, -5) && NAME.test(m.name) ? [m] : []; }); } catch { return []; } };
const knownNames = (run, meta) => new Set([meta.lead, ...(meta.members ?? []).map((m) => m.name), ...seenAll(run).map((s) => s.name), ...registered(run).map((m) => m.name), 'all']);

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
    const key = f.key === true ? `${f.from}-${id.slice(9, 15)}${id.slice(-4)}` : f.key; // a question or a needs-person event is an open item under its key
    const event = { v: 1, id, at: now.toISOString(), from: f.from, to: f.to, label: cap(f.label, 80), kind: f.kind, state: f.state ?? 'unknown', text: cap(f.text), refs: f.refs ?? [], by: f.by, ...(key ? { key } : {}) };
    try { fs.writeFileSync(path.join(runDir(run), 'events', `${id}.json`), `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' }); return event; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('could not create an event file');
}

// What counts as news for a reader, and how it is shown.
export const wakeWorthy = (e) => ['turn-failed', 'session-end', 'question', 'pointer', 'answer', 'person-said'].includes(e.kind) || (['turn-end', 'report'].includes(e.kind) && e.state !== 'working');
const unread = (events, me, floor, run) => events.filter((e) => e.id > (floor ?? '') && e.from !== me && e.kind !== 'session-start' && (e.to === me || e.to === 'all') && !(e.refs ?? []).some((r) => /^durable:[a-z0-9][a-z0-9._-]{0,39}$/.test(r) && fs.existsSync(path.join(runDir(run), 'durable', 'receipts', `${r.slice(8)}.json`)))); // a durable wake whose receipt exists is handled
function collapse(list) {
  const newest = new Map();
  for (const e of list) if (e.kind === 'turn-end') newest.set(e.from, e.id);
  return list.filter((e) => e.kind !== 'turn-end' || newest.get(e.from) === e.id);
}
const line = (e) => `${hhmm(e.at)} ${e.from.padEnd(10)} ${(['turn-end', 'report'].includes(e.kind) ? e.state : e.kind).padEnd(12)} ${e.label ? `"${e.label}": ` : ''}${e.text}`.trimEnd();
// The lead sees every open item; anyone else sees only the items they raised. The hook never loads state.mjs, so it shows no open list.
const openFor = (run, events, me) => { const all = STATE?.openItems(events) ?? []; return me === readJson(path.join(runDir(run), 'run.json'))?.lead ? all : all.filter((i) => i.by === me); };
const openLines = (open) => [`OPEN (${open.length})`, ...open.map((i) => `  ${i.item.slice(9)} ${age(Date.now() - Date.parse(i.at))} ${i.by}: ${i.text ?? ''}`.trimEnd())];
// A digest never moves a cursor: it ends with `ack: <token>`, and only `ack` moves it. `delivered` is what this wait already printed.
function digest(run, events, me, cursor, delivered = null) {
  const floor = [cursor, delivered].filter(Boolean).sort().at(-1) ?? null;
  const items = collapse(unread(events, me, floor, run));
  if (items.length === 0) return null;
  const shown = items.slice(0, 12);
  const before = events.find((e) => e.id === floor);
  const open = openFor(run, events, me);
  const lines = [...(open.length ? openLines(open) : []), `session-sync run ${run}: ${items.length} new since ${before ? hhmm(before.at) : 'start'}`, ...shown.map(line)];
  if (items.length > 12) lines.push(`+${items.length - 12} more`);
  const pending = delivered ? collapse(unread(events, me, cursor, run)).filter((e) => e.id <= delivered).length : 0;
  if (pending > 0) lines.push(`not yet acked: ${pending}`);
  lines.push(`ack: ${tokenOf(run, me, shown.at(-1).id)}`);
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
  console.log(`run ${run} opened in ${tilde(runDir(run))}\nscript: ${SCRIPT}\nthe lead registers each worker: node "${SCRIPT}" register --me ${lead} --name <name> --dir <folder> --run ${run} (a worker may join instead: node "${SCRIPT}" join --me <name> --run ${run})`);
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
  const keyed = o.kind === 'question' || o.kind === 'resolved' || state === 'needs-person'; // S5: these are open items, open until `resolved`
  if (o.key !== undefined && !(keyed && KEY.test(o.key))) throw usage('--key (1 to 60 letters, digits, dots, hyphens, underscores or colons) is for question, needs-person and resolved');
  const key = o.key !== undefined && o.kind !== 'resolved' && !o.key.includes(':') ? `${me}:${o.key}` : o.key; // A-4: a worker's own key is namespaced, so two workers' q1 stay two questions; resolved names a key as printed
  if (key !== undefined && !KEY.test(key)) throw usage(`--key ${o.key} is too long once your name and a colon are put in front (60 characters at most)`);
  if (o.kind === 'resolved' && (me !== meta.lead || !key || !(o.ref ?? []).length)) throw usage('only the lead posts resolved, with --key and --ref <where the answer is>; resolved records where the answer is, never the answer, an approval or a go');
  if (o.kind === 'resolved' && STATE && !STATE.openItems(loadEvents(run).ok).some((i) => i.item === `question:${key}`)) throw usage(`no open question ${key}`);
  if (!o.text && o.kind !== 'resolved') throw usage('--text is needed');
  if ((o.text ?? '').length > 200) console.error('text cut to 200 characters; put long text in a file and give it with --ref');
  const event = writeEvent(run, { from: me, to, label: o.label ?? mine.label, kind: o.kind, state, text: o.text ?? 'resolved', refs: o.ref ?? [], by: 'session', key: keyed ? (key ?? true) : undefined });
  console.log(`posted ${event.id}${event.key ? ` key=${event.key}` : ''}`);
}

function cmdInbox(o) {
  const run = pickRun(o);
  const me = needMe(o);
  const mine = readJson(seenFile(run, me));
  if (!mine) throw usage(`${me} has not joined run ${run}; run join first`);
  const events = loadEvents(run).ok;
  const result = digest(run, events, me, mine.cursor);
  const open = result ? [] : openFor(run, events, me);
  console.log(result ? result.text : `${open.length ? `${openLines(open).join('\n')}\n` : ''}session-sync run ${run}: no new events`); // printing moves nothing; ack does (--peek is accepted and means the same)
}

function cmdClose(o) {
  const run = pickRun(o);
  if (needMe(o) !== metaOf(run).lead) throw usage('only the lead closes a run');
  fs.writeFileSync(path.join(runDir(run), 'closed.json'), `${JSON.stringify({ v: 1, at: new Date().toISOString(), by: o.me })}\n`);
  writeJson(path.join(syncHome(), 'active.json'), { v: 1, runs: openRuns().filter((r) => r.run !== run) });
  console.log(`run ${run} closed`);
  if (STATE) console.log(openLines(STATE.openItems(loadEvents(run).ok)).join('\n')); // open questions do not die with the run
}

// ---- hook: runs for every session, so it is silent, fast and never fails ---------------------------------------------

function memberFor(run, meta, input) {
  const found = seenAll(run).find((s) => s.session_id === input.session_id);
  if (found) return found;
  const cwd = typeof input.cwd === 'string' && input.cwd ? path.resolve(input.cwd) : null;
  const workers = registered(run).filter((m) => m.role === 'worker');
  const inDir = cwd ? workers.filter((m) => typeof m.dir === 'string' && (cwd === m.dir || cwd.startsWith(m.dir + path.sep))) : [];
  const reg = workers.find((m) => m.session === input.session_id) ?? (inDir.length === 1 ? inDir[0] : null); // by id, else by folder when exactly one member has it
  if (reg) { const seen = readJson(seenFile(run, reg.name)); return seen?.name === reg.name ? seen : { name: reg.name, label: '', cursor: null, reg: true }; } // reg: registered, never joined
  if (!cwd || !(meta.auto ?? []).some((root) => typeof root === 'string' && (cwd === root || cwd.startsWith(root + path.sep)))) return null;
  const name = `${path.basename(cwd).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 30) || 'session'}-${input.session_id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}`;
  if (!NAME.test(name) || fs.existsSync(seenFile(run, name))) return null;
  const record = { v: 1, name, session_id: input.session_id, label: cap(input.session_title ?? path.basename(cwd), 80), kind: 'auto', joined: new Date().toISOString(), cursor: null };
  writeJson(seenFile(run, name), record);
  return record;
}

async function cmdHook() {
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
    writeEvent(run, { from: me.name, to: meta.lead, label: me.label, kind: kinds[0], state, text, by: 'hook', key: state === 'needs-person' ? `${me.name}:hook` : undefined }); // a later one from the same member replaces it
    if (input.hook_event_name === 'SessionStart' && ['startup', 'resume', 'clear'].includes(input.source)) {
      const news = me.reg ? null : digest(run, loadEvents(run).ok, me.name, me.cursor); // a registered worker that never joined cannot ack: it gets no digest. The hook imports no sibling file.
      if (news) process.stdout.write(`${news.text}\n`);
      if (me.name === meta.lead) { const lock = readJson(path.join(runDir(run), 'wait', `${me.name}.json`)); if (!(lock?.pid && alive(lock.pid))) process.stdout.write(`session-sync: you lead run ${run} and no wait is armed. Arm: node "${SCRIPT}" follow --me ${me.name} --settle 60 --run ${run}\n`); }
    }
    return;
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
  const lock = { v: 1, pid: process.pid, started: new Date().toISOString(), delivered: null, stale: old?.stale ?? [] };
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
      const cursor = readJson(seenFile(run, me))?.cursor ?? null;
      const floor = [cursor, lock.delivered].filter(Boolean).sort().at(-1) ?? null;
      if (leads) for (const s of seenAll(run)) {
        const last = events.filter((e) => e.from === s.name).at(-1);
        const quiet = last && last.state === 'working' && Date.now() - Date.parse(last.at) > staleMs;
        if (!quiet) { lock.stale = lock.stale.filter((n) => n !== s.name); continue; }
        if (s.name === me || lock.stale.includes(s.name)) continue;
        console.log(`${hhmm(Date.now())} ${s.name.padEnd(10)} STALE        no event for ${age(Date.now() - Date.parse(last.at))}`);
        lock.stale.push(s.name); writeJson(lockFile, lock);
        if (!forever) { finish(0); return; }
      }
      if (!unread(events, me, floor, run).some(wakeWorthy)) return;
      first ??= { at: Date.now(), timer: null };
      const wait = first.at + settle - Date.now();
      if (wait > 0) { if (!first.timer) first.timer = setTimeout(() => { first.timer = null; scan(); }, wait); return; }
      const news = digest(run, events, me, cursor, lock.delivered);
      clearTimeout(first.timer);
      first = null;
      if (!news) return;
      console.log(news.text);
      lock.delivered = news.cursor;
      writeJson(lockFile, lock); // the cursor stays where it is until `ack`; delivered keeps follow from waking twice for the same events
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
  const regs = registered(run);
  const names = [...new Set([meta.lead, ...(meta.members ?? []).map((m) => m.name), ...seenAll(run).map((s) => s.name), ...regs.map((m) => m.name)])];
  const rows = names.map((name) => {
    const own = events.filter((e) => e.from === name);
    const newest = own.at(-1);
    const news = own.filter((e) => ['turn-end', 'report', 'question'].includes(e.kind)).at(-1);
    const seen = readJson(seenFile(run, name));
    const reg = regs.find((m) => m.name === name);
    const beat = newest ? Date.now() - Date.parse(newest.at) : null;
    const state = newest?.state ?? 'unknown';
    return { name, label: seen?.label ?? '', state, last: news ? Date.now() - Date.parse(news.at) : null, beat, unread: unread(events, name, seen?.cursor, run).length, by: newest?.by ?? 'none', stale: beat !== null && !['done', 'ended'].includes(state) && beat > stale, reg: reg ? 'lead' : null, dir: reg?.dir ?? null, pane: reg?.pane ?? null, item: reg?.item ?? null };
  });
  const who = o.me ?? process.env.SESSION_SYNC_ME; // no name given: the run overview, as the lead sees it
  const open = who && who !== meta.lead ? openFor(run, events, who) : (STATE?.openItems(events) ?? []); // the same fields as a ledger item
  if (o.json) { console.log(JSON.stringify({ run, lead: meta.lead, open: !isClosed(run), open_items: open, members: rows }, null, 2)); return; }
  if (STATE) console.log(openLines(open).join('\n'));
  console.log(`run ${run} lead=${meta.lead} members=${rows.length} ${isClosed(run) ? 'closed' : 'open'}`);
  for (const r of rows) console.log(`${r.name.padEnd(10)} state=${r.state} last=${age(r.last)} beat=${age(r.beat)} unread=${r.unread} by=${r.by}${r.reg ? ` reg=lead${r.dir ? ` dir=${tilde(r.dir)}` : ''}${r.pane ? ` pane=${r.pane}` : ''}` : ''}${r.stale ? ' STALE' : ''}`);
}

// ---- doctor: lives in doctor.mjs (loaded on demand); checkNode stays here for the tests ---------------------------------

export const checkNode = (version) => (Number(String(version).replace(/^v/, '').split('.')[0]) >= 22 ? { status: 'OK', text: `Node.js ${version}` } : { status: 'FAIL', text: `Node.js ${version} is older than 22` });

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

// A copy pinned by `snippet --pin` has a hash file beside it and only that one file is hashed: it loads no sibling module, so a file planted next to it is never run.
const PINNED = fs.existsSync(path.join(path.dirname(SCRIPT), 'session-sync.sha256'));
const MODULES = { 'durable.mjs': () => import('./durable.mjs'), 'state.mjs': () => import('./state.mjs'), 'doctor.mjs': () => import('./doctor.mjs') };
const need = (file, what) => (PINNED ? Promise.reject(Object.assign(new Error(), { code: 'ERR_MODULE_NOT_FOUND' })) : MODULES[file]()).catch((e) => { throw e.code === 'ERR_MODULE_NOT_FOUND' ? usage(`${what} need ${file} next to session-sync.mjs; a pinned single-file copy cannot run them`) : e; });

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'hook') { try { await cmdHook(); } catch { /* a hook never fails */ } return 0; }
  try {
    const o = parseArgs(rest);
    const sync = { init: cmdInit, join: cmdJoin, post: cmdPost, inbox: cmdInbox, close: cmdClose, status: cmdStatus, snippet: cmdSnippet };
    const deps = { fs, path, os, NAME, randomBytes, readJson, syncHome, openRuns, runDir, needName, usage, pickRun, metaOf, needMe, isClosed, cap, writeEvent, loadEvents, knownNames, seenFile, alive, tilde, fileHash, tokenOf, checkNode, registered };
    if (command?.startsWith('durable-')) { const durable = await need('durable.mjs', 'durable commands'); Object.assign(sync, durable.durableCommands({ ...deps, state: (await need('state.mjs', 'durable commands')).stateApi(deps) })); }
    else if (['register', 'ack'].includes(command) || command?.startsWith('ledger-')) Object.assign(sync, (await need('state.mjs', 'register, ack and ledger commands')).stateApi(deps).commands);
    else if (command === 'doctor') Object.assign(sync, (await need('doctor.mjs', 'doctor')).doctorCommands(deps));
    if (['post', 'inbox', 'status', 'close', 'wait', 'follow'].includes(command)) STATE = PINNED ? null : await MODULES['state.mjs']().catch(() => null); // no state.mjs: no open list, everything else works
    if (Object.hasOwn(sync, command)) return (await sync[command](o)) ?? 0;
    if (command === 'wait' || command === 'follow') return await listen(o, command === 'follow');
    throw usage(`usage: session-sync.mjs <init|join|register|post|inbox|ack|hook|wait|follow|status|doctor|snippet|close|ledger-*> [options]; see SKILL.md${command ? `; unknown command ${command}` : ''}`);
  } catch (error) {
    console.error(`session-sync: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL((() => { try { return fs.realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()).href) process.exitCode = await main(process.argv.slice(2));
