#!/usr/bin/env node
// Usage dashboard: reads the Claude Code transcript files on this machine and prints,
// per session, the tokens used, an estimated cost at list prices, the peak context,
// and how often each skill and each slash command was used.
// It only reads. Standard library only. Specification: 00-Meta/SDD/packs/2026-10-13-usage-dashboard-design-note.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICES = path.join(HERE, 'usage-prices.json');
const DEFAULT_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const COMMAND_RE = /^\/?[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const UNREADABLE = '(unreadable name)';
const SYNTHETIC = '<synthetic>';
const CLASSES = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];
const ESTIMATE_NOTE = 'Spend figures are estimates at list prices for the same tokens on the pay-per-token API. They are not a bill and not your subscription allowance.';

const USAGE = `Usage: node scripts/usage-dashboard.mjs [options]

Reads the Claude Code transcript files on this machine and prints, per session, the
tokens used, an estimated cost at list prices, the peak context, and skill and command
use. It writes nothing.

Options:
  --projects-dir DIR   folder with the transcripts (default: ~/.claude/projects)
  --prices FILE        price file (default: usage-prices.json beside this script;
                       with neither, the output shows tokens only)
  --since DATE         keep sessions that started on or after DATE (YYYY-MM-DD, UTC)
  --until DATE         keep sessions that started on or before DATE (YYYY-MM-DD, UTC)
  --project TEXT       keep project folders whose name contains TEXT
  --top N              show N sessions in the table (default 20, 0 = all). Totals,
                       models, skills and commands always cover every kept session.
  --json               print one JSON object instead of text
  --help               print this text

Exit codes: 0 clean, 1 bad input found in a transcript, 2 wrong use.
`;

class UsageError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const sumTokens = (t) => CLASSES.reduce((s, k) => s + t[k], 0);
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const getOrInit = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};
const bucket = () => ({ calls: 0, tokens: zeroTokens(), cost: 0, unpriced: 0 });

function addToBucket(b, counts, cost, pricesGiven) {
  b.calls++;
  for (const k of CLASSES) b.tokens[k] += counts[k];
  if (pricesGiven) {
    if (cost === null) b.unpriced++;
    else b.cost += cost;
  }
}

function mergeBucket(into, from) {
  into.calls += from.calls;
  for (const k of CLASSES) into.tokens[k] += from.tokens[k];
  into.cost += from.cost;
  into.unpriced += from.unpriced;
}

// ---------- arguments ----------

const VALUE_FLAGS = {
  '--projects-dir': 'projectsDir',
  '--prices': 'prices',
  '--since': 'since',
  '--until': 'until',
  '--project': 'project',
  '--top': 'top',
};

function checkDate(flag, value) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (d === null || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new UsageError(`${flag} needs a date in the form YYYY-MM-DD, got: ${value}`);
  }
  return value;
}

function parseArgs(argv) {
  const o = { projectsDir: null, prices: null, since: null, until: null, project: null, top: null, json: false, help: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') {
      o.help = true;
      return o;
    }
    if (a === '--json' || has(VALUE_FLAGS, a)) {
      if (seen.has(a)) throw new UsageError(`${a} given more than once`);
      seen.add(a);
    }
    if (a === '--json') {
      o.json = true;
      continue;
    }
    if (has(VALUE_FLAGS, a)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError(`missing value for ${a}`);
      o[VALUE_FLAGS[a]] = v;
      i++;
      continue;
    }
    throw new UsageError(`unknown option: ${a}`);
  }
  if (o.since !== null) o.since = checkDate('--since', o.since);
  if (o.until !== null) o.until = checkDate('--until', o.until);
  if (o.since !== null && o.until !== null && o.since > o.until) throw new UsageError('--since is later than --until');
  if (o.top !== null && !/^\d+$/.test(o.top)) throw new UsageError(`--top needs a whole number, 0 or more, got: ${o.top}`);
  o.top = o.top === null ? 20 : Number(o.top);
  return o;
}

// ---------- prices ----------

function loadPrices(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new UsageError(`cannot read price file: ${file}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UsageError(`price file is not valid JSON: ${file}`);
  }
  if (!isObj(data) || !isObj(data.models)) throw new UsageError(`price file has no models object: ${file}`);
  for (const [model, row] of Object.entries(data.models)) {
    if (!isObj(row)) throw new UsageError(`price file: model ${model} is not an object`);
    for (const field of CLASSES) {
      const v = row[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new UsageError(`price file: model ${model} needs a number for ${field}`);
      if (v < 0) throw new UsageError(`price file: model ${model} has a negative price for ${field}`);
    }
  }
  return data.models;
}

// ---------- reading transcripts ----------

// Calls fn(text, lineNumber, unterminated) for every line. Splits on the newline byte.
function forEachLine(buf, fn) {
  let start = 0;
  let lineNo = 0;
  while (start < buf.length) {
    let end = buf.indexOf(0x0a, start);
    const terminated = end !== -1;
    if (!terminated) end = buf.length;
    lineNo++;
    fn(buf.subarray(start, end).toString('utf8'), lineNo, !terminated);
    if (!terminated) break;
    start = end + 1;
  }
}

// Returns { counts } or { error } for the usage object of one assistant line.
// An absent field counts as 0; a present field (even null) must be a whole number of zero or more.
function readCounts(usage) {
  const cc = isObj(usage.cache_creation) ? usage.cache_creation : {};
  const fields = {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWriteAll: usage.cache_creation_input_tokens,
    cacheWrite5m: cc.ephemeral_5m_input_tokens,
    cacheWrite1h: cc.ephemeral_1h_input_tokens,
  };
  const v = {};
  for (const [k, x] of Object.entries(fields)) {
    if (x === undefined) continue;
    if (typeof x !== 'number' || !Number.isInteger(x)) return { error: 'not a whole number' };
    if (x < 0) return { error: 'negative count' };
    v[k] = x;
  }
  // The 1 hour count is its field when present. The 5 minute count is its field when present,
  // else the rest of cache_creation_input_tokens (never below 0), so a partial object drops nothing.
  const cacheWrite1h = v.cacheWrite1h ?? 0;
  const cacheWrite5m = v.cacheWrite5m ?? Math.max(0, (v.cacheWriteAll ?? 0) - cacheWrite1h);
  return {
    counts: {
      input: v.input ?? 0,
      output: v.output ?? 0,
      cacheRead: v.cacheRead ?? 0,
      cacheWrite5m,
      cacheWrite1h,
    },
  };
}

function noteTime(session, ts) {
  if (typeof ts !== 'string') return;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return;
  if (session.start === null || t < session.start) session.start = t;
  if (session.end === null || t > session.end) session.end = t;
}

function scanSkills(msg, seenIds, session) {
  if (!msg || !Array.isArray(msg.content)) return;
  for (const block of msg.content) {
    if (!isObj(block) || block.type !== 'tool_use' || block.name !== 'Skill') continue;
    if (typeof block.id === 'string') {
      if (seenIds.has(block.id)) continue;
      seenIds.add(block.id);
    }
    const raw = isObj(block.input) && typeof block.input.skill === 'string' ? block.input.skill : '';
    bump(session.skillUses, NAME_RE.test(raw) ? raw : UNREADABLE);
  }
}

function commandNames(msg) {
  const names = new Set();
  if (!msg) return names;
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  for (const m of text.matchAll(/<command-name>([\s\S]*?)<\/command-name>/g)) {
    names.add(COMMAND_RE.test(m[1]) ? m[1] : UNREADABLE);
  }
  return names;
}

function addCall(session, rec, isMain, prices) {
  const c = rec.counts;
  session.calls++;
  for (const k of CLASSES) session.tokens[k] += c[k];
  if (isMain) {
    session.peak = Math.max(session.peak, c.input + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h);
  } else {
    session.subTokens += sumTokens(c);
  }
  const modelName = NAME_RE.test(rec.model) ? rec.model : UNREADABLE;
  const row = prices !== null && has(prices, rec.model) ? prices[rec.model] : null;
  const cost = row === null ? null : CLASSES.reduce((s, k) => s + c[k] * row[k], 0) / 1e6;
  addToBucket(getOrInit(session.models, modelName, bucket), c, cost, prices !== null);
  if (prices !== null) {
    if (cost === null) session.unpriced++;
    else session.cost += cost;
  }
  if (rec.attr !== null) {
    const attrName = NAME_RE.test(rec.attr) ? rec.attr : UNREADABLE;
    addToBucket(getOrInit(session.skillAttr, attrName, bucket), c, cost, prices !== null);
  }
}

function scanFile(file, isMain, session, ctx) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    ctx.bad.push({ path: file, line: 0, reason: 'file cannot be read' });
    return;
  }
  ctx.filesRead++;
  const byId = new Map();
  const anonymous = [];
  const seenSkillIds = new Set();
  const bad = (line, reason) => ctx.bad.push({ path: file, line, reason });

  forEachLine(buf, (text, lineNo, unterminated) => {
    if (text.trim() === '') return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      // The last line of a file with no line ending is a session still being written.
      if (!unterminated) bad(lineNo, 'not valid JSON');
      return;
    }
    if (!isObj(obj)) {
      bad(lineNo, 'not a JSON object');
      return;
    }
    const msg = isObj(obj.message) ? obj.message : null;

    if (obj.type === 'assistant') {
      let counts = null;
      if (msg && isObj(msg.usage)) {
        const r = readCounts(msg.usage);
        if (r.error) {
          bad(lineNo, r.error);
          return;
        }
        counts = r.counts;
      }
      noteTime(session, obj.timestamp);
      scanSkills(msg, seenSkillIds, session);
      if (counts !== null && msg.model !== SYNTHETIC) {
        const rec = {
          model: typeof msg.model === 'string' ? msg.model : '',
          counts,
          attr: typeof obj.attributionSkill === 'string' && obj.attributionSkill !== '' ? obj.attributionSkill : null,
        };
        if (typeof msg.id === 'string' && msg.id !== '') byId.set(msg.id, rec);
        else anonymous.push(rec);
      }
      return;
    }

    noteTime(session, obj.timestamp);
    if (obj.type === 'user' && isMain) {
      for (const name of commandNames(msg)) bump(session.commandUses, name);
    }
  });

  for (const rec of byId.values()) addCall(session, rec, isMain, ctx.prices);
  for (const rec of anonymous) addCall(session, rec, isMain, ctx.prices);
}

function newSession(project, sid) {
  return {
    project,
    sid,
    start: null,
    end: null,
    calls: 0,
    tokens: zeroTokens(),
    subTokens: 0,
    peak: 0,
    cost: 0,
    unpriced: 0,
    models: new Map(),
    skillUses: new Map(),
    skillAttr: new Map(),
    commandUses: new Map(),
  };
}

function readDirOrThrow(dir, message) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new UsageError(`${message}: ${dir}`);
  }
}

// lstat, not stat: a symbolic link is never followed.
function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function subagentFiles(projectDir, sid, ctx) {
  const sessionDir = path.join(projectDir, sid);
  // A linked session folder was already counted as a skipped link in the project listing.
  const sessionStat = lstatOrNull(sessionDir);
  if (sessionStat === null || !sessionStat.isDirectory()) return [];
  const dir = path.join(sessionDir, 'subagents');
  const st = lstatOrNull(dir);
  if (st === null || !st.isDirectory()) {
    if (st !== null && st.isSymbolicLink()) ctx.skipped++;
    return [];
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    ctx.bad.push({ path: dir, line: 0, reason: 'folder cannot be read' });
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) {
      ctx.skipped++;
      continue;
    }
    if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) files.push(path.join(dir, e.name));
  }
  return files.sort();
}

function scanFolder(root, projectFilter, ctx) {
  const rootEntries = readDirOrThrow(root, 'cannot read projects folder');
  ctx.skipped += rootEntries.filter((d) => d.isSymbolicLink()).length;
  const projects = rootEntries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const project of projects) {
    if (projectFilter !== null && !project.includes(projectFilter)) continue;
    const projectDir = path.join(root, project);
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      ctx.bad.push({ path: projectDir, line: 0, reason: 'folder cannot be read' });
      continue;
    }
    ctx.skipped += entries.filter((e) => e.isSymbolicLink()).length;
    const mains = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort();
    for (const name of mains) {
      const sid = name.slice(0, -'.jsonl'.length);
      const session = newSession(project, sid);
      ctx.sessions.push(session);
      scanFile(path.join(projectDir, name), true, session, ctx);
      for (const sub of subagentFiles(projectDir, sid, ctx)) scanFile(sub, false, session, ctx);
    }
  }
}

// ---------- aggregation ----------

function sessionInRange(s, since, until) {
  if (since === null && until === null) return true;
  if (s.start === null) return false;
  const day = new Date(s.start).toISOString().slice(0, 10);
  return (since === null || day >= since) && (until === null || day <= until);
}

function aggregate(sessions, o, prices) {
  const kept = sessions.filter((s) => sessionInRange(s, o.since, o.until));
  const tokens = zeroTokens();
  const totals = { sessions: kept.length, calls: 0, tokens, cost: 0, unpriced: 0, subTokens: 0 };
  const byModel = new Map();
  const skills = new Map();
  const commands = new Map();
  const skillEntry = () => ({ uses: 0, sessions: 0, attr: bucket() });
  const commandEntry = () => ({ uses: 0, sessions: 0 });

  for (const s of kept) {
    totals.calls += s.calls;
    for (const k of CLASSES) tokens[k] += s.tokens[k];
    totals.cost += s.cost;
    totals.unpriced += s.unpriced;
    totals.subTokens += s.subTokens;
    for (const [name, b] of s.models) mergeBucket(getOrInit(byModel, name, bucket), b);
    for (const [name, n] of s.skillUses) {
      const e = getOrInit(skills, name, skillEntry);
      e.uses += n;
      e.sessions++;
    }
    for (const [name, b] of s.skillAttr) mergeBucket(getOrInit(skills, name, skillEntry).attr, b);
    for (const [name, n] of s.commandUses) {
      const e = getOrInit(commands, name, commandEntry);
      e.uses += n;
      e.sessions++;
    }
  }
  totals.allTokens = sumTokens(tokens);

  const ordered = [...kept].sort((a, b) => b.cost - a.cost ||sumTokens(b.tokens) - sumTokens(a.tokens) || (a.project + a.sid < b.project + b.sid ? -1 : 1));
  const shown = o.top === 0 ? ordered : ordered.slice(0, o.top);
  const starts = kept.filter((s) => s.start !== null).map((s) => s.start);
  const ends = kept.filter((s) => s.end !== null).map((s) => s.end);
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const dates = starts.length
    ? { from: dayOf(Math.min(...starts)), to: dayOf(Math.max(...ends)) }
    : { from: null, to: null };

  return {
    kept,
    shown,
    totals,
    dates,
    byModel: [...byModel].sort((a, b) => sumTokens(b[1].tokens) - sumTokens(a[1].tokens) || (a[0] < b[0] ? -1 : 1)),
    skills: [...skills].sort((a, b) => b[1].uses - a[1].uses || b[1].attr.tokens.input - a[1].attr.tokens.input || (a[0] < b[0] ? -1 : 1)),
    commands: [...commands].sort((a, b) => b[1].uses - a[1].uses || (a[0] < b[0] ? -1 : 1)),
    prices,
  };
}

// ---------- output ----------

const money = (v) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%');

function moneyCell(hasPrices, cost, unpriced, calls) {
  if (!hasPrices) return 'not shown';
  if (calls > 0 && unpriced === calls) return 'no price';
  if (unpriced > 0) return `${money(cost)} (${unpriced} no price)`;
  return money(cost);
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  return all.map((r) => `  ${r.map((c, i) => String(c).padEnd(widths[i])).join('  ')}`.trimEnd());
}

function jsonReport(r, folder, filesRead, badInput) {
  const hasPrices = r.prices !== null;
  const tok = (t) => ({ input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite5m: t.cacheWrite5m, cacheWrite1h: t.cacheWrite1h, total: sumTokens(t) });
  const money2 = (cost, unpriced, calls) => (!hasPrices || (unpriced > 0 && calls === unpriced) ? null : round6(cost));
  return {
    folder,
    prices: r.pricesPath,
    ...(hasPrices ? { estimateNote: ESTIMATE_NOTE } : {}),
    filesRead,
    skippedLinks: r.skippedLinks,
    dates: r.dates,
    totals: {
      sessions: r.totals.sessions,
      calls: r.totals.calls,
      tokens: tok(r.totals.tokens),
      costUSD: money2(r.totals.cost, r.totals.unpriced, r.totals.calls),
      unpricedCalls: r.totals.unpriced,
      subagentShare: r.totals.allTokens > 0 ? round6(r.totals.subTokens / r.totals.allTokens) : 0,
    },
    byModel: r.byModel.map(([model, b]) => ({ model, calls: b.calls, tokens: tok(b.tokens), costUSD: money2(b.cost, b.unpriced, b.calls), unpricedCalls: b.unpriced })),
    sessionsShown: r.shown.length,
    sessions: r.shown.map((s) => ({
      session: s.sid,
      project: s.project,
      start: s.start === null ? null : new Date(s.start).toISOString(),
      calls: s.calls,
      tokens: tok(s.tokens),
      peakContext: s.peak,
      costUSD: money2(s.cost, s.unpriced, s.calls),
      unpricedCalls: s.unpriced,
      subagentShare: sumTokens(s.tokens) > 0 ? round6(s.subTokens / sumTokens(s.tokens)) : 0,
    })),
    skills: r.skills.map(([name, e]) => ({
      name,
      uses: e.uses,
      sessions: e.sessions,
      attributedCalls: e.attr.calls,
      attributedTokens: sumTokens(e.attr.tokens),
      attributedCostUSD: money2(e.attr.cost, e.attr.unpriced, e.attr.calls),
    })),
    commands: r.commands.map(([name, e]) => ({ name, uses: e.uses, sessions: e.sessions })),
    badInput,
  };
}

function textReport(r, folder, filesRead, badInput) {
  const hasPrices = r.prices !== null;
  const t = r.totals;
  const L = [];
  const range = r.dates.from === null ? 'no dated sessions' : `${r.dates.from} to ${r.dates.to} (UTC)`;
  L.push(`Usage dashboard: folder ${folder}, prices ${r.pricesPath ?? 'none (tokens only)'}, ${filesRead} files read, dates ${range}, ${t.calls} calls counted, skipped links: ${r.skippedLinks}.`);
  L.push('');
  L.push('Totals');
  L.push(`  Sessions: ${t.sessions}`);
  L.push(`  Calls: ${t.calls}`);
  L.push(`  Tokens: input ${t.tokens.input}, output ${t.tokens.output}, cache read ${t.tokens.cacheRead}, cache write 5 min ${t.tokens.cacheWrite5m}, cache write 1 hour ${t.tokens.cacheWrite1h}, all ${t.allTokens}`);
  if (hasPrices) {
    L.push(`  Estimated cost at list prices: ${t.calls > 0 && t.unpriced === t.calls ? 'no price' : money(t.cost)}`);
    L.push(`  Calls with no price: ${t.unpriced} (their tokens are in the totals above)`);
  } else {
    L.push('  Estimated cost: not shown (no price file, so tokens only)');
  }
  L.push(`  Sub-agent share of tokens: ${pct(t.subTokens, t.allTokens)}`);
  L.push('');
  L.push('By model');
  const modelRows = r.byModel.map(([model, b]) => [model, b.calls, sumTokens(b.tokens), b.tokens.input, b.tokens.output, b.tokens.cacheRead, b.tokens.cacheWrite5m, b.tokens.cacheWrite1h, moneyCell(hasPrices, b.cost, b.unpriced, b.calls)]);
  if (modelRows.length) L.push(...table(['Model', 'Calls', 'All tokens', 'Input', 'Output', 'Cache read', 'Write 5 min', 'Write 1 hour', 'Est. cost'], modelRows));
  else L.push('  none');
  L.push('');
  L.push(`Sessions (showing ${r.shown.length} of ${t.sessions}, highest estimated cost first)`);
  const sessionRows = r.shown.map((s) => [
    s.sid.slice(0, 8),
    s.project,
    s.start === null ? 'no timestamp' : new Date(s.start).toISOString().slice(0, 10),
    s.calls,
    s.tokens.input,
    s.tokens.output,
    s.tokens.cacheRead,
    s.tokens.cacheWrite5m,
    s.tokens.cacheWrite1h,
    s.peak,
    moneyCell(hasPrices, s.cost, s.unpriced, s.calls),
    pct(s.subTokens, sumTokens(s.tokens)),
  ]);
  if (sessionRows.length) L.push(...table(['Session', 'Project', 'Start', 'Calls', 'Input', 'Output', 'Cache read', 'Write 5 min', 'Write 1 hour', 'Peak context', 'Est. cost', 'Sub-agent share of tokens'], sessionRows));
  else L.push('  none');
  L.push('');
  L.push('Skills');
  const skillRows = r.skills.map(([name, e]) => [name, e.uses, e.sessions, e.attr.calls, sumTokens(e.attr.tokens), moneyCell(hasPrices, e.attr.cost, e.attr.unpriced, e.attr.calls)]);
  if (skillRows.length) L.push(...table(['Skill', 'Uses', 'Sessions', 'Attributed calls', 'Attributed tokens', 'Attributed est. cost'], skillRows));
  else L.push('  none');
  L.push('');
  L.push('Commands');
  const commandRows = r.commands.map(([name, e]) => [name, e.uses, e.sessions]);
  if (commandRows.length) L.push(...table(['Command', 'Uses', 'Sessions'], commandRows));
  else L.push('  none');
  if (badInput.length) {
    L.push('');
    L.push('Bad input');
    for (const b of badInput) L.push(`  ${b.path}:${b.line} ${b.reason}`);
  }
  if (hasPrices) {
    L.push('');
    L.push(ESTIMATE_NOTE);
  }
  return `${L.join('\n')}\n`;
}

// ---------- main ----------

function run(argv) {
  const o = parseArgs(argv);
  if (o.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const folder = path.resolve(o.projectsDir ?? DEFAULT_PROJECTS);
  let st;
  try {
    st = fs.statSync(folder);
  } catch {
    throw new UsageError(`projects folder not found: ${folder}`);
  }
  if (!st.isDirectory()) throw new UsageError(`projects folder is not a folder: ${folder}`);

  let prices = null;
  let pricesPath = null;
  if (o.prices !== null) {
    pricesPath = path.resolve(o.prices);
    prices = loadPrices(pricesPath);
  } else if (fs.existsSync(DEFAULT_PRICES)) {
    pricesPath = DEFAULT_PRICES;
    prices = loadPrices(DEFAULT_PRICES);
  }

  const ctx = { prices, sessions: [], bad: [], filesRead: 0, skipped: 0 };
  scanFolder(folder, o.project, ctx);
  const r = aggregate(ctx.sessions, o, prices);
  r.pricesPath = pricesPath;
  r.skippedLinks = ctx.skipped;
  const badInput = ctx.bad;

  if (o.json) {
    process.stdout.write(`${JSON.stringify(jsonReport(r, folder, ctx.filesRead, badInput), null, 2)}\n`);
  } else {
    process.stdout.write(textReport(r, folder, ctx.filesRead, badInput));
  }
  return badInput.length > 0 ? 1 : 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  process.stderr.write(`usage-dashboard: ${err.message}\n`);
  process.exitCode = 2;
}
