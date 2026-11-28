// Tests for template/shared-skills/session-sync/state.mjs: the one state model (a fact and its fold), the task ledger, the
// member record the lead writes, and the open list of a run. Every test uses a fresh temporary home, sync folder and ledger.
//   node --test test/state.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(sourceRoot, 'template', 'shared-skills', 'session-sync');
const SCRIPT = path.join(SKILL_DIR, 'session-sync.mjs');
const STATE = path.join(SKILL_DIR, 'state.mjs');
const { FINAL, MOOT, isStale } = await import(pathToFileURL(STATE).href);

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'state-')));
  const home = path.join(dir, 'home');
  const sync = path.join(home, '.session-sync');
  const workspace = path.join(dir, 'workspace');
  const ledger = path.join(dir, 'ledger');
  const pages = path.join(dir, 'pages');
  for (const folder of [home, workspace, pages]) mkdirSync(folder, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, TZ: 'UTC', HOME: home, USERPROFILE: home, SESSION_SYNC_HOME: sync, PATH: process.env.PATH };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SESSION_SYNC_LEDGER;
  return { dir, home, sync, workspace, ledger, pages, env };
}

function cli(sb, args, { input, env = {}, script = SCRIPT } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', input, cwd: sb.workspace, env: { ...sb.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const run = (sb, args) => new Promise((resolve) => { const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: sb.workspace, env: sb.env }); let out = ''; p.stdout.on('data', (d) => { out += d; }); p.on('close', (code) => resolve({ code, out })); });
const ok = (result) => { assert.equal(result.code, 0, result.err || result.out); return result; };

const add = (sb, item, state, source, extra = []) => cli(sb, ['ledger-add', '--ledger', sb.ledger, '--item', item, '--state', state, '--source', source, ...extra]);
const fold = (sb) => { ok(cli(sb, ['ledger-fold', '--ledger', sb.ledger])); return JSON.parse(readFileSync(path.join(sb.ledger, 'state.json'), 'utf8')); };
const itemOf = (state, id) => state.items.find((i) => i.item === id);
const gitFile = (sb, rows, name = 'git-check.json', checkedAt = '2026-01-05T10:00:00+00:00') => { const file = path.join(sb.dir, name); writeFileSync(file, JSON.stringify({ checked_at: checkedAt, rows })); return file; };
let gitCount = 0;
// A git fact the only way it can be made: a git-check file read by ledger-git.
const gitFact = (sb, key, gitState, checkedAt = '2026-01-05T10:00:00+00:00') => ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, [{ key, branch: `b/${key}`, git_state: gitState }], `git-check-${gitCount += 1}.json`, checkedAt)]));
const person = (sb, item, state, words = '"typed"') => ok(add(sb, item, state, 'person', ['--words', words, '--ref', 'session-A']));
const factsOf = (sb) => readdirSync(path.join(sb.ledger, 'facts')).filter((f) => f.endsWith('.json'));
const eventsOf = (sb, runId = 'R1') => readdirSync(path.join(sb.sync, runId, 'events')).sort().map((f) => JSON.parse(readFileSync(path.join(sb.sync, runId, 'events', f), 'utf8')));
const hook = (sb, input) => cli(sb, ['hook'], { input: JSON.stringify(input) });
const stop = (session, cwd, text = 'SYNC: working - busy') => ({ session_id: session, cwd, hook_event_name: 'Stop', last_assistant_message: text, background_tasks: [] });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openRun = (sb, members = []) => ok(cli(sb, ['init', '--lead', 'lead', '--run', 'R1', '--session', 's-lead', ...members.flatMap((m) => ['--member', `${m}:${m}:worker`])]));

// ---- step 1: the fact, the fold and the ledger commands ------------------------------------------------------------------

test('a session fact "merged" folds to reported, not verified; a git fact folds to merged; a person fact needs their words and where they were typed', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:PROJ-1', 'review', 'session'));
  ok(add(sb, 'task:PROJ-1', 'merged', 'session', ['--text', 'the worker says it merged']));
  ok(add(sb, 'task:PROJ-1', 'working', 'session'));
  let state = fold(sb);
  assert.deepEqual([state.rev, itemOf(state, 'task:PROJ-1').state, itemOf(state, 'task:PROJ-1').reported], [3, 'working', 'merged, not verified'], 'a session claim never sets merged, and a later session note does not clear it');
  ok(add(sb, 'task:PROJ-2', 'pushed', 'lead'));
  assert.equal(itemOf(fold(sb), 'task:PROJ-2').reported, 'pushed, not verified', 'a lead claim of pushed is not verified either');
  assert.equal(itemOf(fold(sb), 'task:PROJ-2').state, 'unknown', 'unknown is never shown as done');
  gitFact(sb, 'PROJ-1', 'MERGED', '2026-01-05T10:00:00Z');
  state = fold(sb);
  const merged = itemOf(state, 'task:PROJ-1');
  assert.deepEqual([merged.state, merged.source, merged.reported, merged.evidence, merged.checked_at], ['merged', 'git', null, path.join(sb.dir, `git-check-${gitCount}.json`), '2026-01-05T10:00:00Z']);
  // A1: ledger-add never takes a git fact on the caller's word, with or without evidence.
  const evidence = path.join(sb.dir, 'git-check.json');
  for (const extra of [[], ['--evidence', evidence, '--checked-at', '2026-01-05T10:00:00Z'], ['--evidence', '/nonexistent/file.json', '--checked-at', '1']]) {
    const refused = add(sb, 'task:PROJ-3', 'merged', 'git', extra);
    assert.equal(refused.code, 2, extra.join(' '));
    assert.match(refused.err, /a git fact is never typed: run ledger-git --from/);
  }
  assert.equal(readdirSync(path.join(sb.ledger, 'facts')).length, 5, 'a refused fact writes nothing');
  // the fold itself refuses a git fact with a loose check time: `1` is not a time
  const loose = '29980101T000000000Z-hand-aaaa';
  writeFileSync(path.join(sb.ledger, 'facts', `${loose}.json`), JSON.stringify({ v: 1, id: loose, item: 'task:PROJ-8', type: 'task', state: 'merged', source: 'git', at: '2998-01-01T00:00:00.000Z', by: 'hand', refs: [], words: null, evidence: evidence, checked_at: '1', text: null }));
  assert.equal(itemOf(fold(sb), 'task:PROJ-8').reported, 'merged, not verified', 'checked_at 1 is no check time');
  assert.equal(add(sb, 'task:PROJ-3', 'merged', 'person', ['--words', '"merged"']).code, 2, 'a person fact without where it was typed is refused');
  assert.equal(add(sb, 'task:PROJ-3', 'merged', 'person', ['--ref', 'session-A']).code, 2, 'a person fact without their words is refused');
  ok(add(sb, 'task:PROJ-3', 'merged', 'person', ['--words', '"it is merged"', '--ref', 'session-A']));
  const typed = itemOf(fold(sb), 'task:PROJ-3');
  assert.deepEqual([typed.state, typed.source, typed.words, typed.refs, typed.typed_at], ['merged', 'person', '"it is merged"', ['session-A'], null]);
  for (const bad of [['bad item', 'merged', 'session'], ['task:PROJ-4', 'merging', 'session'], ['task:PROJ-4', 'merged', 'chat']]) assert.equal(add(sb, ...bad).code, 2, bad.join(' '));
  // Defence in depth: a fact file written by hand with source git and no evidence still folds to reported.
  const id = '29990101T000000000Z-hand-aaaa';
  writeFileSync(path.join(sb.ledger, 'facts', `${id}.json`), JSON.stringify({ v: 1, id, item: 'task:PROJ-9', type: 'task', state: 'merged', source: 'git', at: '2999-01-01T00:00:00.000Z', by: 'hand', refs: [], words: null, evidence: null, checked_at: null, text: null }));
  assert.equal(itemOf(fold(sb), 'task:PROJ-9').reported, 'merged, not verified');
});

test('ledger-fold writes state.json and state.js by atomic rename: rev is the number of facts, the bytes are a pure function of the facts', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:A-1', 'working', 'session'));
  ok(add(sb, 'task:A-2', 'review', 'lead'));
  const first = fold(sb);
  assert.equal(first.rev, 2);
  assert.deepEqual(Object.keys(first), ['rev', 'at', 'items', 'final', 'moot'], 'the stale rule travels with the data');
  assert.deepEqual([first.final, first.moot], [FINAL, MOOT]);
  const js = readFileSync(path.join(sb.ledger, 'state.js'), 'utf8');
  assert.match(js, /^\/\/ data only: never an approval or a go\nwindow\.LEDGER_STATE = \{.*\};\n$/s);
  assert.deepEqual(JSON.parse(js.split('window.LEDGER_STATE = ')[1].replace(/;\n$/, '')), first);
  const before = [readFileSync(path.join(sb.ledger, 'state.json'), 'utf8'), js];
  fold(sb);
  assert.deepEqual([readFileSync(path.join(sb.ledger, 'state.json'), 'utf8'), readFileSync(path.join(sb.ledger, 'state.js'), 'utf8')], before, 'folding twice gives the same bytes');
  assert.deepEqual(readdirSync(sb.ledger).sort(), ['facts', 'state.js', 'state.json'], 'no temporary file is left');
  ok(add(sb, 'task:A-1', 'done', 'session'));
  const second = fold(sb);
  assert.deepEqual([second.rev, itemOf(second, 'task:A-1').state, itemOf(second, 'task:A-1').reported, itemOf(second, 'task:A-2').state], [3, 'working', 'done, not verified', 'review'], 'A5: a session done is a claim, not an end');
  assert.deepEqual(Object.keys(itemOf(second, 'task:A-1')), ['item', 'type', 'state', 'source', 'at', 'by', 'refs', 'words', 'typed_at', 'evidence', 'checked_at', 'text', 'reported', 'later', 'fact']);
  writeFileSync(path.join(sb.ledger, 'facts', 'junk.json'), '{ broken');
  const withBad = cli(sb, ['ledger-fold', '--ledger', sb.ledger]);
  assert.equal(withBad.code, 0);
  assert.match(withBad.err, /1 fact file\(s\) skipped/);
  assert.equal(JSON.parse(readFileSync(path.join(sb.ledger, 'state.json'), 'utf8')).rev, 3, 'a broken file is skipped and not counted');
  assert.equal(cli(sb, ['ledger-fold']).code, 2, 'a ledger folder is needed');
});

test('two processes add facts at once: two files, none lost', async (t) => {
  const sb = sandbox(t);
  const args = (i) => ['ledger-add', '--ledger', sb.ledger, '--item', 'task:RACE-1', '--state', 'working', '--source', 'session', '--by', `w${i}`, '--text', `from ${i}`];
  const results = await Promise.all([run(sb, args(1)), run(sb, args(2))]);
  assert.deepEqual(results.map((r) => r.code), [0, 0]);
  assert.equal(factsOf(sb).length, 2);
  const many = await Promise.all(Array.from({ length: 8 }, (_, i) => run(sb, args(`n${i}`))));
  assert.ok(many.every((r) => r.code === 0));
  assert.equal(new Set(factsOf(sb)).size, 10, 'ten distinct files');
  assert.equal(fold(sb).rev, 10);
});

const PAGE = (claim, rev = 3) => `<!doctype html><html><body><section data-item="task:PROJ-5" data-rev="${rev}" data-claim="${claim}">Ask: ${claim} PROJ-5</section><p data-item="task:PROJ-6">no claim</p></body></html>\n`;

test('ledger-stale lists a page that asks for an item that has ended, names the file and exits 3; a rebuilt page exits 0', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:PROJ-5', 'review', 'session'));
  const page = path.join(sb.pages, 'decision.html');
  mkdirSync(path.join(sb.pages, 'nested'), { recursive: true });
  writeFileSync(page, PAGE('review'));
  writeFileSync(path.join(sb.pages, 'nested', 'plain.html'), '<p>no attributes</p>');
  writeFileSync(path.join(sb.pages, 'notes.md'), PAGE('review'));
  const quiet = cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]);
  assert.equal(quiet.code, 0, 'the item is still in review, so the claim holds');
  gitFact(sb, 'PROJ-5', 'MERGED', '2026-01-05T10:00:00Z');
  const stale = cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]);
  assert.equal(stale.code, 3, stale.out);
  assert.ok(stale.out.includes(`${page}: task:PROJ-5 asks "review" (page rev 3), now merged (git, checked 2026-01-05T10:00:00Z)`), stale.out);
  assert.match(stale.out, /ledger rev 2: 1 stale ask\(s\) in 1 page\(s\)/);
  assert.ok(!stale.out.includes('notes.md') && !stale.out.includes('plain.html'), 'only html pages with a data-claim count');
  writeFileSync(page, PAGE('merged', 2));
  assert.equal(cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]).code, 0, 'a page that says merged is current');
  ok(add(sb, 'task:PROJ-5', 'review', 'lead'));
  writeFileSync(page, PAGE('review'));
  assert.equal(cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]).code, 3, 'a lead note cannot reopen a merged item: the review ask stays stale');
  person(sb, 'task:PROJ-5', 'review', '"reverted, reopen"');
  assert.equal(cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]).code, 0, 'the person reopened it: the review ask holds again');
  assert.equal(cli(sb, ['ledger-stale', '--ledger', sb.ledger]).code, 2, '--root is needed');
});

test('ledger-git reads a git-check file only: MERGED and PUSHED rows become git facts, other rows are skipped, a repeat adds nothing', (t) => {
  const sb = sandbox(t);
  const file = gitFile(sb, [
    { card: 'C1', key: 'PROJ-1', branch: 'feature/one', git_state: 'MERGED', git_checked_at: '2026-01-05T09:00:00+00:00' },
    { card: 'C2', key: 'PROJ-2', branch: 'feature/two', git_state: 'PUSHED_BEHIND_LOCAL' },
    { card: 'C3', key: 'PROJ-3', git_state: 'LOCAL_ONLY' },
    { card: 'C4', key: 'bad key', git_state: 'MERGED' },
    { card: 'C5', key: null, git_state: 'MERGED' },
  ]);
  const first = ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file]));
  assert.match(first.out, /git facts: 2 added, 0 unchanged, 3 skipped/);
  const state = fold(sb);
  const one = itemOf(state, 'task:PROJ-1');
  assert.deepEqual([one.state, one.source, one.evidence, one.checked_at, one.refs, one.reported], ['merged', 'git', file, '2026-01-05T09:00:00+00:00', ['feature/one'], null]);
  assert.equal(state.items.some((i) => i.item === 'task:C5' || i.item === 'task:null'), false, 'a row without a key makes no second identity from its card id');
  const two = itemOf(state, 'task:PROJ-2');
  assert.deepEqual([two.state, two.checked_at], ['pushed', '2026-01-05T10:00:00+00:00'], 'the file time is the check time when a row has none');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /0 added, 2 unchanged, 3 skipped/);
  assert.equal(factsOf(sb).length, 2, 'the same check twice writes no new fact');
  // the same file again after another fact on the item: still nothing new (it is compared with the newest git fact, not with the folded item)
  ok(add(sb, 'task:PROJ-1', 'working', 'session'));
  person(sb, 'task:PROJ-1', 'merged', '"yes merged"');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /0 added, 2 unchanged/);
  assert.equal(factsOf(sb).length, 4);
  const notGit = path.join(sb.dir, 'other.json');
  writeFileSync(notGit, '{"no":"rows"}');
  assert.equal(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', notGit]).code, 2);
  assert.equal(cli(sb, ['ledger-git', '--ledger', sb.ledger]).code, 2);
});

test('a pinned hook copy without state.mjs still writes its event; register, ack and ledger commands from it exit 2 with one line', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['snippet', '--pin']));
  const pinnedDir = path.join(sb.sync, 'bin');
  assert.deepEqual(readdirSync(pinnedDir).sort(), ['session-sync.mjs', 'session-sync.sha256'], 'state.mjs and doctor.mjs are not pinned');
  const pinned = path.join(pinnedDir, 'session-sync.mjs');
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  const before = eventsOf(sb).length;
  const hooked = cli(sb, ['hook'], { script: pinned, input: JSON.stringify(stop('s-writer', '.', 'SYNC: needs-person - which headline?')) });
  assert.deepEqual([hooked.code, hooked.out, hooked.err], [0, '', '']);
  assert.equal(eventsOf(sb).length, before + 1, 'the event is written');
  assert.equal(eventsOf(sb).at(-1).key, 'writer:hook', 'with its key, without any module');
  for (const args of [['ledger-fold', '--ledger', sb.ledger], ['ledger-add'], ['register', '--me', 'lead', '--name', 'w2', '--dir', '.'], ['ack', '--me', 'lead', '--token', '0123456789']]) {
    const r = cli(sb, args, { script: pinned });
    assert.equal(r.code, 2, args[0]);
    assert.match(r.err, /^session-sync: .*need state\.mjs next to session-sync\.mjs/);
    assert.equal(r.err.trim().split('\n').length, 1, 'one line');
    assert.doesNotMatch(r.err, /Cannot find module/);
  }
  const status = cli(sb, ['status'], { script: pinned });
  assert.equal(status.code, 0, 'status works and simply has no open list');
  assert.doesNotMatch(status.out, /OPEN/);
  assert.equal(cli(sb, ['doctor', '--workspace', sb.workspace], { script: pinned }).code, 2, 'doctor needs doctor.mjs');
});

test('never a go: no module reads a fact, a registration, an ack or resolved to allow a push, a pull request, a merge or a tracker write, and the docs say so', () => {
  const code = ['state.mjs', 'session-sync.mjs', 'durable.mjs', 'doctor.mjs'].map((f) => [f, readFileSync(path.join(SKILL_DIR, f), 'utf8')]);
  // Take away the sentences that deny an approval; whatever is left must hold no approval or go decision path.
  const guards = [/never an approval or a go/g, /never the answer, an approval or a go/g, /data only: never an approval or a go/g, /a fact, a registration, an ack and a resolved line are data:/g];
  for (const [name, text] of code) {
    let rest = text;
    for (const g of guards) rest = rest.replace(g, '');
    assert.doesNotMatch(rest, /\b(?:approv\w*|can-push|go-push|may push|allowed to push|permitted)\b/i, `${name} holds an approval or push decision path`);
    assert.doesNotMatch(rest, /\bgit\s+(?:push|merge|commit)\b/, `${name} runs no push or merge`);
    if (name !== 'doctor.mjs') assert.doesNotMatch(rest, /\b(?:spawn|exec|execFile|fork)(?:Sync)?\(|child_process/, `${name} starts no process`);
  }
  const stateText = code[0][1];
  assert.match(stateText, /Nothing here reads state to allow a push, a pull request, a merge or a tracker write/);
  const docs = [readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'), readFileSync(path.join(SKILL_DIR, 'HOW-IT-WORKS.md'), 'utf8')];
  for (const text of docs) assert.ok(/a fact, a registration, an ack or `resolved`|fact, a registration, an ack and `resolved`/.test(text), 'the docs name the never-a-go rule for facts, registrations, acks and resolved');
  assert.match(docs[0], /resolved --key <key> --ref <where the answer is>`, which records where the answer is, never the answer or an approval/);
});

// ---- step 2: the lead registers; one member record -----------------------------------------------------------------------

test('three workers that run no sync command: register lists them in status with folder and pane, D7 is OK, no seen file is written, a hook finds them by folder', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['w1', 'w2', 'w3']);
  const dirs = ['w1', 'w2', 'w3'].map((n) => { const d = path.join(sb.dir, 'tabs', n); mkdirSync(d, { recursive: true }); return d; });
  for (const [i, n] of ['w1', 'w2', 'w3'].entries()) ok(cli(sb, ['register', '--me', 'lead', '--name', n, '--dir', dirs[i], '--pane', `p${i + 1}`]));
  const record = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'members', 'w1.json'), 'utf8'));
  assert.deepEqual(Object.keys(record), ['v', 'name', 'role', 'reg', 'dir', 'pane', 'client', 'session', 'generation', 'item']);
  assert.deepEqual([record.v, record.name, record.role, record.reg, record.dir, record.pane, record.client, record.session, record.item], [2, 'w1', 'worker', 'lead', dirs[0], 'p1', null, null, null]);
  assert.match(record.generation, /^[0-9a-f]{32}$/);
  const status = cli(sb, ['status']).out;
  for (const [i, n] of ['w1', 'w2', 'w3'].entries()) assert.match(status, new RegExp(`^${n}\\s+state=unknown.*reg=lead dir=${dirs[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} pane=p${i + 1}$`, 'm'));
  assert.match(status, /members=4/);
  const json = JSON.parse(cli(sb, ['status', '--json']).out);
  assert.deepEqual(json.members.filter((m) => m.reg === 'lead').map((m) => [m.name, m.dir, m.pane]), dirs.map((d, i) => [`w${i + 1}`, d, `p${i + 1}`]));
  const d7 = cli(sb, ['doctor', '--workspace', sb.workspace]).out.split('\n').find((l) => / D7 /.test(l));
  assert.match(d7, /^OK D7 /, d7);
  assert.deepEqual(readdirSync(path.join(sb.sync, 'R1', 'seen')), ['lead.json'], 'no seen file for a registered worker');
  const before = eventsOf(sb).length;
  assert.deepEqual([hook(sb, stop('s-unknown', dirs[1], 'SYNC: done - finished')).out], ['']);
  const [event] = eventsOf(sb).slice(before);
  assert.deepEqual([event.from, event.kind, event.state, event.by], ['w2', 'turn-end', 'done', 'hook'], 'the hook matched the worker by its folder');
  assert.deepEqual(readdirSync(path.join(sb.sync, 'R1', 'seen')), ['lead.json'], 'the hook created no seen file either');
  assert.equal(hook(sb, stop('s-other', path.join(sb.dir, 'elsewhere'))).code, 0);
  assert.equal(eventsOf(sb).length, before + 1, 'a folder nobody registered writes nothing');
});

test('a folder two members share matches neither; register is lead only, create-once per generation and idempotent for the same values', (t) => {
  const sb = sandbox(t);
  openRun(sb);
  const shared = path.join(sb.dir, 'repo');
  ok(cli(sb, ['register', '--me', 'lead', '--name', 'a1', '--dir', shared]));
  ok(cli(sb, ['register', '--me', 'lead', '--name', 'a2', '--dir', shared]));
  const before = eventsOf(sb).length;
  hook(sb, stop('s-unknown', shared));
  assert.equal(eventsOf(sb).length, before, 'exactly one member must have the folder');
  const again = cli(sb, ['register', '--me', 'lead', '--name', 'a1', '--dir', shared]);
  assert.equal(again.code, 0, 'the same values again: the same record');
  const [first, second] = [JSON.parse(again.out), JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'members', 'a1.json'), 'utf8'))];
  assert.equal(first.generation, second.generation);
  const other = cli(sb, ['register', '--me', 'lead', '--name', 'a1', '--dir', path.join(sb.dir, 'else')]);
  assert.equal(other.code, 2);
  assert.match(other.err, /already registered with other values; register --replace/);
  assert.equal(cli(sb, ['register', '--me', 'a1', '--name', 'a3', '--dir', shared]).code, 2, 'only the lead registers');
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', 'lead', '--dir', shared]).code, 2, 'the lead registers itself only with client and session labels');
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', '../x', '--dir', shared]).code, 2);
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', 'a4', '--client', 'one']).code, 2, 'client and session come together');
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', 'A5', '--client', 'one', '--session', 'two']).code, 2, 'labels are lowercase');
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', 'a6', '--item', 'not an item']).code, 2);
  assert.equal(readdirSync(path.join(sb.sync, 'R1', 'members')).sort().join(), 'a1.json,a2.json');
  ok(cli(sb, ['close', '--me', 'lead']));
  assert.equal(cli(sb, ['register', '--me', 'lead', '--name', 'a7', '--dir', shared]).code, 2, 'a closed run takes no registration');
});

const durableLabels = (who, client, session) => ['--me', who, '--client', client, '--session', session];

test('durable-send works for a registered worker; register --replace starts the next generation: nothing old is delivered and the old question is listed as stranded', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['worker']);
  ok(cli(sb, ['durable-enroll', ...durableLabels('lead', 'one', 'manager'), '--worker', 'worker', '--worker-client', 'two', '--worker-session', 'task']));
  const member = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'members', 'worker.json'), 'utf8'));
  assert.deepEqual([member.v, member.reg, member.role, member.client, member.session, member.dir], [2, 'lead', 'worker', 'two', 'task', null], 'durable-enroll writes the same member record');
  assert.equal(existsSync(path.join(sb.sync, 'R1', 'durable', 'members')), false, 'nothing under durable/members any more');
  ok(cli(sb, ['durable-send', ...durableLabels('worker', 'two', 'task'), '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'which headline?']));
  ok(cli(sb, ['durable-send', ...durableLabels('lead', 'one', 'manager'), '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--text', 'see the board']));
  const replaced = ok(cli(sb, ['register', '--me', 'lead', '--name', 'worker', '--client', 'three', '--session', 'task2', '--pane', 'p9', '--replace']));
  const next = JSON.parse(replaced.out);
  assert.notEqual(next.generation, member.generation);
  assert.deepEqual([next.client, next.session, next.pane], ['three', 'task2', 'p9']);
  assert.deepEqual(next.stranded.map((m) => m.id).sort(), ['lead-p1', 'worker-q1'], 'the unhandled messages of the old generation are listed');
  assert.deepEqual(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('worker', 'three', 'task2')])).out), [], 'the new session is delivered nothing old');
  assert.equal(cli(sb, ['durable-pending', ...durableLabels('worker', 'two', 'task')]).code, 2, 'the old labels no longer match');
  ok(cli(sb, ['durable-send', ...durableLabels('worker', 'three', 'task2'), '--to', 'lead', '--id', 'worker-q2', '--kind', 'question', '--text', 'new question']));
  assert.deepEqual(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('lead', 'one', 'manager')])).out).map((m) => m.id).includes('worker-q2'), true);
  const answer = cli(sb, ['durable-send', ...durableLabels('lead', 'one', 'manager'), '--to', 'worker', '--id', 'lead-a1', '--kind', 'answer', '--question', 'worker-q1', '--text', 'x']);
  assert.equal(answer.code, 2, 'an answer to a question of the old generation is refused');
});

test('register alone is enough for durable messages: the lead registers itself and a worker with labels, and durable-send works for both', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['worker']);
  assert.equal(JSON.parse(ok(cli(sb, ['register', '--me', 'lead', '--name', 'lead', '--client', 'one', '--session', 'manager'])).out).role, 'lead');
  const reg = JSON.parse(ok(cli(sb, ['register', '--me', 'lead', '--name', 'worker', '--dir', sb.workspace, '--pane', 'p1', '--client', 'two', '--session', 'task', '--item', 'task:PROJ-1'])).out);
  assert.deepEqual([reg.role, reg.reg, reg.dir, reg.pane, reg.client, reg.session, reg.item], ['worker', 'lead', sb.workspace, 'p1', 'two', 'task', 'task:PROJ-1']);
  ok(cli(sb, ['durable-send', ...durableLabels('worker', 'two', 'task'), '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'which?']));
  assert.deepEqual(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('lead', 'one', 'manager')])).out).map((m) => m.id), ['worker-q1']);
  ok(cli(sb, ['durable-send', ...durableLabels('lead', 'one', 'manager'), '--to', 'worker', '--id', 'lead-a1', '--kind', 'answer', '--question', 'worker-q1', '--text', 'see the board']));
  assert.deepEqual(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('worker', 'two', 'task')])).out).map((m) => m.id), ['lead-a1']);
  assert.deepEqual(readdirSync(path.join(sb.sync, 'R1', 'seen')), ['lead.json'], 'the worker ran no sync command');
});

test('a member file in the first version\'s place (durable/members) is still read, and enrolling again keeps its generation in the new place', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['worker']);
  const old = path.join(sb.sync, 'R1', 'durable', 'members');
  mkdirSync(old, { recursive: true });
  mkdirSync(path.join(sb.sync, 'R1', 'durable', 'messages'));
  mkdirSync(path.join(sb.sync, 'R1', 'durable', 'receipts'));
  const gen = 'a'.repeat(32);
  writeFileSync(path.join(old, 'lead.json'), JSON.stringify({ name: 'lead', client: 'one', session: 'manager', generation: 'b'.repeat(32), role: 'lead' }));
  writeFileSync(path.join(old, 'worker.json'), JSON.stringify({ name: 'worker', client: 'two', session: 'task', generation: gen, role: 'worker' }));
  ok(cli(sb, ['durable-send', ...durableLabels('lead', 'one', 'manager'), '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--text', 'old place']));
  assert.equal(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('worker', 'two', 'task')])).out).length, 1, 'an old member file works');
  ok(cli(sb, ['durable-enroll', ...durableLabels('lead', 'one', 'manager'), '--worker', 'worker', '--worker-client', 'two', '--worker-session', 'task']));
  const moved = JSON.parse(readFileSync(path.join(sb.sync, 'R1', 'members', 'worker.json'), 'utf8'));
  assert.deepEqual([moved.v, moved.generation, moved.client, moved.session], [2, gen, 'two', 'task'], 'same generation, new place');
  assert.equal(JSON.parse(ok(cli(sb, ['durable-pending', ...durableLabels('worker', 'two', 'task')])).out).length, 1, 'the pending message survived the move');
  assert.equal(cli(sb, ['durable-enroll', ...durableLabels('lead', 'one', 'manager'), '--worker', 'worker', '--worker-client', 'two', '--worker-session', 'other']).code, 2, 'still create-once');
});

// ---- step 4: questions stay open until resolved --------------------------------------------------------------------------

const firstLine = (out) => out.split('\n')[0];

test('S5 proof: a question stays OPEN through 30 notes and a lead restart, until resolved; status, digests and close say so', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer', '--label', 'Article']));
  const posted = ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--state', 'needs-lead', '--key', 'q1', '--text', 'which headline?']));
  assert.match(posted.out, /^posted \S+ key=writer:q1$/m);
  for (let i = 0; i < 30; i += 1) ok(cli(sb, ['post', '--me', 'writer', '--kind', 'note', '--text', `note ${i}`]));
  ok(cli(sb, ['join', '--me', 'lead', '--session', 's-lead'])); // the lead restarts
  const status = cli(sb, ['status']).out;
  assert.match(firstLine(status), /^OPEN \(1\)$/);
  assert.match(status.split('\n')[1], /^ {2}writer:q1 \d+s writer: which headline\?$/);
  const digest = cli(sb, ['inbox', '--me', 'lead']).out;
  assert.match(firstLine(digest), /^OPEN \(1\)$/, 'every digest starts with the open list');
  assert.match(digest, /^session-sync run R1: /m);
  const reply = cli(sb, ['post', '--me', 'lead', '--to', 'writer', '--kind', 'pointer', '--text', 'answered in your tab']);
  assert.equal(reply.code, 0);
  assert.equal(cli(sb, ['post', '--me', 'writer', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'notes/a.md']).code, 2, 'only the lead posts resolved');
  assert.equal(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1']).code, 2, 'resolved says where the answer is');
  assert.equal(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--ref', 'notes/a.md']).code, 2, 'resolved names its key');
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(1\)$/, 'a refused resolved closes nothing');
  ok(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'notes/a.md']));
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(0\)$/);
  assert.doesNotMatch(cli(sb, ['inbox', '--me', 'lead']).out, /OPEN/, 'a digest with nothing open adds no list');
  const resolved = eventsOf(sb).at(-1);
  assert.deepEqual([resolved.kind, resolved.key, resolved.refs], ['resolved', 'writer:q1', ['notes/a.md']]);
  // close prints what is still open
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--text', 'second one']));
  const closed = ok(cli(sb, ['close', '--me', 'lead']));
  assert.match(closed.out, /run R1 closed\nOPEN \(1\)\n {2}writer-\S+ \d+s writer: second one/);
  assert.match(firstLine(cli(sb, ['status', '--run', 'R1']).out), /^OPEN \(1\)$/, 'status still works on a closed run');
});

test('a question or needs-person post without a key gets one from its event id; --key on any other post is refused; a durable wake line is not an open question', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  const q = ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--text', 'a?']));
  const n = ok(cli(sb, ['post', '--me', 'writer', '--kind', 'report', '--state', 'needs-person', '--text', 'b?']));
  const keys = [q, n].map((r) => r.out.match(/key=(\S+)$/m)?.[1]);
  assert.ok(keys.every((k) => /^writer-\d{6}[0-9a-f]{4}$/.test(k)), keys.join());
  assert.notEqual(keys[0], keys[1]);
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(2\)$/);
  assert.equal(cli(sb, ['post', '--me', 'writer', '--kind', 'note', '--key', 'k1', '--text', 'x']).code, 2);
  assert.equal(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--key', 'bad key', '--text', 'x']).code, 2);
  assert.doesNotMatch(readFileSync(path.join(sb.sync, 'R1', 'events', `${eventsOf(sb)[0].id}.json`), 'utf8').replace(/"key": "[^"]+"/, ''), /key/, 'an event with no key has no key field');
  const note = ok(cli(sb, ['post', '--me', 'writer', '--kind', 'note', '--text', 'plain']));
  assert.ok(!('key' in eventsOf(sb).at(-1)) && !note.out.includes('key='));
  // A durable wake line is a question-kind event without a key: the durable journal is its record.
  const id = '29990101T000000000Z-writer-aaaa';
  writeFileSync(path.join(sb.sync, 'R1', 'events', `${id}.json`), JSON.stringify({ v: 1, id, at: '2999-01-01T00:00:00.000Z', from: 'writer', to: 'lead', label: '', kind: 'question', state: 'needs-lead', text: 'durable message x pending for lead', refs: ['durable:x'], by: 'session' }));
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(2\)$/);
});

test('a needs-person line from a hook has the key <member>:hook, and a later one from the same member replaces it', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  assert.deepEqual([hook(sb, stop('s-writer', '.', 'SYNC: needs-person - first question')).out], ['']);
  hook(sb, stop('s-writer', '.', 'SYNC: working - still going'));
  hook(sb, stop('s-writer', '.', 'SYNC: needs-person - second question'));
  const keyed = eventsOf(sb).filter((e) => e.key);
  assert.deepEqual(keyed.map((e) => [e.kind, e.key]), [['turn-end', 'writer:hook'], ['turn-end', 'writer:hook']], 'only needs-person lines carry the key');
  const status = cli(sb, ['status']).out;
  assert.match(firstLine(status), /^OPEN \(1\)$/);
  assert.match(status, /^ {2}writer:hook \d+s writer: second question$/m, 'the later line replaced the earlier one');
  ok(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:hook', '--ref', 'tab-writer']));
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(0\)$/);
  hook(sb, stop('s-writer', '.', 'SYNC: needs-person - third question'));
  assert.match(firstLine(cli(sb, ['status']).out), /^OPEN \(1\)$/, 'a new question after resolved opens it again');
});

test('the open items in status --json have the same fields as an item in the ledger', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--key', 'q1', '--ref', 'notes/q.md', '--text', 'which?']));
  const json = JSON.parse(cli(sb, ['status', '--json']).out);
  assert.equal(json.open, true, 'the run flag keeps its name');
  assert.equal(json.open_items.length, 1);
  ok(add(sb, 'task:A-1', 'review', 'session'));
  assert.deepEqual(Object.keys(json.open_items[0]), Object.keys(itemOf(fold(sb), 'task:A-1')));
  const item = json.open_items[0];
  assert.deepEqual([item.item, item.type, item.state, item.by, item.refs, item.text, item.reported], ['question:writer:q1', 'question', 'needs-person', 'writer', ['notes/q.md'], 'which?', null]);
  ok(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'x']));
  assert.deepEqual(JSON.parse(cli(sb, ['status', '--json']).out).open_items, []);
});

test('a wake digest starts with the OPEN list while a question is open, then the header, the lines and the ack token', async (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--state', 'needs-lead', '--key', 'q1', '--text', 'which?']));
  const waiter = spawn(process.execPath, [SCRIPT, 'wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.5'], { cwd: sb.workspace, env: sb.env });
  let out = '';
  waiter.stdout.on('data', (d) => { out += d; });
  await new Promise((resolve) => waiter.on('close', resolve));
  assert.match(out, /^OPEN \(1\)\n {2}writer:q1 \d+s writer: which\?\nsession-sync run R1: 1 new since start\n.*question.*which\?\nack: [0-9a-f]{10}\n$/s);
  await pause(10);
});

// ---- review fixes: an end holds, the stale rule, no sibling import in the hook, one list per reader ---------------------------

const staleCode = (sb, claim, item = 'PROJ-5') => { writeFileSync(path.join(sb.pages, 'decision.html'), PAGE(claim).replaceAll('PROJ-5', item)); return cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]).code; };
const stateOf = (sb, item) => itemOf(fold(sb), item);

test('an end holds (A2): a person merged is not undone by a later git pushed; the later fact stays visible; the same check twice adds nothing', (t) => {
  const sb = sandbox(t);
  person(sb, 'task:E-1', 'merged', '"it is merged"');
  const file = gitFile(sb, [{ key: 'E-1', branch: 'b/e1', git_state: 'PUSHED', git_checked_at: '2026-01-06T10:00:00+00:00' }], 'late.json');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /1 added/);
  const item = stateOf(sb, 'task:E-1');
  assert.deepEqual([item.state, item.source, item.words], ['merged', 'person', '"it is merged"']);
  assert.equal(item.later, 'pushed (git, 2026-01-06T10:00:00+00:00), not applied: the item ended');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /0 added, 1 unchanged/, 'the same file again adds nothing');
  ok(add(sb, 'task:E-1', 'working', 'session'));
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /0 added, 1 unchanged/, 'also after a session fact: it is compared with the newest git fact');
  assert.equal(factsOf(sb).length, 3);
});

test('an end holds (A2): session and lead facts never reopen, a data-claim review on the merged item is stale, an unverified merged claim adds no note', (t) => {
  const sb = sandbox(t);
  person(sb, 'task:E-2', 'merged');
  ok(add(sb, 'task:E-2', 'review', 'session'));
  ok(add(sb, 'task:E-2', 'working', 'lead'));
  ok(add(sb, 'task:E-2', 'merged', 'session'));
  const item = stateOf(sb, 'task:E-2');
  assert.deepEqual([item.state, item.source, item.reported], ['merged', 'person', null], 'still merged, and no "merged, not verified" next to a real merge');
  assert.match(item.later, /^working \(lead, .*\), not applied: the item ended$/, 'the newest ignored fact is the one shown');
  assert.equal(staleCode(sb, 'review', 'E-2'), 3, 'a page that still asks for review of a merged item is stale');
});

test('an end holds (A2): a person reopens with their words; git merged after a person merged is the newer end; without an end the newest fact wins', (t) => {
  const sb = sandbox(t);
  person(sb, 'task:E-3', 'merged');
  person(sb, 'task:E-3', 'working', '"reverted, reopen"');
  assert.deepEqual([stateOf(sb, 'task:E-3').state, stateOf(sb, 'task:E-3').later], ['working', null]);
  person(sb, 'task:E-4', 'merged');
  gitFact(sb, 'E-4', 'MERGED');
  assert.deepEqual([stateOf(sb, 'task:E-4').state, stateOf(sb, 'task:E-4').source], ['merged', 'git'], 'a final git fact moves a final person fact');
  ok(add(sb, 'task:E-5', 'review', 'session'));
  gitFact(sb, 'E-5', 'PUSHED');
  assert.deepEqual([stateOf(sb, 'task:E-5').state, stateOf(sb, 'task:E-5').later], ['pushed', null], 'control: review then git pushed is pushed');
});

test('an end holds (A2): a dropped item is held only when a person or the lead dropped it; a question is asked again by its key', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:E-6', 'dropped', 'lead'));
  ok(add(sb, 'task:E-6', 'working', 'session'));
  assert.equal(stateOf(sb, 'task:E-6').state, 'dropped', 'the lead dropped it; a session cannot revive it');
  ok(add(sb, 'task:E-7', 'dropped', 'session'));
  ok(add(sb, 'task:E-7', 'working', 'session'));
  assert.equal(stateOf(sb, 'task:E-7').state, 'working', 'a session drop is no authority, so it holds nothing');
});

test('stale rule (A3): FINAL, MOOT and isStale: a pushed branch still needs review, a merged one does not; the same rule is in the CLI and in state.js', (t) => {
  assert.deepEqual(FINAL, ['merged', 'done', 'resolved', 'dropped']);
  const cases = [['review', 'pushed', false], ['review', 'merged', true], ['review', 'done', true], ['push', 'pushed', true], ['pushed', 'pushed', false], ['pushed', 'merged', true], ['merged', 'done', false], ['merged', 'dropped', true], ['blocked', 'resolved', true], ['needs-person', 'pushed', false], ['answer', 'pushed', false], ['answer', 'merged', true], ['constructor', 'merged', true], ['__proto__', 'pushed', false]];
  for (const [claim, state, stale] of cases) assert.equal(isStale(claim, state), stale, `${claim} on ${state}`);
  const sb = sandbox(t);
  gitFact(sb, 'PROJ-5', 'PUSHED');
  const rows = [['review', 0], ['pushed', 0], ['push', 3], ['needs-person', 0], ['answer', 0]];
  assert.deepEqual(rows.map(([claim]) => staleCode(sb, claim)), rows.map(([, code]) => code), 'on a pushed item');
  gitFact(sb, 'PROJ-5', 'MERGED', '2026-01-06T10:00:00+00:00');
  assert.deepEqual(['review', 'pushed', 'push', 'answer', 'merged'].map((c) => staleCode(sb, c)), [3, 3, 3, 3, 0], 'on a merged item');
  fold(sb);
  const data = JSON.parse(readFileSync(path.join(sb.ledger, 'state.js'), 'utf8').split('window.LEDGER_STATE = ')[1].replace(/;\n$/, ''));
  assert.deepEqual([data.final, data.moot], [FINAL, MOOT], 'state.js carries the rule');
  const session = sandbox(t);
  ok(add(session, 'task:PROJ-5', 'merged', 'session'));
  assert.equal(staleCode(session, 'review'), 0, 'a merged claim from a session only is never an end');
});

test('done folds like merged (A5): from a session or the lead it is "done, not verified" and the earlier note stays; from a person it ends the item', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:D-1', 'review', 'session'));
  ok(add(sb, 'task:D-1', 'merged', 'session'));
  ok(add(sb, 'task:D-1', 'done', 'lead'));
  let item = stateOf(sb, 'task:D-1');
  assert.deepEqual([item.state, item.reported], ['review', 'done, not verified'], 'the higher claim is the one shown');
  ok(add(sb, 'task:D-1', 'merged', 'session'));
  assert.equal(stateOf(sb, 'task:D-1').reported, 'done, not verified', 'a weaker claim after it does not hide it');
  person(sb, 'task:D-2', 'done');
  item = stateOf(sb, 'task:D-2');
  assert.deepEqual([item.state, item.reported], ['done', null]);
  ok(add(sb, 'task:D-2', 'done', 'session'));
  assert.equal(stateOf(sb, 'task:D-2').reported, null, 'a session done on a done item adds nothing');
});

test('typed-at (person facts): stored and shown, strict ISO, person facts only; ledger-add takes no check time or evidence', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:T-1', 'merged', 'person', ['--words', '"merged"', '--ref', 'tab-A', '--typed-at', '2026-11-24T09:30:00Z']));
  assert.equal(stateOf(sb, 'task:T-1').typed_at, '2026-11-24T09:30:00Z');
  for (const bad of ['1', 'yesterday', '2026-11-24']) assert.equal(add(sb, 'task:T-2', 'merged', 'person', ['--words', '"m"', '--ref', 'x', '--typed-at', bad]).code, 2, bad);
  assert.equal(add(sb, 'task:T-2', 'working', 'session', ['--typed-at', '2026-11-24T09:30:00Z']).code, 2, 'typed-at belongs to a person fact');
  assert.equal(add(sb, 'task:T-2', 'working', 'session', ['--checked-at', '2026-11-24T09:30:00Z']).code, 2);
  assert.equal(factsOf(sb).length, 1);
});

test('git check order: an older check file run later never rolls an item back; a newer one moves it', (t) => {
  const sb = sandbox(t);
  gitFact(sb, 'O-1', 'MERGED', '2026-11-24T10:00:00+00:00');
  const older = gitFile(sb, [{ key: 'O-1', git_state: 'PUSHED' }], 'older.json', '2026-11-22T10:00:00+00:00');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', older])).out, /0 added, 0 unchanged, 1 skipped/);
  assert.deepEqual([stateOf(sb, 'task:O-1').state, stateOf(sb, 'task:O-1').later], ['merged', null]);
  assert.equal(factsOf(sb).length, 1);
  gitFact(sb, 'O-2', 'PUSHED', '2026-11-22T10:00:00+00:00');
  gitFact(sb, 'O-2', 'MERGED', '2026-11-24T10:00:00+00:00');
  assert.equal(stateOf(sb, 'task:O-2').state, 'merged');
});

test('ledger-stale names the pages it skipped over the size cap; state.js cannot close its script element; the scan is fast on a crafted page', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:X-1', 'working', 'session', ['--text', '</script><b>x</b>\u2028']));
  const odd = gitFile(sb, [{ key: 'X-2', git_state: 'MERGED' }], 'a\u2028<b.json'); // the evidence path is not cleaned, so state.js must escape it
  ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', odd]));
  fold(sb);
  const js = readFileSync(path.join(sb.ledger, 'state.js'), 'utf8');
  assert.equal(js.includes('<'), false, 'no raw < in state.js: a text cannot close the script element');
  assert.equal(/[\u2028\u2029]/.test(js), false);
  assert.equal(JSON.parse(js.split('window.LEDGER_STATE = ')[1].replace(/;\n$/, '')).items.find((i) => i.item === 'task:X-1').text, '</script><b>x</b>', 'the data is unchanged');
  const big = path.join(sb.pages, 'big.html');
  writeFileSync(big, `<p>${'x'.repeat(4_000_001)}</p>`);
  const out = ok(cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages])).out;
  assert.ok(out.includes(`not scanned (over the 4 MB cap): ${big} (4000008 bytes)`), out);
  assert.match(out, /1 page\(s\) not scanned/);
  writeFileSync(path.join(sb.pages, 'crafted.html'), `${'<a '.repeat(80_000)}`);
  const started = Date.now();
  ok(cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]));
  assert.ok(Date.now() - started < 3000, `the scan took ${Date.now() - started} ms`);
});

test('the hook imports no sibling file (A4): a planted state.mjs beside the pinned copy is not run on SessionStart, and doctor D12 warns', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--key', 'q1', '--text', 'which?']));
  const settingsFile = path.join(sb.home, '.claude', 'settings.json');
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  const pinned = cli(sb, ['snippet', '--pin']);
  writeFileSync(settingsFile, JSON.stringify(JSON.parse(pinned.out)));
  const d12 = () => cli(sb, ['doctor', '--workspace', sb.workspace]).out.split('\n').find((l) => / D12 /.test(l));
  assert.match(d12(), /^OK D12/);
  const marker = path.join(sb.dir, 'planted-ran');
  for (const name of ['state.mjs', 'doctor.mjs']) writeFileSync(path.join(sb.sync, 'bin', name), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran'); export const openItems = () => [{ item: 'question:fake', by: 'x', at: new Date().toISOString(), text: 'planted' }];\n`);
  const start = { session_id: 's-lead', cwd: sb.workspace, hook_event_name: 'SessionStart', source: 'startup' };
  const r = cli(sb, ['hook'], { script: path.join(sb.sync, 'bin', 'session-sync.mjs'), input: JSON.stringify(start) });
  assert.equal(r.code, 0);
  assert.equal(existsSync(marker), false, 'the planted module did not run');
  assert.match(r.out, /^session-sync run R1: 1 new/m, 'the digest still prints');
  assert.doesNotMatch(r.out, /OPEN|planted/, 'the session-start digest has no open list');
  assert.match(d12(), /^WARN D12 .*holds doctor\.mjs, state\.mjs beside the pinned hook/);
});

test('one list per reader (A7): the lead sees every open item, a worker only its own; a registered worker that never joined gets no digest (A6)', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['w1', 'w2']);
  for (const [n, s] of [['w1', 's1'], ['w2', 's2']]) { ok(cli(sb, ['join', '--me', n, '--session', s])); ok(cli(sb, ['post', '--me', n, '--kind', 'question', '--key', `q-${n}`, '--text', `secret of ${n}`])); }
  const asLead = cli(sb, ['status', '--me', 'lead']).out;
  assert.match(asLead.split('\n')[0], /^OPEN \(2\)$/);
  const asW1 = cli(sb, ['status', '--me', 'w1']).out;
  assert.match(asW1.split('\n')[0], /^OPEN \(1\)$/);
  assert.doesNotMatch(asW1, /secret of w2/);
  ok(cli(sb, ['post', '--me', 'lead', '--to', 'w1', '--kind', 'pointer', '--text', 'look']));
  const inbox = cli(sb, ['inbox', '--me', 'w1']).out;
  assert.match(inbox, /^OPEN \(1\)\n {2}w1:q-w1 /);
  assert.doesNotMatch(inbox, /secret of w2/);
  // A6: registered, never joined: the session start prints nothing, though an event waits for it
  const dir = path.join(sb.dir, 'tabs', 'w3');
  mkdirSync(dir, { recursive: true });
  ok(cli(sb, ['register', '--me', 'lead', '--name', 'w3', '--dir', dir]));
  ok(cli(sb, ['post', '--me', 'lead', '--to', 'w3', '--kind', 'pointer', '--text', 'for w3']));
  assert.equal(hook(sb, { session_id: 's3', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }).out, '', 'no unusable ack line for a worker that cannot ack');
});

test('resolved needs an open question (A13): an unknown or closed key exits 2', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--key', 'q1', '--text', 'a?']));
  const bad = cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'qx', '--ref', 'n.md']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /no open question qx/);
  ok(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'n.md']));
  assert.equal(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'n.md']).code, 2, 'already resolved');
});

test('init says the lead registers workers and join is optional (item 4)', (t) => {
  const sb = sandbox(t);
  const out = openRun(sb).out;
  assert.match(out, /the lead registers each worker: node ".*session-sync\.mjs" register --me lead --name <name> --dir <folder> --run R1 \(a worker may join instead/);
});

test('A12: state.mjs exports and the stateApi command names are fixed lists, so a new decision function cannot slip in', async () => {
  const mod = await import(pathToFileURL(STATE).href);
  assert.deepEqual(Object.keys(mod).sort(), ['FINAL', 'LEDGER_STATES', 'MOOT', 'SOURCES', 'addGitFacts', 'eventFacts', 'foldItems', 'foldLedger', 'isStale', 'makePutOnce', 'openItems', 'putOnce', 'readFacts', 'staleScan', 'stateApi', 'syncDir', 'writeFact']);
  const api = mod.stateApi({ runDir: () => '/x', usage: (m) => new Error(m) });
  assert.deepEqual(Object.keys(api.commands).sort(), ['ack', 'ledger-add', 'ledger-fold', 'ledger-git', 'ledger-stale', 'register']);
  assert.deepEqual(Object.keys(api).sort(), ['commands', 'listMembers', 'putOnce', 'readMember', 'registerMember', 'syncDir']);
});

// ---- round 3 (R-A1 to R-A10) ------------------------------------------------------------------------------------------------

const T1 = '2026-11-24T10:00:00+00:00';
const T2 = '2026-11-24T10:30:00+00:00'; // under 2 hours after T1
const T3 = '2026-11-24T13:00:00+00:00'; // over 2 hours after T1
const view = (sb, id) => { const i = stateOf(sb, id); return [i.state, i.source, i.later, i.reported]; };

test('R-A1: a routine git re-check never flips a person\'s done, dropped or working, or a lead\'s resolved; under 2 hours it writes nothing', (t) => {
  const sb = sandbox(t);
  gitFact(sb, 'RA-1', 'MERGED', T1);
  person(sb, 'task:RA-1', 'done');
  const file = gitFile(sb, [{ key: 'RA-1', branch: 'b/ra1', git_state: 'MERGED', git_checked_at: T2 }], 'again.json');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', file])).out, /0 added, 1 unchanged/, 'a re-check 30 minutes later writes no fact (R-A6)');
  assert.deepEqual(view(sb, 'task:RA-1'), ['done', 'person', null, null]);
  const before = factsOf(sb).length;
  gitFact(sb, 'RA-1', 'MERGED', T3);
  assert.deepEqual(view(sb, 'task:RA-1'), ['done', 'person', null, null], 'the next routine check 3 hours later: still done, and (A-3) no refresh fact while the person holds the item');
  assert.equal(factsOf(sb).length, before);
  person(sb, 'task:RA-2', 'dropped');
  gitFact(sb, 'RA-2', 'MERGED', T1);
  assert.deepEqual(view(sb, 'task:RA-2').slice(0, 2), ['dropped', 'person'], 'dropped by the person, then git MERGED: dropped holds');
  assert.match(stateOf(sb, 'task:RA-2').later, /^merged \(git, /);
  ok(add(sb, 'task:RA-3', 'resolved', 'lead'));
  gitFact(sb, 'RA-3', 'MERGED', T1);
  assert.deepEqual(view(sb, 'task:RA-3').slice(0, 2), ['resolved', 'lead'], 'resolved by the lead, then git merged: resolved holds');
  gitFact(sb, 'RA-4', 'MERGED', T1);
  person(sb, 'task:RA-4', 'working', '"it was reverted, reopen"');
  gitFact(sb, 'RA-4', 'MERGED', T3);
  const reopened = view(sb, 'task:RA-4');
  assert.deepEqual(reopened.slice(0, 2), ['working', 'person'], 'git MERGED, the person reopens, the next check says MERGED again: stays working');
  assert.match(reopened[2], /not applied: git repeats its last state$/);
  gitFact(sb, 'RA-4', 'PUSHED', '2026-11-24T16:00:00+00:00');
  assert.equal(stateOf(sb, 'task:RA-4').state, 'pushed', 'a different git state is news and applies');
  gitFact(sb, 'RA-5', 'MERGED', T1);
  person(sb, 'task:RA-5', 'merged');
  assert.deepEqual(view(sb, 'task:RA-5').slice(0, 2), ['merged', 'person'], 'control: a person merged on a git-merged item');
  gitFact(sb, 'RA-5', 'MERGED', T3);
  assert.equal(stateOf(sb, 'task:RA-5').source, 'person', 'and a repeat of the git state does not take it back');
  person(sb, 'task:RA-6', 'dropped');
  ok(add(sb, 'task:RA-6', 'resolved', 'lead'));
  assert.equal(stateOf(sb, 'task:RA-6').state, 'dropped', 'a lead resolved weighs less than a person dropped');
  person(sb, 'task:RA-6', 'working', '"no, keep it"');
  assert.equal(stateOf(sb, 'task:RA-6').state, 'working', 'a person fact always moves an item');
});

test('R-A2: a trusted git state below the claim keeps the "not verified" note; a git state of the same weight or a person fact clears it', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:RB-1', 'merged', 'session'));
  gitFact(sb, 'RB-1', 'PUSHED', T1);
  assert.deepEqual(view(sb, 'task:RB-1'), ['pushed', 'git', null, 'merged, not verified'], 'a squash merge: git sees only the push, the claim stays visible');
  gitFact(sb, 'RB-1', 'MERGED', T3);
  assert.deepEqual(view(sb, 'task:RB-1'), ['merged', 'git', null, null], 'git merged settles the claim');
  ok(add(sb, 'task:RB-2', 'done', 'lead'));
  gitFact(sb, 'RB-2', 'MERGED', T1);
  assert.equal(stateOf(sb, 'task:RB-2').reported, 'done, not verified', 'git merged is below the claim done');
  person(sb, 'task:RB-2', 'working', '"not done"');
  assert.equal(stateOf(sb, 'task:RB-2').reported, null, 'a person fact clears it');
});

test('R-A4/R-A5: resolved and dropped on a task count from a person or the lead and hold; from a session they are a note and end nothing', (t) => {
  const sb = sandbox(t);
  person(sb, 'task:RC-1', 'resolved');
  ok(add(sb, 'task:RC-1', 'working', 'session'));
  assert.equal(stateOf(sb, 'task:RC-1').state, 'resolved', 'a person resolved holds (R-A4)');
  ok(add(sb, 'task:RC-2', 'resolved', 'lead'));
  ok(add(sb, 'task:RC-2', 'working', 'lead'));
  assert.equal(stateOf(sb, 'task:RC-2').state, 'resolved', 'a lead resolved holds');
  ok(add(sb, 'task:RC-3', 'resolved', 'session'));
  ok(add(sb, 'task:RC-4', 'dropped', 'session'));
  assert.deepEqual([view(sb, 'task:RC-3')[0], view(sb, 'task:RC-3')[3]], ['unknown', 'resolved, not verified'], 'a session resolved is a note (R-A5)');
  assert.deepEqual([view(sb, 'task:RC-4')[0], view(sb, 'task:RC-4')[3]], ['unknown', 'dropped, not verified']);
  assert.equal(staleCode(sb, 'review', 'RC-4'), 0, 'a session drop does not end a page\'s review ask');
  ok(add(sb, 'task:RC-5', 'dropped', 'lead'));
  assert.equal(staleCode(sb, 'review', 'RC-5'), 3, 'a lead drop does');
  const q = sandbox(t);
  openRun(q, ['writer']);
  ok(cli(q, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(q, ['post', '--me', 'writer', '--kind', 'question', '--key', 'q1', '--text', 'a?']));
  ok(cli(q, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'writer:q1', '--ref', 'n.md']));
  assert.deepEqual(JSON.parse(cli(q, ['status', '--json']).out).open_items, [], 'the lead\'s resolved still closes a question');
});

test('R-A6: a git check that repeats the newest git fact\'s state within 2 hours adds nothing; after 2 hours it refreshes the check time', (t) => {
  const sb = sandbox(t);
  gitFact(sb, 'RD-1', 'PUSHED', T1);
  const same = (at, name) => ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, [{ key: 'RD-1', git_state: 'PUSHED', git_checked_at: at }], name)])).out;
  assert.match(same(T2, 'a.json'), /0 added, 1 unchanged/);
  assert.equal(factsOf(sb).length, 1);
  assert.match(same(T3, 'b.json'), /1 added/);
  assert.equal(stateOf(sb, 'task:RD-1').checked_at, T3);
});

test('A-1: a git row whose check time is more than 60 s in the future is skipped, so a real MERGED row today still applies', (t) => {
  const sb = sandbox(t);
  const future = ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, [{ key: 'FU-1', git_state: 'PUSHED', git_checked_at: '2099-01-01T00:00:00Z' }], 'future.json')])).out;
  assert.match(future, /0 added, 0 unchanged, 1 skipped/);
  assert.equal(existsSync(path.join(sb.ledger, 'facts')), false, 'a future check writes no fact');
  const today = new Date(Date.now() - 60_000).toISOString();
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, [{ key: 'FU-1', git_state: 'MERGED', git_checked_at: today }], 'today.json')])).out, /1 added/);
  assert.equal(stateOf(sb, 'task:FU-1').state, 'merged');
});

// ---- ledger follow-ups: one key with several rows, the 2-hour refresh, explicit keys, the time a person typed ---------------------------

test('A-2: one key in two repositories folds merged only when every row says MERGED; a mixed check writes one pushed fact and no page ask goes stale', (t) => {
  const sb = sandbox(t);
  const two = (a, b, name) => gitFile(sb, [{ key: 'TW-1', repo: '/r/one', branch: 'feature/x', git_state: a, git_checked_at: T1 }, { key: 'TW-1', repo: '/r/two', branch: 'feature/y', git_state: b, git_checked_at: T1 }], name);
  const mixed = two('MERGED', 'PUSHED', 'mixed.json');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', mixed])).out, /1 added, 0 unchanged, 0 skipped/, 'one fact for the key, not one per row');
  const item = stateOf(sb, 'task:TW-1');
  assert.deepEqual([item.state, item.source, item.refs], ['pushed', 'git', ['one:feature/x', 'feature/x', 'two:feature/y', 'feature/y']], 'pushed, with each repository in refs and the bare branch beside it');
  assert.equal(staleCode(sb, 'review', 'TW-1'), 0, 'the review ask of the repository that is not merged is not listed stale');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', mixed])).out, /0 added, 1 unchanged/, 'the same check again adds nothing');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', two('PUSHED', 'MERGED', 'mixed-swapped.json')])).out, /0 added, 1 unchanged/, 'the order of the rows changes nothing: no switching back and forth inside a check');
  assert.equal(factsOf(sb).length, 1, 'one fact after three checks');
  const merged = two('MERGED', 'MERGED', 'both.json');
  assert.match(ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', merged])).out, /1 added/);
  assert.equal(stateOf(sb, 'task:TW-1').state, 'merged', 'every row MERGED gives merged');
  assert.equal(staleCode(sb, 'review', 'TW-1'), 3, 'and now the review ask is stale');
});

test('D-1: a key is merged only when every row of it that has a git state says MERGED; any other state, even one that makes no fact alone, keeps it at pushed', (t) => {
  const sb = sandbox(t);
  const check = (key, rows, name) => ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, rows.map((r, i) => ({ key, repo: '/r/one', branch: `b${i}`, git_checked_at: T1, ...r })), name)])).out;
  assert.match(check('DA-1', [{ git_state: 'MERGED' }, { git_state: 'LOCAL_ONLY' }], 'd1.json'), /1 added, 0 unchanged, 1 skipped/);
  const local = stateOf(sb, 'task:DA-1');
  assert.deepEqual([local.state, local.refs], ['pushed', ['b0']], 'MERGED with a LOCAL_ONLY follow-up is pushed; the unpushed branch is no ref');
  assert.equal(staleCode(sb, 'review', 'DA-1'), 0, 'so its review ask is not listed stale');
  for (const [key, other] of [['DA-2', 'DIVERGED'], ['DA-3', 'NO_OWN_COMMITS'], ['DA-4', 'TODO']]) {
    check(key, [{ git_state: other }, { git_state: 'MERGED' }], `${key}.json`);
    assert.equal(stateOf(sb, `task:${key}`).state, 'pushed', `MERGED with ${other} is pushed, whatever the row order`);
  }
  check('DA-5', [{ git_state: 'MERGED' }, { git_state: 'PUSHED', git_checked_at: '2099-01-01T00:00:00Z' }, { git_state: 'PUSHED', git_checked_at: 'yesterday' }], 'd5.json');
  assert.equal(stateOf(sb, 'task:DA-5').state, 'pushed', 'a PUSHED row whose time is in the future or unreadable still keeps the key at pushed');
  check('DA-6', [{ git_state: 'MERGED' }, { git_state: '' }, {}], 'd6.json');
  assert.equal(stateOf(sb, 'task:DA-6').state, 'merged', 'a row with no git state does not count');
  assert.match(check('DA-7', [{ git_state: 'LOCAL_ONLY' }, { git_state: 'DIVERGED' }], 'd7.json'), /0 added, 0 unchanged, 2 skipped/);
  assert.equal(itemOf(fold(sb), 'task:DA-7'), undefined, 'a key with no MERGED or PUSHED row gets no fact');
  check('DA-8', [{ git_state: 'PUSHED', repo: 'C:\\work\\api', branch: 'feature/x' }, { git_state: 'PUSHED', repo: '/r/web/', branch: 'feature/x' }, { git_state: 'PUSHED', repo: { a: 1 }, branch: 7 }], 'd8.json');
  assert.deepEqual(stateOf(sb, 'task:DA-8').refs, ['api:feature/x', 'feature/x', 'web:feature/x'], 'refs: the last folder name of a Windows or POSIX path, the bare branch once, and nothing from a repo or branch that is not text');
  check('DA-9', [{ git_state: 'PUSHED', git_checked_at: T1 }, { git_state: 'PUSHED', git_checked_at: T3 }], 'd9.json');
  assert.equal(stateOf(sb, 'task:DA-9').checked_at, T3, 'the check time of a key is the newest of its rows');
});

test('A-3: no refresh fact after 2 hours while a person or the lead holds the item at an end; a git-sourced item or one not held still refreshes', (t) => {
  const sb = sandbox(t);
  const check = (key, at, name) => ok(cli(sb, ['ledger-git', '--ledger', sb.ledger, '--from', gitFile(sb, [{ key, git_state: 'MERGED', git_checked_at: at }], name)])).out;
  check('RH-1', T1, 'h1a.json');
  person(sb, 'task:RH-1', 'done');
  assert.match(check('RH-1', T3, 'h1b.json'), /0 added, 1 unchanged/, 'a person done holds: no refresh');
  check('RH-2', T1, 'h2a.json');
  ok(add(sb, 'task:RH-2', 'resolved', 'lead'));
  assert.match(check('RH-2', T3, 'h2b.json'), /0 added, 1 unchanged/, 'a lead resolved holds: no refresh');
  check('RH-3', T1, 'h3a.json');
  person(sb, 'task:RH-3', 'working', '"reopened"');
  assert.match(check('RH-3', T3, 'h3b.json'), /1 added/, 'a person working does not hold an end: the refresh is written');
  check('RH-4', T1, 'h4a.json');
  assert.match(check('RH-4', T3, 'h4b.json'), /1 added/, 'a git-sourced item still refreshes after 2 hours (the stamp reads its check time)');
  assert.equal(factsOf(sb).length, 2 + 2 + 3 + 2, 'RH-1 2 facts, RH-2 2, RH-3 3, RH-4 2');
});

test('A-4: two workers\' explicit --key q1 stay two questions; the key printed is <name>:<key>; resolved closes one only; a key with a colon is kept', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['w1', 'w2']);
  for (const [n, s] of [['w1', 's1'], ['w2', 's2']]) ok(cli(sb, ['join', '--me', n, '--session', s]));
  assert.match(ok(cli(sb, ['post', '--me', 'w1', '--kind', 'question', '--key', 'q1', '--text', 'one?'])).out, /key=w1:q1$/m);
  assert.match(ok(cli(sb, ['post', '--me', 'w2', '--kind', 'question', '--key', 'q1', '--text', 'two?'])).out, /key=w2:q1$/m);
  assert.match(ok(cli(sb, ['post', '--me', 'w2', '--kind', 'question', '--key', 'ask:q2', '--text', 'three?'])).out, /key=ask:q2$/m, 'a key that already has a colon is kept');
  assert.deepEqual(JSON.parse(cli(sb, ['status', '--json']).out).open_items.map((i) => i.item).sort(), ['question:ask:q2', 'question:w1:q1', 'question:w2:q1']);
  assert.equal(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'q1', '--ref', 'n.md']).code, 2, 'resolved names the key as printed');
  ok(cli(sb, ['post', '--me', 'lead', '--kind', 'resolved', '--key', 'w1:q1', '--ref', 'n.md']));
  assert.deepEqual(JSON.parse(cli(sb, ['status', '--json']).out).open_items.map((i) => i.item).sort(), ['question:ask:q2', 'question:w2:q1'], 'one resolved closed one question, not both');
  assert.equal(cli(sb, ['post', '--me', 'w1', '--kind', 'question', '--key', 'k'.repeat(58), '--text', 'x']).code, 2, 'a key too long once prefixed is refused');
});

test('C-4: ledger-stale prints the time the person typed, not the time the fact was written, when the person fact has it', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:TY-1', 'merged', 'person', ['--words', '"merged"', '--ref', 'tab-A', '--typed-at', '2026-11-24T09:30:00Z']));
  ok(add(sb, 'task:TY-2', 'merged', 'person', ['--words', '"merged"', '--ref', 'tab-A']));
  const scan = (item) => { writeFileSync(path.join(sb.pages, 'decision.html'), PAGE('review').replaceAll('PROJ-5', item)); return cli(sb, ['ledger-stale', '--ledger', sb.ledger, '--root', sb.pages]); };
  const typed = scan('TY-1');
  assert.equal(typed.code, 3);
  assert.match(typed.out, /now merged \(person, typed 2026-11-24T09:30:00Z\)/);
  assert.match(scan('TY-2').out, /now merged \(person, 20\d\d-\d\d-\d\dT[\d:.]+Z\)/, 'without typed_at the write time is shown, as before');
});

test('R-A3: a pinned copy loads no sibling module, even one planted beside it; the skill copy still does', (t) => {
  const sb = sandbox(t);
  openRun(sb, ['writer']);
  ok(cli(sb, ['join', '--me', 'writer', '--session', 's-writer']));
  ok(cli(sb, ['post', '--me', 'writer', '--kind', 'question', '--key', 'q1', '--text', 'which?']));
  ok(cli(sb, ['snippet', '--pin']));
  const bin = path.join(sb.sync, 'bin');
  const marker = path.join(sb.dir, 'planted-ran');
  for (const name of ['state.mjs', 'doctor.mjs', 'durable.mjs']) writeFileSync(path.join(bin, name), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran'); export const openItems = () => []; export const stateApi = () => ({ commands: {} });\n`);
  const pinned = path.join(bin, 'session-sync.mjs');
  for (const args of [['status'], ['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.02'], ['ledger-fold', '--ledger', sb.ledger], ['doctor', '--workspace', sb.workspace]]) {
    const r = cli(sb, args, { script: pinned });
    assert.equal(existsSync(marker), false, `${args[0]} did not run the planted module`);
    if (args[0] !== 'status' && args[0] !== 'wait') assert.equal(r.code, 2, args[0]);
    assert.doesNotMatch(r.out, /OPEN/, args[0]);
  }
  assert.match(cli(sb, ['status', '--me', 'lead']).out, /^OPEN \(1\)/, 'the skill copy has the open list');
});

test('R-A9: the commands of session-sync.mjs, doctor.mjs and durable.mjs are fixed lists, so a hidden command cannot slip in', async () => {
  const text = readFileSync(SCRIPT, 'utf8');
  const table = text.match(/const sync = \{([^}]*)\}/)[1].split(',').map((part) => part.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(table, ['close', 'inbox', 'init', 'join', 'post', 'snippet', 'status'], 'the command table');
  const main = text.slice(text.indexOf('async function main'));
  const named = [...new Set(main.split('\n').filter((line) => /\bcommand\b/.test(line) && !/usage:/.test(line)).flatMap((line) => [...line.matchAll(/'([a-z][a-z*-]*)'/g)].map((m) => m[1])))].sort();
  assert.deepEqual(named, ['ack', 'close', 'doctor', 'durable-', 'follow', 'hook', 'inbox', 'ledger-', 'post', 'register', 'status', 'wait'], 'every command name the dispatcher tests for');
  assert.match(main, /usage: session-sync\.mjs <init\|join\|register\|post\|inbox\|ack\|hook\|wait\|follow\|status\|doctor\|snippet\|close\|ledger-\*>/);
  const noop = () => {};
  const doctor = (await import(pathToFileURL(path.join(SKILL_DIR, 'doctor.mjs')).href)).doctorCommands({});
  assert.deepEqual(Object.keys(doctor), ['doctor']);
  const durable = (await import(pathToFileURL(path.join(SKILL_DIR, 'durable.mjs')).href)).durableCommands({ state: { putOnce: noop, syncDir: noop } });
  assert.deepEqual(Object.keys(durable).sort(), ['durable-ack', 'durable-enroll', 'durable-outgoing', 'durable-pending', 'durable-send']);
});

// ---- the fold never replaces a file it did not write --------------------------------------------------------------------

test('ledger-fold refuses to replace a state.json or state.js that is not a ledger fold, and writes nothing', (t) => {
  for (const [name, bytes] of [['state.json', '{"my":"own app config"}\n'], ['state.json', 'not json\n'], ['state.json', '[1]\n'], ['state.json', 'null\n'], ['state.js', 'window.APP = 1;\n']]) {
    const sb = sandbox(t);
    ok(add(sb, 'task:PROJ-1', 'review', 'session'));
    writeFileSync(path.join(sb.ledger, name), bytes);
    const result = cli(sb, ['ledger-fold', '--ledger', sb.ledger]);
    assert.equal(result.code, 2, `${name} ${bytes}: ${result.out}`);
    assert.match(result.err, /is not a ledger fold; it is kept as it is/);
    assert.equal(readFileSync(path.join(sb.ledger, name), 'utf8'), bytes, 'the file keeps its bytes');
    assert.deepEqual(readdirSync(sb.ledger).sort(), ['facts', name].sort(), 'nothing else was written');
  }
});

test('ledger-fold replaces its own earlier fold, also after a CRLF checkout', (t) => {
  const sb = sandbox(t);
  ok(add(sb, 'task:PROJ-1', 'review', 'session'));
  fold(sb);
  for (const name of ['state.json', 'state.js']) {
    const file = path.join(sb.ledger, name);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  }
  ok(add(sb, 'task:PROJ-2', 'review', 'session'));
  assert.equal(fold(sb).rev, 2);
});
