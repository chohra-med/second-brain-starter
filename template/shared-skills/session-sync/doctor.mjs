// Optional doctor for session-sync. Dependencies are supplied by the entrypoint; this file imports nothing.
// Reads only; prints names, counts and ages, never event text. The one child process (claude --version) runs only behind --claude-version.
export function doctorCommands({ fs, path, os, NAME, readJson, syncHome, openRuns, runDir, needName, loadEvents, knownNames, seenFile, isClosed, alive, tilde, fileHash, checkNode, registered }) {
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
    const unjoined = (meta.members ?? []).filter((m) => !fs.existsSync(seenFile(run, m.name)) && !registered(run).some((r) => r.name === m.name)).map((m) => m.name); // a member the lead registered needs no join
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
    const beside = (() => { try { return fs.readdirSync(path.dirname(script)).filter((f) => f.endsWith('.mjs') && f !== path.basename(script)); } catch { return []; } })();
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) trust.push(`${tilde(script)} is inside the workspace, where agents can edit it; run \`snippet --pin\` and apply the new hooks`);
    else if (beside.length) trust.push(`${tilde(path.dirname(script))} holds ${beside.join(', ')} beside the pinned hook; the hook runs one file alone, so delete ${beside.length > 1 ? 'them' : 'it'}`);
    else if (recorded && recorded !== fileHash(script)) trust.push(`${tilde(script)} changed since it was pinned; read it, then run \`snippet --pin\` again`);
    else if (skillCopy && skillCopy !== script && fileHash(skillCopy) !== fileHash(script)) trust.push(`${tilde(script)} differs from the skill copy in the workspace; read the change, then run \`snippet --pin\` again`);
  }
  add('D12', hookScripts.size === 0 ? 'SKIP' : trust.length ? 'WARN' : 'OK', hookScripts.size === 0 ? 'hook script: no session-sync hook in the settings files' : trust.length ? `hook script: ${trust.join('; ')}` : `hook script: ${hookScripts.size} script(s) outside the workspace, matching the skill copy`);

  const fail = checks.some((c) => c.status === 'FAIL');
  if (o.json) console.log(JSON.stringify({ verdict: fail ? 'FAIL' : checks.some((c) => rank[c.status] === 1) ? 'WARN' : 'OK', checks }, null, 2));
  else for (const c of checks) console.log(`${c.status} ${c.id} ${c.text}${c.row && c.status !== 'OK' && c.status !== 'SKIP' ? `  [HOW-IT-WORKS: "${c.row}"]` : ''}`);
  return fail ? 3 : 0;
}

  return { doctor: cmdDoctor };
}
