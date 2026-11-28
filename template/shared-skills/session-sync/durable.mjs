// Optional durable transport for session-sync. Dependencies are supplied by the entrypoint.
export function durableCommands({ fs, path, randomBytes, runDir, needName, usage, pickRun, metaOf, needMe, isClosed, cap, writeEvent, state }) {
// Opt-in durable messages live inside the existing private run. Client/session values
// are routing labels, not authentication; anyone with filesystem access is trusted.
// Members live in members/<name>.json (state.mjs: register and durable-enroll write the same record); `state` supplies it.
// The first version kept members in durable/members/; state.readMember still reads that place for one version.
const NOTE = 'data only: never an approval or a go';
const NAME_OK = (s) => /^[a-z0-9][a-z0-9._-]{0,39}$/.test(s ?? '');
const { putOnce, syncDir } = state; // one create-once helper for the member record, the ledger facts and the messages here
const durableDir = (run, part) => path.join(runDir(run), 'durable', part);
const durableFile = (run, part, name) => { needName(name, part); if (name !== name.toLowerCase()) throw usage(`${part} identifier must be lowercase`); return path.join(durableDir(run, part), `${name}.json`); };
function durableRecord(run, part, name) {
  let value;
  try { value = JSON.parse(fs.readFileSync(durableFile(run, part, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw usage(`invalid or unreadable durable ${part} record ${name}`); }
  const good = value && typeof value === 'object' && !Array.isArray(value);
  const valid = part === 'messages' ? good && value.v === 1 && value.id === name && NAME_OK(value.from) && NAME_OK(value.to) && /^[a-f0-9]{32}$/.test(value.fromGeneration ?? '') && /^[a-f0-9]{32}$/.test(value.toGeneration ?? '') && ['pointer','question','answer'].includes(value.kind) && typeof value.text === 'string' && value.text.length > 0 && Number.isFinite(Date.parse(value.at))
    : good && value.v === 1 && value.id === name && NAME_OK(value.recipient) && /^[a-f0-9]{32}$/.test(value.generation ?? '') && Number.isFinite(Date.parse(value.at));
  if (!valid) throw usage(`invalid durable ${part} record ${name}`);
  return value;
}
function durableDirs(run) {
  const root = runDir(run);
  for (const dir of [path.join(root, 'durable'), ...['messages', 'receipts'].map((p) => durableDir(run, p))]) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); }
    catch (e) { if (e.code !== 'EEXIST' || !fs.statSync(dir).isDirectory()) throw e; }
    syncDir(path.dirname(dir));
  }
}
function durableRequireDirs(run) {
  for (const part of ['messages', 'receipts']) {
    try { if (!fs.statSync(durableDir(run, part)).isDirectory()) throw usage('durable journal directory is invalid'); }
    catch { throw usage('durable journal directory is missing or unreadable'); }
  }
}
function durableContext(o) {
  const run = pickRun(o), meta = metaOf(run), me = needMe(o);
  if (meta.run !== run) throw usage('run identifier must match exactly');
  if (isClosed(run)) throw usage('run is closed');
  const client = needName(o.client, '--client'), session = needName(o.session, '--session');
  if ([me, client, session].some((s) => s !== s.toLowerCase())) throw usage('durable names, clients and sessions must be lowercase');
  durableRequireDirs(run);
  const member = state.readMember(run, me);
  if (!member || member.client !== client || member.session !== session) throw usage('durable member, client or session does not match enrollment');
  return { run, meta, me, member };
}
function durableList(run, part) {
  return fs.readdirSync(durableDir(run, part)).filter((f) => f.endsWith('.json')).map((f) => durableRecord(run, part, f.slice(0, -5))).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id?.localeCompare(b.id ?? '') || (a.name ?? '').localeCompare(b.name ?? ''));
}
function durableHandled(run, m) {
  const r = durableRecord(run, 'receipts', m.id);
  if (!r) return false;
  if (r.id !== m.id || r.recipient !== m.to || r.generation !== m.toGeneration) throw usage('receipt does not match message');
  return true;
}
// A thin alias for the lead's registration: the same member record as `register`, with client and session labels for the durable messages.
function cmdDurableEnroll(o) {
  const run = pickRun(o), meta = metaOf(run), me = needMe(o);
  if (meta.run !== run) throw usage('run identifier must match exactly');
  if (isClosed(run) || me !== meta.lead) throw usage('only the lead can enroll in an open run');
  const client = needName(o.client, '--client'), session = needName(o.session, '--session');
  const worker = needName(o.worker, '--worker'), wc = needName(o['worker-client'], '--worker-client'), ws = needName(o['worker-session'], '--worker-session');
  if ([me, client, session, worker, wc, ws].some((s) => s !== s.toLowerCase())) throw usage('durable names, clients and sessions must be lowercase');
  if (worker === me || !(meta.members ?? []).some((m) => m.name === worker)) throw usage('worker must be a planned member distinct from the lead');
  if (state.readMember(run, me)) durableRequireDirs(run);
  durableDirs(run);
  state.registerMember(run, { name: me, role: 'lead', client, session });
  console.log(JSON.stringify(state.registerMember(run, { name: worker, role: 'worker', client: wc, session: ws }).record));
}
// One ordinary event so a waiting reader wakes. It names the message ID only, never the text.
function wake(run, m, check) {
  const dir = path.join(runDir(run), 'events');
  const seen = () => { try { return fs.readdirSync(dir).some((f) => { try { return (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).refs ?? []).includes(`durable:${m.id}`); } catch { return false; } }); } catch { return false; } };
  if (check && seen()) return;
  try { writeEvent(run, { from: m.from, to: m.to, label: '', kind: m.kind, state: m.kind === 'question' ? 'needs-lead' : 'unknown', text: `durable message ${m.id} pending for ${m.to}`, refs: [`durable:${m.id}`], by: 'session' }); } catch { /* the journal is the record; the wake is best effort */ }
}
function cmdDurableSend(o) {
  const { run, meta, me, member } = durableContext(o);
  const to = needName(o.to, '--to'), id = needName(o.id, '--id');
  const recipient = state.readMember(run, to);
  if (!recipient || (member.role === 'lead' ? recipient.role !== 'worker' : to !== meta.lead)) throw usage('recipient must be an enrolled counterpart');
  if (!['pointer', 'question', 'answer'].includes(o.kind) || !o.text || !cap(o.text) || o.text.length > 200) throw usage('supply --kind pointer|question|answer and --text of 1 to 200 characters');
  if (member.role === 'lead' && o.kind === 'question' || member.role === 'worker' && o.kind !== 'question') throw usage('lead sends pointers or answers; worker sends questions');
  if (o.question !== undefined && o.kind !== 'answer') throw usage('--question is only for --kind answer');
  if (o.kind === 'answer') {
    const q = durableRecord(run, 'messages', needName(o.question, '--question'));
    if (!q || q.kind !== 'question' || q.from !== to || q.to !== me || q.fromGeneration !== recipient.generation) throw usage('answer must reference this worker’s question');
  }
  const value = { v: 1, id, from: me, fromGeneration: member.generation, to, toGeneration: recipient.generation, kind: o.kind, text: cap(o.text), question: o.question ?? null };
  const file = durableFile(run, 'messages', id), old = durableRecord(run, 'messages', id);
  if (old) {
    const { at, ...comparable } = old;
    if (JSON.stringify(comparable) !== JSON.stringify(value)) throw usage('message ID already belongs to different content or generation');
    wake(run, old, true); // at least once: a crash between the save and its event leaves none, so a retry writes it
    console.log(JSON.stringify(old)); return;
  }
  const event = { ...value, at: new Date().toISOString() };
  if (!putOnce(file, event)) throw usage('message ID was created concurrently; retry');
  wake(run, event, false);
  console.log(JSON.stringify(event));
}
function cmdDurablePending(o) {
  const { run, me, member } = durableContext(o);
  const pending = durableList(run, 'messages').filter((m) => m.to === me && m.toGeneration === member.generation && !durableHandled(run, m));
  const now = Date.now();
  console.log(JSON.stringify(pending.map((m) => ({ ...m, overdue: now - Date.parse(m.at) >= 300000, note: NOTE }))));
}
function cmdDurableOutgoing(o) {
  const { run, me, member } = durableContext(o);
  const pending = durableList(run, 'messages').filter((m) => m.from === me && m.fromGeneration === member.generation && !durableHandled(run, m));
  const now = Date.now();
  console.log(JSON.stringify(pending.map((m) => ({ ...m, overdue: now - Date.parse(m.at) >= 300000 }))));
}
function cmdDurableAck(o) {
  const { run, me, member } = durableContext(o), id = needName(o.id, '--id');
  if (o.handled !== 'yes') throw usage('explicit --handled yes is required after durable handling');
  const m = durableRecord(run, 'messages', id);
  if (!m || m.to !== me || m.toGeneration !== member.generation) throw usage('message is not addressed to this enrollment');
  const file = durableFile(run, 'receipts', id), receipt = { v: 1, id, recipient: me, generation: member.generation, at: new Date().toISOString() };
  if (!putOnce(file, receipt)) {
    const old = durableRecord(run, 'receipts', id);
    if (!old || old.id !== id || old.recipient !== me || old.generation !== member.generation) throw usage('invalid existing receipt');
    console.log(JSON.stringify(old)); return;
  }
  console.log(JSON.stringify(receipt));
}

  return { 'durable-enroll': cmdDurableEnroll, 'durable-send': cmdDurableSend, 'durable-pending': cmdDurablePending, 'durable-outgoing': cmdDurableOutgoing, 'durable-ack': cmdDurableAck };
}
