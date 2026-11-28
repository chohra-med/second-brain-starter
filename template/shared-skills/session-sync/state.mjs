// state.mjs: the one state model of session-sync. One record shape (a fact), one fold, three uses: the open list of a run
// (questions), the member record the lead writes (register), and the task ledger of a project (ledger-*).
// Loaded on demand by session-sync.mjs (a dynamic import, never a static one), so a pinned single-file hook copy keeps working without it.
// Node.js standard library only. No network, no child process. A fact, a registration, an ack and a resolved line are data: never an approval or a go. Nothing here reads state to allow a push, a pull request, a merge or a tracker write.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_STATES = ['open', 'working', 'needs-person', 'blocked', 'review', 'pushed', 'merged', 'done', 'resolved', 'dropped', 'unknown'];
// FINAL: an item in one of these has ended. MOOT: for each thing a page can ask, the states that make the ask pointless; an ask not listed
// is moot in any final state. A pushed branch still needs review; a merged one does not. The stamp script and the factory board read the same rule.
export const FINAL = ['merged', 'done', 'resolved', 'dropped'];
export const MOOT = { push: ['pushed', ...FINAL], review: ['merged', 'done', 'dropped'], pushed: ['merged', 'done', 'dropped'], merged: ['dropped'], done: ['dropped'] };
export const isStale = (claim, state) => claim !== state && (Object.hasOwn(MOOT, claim) ? MOOT[claim] : FINAL).includes(state);
const RANK = { open: 0, working: 1, 'needs-person': 1, blocked: 1, review: 2, pushed: 3, merged: 4, done: 5, resolved: 6, dropped: 7 }; // the weight of a state: a held item moves only to a state of equal or higher weight
const GATED = ['pushed', 'merged', 'done']; // these count only from git (evidence and check time) or person (words and where typed)
const AUTH = ['person', 'lead']; // dropped and resolved on a task count only from these; a session's drop or resolve is a note
export const SOURCES = ['person', 'git', 'session', 'lead'];
const ITEM = /^[a-z]+:[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const LOWER = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const GEN = /^[a-f0-9]{32}$/;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('.', '');
const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const clean = (text, size = 200) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, size);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const atomic = (file, value) => { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file); };

const keepForeign = (file, ours) => { let ok = false; try { ok = ours(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; if (e.code && e.code !== 'EISDIR') throw e; } if (!ok) throw new Error(`${file} is not a ledger fold; it is kept as it is. Give the ledger its own folder, or move that file away yourself`); }; // the fold owns state.json and state.js: a file of either name that it did not write is somebody's own record
// Create-once: publish complete bytes under a new name; false when the file exists. durable.mjs uses the same helper.
export function makePutOnce({ fs: f = fs, path: p = path, randomBytes: rb = randomBytes } = {}) {
  function syncDir(dir) { // some platforms (Windows) cannot open a directory; there the flush is skipped
    let fd;
    try { fd = f.openSync(dir, 'r'); f.fsyncSync(fd); } catch (e) { if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(e.code)) throw e; } finally { if (fd !== undefined) try { f.closeSync(fd); } catch { /* already closed */ } }
  }
  function putOnce(file, value) {
    const temp = `${file}.${process.pid}.${rb(8).toString('hex')}.tmp`;
    try {
      const fd = f.openSync(temp, 'wx', 0o600);
      try { f.writeFileSync(fd, `${JSON.stringify(value)}\n`); f.fsyncSync(fd); } finally { f.closeSync(fd); }
      try { f.linkSync(temp, file); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
      syncDir(p.dirname(file));
      return true;
    } finally { f.rmSync(temp, { force: true }); }
  }
  return { putOnce, syncDir };
}
export const { putOnce, syncDir } = makePutOnce();

// ---- the fact and the fold -------------------------------------------------------------------------------------------
// A fact is created once and never edited: { v, id, item, type, state, source, at, by, refs, words, typed_at, evidence, checked_at, text }.
// An item is `<type>:<key>`. `pushed`, `merged` and `done` count only from `git` (evidence path and check time) or `person` (quoted
// words and where they were typed); `dropped` and `resolved` on a task only from `person` or `lead`. From any other source they fold to
// `reported: "<state>, not verified"` and change no state. Facts fold in the order of their id (the time they were written): `typed_at` is shown, never used for order.
// An end holds: an item that ended by an authoritative fact (merged or done, dropped or resolved from person or lead) is not moved by a later
// fact of lower weight (RANK); the fact shows as `later`. Only a `person` fact, or a final fact of equal or higher weight, moves it.
// A git fact that repeats the item's last git state never overrides a state that came from someone else (a re-check is not news), held or not.
// A question is asked again by the same key, so it never holds.
const trusted = (f) => (GATED.includes(f.state) ? (f.source === 'git' && f.evidence && isoOk(f.checked_at)) || (f.source === 'person' && f.words && f.refs?.length > 0) : !['dropped', 'resolved'].includes(f.state) || f.type === 'question' || AUTH.includes(f.source));
const held = (i) => i.type !== 'question' && FINAL.includes(i.state);
const shape = (f, reported = null, later = null) => ({ item: f.item, type: f.type ?? f.item.split(':')[0], state: f.state, source: f.source, at: f.at, by: f.by, refs: f.refs ?? [], words: f.words ?? null, typed_at: f.typed_at ?? null, evidence: f.evidence ?? null, checked_at: f.checked_at ?? null, text: f.text ?? null, reported, later, fact: f.id });

export function foldItems(facts) {
  const items = new Map();
  const lastGit = new Map(); // item -> the state of its newest git fact
  for (const f of [...facts].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cur = items.get(f.item);
    if (!trusted(f)) { // an unverified claim: noted, never applied
      const base = cur ?? shape({ ...f, state: 'unknown' });
      if (held(base) && (RANK[f.state] ?? 9) <= (RANK[base.state] ?? 9)) continue;
      items.set(f.item, { ...base, reported: base.reported && (RANK[base.reported.split(',')[0]] ?? 0) >= RANK[f.state] ? base.reported : `${f.state}, not verified` });
      continue;
    }
    const repeat = f.source === 'git' && cur && cur.source !== 'git' && lastGit.get(f.item) === f.state;
    if (f.source === 'git') lastGit.set(f.item, f.state);
    const holds = cur && held(cur) && !(f.source === 'person' || (held(shape(f)) && RANK[f.state] >= RANK[cur.state]));
    if (cur && (repeat || holds)) { items.set(f.item, { ...cur, later: `${f.state} (${f.source}, ${f.checked_at ?? f.at}), not applied: ${holds ? 'the item ended' : 'git repeats its last state'}` }); continue; }
    const claim = cur?.reported ? RANK[cur.reported.split(',')[0]] ?? 0 : -1; // a claim from a session or the lead stays until a person, or a git state of equal or higher weight, speaks
    items.set(f.item, shape(f, f.source !== 'person' && claim > (RANK[f.state] ?? 0) ? cur.reported : null));
  }
  return [...items.values()].sort((a, b) => (a.item < b.item ? -1 : 1));
}

// A run's events fold the same way: a question, or a needs-person event, with a key opens `question:<key>`; `resolved` ends it.
export const eventFacts = (events) => events.flatMap((e) => (e.key && (e.kind === 'resolved' || e.kind === 'question' || e.state === 'needs-person') ? [{ v: 1, id: e.id, item: `question:${e.key}`, type: 'question', state: e.kind === 'resolved' ? 'resolved' : 'needs-person', source: e.kind === 'resolved' ? 'lead' : 'session', at: e.at, by: e.from, refs: e.refs ?? [], words: null, typed_at: null, evidence: null, checked_at: null, text: e.text }] : []));
export const openItems = (events) => foldItems(eventFacts(events)).filter((i) => !FINAL.includes(i.state) && i.state !== 'unknown');

export function writeFact(dir, f) {
  const item = String(f.item ?? '');
  if (!ITEM.test(item)) throw new Error('--item is <type>:<key>, for example task:PROJ-1');
  if (!LEDGER_STATES.includes(f.state)) throw new Error(`--state is one of ${LEDGER_STATES.join(', ')}`);
  if (!SOURCES.includes(f.source)) throw new Error(`--source is one of ${SOURCES.join(', ')}`);
  const by = f.by ?? 'ledger';
  if (!NAME.test(by)) throw new Error('--by is 1 to 40 letters, digits, dots, hyphens or underscores');
  const refs = (f.refs ?? []).map((r) => clean(r, 300));
  if (f.source === 'git' && !(f.evidence && isoOk(f.checked_at))) throw new Error('a git fact needs --evidence <the git-check file> and --checked-at <time>');
  if (f.source === 'person' && !(f.words && refs.length > 0)) throw new Error('a person fact needs --words <their words, quoted> and --ref <where they were typed>');
  if (f.typed_at != null && !(f.source === 'person' && isoOk(f.typed_at))) throw new Error('--typed-at is an ISO time (for example 2026-11-24T10:00:00Z), for a person fact only');
  fs.mkdirSync(path.join(dir, 'facts'), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    const now = new Date();
    const id = `${stamp(now)}-${by}-${randomBytes(2).toString('hex')}`;
    const fact = { v: 1, id, item, type: item.split(':')[0], state: f.state, source: f.source, at: now.toISOString(), by, refs, words: f.words ? clean(f.words, 300) : null, typed_at: f.typed_at ?? null, evidence: f.evidence ? path.resolve(f.evidence) : null, checked_at: f.checked_at ?? null, text: f.text ? clean(f.text) : null };
    if (putOnce(path.join(dir, 'facts', `${id}.json`), fact)) return fact;
  }
  throw new Error('could not create a fact file');
}

export function readFacts(dir) {
  const facts = [];
  const bad = [];
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'facts')).filter((f) => f.endsWith('.json')).sort(); } catch { /* no facts yet */ }
  for (const file of files) {
    const f = readJson(path.join(dir, 'facts', file));
    if (f && f.v === 1 && f.id === file.slice(0, -5) && ITEM.test(f.item) && LEDGER_STATES.includes(f.state) && SOURCES.includes(f.source) && isoOk(f.at) && NAME.test(f.by ?? '') && Array.isArray(f.refs)) facts.push(f); else bad.push(file);
  }
  return { facts, bad };
}

// Writes state.json and state.js ({ rev, at, items, final, moot }) by atomic rename. rev is the number of facts folded; at is the newest fact's time, so the same facts always give the same bytes. The files are a projection: never edit them, and let one session fold a folder at a time.
export function foldLedger(dir) {
  const { facts, bad } = readFacts(dir);
  const state = { rev: facts.length, at: facts.map((f) => f.at).sort().at(-1) ?? null, items: foldItems(facts), final: FINAL, moot: MOOT }; // the rule travels with the data, so a page script never hard-codes it
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, ours] of [['state.json', (t) => Object.hasOwn(JSON.parse(t) ?? {}, 'moot')], ['state.js', (t) => /^\/\/ data only: never an approval or a go\r?\nwindow\.LEDGER_STATE = /.test(t)]]) keepForeign(path.join(dir, name), ours);
  atomic(path.join(dir, 'state.json'), state);
  const safe = JSON.stringify(state).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); // a text can never close the script element
  atomic(path.join(dir, 'state.js'), `// data only: never an approval or a go\nwindow.LEDGER_STATE = ${safe};\n`);
  return { ...state, bad };
}

// Pages that ask for something that no longer holds: an element with data-item and data-claim, whose item is in a state that makes the
// claim moot (isStale). Reads html and htm files only; follows no link; writes nothing. A page over the size cap is listed in `skipped`.
const attr = (tag, name) => tag.match(new RegExp(`\\sdata-${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find((v) => v !== undefined) ?? null;
const pagesUnder = (root, depth = 0) => { try { return fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth < 8 && !['node_modules', '.git'].includes(e.name) ? pagesUnder(path.join(root, e.name), depth + 1) : []) : e.isFile() && /\.html?$/i.test(e.name) ? [path.join(root, e.name)] : [])); } catch { return []; } };
export function staleScan(dir, root) {
  const { facts } = readFacts(dir);
  const now = new Map(foldItems(facts).map((i) => [i.item, i]));
  const found = [];
  const skipped = [];
  for (const file of pagesUnder(path.resolve(root))) {
    let text;
    try { const size = fs.statSync(file).size; if (size > 4_000_000) { skipped.push({ file, size }); continue; } text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/<[a-zA-Z][^<>]*>/g)) {
      if (!/\sdata-item\s*=/.test(m[0])) continue;
      const [item, claim] = [attr(m[0], 'item'), attr(m[0], 'claim')];
      const cur = now.get(item);
      if (claim && cur && isStale(claim, cur.state)) found.push({ file, item, claim, rev: attr(m[0], 'rev'), state: cur.state, source: cur.source, at: cur.at, typed_at: cur.typed_at, checked_at: cur.checked_at });
    }
  }
  return { rev: facts.length, found, skipped };
}

// Reads one git-check file ({ checked_at, rows: [{ key, repo, branch, git_state, git_checked_at }] }); no git call, no network.
// MERGED, PUSHED and PUSHED_BEHIND_LOCAL rows become git facts for task:<key>; a row without a key is skipped. One key's rows of one check are
// combined (a ticket can be in several branches or repositories): merged only when every row of the key that has a git state says MERGED, otherwise
// pushed (a LOCAL_ONLY or DIVERGED row, or a row with an unreadable time, keeps the key at pushed; a key with no MERGED or PUSHED row gets no fact).
// The result is compared with the item's newest git fact (not the folded item): the same check is not written twice, a check older than that fact
// never rolls it back, and a state that repeats the newest fact's is skipped while that fact is under 2 hours old (a routine re-check does not
// grow the ledger), and after that too while a person or the lead holds the item at an end (the refresh would change nothing). A row whose
// check time is more than 60 s after now is skipped: a future time would hold the item against every real check after it.
export function addGitFacts(dir, file, nowMs = Date.now()) {
  const data = readJson(file);
  if (!Array.isArray(data?.rows)) throw new Error(`${file} is not a git-check file with a rows list`);
  const { facts } = readFacts(dir);
  const last = new Map(facts.filter((f) => f.source === 'git').map((f) => [f.item, f])); // facts come sorted by id: the newest wins
  const folded = new Map(foldItems(facts).map((i) => [i.item, i]));
  const out = { added: 0, unchanged: 0, skipped: 0 };
  const byKey = new Map(); // key -> its usable rows in this check
  const notMerged = new Set(); // keys with a row whose git state is not MERGED: never merged by this check
  for (const row of data.rows) {
    const key = row?.key;
    const state = { MERGED: 'merged', PUSHED: 'pushed', PUSHED_BEHIND_LOCAL: 'pushed' }[row?.git_state];
    const checked = row?.git_checked_at ?? data.checked_at;
    if (typeof key === 'string' && ![undefined, null, '', 'MERGED'].includes(row.git_state)) notMerged.add(key);
    if (typeof key !== 'string' || !ITEM.test(`task:${key}`) || !state || !isoOk(checked) || Date.parse(checked) > nowMs + 60_000) { out.skipped += 1; continue; }
    byKey.set(key, [...(byKey.get(key) ?? []), { state, checked, row }]);
  }
  for (const [key, rows] of byKey) {
    const item = `task:${key}`;
    const state = rows.every((r) => r.state === 'merged') && !notMerged.has(key) ? 'merged' : 'pushed';
    const checked = rows.map((r) => r.checked).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
    const [cur, mine] = [last.get(item), folded.get(item)];
    if (cur && Date.parse(checked) < Date.parse(cur.checked_at)) { out.skipped += 1; continue; }
    if (cur && cur.state === state && (Date.parse(checked) - Date.parse(cur.checked_at) < 2 * 3600 * 1000 || (held(mine) && AUTH.includes(mine.source)))) { out.unchanged += 1; continue; }
    const repoName = (repo) => (typeof repo === 'string' ? repo.split(/[\\/]/).filter(Boolean).at(-1) : null); // the last folder name, for a Windows path too
    const refs = [...new Set(rows.flatMap(({ row }) => (typeof row.branch === 'string' && row.branch ? [...(rows.length > 1 && repoName(row.repo) ? [`${repoName(row.repo)}:${row.branch}`] : []), row.branch] : [])))]; // the bare branch stays, so a card named by its branch still finds the task
    last.set(item, writeFact(dir, { item, state, source: 'git', by: 'ledger-git', refs, evidence: file, checked_at: checked }));
    out.added += 1;
  }
  return out;
}

// ---- members, ack and the ledger commands -----------------------------------------------------------------------------
export function stateApi({ fs: F = fs, path: P = path, randomBytes: rb = randomBytes, runDir, needName, usage, pickRun, metaOf, needMe, isClosed, loadEvents, seenFile, tokenOf, cap }) {
  const put = makePutOnce({ fs: F, path: P, randomBytes: rb });
  const membersDir = (run) => P.join(runDir(run), 'members');
  const legacyDir = (run) => P.join(runDir(run), 'durable', 'members'); // where the first durable version kept members; still read for one version
  const memberOk = (m, name) => m && typeof m === 'object' && !Array.isArray(m) && m.name === name && GEN.test(m.generation ?? '') && ['lead', 'worker'].includes(m.role) && [m.client, m.session].every((v) => v == null || LOWER.test(v));
  function readMember(run, name) {
    needName(name, 'a member name');
    for (const file of [P.join(membersDir(run), `${name}.json`), P.join(legacyDir(run), `${name}.json`)]) {
      let m;
      try { m = JSON.parse(F.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') continue; throw usage(`invalid or unreadable member record ${name}`); }
      if (!memberOk(m, name)) throw usage(`invalid member record ${name}`);
      return m;
    }
    return null;
  }
  const listMembers = (run) => [...new Set([membersDir(run), legacyDir(run)].flatMap((d) => { try { return F.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; } }))].sort().map((n) => readMember(run, n));
  // Messages of an older generation of this member that nobody handled: listed, never delivered to the new generation.
  const stranded = (run, name, gen) => { const dir = P.join(runDir(run), 'durable', 'messages'); try { return F.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => { const m = readJson(P.join(dir, f)); return m && ((m.to === name && m.toGeneration !== gen) || (m.from === name && m.fromGeneration !== gen)) && !F.existsSync(P.join(runDir(run), 'durable', 'receipts', f)) ? [{ id: m.id, kind: m.kind, from: m.from, to: m.to }] : []; }); } catch { return []; } };

  // One member record for registration and durable enrollment: members/<name>.json, written by the lead only, create-once per generation.
  function registerMember(run, w) {
    const given = { dir: w.dir ?? null, pane: w.pane ?? null, client: w.client ?? null, session: w.session ?? null, item: w.item ?? null };
    if (given.client && listMembers(run).some((m) => m.name !== w.name && m.client === given.client && m.session === given.session)) throw usage('client/session endpoint is already registered under another name');
    F.mkdirSync(membersDir(run), { recursive: true, mode: 0o700 });
    if (given.client) { // durable messages need their journal: create it once; if it exists it must be whole (a missing part fails closed)
      const root = P.join(runDir(run), 'durable');
      const parts = ['messages', 'receipts'].map((n) => P.join(root, n));
      if (!F.existsSync(root)) for (const d of [root, ...parts]) { F.mkdirSync(d, { recursive: true, mode: 0o700 }); put.syncDir(P.dirname(d)); }
      else if (!parts.every((d) => F.statSync(d, { throwIfNoEntry: false })?.isDirectory())) throw usage('durable journal directory is missing or unreadable');
    }
    const file = P.join(membersDir(run), `${w.name}.json`);
    const rec = (r) => ({ v: 2, name: r.name, role: r.role, reg: 'lead', dir: r.dir ?? null, pane: r.pane ?? null, client: r.client ?? null, session: r.session ?? null, generation: r.generation, item: r.item ?? null });
    const fresh = rec({ name: w.name, role: w.role, ...given, generation: rb(16).toString('hex') });
    let old = readMember(run, w.name);
    if (!old && put.putOnce(file, fresh)) return { record: fresh, stranded: [] };
    old = readMember(run, w.name);
    if (!old) throw usage('registration failed; retry');
    if (w.replace) {
      const next = rec({ ...old, ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== null)), generation: fresh.generation });
      atomic(file, `${JSON.stringify(next)}\n`);
      return { record: next, stranded: stranded(run, w.name, next.generation) };
    }
    if (old.role !== w.role || Object.entries(given).some(([k, v]) => v !== null && old[k] !== v)) throw usage(`${w.name} is already registered with other values; register --replace writes the next generation`);
    if (old.v === 2) return { record: old, stranded: [] };
    const moved = rec({ ...fresh, client: old.client, session: old.session, generation: old.generation }); // a first-version durable member: same generation, new place
    put.putOnce(file, moved);
    return { record: readMember(run, w.name), stranded: [] };
  }

  const ledgerDir = (o) => { const d = o.ledger ?? process.env.SESSION_SYNC_LEDGER; if (!d) throw usage('--ledger <folder> is needed (or set SESSION_SYNC_LEDGER)'); return path.resolve(d); };
  const commands = {
    // The lead writes a member record for a tab it opened (and, with --client and --session, one for itself, which durable messages need).
    // The worker has no duty: it joins nothing and posts nothing. Register serially.
    register(o) {
      const run = pickRun(o);
      const me = needMe(o);
      if (isClosed(run) || me !== metaOf(run).lead) throw usage('only the lead registers a member, in an open run');
      const name = needName(o.name, '--name');
      if (name === me && !o.client) throw usage('the lead registers itself only with --client and --session, for durable messages');
      if (!o.client !== !o.session) throw usage('--client and --session come together');
      if (o.client && ![name, o.client, o.session].every((v) => LOWER.test(v))) throw usage('with --client, the name, client and session are lowercase');
      if (o.item !== undefined && !ITEM.test(o.item)) throw usage('--item is <type>:<key>, for example task:PROJ-1');
      const r = registerMember(run, { name, role: name === me ? 'lead' : 'worker', dir: o.dir ? path.resolve(o.dir) : null, pane: o.pane ? cap(o.pane, 60) : null, client: o.client, session: o.session, item: o.item, replace: Boolean(o.replace) });
      console.log(JSON.stringify(o.replace ? { ...r.record, stranded: r.stranded } : r.record));
    },
    // Moves the cursor to the event that the printed token names. The event ack (the cursor) and the durable receipt (durable-ack) differ.
    ack(o) {
      const run = pickRun(o);
      const me = needMe(o);
      const mine = readJson(seenFile(run, me));
      if (!mine) throw usage(`${me} has not joined run ${run}; run join first`);
      if (!/^[0-9a-f]{10}$/.test(o.token ?? '')) throw usage('--token is the 10 characters printed after "ack:" in a digest');
      const hit = loadEvents(run).ok.find((e) => tokenOf(run, me, e.id) === o.token);
      if (!hit) throw usage('unknown ack token');
      if (hit.id <= (mine.cursor ?? '')) throw usage('old ack token: that digest is already acknowledged');
      atomic(seenFile(run, me), { ...mine, cursor: hit.id });
      console.log(`acked ${me} up to ${hit.id}`);
    },
    'ledger-add'(o) {
      if (o.source === 'git' || o.evidence !== undefined || o['checked-at'] !== undefined) throw usage('a git fact is never typed: run ledger-git --from <git-check json file>, which reads real rows');
      const fact = writeFact(ledgerDir(o), { item: o.item, state: o.state, source: o.source, by: o.by ?? o.me ?? process.env.SESSION_SYNC_ME, refs: o.ref, words: o.words, typed_at: o['typed-at'], text: o.text });
      console.log(`added ${fact.id}`);
    },
    'ledger-fold'(o) {
      const s = foldLedger(ledgerDir(o));
      if (s.bad.length) console.error(`${s.bad.length} fact file(s) skipped: ${s.bad.slice(0, 3).join(', ')}`);
      console.log(`ledger rev ${s.rev}: ${s.items.length} item(s); wrote state.json and state.js`);
    },
    'ledger-stale'(o) {
      if (!o.root) throw usage('--root <pages folder> is needed');
      const { rev, found, skipped } = staleScan(ledgerDir(o), o.root);
      for (const s of found) console.log(`${s.file}: ${s.item} asks "${s.claim}" (page rev ${s.rev ?? '-'}), now ${s.state} (${s.source}, ${s.source === 'git' ? `checked ${s.checked_at}` : s.typed_at ? `typed ${s.typed_at}` : s.at})`);
      for (const k of skipped) console.log(`not scanned (over the 4 MB cap): ${k.file} (${k.size} bytes)`);
      console.log(`ledger rev ${rev}: ${found.length} stale ask(s) in ${new Set(found.map((s) => s.file)).size} page(s)${skipped.length ? `; ${skipped.length} page(s) not scanned` : ''}`);
      return found.length ? 3 : 0;
    },
    'ledger-git'(o) {
      if (!o.from) throw usage('--from <git-check json file> is needed');
      const r = addGitFacts(ledgerDir(o), path.resolve(o.from));
      console.log(`git facts: ${r.added} added, ${r.unchanged} unchanged, ${r.skipped} skipped`);
    },
  };
  return { commands, readMember, listMembers, registerMember, putOnce: put.putOnce, syncDir: put.syncDir };
}
