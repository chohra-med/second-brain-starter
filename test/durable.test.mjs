import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, openSync, closeSync, fsyncSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fsDefault from 'node:fs';
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template', 'shared-skills', 'session-sync');
const script = path.join(skillDir, 'session-sync.mjs');
test('durable addressed round trip survives separate processes and retries', t => {
 const home = mkdtempSync(path.join(tmpdir(), 'sync-durable-')); t.after(() => rmSync(home,{recursive:true,force:true}));
 const call=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,SESSION_SYNC_HOME:home}});
 const ok=(...args)=>{const r=call(...args);assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
 const bad=(...args)=>assert.equal(call(...args).status,2);
 const lead=['--me','lead','--client','codex','--session','manager'];
 const worker=['--me','worker','--client','claude','--session','worker1'];
 ok('init','--run','r','--lead','lead','--member','worker:Worker:task','--member','worker2:Second:task');
 ok('durable-enroll',...lead,'--worker','worker','--worker-client','claude','--worker-session','worker1');
 bad('durable-enroll',...lead,'--worker','worker2','--worker-client','claude','--worker-session','worker1');
 bad('durable-enroll',...lead,'--worker','worker2','--worker-client','codex','--worker-session','manager');
 ok('durable-enroll',...lead,'--worker','worker2','--worker-client','other','--worker-session','worker1');
 ok('durable-send',...lead,'--to','worker','--id','p1','--kind','pointer','--text','file');
 assert.equal(JSON.parse(ok('durable-pending',...worker)).length,1);
 const msgFile=path.join(home,'r','durable','messages','p1.json');
 const oldMessage=JSON.parse(readFileSync(msgFile)); oldMessage.at='2000-01-01T00:00:00.000Z'; writeFileSync(msgFile,JSON.stringify(oldMessage));
 assert.equal(JSON.parse(ok('durable-pending',...worker))[0].overdue,true);
 assert.equal(JSON.parse(ok('durable-outgoing',...lead))[0].overdue,true);
 bad('durable-ack',...worker,'--id','P1','--handled','yes');
 bad('durable-pending','--me','Worker','--client','claude','--session','worker1');
 bad('durable-send',...lead,'--to','worker','--id','empty','--kind','pointer','--text','   ');
 ok('join','--me','worker','--session','none');
 ok('inbox','--me','worker');
 assert.equal(JSON.parse(ok('durable-pending',...worker)).length,1);
 bad('durable-pending','--me','worker','--client','other','--session','worker1');
 bad('durable-ack',...lead,'--id','p1','--handled','yes');
 ok('durable-send',...lead,'--to','worker','--id','p1','--kind','pointer','--text','file');
 bad('durable-send',...lead,'--to','worker','--id','p1','--kind','pointer','--text','other');
 bad('durable-enroll',...lead,'--worker','worker','--worker-client','claude','--worker-session','worker2');
 // Persist a pointer-derived item before its receipt; a second process repeats the upsert safely.
 const pointerBoard=path.join(home,'pointer-board.json');
 const persist=(file, rows)=>{const temp=file+'.tmp'; const fd=openSync(temp,'w',0o600); try { writeFileSync(fd,JSON.stringify(rows)); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp,file); if (process.platform === 'win32') return; /* Windows refuses to flush a directory handle (EPERM) */ const dir=openSync(home,'r'); try { fsyncSync(dir); } finally { closeSync(dir); }};
 const pointerSave=()=>{let rows={}; try { rows=JSON.parse(readFileSync(pointerBoard)); } catch(e) { if(e.code!=='ENOENT') throw e; } for(const m of JSON.parse(ok('durable-pending',...worker))) { rows[m.id]=m.text; rows['question-q1']='pending'; rows['question-q2']='pending'; } persist(pointerBoard,rows);};
 pointerSave(); pointerSave(); assert.deepEqual(JSON.parse(readFileSync(pointerBoard)),{p1:'file','question-q1':'pending','question-q2':'pending'});
 ok('durable-ack',...worker,'--id','p1','--handled','yes');
 for(const id of ['q1','q2']) ok('durable-send',...worker,'--to','lead','--id',id,'--kind','question','--text',id);
 assert.equal(JSON.parse(ok('durable-pending',...lead)).length,2);
 // Before the board write: a fresh process still sees both questions.
 assert.equal(JSON.parse(ok('durable-pending',...lead)).length,2);
 const board=path.join(home,'synthetic-board.json');
 const save=()=>{let rows={};try{rows=JSON.parse(readFileSync(board))}catch(e){if(e.code!=='ENOENT') throw e;} for(const m of JSON.parse(ok('durable-pending',...lead))) rows[m.id]=m.text; persist(board,rows);};
 save(); // the board is saved, the receipt is not yet written
 save(); assert.deepEqual(JSON.parse(readFileSync(board)),{q1:'q1',q2:'q2'});
 ok('durable-send',...lead,'--to','worker','--id','a1','--kind','answer','--question','q1','--text','answer');
 ok('durable-ack',...lead,'--id','q1','--handled','yes');
 ok('durable-ack',...lead,'--id','q1','--handled','yes');
 assert.deepEqual(JSON.parse(ok('durable-pending',...lead)).map(x=>x.id),['q2']);
 assert.deepEqual(JSON.parse(ok('durable-pending',...worker)).map(x=>x.id),['a1']);
 assert.deepEqual(JSON.parse(ok('durable-pending',...lead)).map(x=>x.id),['q2']);
 bad('durable-ack',...lead,'--id','q2');
 ok('durable-ack',...lead,'--id','q2','--handled','yes');
 ok('durable-ack',...worker,'--id','a1','--handled','yes');
 bad('durable-enroll',...lead,'--worker','worker','--worker-client','other','--worker-session','worker2');
 assert.deepEqual(JSON.parse(ok('durable-pending',...worker)),[]);
 bad('durable-pending','--me','worker','--client','other','--session','worker2');
 // A missing expected journal directory fails closed rather than appearing empty.
 const messages=path.join(home,'r','durable','messages'); const moved=messages+'-moved'; renameSync(messages,moved);
 bad('durable-pending',...worker); bad('durable-outgoing',...lead); bad('durable-enroll',...lead,'--worker','worker','--worker-client','claude','--worker-session','worker1'); renameSync(moved,messages);
 // Corrupt boards do not get overwritten by a retry.
 writeFileSync(board,'{'); assert.throws(save); writeFileSync(board,JSON.stringify({q1:'q1',q2:'q2'}));
 // Corrupt records fail closed, including a corrupt receipt.
 const receipt=path.join(home,'r','durable','receipts','a1.json'); writeFileSync(receipt,'{');
 bad('durable-pending',...worker);
 // Legacy inbox remains usable independently.
 ok('join','--me','worker','--session','none');
 ok('post','--me','worker','--kind','report','--state','done','--text','legacy');
 assert.match(ok('inbox','--me','lead'),/legacy/);
});

test('simultaneous enrollment and message-ID retries never replace records', async t => {
 const home = mkdtempSync(path.join(tmpdir(),'sync-race-')); t.after(()=>rmSync(home,{recursive:true,force:true}));
 const args=(...x)=>[script,...x]; const env={...process.env,SESSION_SYNC_HOME:home};
 const init=spawnSync(process.execPath,args('init','--run','r','--lead','lead','--member','worker:Worker:task'),{env,encoding:'utf8'}); assert.equal(init.status,0,init.stderr);
 const {spawn}=await import('node:child_process');
 const run=(...x)=>new Promise(resolve=>{const p=spawn(process.execPath,args(...x),{env}); let out=''; p.stdout.on('data',d=>out+=d); p.on('close',status=>resolve({status,out}));});
 const lead=['--me','lead','--client','codex','--session','manager'];
 const enroll=(session)=>run('durable-enroll',...lead,'--worker','worker','--worker-client','client','--worker-session',session);
 const enrolled=await Promise.all([enroll('a'),enroll('b')]); assert.equal(enrolled.filter(r=>r.status===0).length,1);
 const member=JSON.parse(enrolled.find(r=>r.status===0).out);
 const send=(text)=>run('durable-send',...lead,'--to','worker','--id','same','--kind','pointer','--text',text);
 const sent=await Promise.all([send('one'),send('two')]); assert.equal(sent.filter(r=>r.status===0).length,1);
 const pending=await run('durable-pending','--me','worker','--client','client','--session',member.session);
 assert.equal(pending.status,0); assert.equal(JSON.parse(pending.out).length,1);
});

// --- wake and the approval sentence ---------------------------------------------------------------------------------

function trio(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'sync-wake-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const call = (args, input) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', input, env: { ...process.env, SESSION_SYNC_HOME: home } });
  const ok = (...args) => { const r = call(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const lead = ['--me', 'lead', '--client', 'one', '--session', 'manager'];
  const worker = ['--me', 'worker', '--client', 'two', '--session', 'task'];
  ok('init', '--run', 'r', '--lead', 'lead', '--member', 'worker:Worker:task');
  ok('durable-enroll', ...lead, '--worker', 'worker', '--worker-client', 'two', '--worker-session', 'task');
  const events = () => readdirSync(path.join(home, 'r', 'events')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(home, 'r', 'events', f), 'utf8')));
  return { home, call, ok, lead, worker, events };
}

test('a durable question wakes a waiting lead once, without carrying the message text', (t) => {
  const { call, ok, lead, worker, events } = trio(t);
  ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'secret question body');
  const woke = call(['wait', '--me', 'lead', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(woke.status, 0, woke.stderr);
  assert.match(woke.stdout, /worker-q1/);
  assert.doesNotMatch(woke.stdout, /secret question body/);
  assert.equal(events().length, 1);
  assert.deepEqual(events()[0].refs, ['durable:worker-q1']);
  ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'secret question body'); // a retry
  assert.equal(events().length, 1, 'a retry adds no second event');
  assert.equal(JSON.parse(ok('durable-pending', ...lead)).length, 1);
});

test('a retry after a crash between the save and its wake event writes the missing event once, still without the text', (t) => {
  const { home, ok, lead, worker, events } = trio(t);
  const send = () => ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'secret question body');
  send();
  const dir = path.join(home, 'r', 'events');
  for (const f of readdirSync(dir)) rmSync(path.join(dir, f)); // simulate the crash: message saved, wake event never written
  assert.equal(events().length, 0);
  send(); // the retry
  assert.equal(events().length, 1, 'the retry wrote the missing wake event');
  assert.deepEqual(events()[0].refs, ['durable:worker-q1']);
  assert.equal(events()[0].kind, 'question');
  assert.doesNotMatch(JSON.stringify(events()[0]), /secret question body/);
  send(); // a second retry
  assert.equal(events().length, 1, 'an event that exists is not written again');
  assert.equal(JSON.parse(ok('durable-pending', ...lead)).length, 1);
});

test('a lead answer wakes the worker and its wake line shows kind answer', (t) => {
  const { call, ok, lead, worker, events } = trio(t);
  ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'which?');
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-a1', '--kind', 'answer', '--question', 'worker-q1', '--text', 'see the board');
  const woke = call(['wait', '--me', 'worker', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(woke.status, 0, woke.stderr);
  assert.match(woke.stdout, /lead-a1/);
  assert.deepEqual(events().map((e) => e.kind).sort(), ['answer', 'question']);
  assert.match(woke.stdout, /\banswer\b/, 'the digest line shows kind answer, not pointer');
  assert.doesNotMatch(woke.stdout, /\bpointer\b/);
});

test('every pending item says it is data and never an approval or a go, and the skill says an answer is not approval', (t) => {
  const { ok, lead, worker } = trio(t);
  ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'may I push?');
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-a1', '--kind', 'answer', '--question', 'worker-q1', '--text', 'yes');
  for (const who of [lead, worker]) {
    const items = JSON.parse(ok('durable-pending', ...who));
    assert.equal(items.length, 1);
    for (const item of items) assert.match(item.note, /never an approval or a go/);
  }
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(skill.includes("never the person's approval or a go"));
  assert.match(skill, /answer points to where the person answered/i);
});

// --- hardening ------------------------------------------------------------------------------------------------------

test('pending messages come back in send order, not in file-name order (q2 before q10)', (t) => {
  const { ok, lead, worker } = trio(t);
  for (const id of ['q2', 'q10', 'q1']) ok('durable-send', ...worker, '--to', 'lead', '--id', id, '--kind', 'question', '--text', id);
  assert.deepEqual(JSON.parse(ok('durable-pending', ...lead)).map((m) => m.id), ['q2', 'q10', 'q1']);
  assert.deepEqual(JSON.parse(ok('durable-outgoing', ...worker)).map((m) => m.id), ['q2', 'q10', 'q1']);
});

test('an unreadable record names its identifier in the error, and still fails closed', (t) => {
  const { home, call, ok, lead, worker } = trio(t);
  ok('durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--text', 'x');
  writeFileSync(path.join(home, 'r', 'durable', 'messages', 'zz.json'), '{');
  for (const who of [lead, worker]) {
    const r = call(['durable-pending', ...who]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /zz/);
  }
});

test('--question is refused unless the kind is answer', (t) => {
  const { call, lead, worker } = trio(t);
  const r = call(['durable-send', ...worker, '--to', 'lead', '--id', 'worker-q1', '--kind', 'question', '--question', 'other', '--text', 'x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--question/);
  const p = call(['durable-send', ...lead, '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--question', 'other', '--text', 'x']);
  assert.equal(p.status, 2);
});

test('enroll and send still work where a directory cannot be opened for sync (Windows-style errors)', async (t) => {
  const { durableCommands } = await import(pathToFileURL(path.join(skillDir, 'durable.mjs')).href);
  const { stateApi } = await import(pathToFileURL(path.join(skillDir, 'state.mjs')).href);
  const home = mkdtempSync(path.join(tmpdir(), 'sync-stub-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'r', 'events'), { recursive: true });
  for (const code of ['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP']) {
    const run = `r-${code.toLowerCase()}`;
    mkdirSync(path.join(home, run, 'events'), { recursive: true });
    const stub = { ...fsDefault, openSync: (target, ...rest) => { if (fsDefault.statSync(target, { throwIfNoEntry: false })?.isDirectory()) throw Object.assign(new Error('stub'), { code }); return fsDefault.openSync(target, ...rest); } };
    const out = [];
    const log = console.log; console.log = (line) => out.push(line);
    try {
      const needName = (v, what) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(v ?? '')) throw new Error(what); return v; };
      const usage = (m) => new Error(m);
      const base = { fs: stub, path, randomBytes: (n) => Buffer.alloc(n, 7), runDir: (id) => path.join(home, id), needName, usage };
      const commands = durableCommands({ ...base, pickRun: (o) => o.run, metaOf: () => ({ run, lead: 'lead', members: [{ name: 'worker' }] }), needMe: (o) => o.me, isClosed: () => false, cap: (x) => x, writeEvent: () => {}, state: stateApi(base) }); // the member record and the create-once helper come from state.mjs
      const lead = { run, me: 'lead', client: 'one', session: 'manager' };
      commands['durable-enroll']({ ...lead, worker: 'worker', 'worker-client': 'two', 'worker-session': 'task' });
      commands['durable-send']({ ...lead, to: 'worker', id: 'p1', kind: 'pointer', text: 'x' });
      commands['durable-pending']({ run, me: 'worker', client: 'two', session: 'task' });
    } finally { console.log = log; }
    assert.equal(JSON.parse(out.at(-1)).length, 1, code);
  }
});

test('the wake line for a durable message has no verb addressed to the reader and names the recipient', (t) => {
  const { call, ok, lead, worker, events } = trio(t);
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--text', 'see the board');
  const text = events()[0].text;
  assert.equal(text, 'durable message lead-p1 pending for worker');
  // An agent that treats tool output as data stops on an instruction. No imperative word and no command name may appear.
  assert.doesNotMatch(text, /\b(run|use|call|read|open|check|execute|see|do|type|durable-[a-z]+)\b/i);
  const woke = call(['wait', '--me', 'worker', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(woke.status, 0, woke.stderr);
  assert.match(woke.stdout, /durable message lead-p1 pending for worker/);
  assert.doesNotMatch(woke.stdout, /run durable-pending/);
});

test('after durable-ack the wake line no longer wakes wait, but an unrelated event still does', (t) => {
  const { call, ok, lead, worker } = trio(t);
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--text', 'see the board');
  assert.equal(JSON.parse(ok('durable-pending', ...worker)).length, 1);
  ok('durable-ack', ...worker, '--id', 'lead-p1', '--handled', 'yes');
  const quiet = call(['wait', '--me', 'worker', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(quiet.status, 4, `a handled wake line must not wake wait: ${quiet.stdout}`);
  assert.equal(quiet.stdout, '');
  // The cursor did not move past anything else: a later unrelated event is still delivered, and the handled line is not in its digest.
  ok('post', '--me', 'lead', '--to', 'worker', '--kind', 'pointer', '--text', 'unrelated news');
  const woke = call(['wait', '--me', 'worker', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(woke.status, 0, woke.stderr);
  assert.match(woke.stdout, /unrelated news/);
  assert.doesNotMatch(woke.stdout, /lead-p1/);
});

test('an acknowledged wake line is left out of the digest while another unacknowledged message still wakes', (t) => {
  const { call, ok, lead, worker } = trio(t);
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-p1', '--kind', 'pointer', '--text', 'one');
  ok('durable-send', ...lead, '--to', 'worker', '--id', 'lead-p2', '--kind', 'pointer', '--text', 'two');
  ok('durable-ack', ...worker, '--id', 'lead-p1', '--handled', 'yes');
  const woke = call(['wait', '--me', 'worker', '--settle', '0', '--interval', '1', '--timeout', '0.05']);
  assert.equal(woke.status, 0, woke.stderr);
  assert.match(woke.stdout, /lead-p2/);
  assert.doesNotMatch(woke.stdout, /lead-p1/);
});
