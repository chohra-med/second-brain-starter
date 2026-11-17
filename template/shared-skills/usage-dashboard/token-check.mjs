#!/usr/bin/env node
// Token check: reads ONE Claude Code transcript file that you name and prints, for that one run, how many
// tokens it used by kind, how many model calls and tool calls it made, which files it read (and which more
// than once), and which steps grew the context most. A second mode compares two saved run reports. A third
// mode prints the tokens of each of your turns. It only reads. Standard library only. No network.
//
// It prints numbers, tool names and file paths. It never prints a prompt, an answer, thinking, a tool
// command, a search pattern or a tool result. The "why" lines are computed from the numbers. No model wrote them.
// The counting rules are the ones of usage-dashboard.mjs: several lines with one message.id are one model
// call, a synthetic line is not a call, and the cache write splits into 5 minute and 1 hour.

import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const UNREADABLE = '(unreadable name)';
const UNREADABLE_PATH = '(unreadable path)';
const SYNTHETIC = '<synthetic>';
const CLASSES = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];
const SCHEMA = 1;
const FILE_LIST_CAP = 500;
const READ_TOOLS = new Set(['Read', 'NotebookRead']);

const USAGE = `Usage: node <path to>/token-check.mjs <mode> [options]

Modes:
  run <transcript.jsonl>      tokens by kind, model calls, tool calls, files read and the
                              steps that grew the context most, for one transcript file
      --subagents DIR         also read the agent-*.jsonl files in DIR (shown apart)
      --cwd DIR               print paths relative to DIR (default: the folder the run recorded)
      --top N                 show the N largest steps (default 5)
  compare <a.json> <b.json>   compare two reports saved from "run --json"
  turns <transcript.jsonl>    fresh tokens and cache read for each of your turns
      --top N                 show N turns (default 30, 0 = all)

Options for every mode:
  --json                      print one JSON object instead of text
  --help                      print this text

It reads only the paths you name. It follows no symbolic link, makes no network call and
writes no file (save a report with your shell: run <file> --json > a.json). It prints numbers,
tool names and file paths, never message or tool-result text.

Exit codes: 0 clean, 1 bad input found in a transcript, 2 wrong use.
`;

class UsageError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const cleanName = (s) => (typeof s === 'string' && NAME_RE.test(s) ? s : UNREADABLE);
// A path is tool input text. Keep it only when it looks like one line of a path.
const cleanPath = (s) => (typeof s === 'string' && s.length > 0 && s.length <= 500 && !/[\u0000-\u001f\u007f]/.test(s) ? s : UNREADABLE_PATH);
const isCount = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

function tokenView(t) {
  const cacheWrite = t.cacheWrite5m + t.cacheWrite1h;
  return {
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead,
    cacheWrite5m: t.cacheWrite5m,
    cacheWrite1h: t.cacheWrite1h,
    cacheWrite,
    fresh: t.input + cacheWrite + t.output,
    all: t.input + t.output + t.cacheRead + cacheWrite,
  };
}
const contextOf = (c) => c.input + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h;
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : '0');
const change = (a, b) => (a === 0 ? (b === 0 ? '0.0%' : 'new') : `${b >= a ? '+' : '-'}${(Math.abs(b - a) / a * 100).toFixed(1)}%`);

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  // A column of numbers lines up on the right; a column of names or paths on the left.
  const right = headers.map((_, i) => rows.length > 0 && rows.every((r) => /^[+-]?[\d,.]+%?$|^new$/.test(String(r[i]))));
  return all.map((r) => `  ${r.map((c, i) => (right[i] ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ')}`.trimEnd());
}

// ---------- arguments ----------

const FLAGS = {
  run: { value: ['--subagents', '--cwd', '--top'], positional: 1 },
  compare: { value: [], positional: 2 },
  turns: { value: ['--top'], positional: 1 },
};

function parseArgs(argv) {
  const o = { help: false, mode: null, json: false, files: [], subagents: null, cwd: null, top: null };
  if (argv.length === 0) throw new UsageError('give a mode: run, compare or turns (see --help)');
  if (argv.includes('--help')) {
    o.help = true;
    return o;
  }
  o.mode = argv[0];
  if (!has(FLAGS, o.mode)) throw new UsageError(`unknown mode: ${o.mode} (use run, compare or turns)`);
  const spec = FLAGS[o.mode];
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || spec.value.includes(a)) {
      if (seen.has(a)) throw new UsageError(`${a} given more than once`);
      seen.add(a);
    }
    if (a === '--json') {
      o.json = true;
      continue;
    }
    if (spec.value.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError(`missing value for ${a}`);
      o[a.slice(2)] = v;
      i++;
      continue;
    }
    if (a.startsWith('--')) throw new UsageError(`unknown option for ${o.mode}: ${a}`);
    o.files.push(a);
  }
  if (o.files.length !== spec.positional) {
    throw new UsageError(`${o.mode} needs ${spec.positional === 1 ? 'one file' : 'two files'}, got ${o.files.length}`);
  }
  if (o.top !== null && !/^\d+$/.test(o.top)) throw new UsageError(`--top needs a whole number, 0 or more, got: ${o.top}`);
  o.top = o.top === null ? (o.mode === 'turns' ? 30 : 5) : Number(o.top);
  return o;
}

// ---------- reading ----------

// lstat, not stat: a symbolic link is never followed.
function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function requireRegularFile(file, what) {
  const st = lstatOrNull(file);
  if (st === null) throw new UsageError(`${what} not found: ${file}`);
  if (st.isSymbolicLink()) throw new UsageError(`${what} is a symbolic link, and this tool follows none: ${file}`);
  if (!st.isFile()) throw new UsageError(`${what} is not a file: ${file}`);
}

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

// Same rule as usage-dashboard.mjs: an absent field counts as 0, a present field must be a whole number of zero or more.
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
  const cacheWrite1h = v.cacheWrite1h ?? 0;
  const cacheWrite5m = v.cacheWrite5m ?? Math.max(0, (v.cacheWriteAll ?? 0) - cacheWrite1h);
  return { counts: { input: v.input ?? 0, output: v.output ?? 0, cacheRead: v.cacheRead ?? 0, cacheWrite5m, cacheWrite1h } };
}

function isPrompt(obj, msg) {
  if (obj.type !== 'user' || obj.isMeta === true || obj.isCompactSummary === true || obj.isSidechain === true || !msg) return false;
  if (typeof msg.content === 'string') return msg.content.trim() !== '';
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((b) => isObj(b) && (b.type === 'text' || b.type === 'image'));
}

function toolsOf(msg) {
  const out = [];
  if (!msg || !Array.isArray(msg.content)) return out;
  for (const b of msg.content) {
    if (!isObj(b) || b.type !== 'tool_use') continue;
    const input = isObj(b.input) ? b.input : {};
    const raw = [input.file_path, input.notebook_path, input.path].find((x) => typeof x === 'string');
    out.push({ id: typeof b.id === 'string' ? b.id : null, name: cleanName(b.name), path: raw === undefined ? null : cleanPath(raw) });
  }
  return out;
}

// Returns { calls, turns, cwd, bad }. calls are in order of first appearance; one message.id is one call.
function scanFile(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return { calls: [], turns: 0, cwd: null, bad: [{ path: file, line: 0, reason: 'file cannot be read' }] };
  }
  const calls = [];
  const byId = new Map();
  const bad = [];
  let turn = 0;
  let cwd = null;
  forEachLine(buf, (text, lineNo, unterminated) => {
    if (text.trim() === '') return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      if (!unterminated) bad.push({ path: file, line: lineNo, reason: 'not valid JSON' });
      return;
    }
    if (!isObj(obj)) {
      bad.push({ path: file, line: lineNo, reason: 'not a JSON object' });
      return;
    }
    if (cwd === null && typeof obj.cwd === 'string' && cleanPath(obj.cwd) !== UNREADABLE_PATH) cwd = obj.cwd;
    const msg = isObj(obj.message) ? obj.message : null;
    if (obj.type === 'assistant') {
      if (!msg || !isObj(msg.usage)) return;
      const r = readCounts(msg.usage);
      if (r.error) {
        bad.push({ path: file, line: lineNo, reason: r.error });
        return;
      }
      if (msg.model === SYNTHETIC) return;
      const model = typeof msg.model === 'string' ? msg.model : '';
      const tools = toolsOf(msg);
      const id = typeof msg.id === 'string' && msg.id !== '' ? msg.id : null;
      if (id !== null && byId.has(id)) {
        const call = byId.get(id);
        call.counts = r.counts; // the last line of one call wins, as in the dashboard
        for (const t of tools) if (t.id === null || !call.seen.has(t.id)) {
          if (t.id !== null) call.seen.add(t.id);
          call.tools.push(t);
        }
        return;
      }
      const call = { model, counts: r.counts, tools: [], seen: new Set(), turn };
      for (const t of tools) if (t.id === null || !call.seen.has(t.id)) {
        if (t.id !== null) call.seen.add(t.id);
        call.tools.push(t);
      }
      calls.push(call);
      if (id !== null) byId.set(id, call);
      return;
    }
    if (isPrompt(obj, msg)) turn++;
  });
  return { calls, turns: turn, cwd, bad };
}

function subagentFiles(dir, skipped) {
  const st = lstatOrNull(dir);
  if (st === null) throw new UsageError(`sub-agent folder not found: ${dir}`);
  if (st.isSymbolicLink()) throw new UsageError(`sub-agent folder is a symbolic link, and this tool follows none: ${dir}`);
  if (!st.isDirectory()) throw new UsageError(`sub-agent folder is not a folder: ${dir}`);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new UsageError(`sub-agent folder cannot be read: ${dir}`);
  }
  const files = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) {
      skipped.count++;
      continue;
    }
    if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) files.push(path.join(dir, e.name));
  }
  return files.sort();
}

// ---------- numbers ----------

const relPath = (p, cwd) => {
  if (p === UNREADABLE_PATH || cwd === null) return p;
  const base = cwd.replace(/\/+$/, '');
  return base !== '' && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
};

function toolTable(calls) {
  const m = new Map();
  for (const c of calls) for (const t of c.tools) bump(m, t.name);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

function fileStats(calls, cwd) {
  const m = new Map();
  for (const c of calls) for (const t of c.tools) if (READ_TOOLS.has(t.name) && t.path !== null) bump(m, relPath(t.path, cwd));
  const list = [...m].map(([p, reads]) => ({ path: p, reads })).sort((a, b) => b.reads - a.reads || (a.path < b.path ? -1 : 1));
  const repeated = list.filter((f) => f.reads > 1);
  return {
    distinct: list.length,
    reads: sum(list.map((f) => f.reads)),
    repeated: { files: repeated.length, extraReads: sum(repeated.map((f) => f.reads - 1)), list: repeated.slice(0, 20) },
    list: list.slice(0, FILE_LIST_CAP),
  };
}

function totalTokens(calls) {
  const t = zeroTokens();
  for (const c of calls) for (const k of CLASSES) t[k] += c.counts[k];
  return t;
}

function steps(calls, cwd, top) {
  const out = [];
  for (let i = 0; i + 1 < calls.length; i++) {
    const before = contextOf(calls[i].counts);
    const after = contextOf(calls[i + 1].counts);
    if (after <= before) continue;
    out.push({
      call: i + 1,
      before,
      after,
      growth: after - before,
      tools: calls[i].tools.map((t) => ({ name: t.name, path: t.path === null ? null : relPath(t.path, cwd) })),
    });
  }
  out.sort((a, b) => b.growth - a.growth || a.call - b.call);
  return out.slice(0, top);
}

function byModel(calls) {
  const m = new Map();
  for (const c of calls) {
    const name = NAME_RE.test(c.model) ? c.model : UNREADABLE;
    if (!m.has(name)) m.set(name, { calls: 0, tokens: zeroTokens() });
    const e = m.get(name);
    e.calls++;
    for (const k of CLASSES) e.tokens[k] += c.counts[k];
  }
  return [...m].map(([model, e]) => ({ model, calls: e.calls, tokens: tokenView(e.tokens) })).sort((a, b) => b.tokens.all - a.tokens.all || (a.model < b.model ? -1 : 1));
}

function buildRun(o) {
  requireRegularFile(o.files[0], 'transcript');
  const skipped = { count: 0 };
  const subFiles = o.subagents === null ? [] : subagentFiles(path.resolve(o.subagents), skipped);
  const main = scanFile(path.resolve(o.files[0]));
  const cwd = o.cwd !== null ? o.cwd : main.cwd;
  const bad = [...main.bad];
  const subItems = [];
  const subTotal = zeroTokens();
  let subCalls = 0;
  for (const f of subFiles) {
    const s = scanFile(f);
    bad.push(...s.bad);
    const t = totalTokens(s.calls);
    for (const k of CLASSES) subTotal[k] += t[k];
    subCalls += s.calls.length;
    const fs2 = fileStats(s.calls, cwd);
    subItems.push({ file: path.basename(f), calls: s.calls.length, tokens: tokenView(t), tools: toolTable(s.calls), files: { distinct: fs2.distinct, reads: fs2.reads } });
  }
  const tokens = tokenView(totalTokens(main.calls));
  const sub = tokenView(subTotal);
  const ctx = main.calls.map((c) => contextOf(c.counts));
  const tools = toolTable(main.calls);
  return {
    schema: SCHEMA,
    tool: 'token-check',
    mode: 'run',
    transcript: path.basename(o.files[0]),
    pathsRelativeToWorkingFolder: cwd !== null,
    calls: main.calls.length,
    tokens,
    models: byModel(main.calls),
    context: { start: ctx.length ? ctx[0] : 0, peak: ctx.length ? Math.max(...ctx) : 0 },
    toolCalls: sum(tools.map((t) => t.count)),
    tools,
    files: fileStats(main.calls, cwd),
    steps: steps(main.calls, cwd, o.top),
    subagents: {
      files: subFiles.length,
      calls: subCalls,
      tokens: sub,
      share: tokens.all + sub.all > 0 ? Math.round((sub.all / (tokens.all + sub.all)) * 1e6) / 1e6 : 0,
      items: subItems,
    },
    skippedLinks: skipped.count,
    badInput: bad,
  };
}

// Only the Read tool is counted as a file read. The shell calls are counted by name, so the report can say how many reads it could not see.
const shellCalls = (tools) => tools.filter((t) => t.name === 'Bash').reduce((n, t) => n + t.count, 0);
const readNote = (shell) => ` Only the Read tool is counted; this run also made ${fmt(shell)} Bash call${shell === 1 ? '' : 's'}, whose file reads are not inspected.`;

// The computed "why" lines. Every number comes from the run's own fields.
function whyLines(r) {
  const L = [];
  const session = r.tokens.all + r.subagents.tokens.all;
  if (r.calls > 0) {
    const carried = r.context.start * r.calls;
    L.push(`Start context: the first call held ${fmt(r.context.start)} tokens. If each of the ${fmt(r.calls)} calls held only that much, they would total ${fmt(carried)} tokens (${pct(Math.min(carried, r.tokens.all), r.tokens.all)} of this run's tokens).`);
    L.push(`Per call: ${fmt(Math.round(r.tokens.all / r.calls))} tokens on average; the context peaked at ${fmt(r.context.peak)} tokens.`);
  }
  L.push(`Cache: ${pct(r.tokens.cacheRead, r.tokens.all)} of this run's tokens were cache reads and ${pct(r.tokens.fresh, r.tokens.all)} were fresh (input, cache write and output).`);
  const shell = shellCalls(r.tools);
  if (r.files.reads > 0) {
    L.push(`Files: ${fmt(r.files.reads)} reads of ${fmt(r.files.distinct)} distinct files; ${fmt(r.files.repeated.files)} files were read more than once (${fmt(r.files.repeated.extraReads)} extra reads).${shell > 0 ? readNote(shell) : ''}`);
  } else {
    L.push(`Files: no file reads in this run.${shell > 0 ? readNote(shell) : ''}`);
  }
  if (r.steps.length > 0) {
    const s = r.steps[0];
    const what = s.tools.length ? s.tools.map((t) => (t.path ? `${t.name} ${t.path}` : t.name)).join(', ') : 'no tool call';
    L.push(`Largest step: after call ${s.call} the context grew by ${fmt(s.growth)} tokens (tool results plus that call's own output) (${pct(s.growth, r.context.peak)} of the peak context). That call used: ${what}.`);
  }
  if (r.subagents.files > 0) L.push(`Sub-agents: ${fmt(r.subagents.files)} files, ${pct(r.subagents.tokens.all, session)} of the session's tokens.`);
  return L;
}

function stepRows(steps2) {
  return steps2.map((s) => [s.call, fmt(s.before), fmt(s.after), signed(s.growth), s.tools.length ? s.tools.map((t) => (t.path ? `${t.name} ${t.path}` : t.name)).join('; ') : '(no tool call)']);
}

function runText(r) {
  const L = [];
  L.push(`Token check, run: transcript ${r.transcript}, sub-agent files ${r.subagents.files}, skipped links ${r.skippedLinks}, paths ${r.pathsRelativeToWorkingFolder ? 'relative to the run\'s working folder' : 'as recorded'}.`);
  L.push('');
  L.push('Counts');
  L.push(`  Model calls: ${fmt(r.calls)} (one call written as several lines counts once)`);
  L.push(`  Tool calls: ${fmt(r.toolCalls)}`);
  L.push('');
  L.push('Tokens (main session)');
  L.push(`  Input ${fmt(r.tokens.input)}, output ${fmt(r.tokens.output)}, cache read ${fmt(r.tokens.cacheRead)}, cache write 5 min ${fmt(r.tokens.cacheWrite5m)}, cache write 1 hour ${fmt(r.tokens.cacheWrite1h)}`);
  L.push(`  Fresh (input + cache write + output): ${fmt(r.tokens.fresh)}`);
  L.push(`  All: ${fmt(r.tokens.all)}`);
  L.push(`  Context: first call ${fmt(r.context.start)}, peak ${fmt(r.context.peak)}`);
  L.push('');
  L.push('By model');
  if (r.models.length) L.push(...table(['Model', 'Calls', 'All tokens', 'Fresh', 'Cache read'], r.models.map((m) => [m.model, fmt(m.calls), fmt(m.tokens.all), fmt(m.tokens.fresh), fmt(m.tokens.cacheRead)])));
  else L.push('  none');
  L.push('');
  L.push('Tool calls by name');
  if (r.tools.length) L.push(...table(['Tool', 'Calls'], r.tools.map((t) => [t.name, fmt(t.count)])));
  else L.push('  none');
  L.push('');
  L.push(`Files read: ${fmt(r.files.distinct)} distinct, ${fmt(r.files.reads)} reads, ${fmt(r.files.repeated.files)} read more than once.${shellCalls(r.tools) > 0 ? readNote(shellCalls(r.tools)) : ''}`);
  if (r.files.repeated.list.length) L.push(...table(['Path', 'Reads'], r.files.repeated.list.map((f) => [f.path, fmt(f.reads)])));
  L.push('');
  L.push(`Largest context steps (growth between two calls is charged to the tool calls of the earlier one)`);
  if (r.steps.length) L.push(...table(['After call', 'Before', 'After', 'Context growth (tool results plus that call\'s output)', 'Tool calls of that call'], stepRows(r.steps)));
  else L.push('  none');
  L.push('');
  L.push('Sub-agents (apart from the main session)');
  if (r.subagents.items.length) {
    L.push(...table(['File', 'Calls', 'All tokens', 'Fresh', 'Cache read', 'Tool calls', 'Files read'], r.subagents.items.map((s) => [s.file, fmt(s.calls), fmt(s.tokens.all), fmt(s.tokens.fresh), fmt(s.tokens.cacheRead), fmt(sum(s.tools.map((t) => t.count))), fmt(s.files.reads)])));
    L.push(`  Sub-agent tokens ${fmt(r.subagents.tokens.all)}; main plus sub-agents ${fmt(r.tokens.all + r.subagents.tokens.all)}`);
  } else {
    L.push('  none read');
  }
  L.push('');
  L.push('Why (computed from the transcript; no model wrote these lines)');
  for (const line of whyLines(r)) L.push(`  - ${line}`);
  if (r.badInput.length) {
    L.push('');
    L.push('Bad input');
    for (const b of r.badInput) L.push(`  ${b.path}:${b.line} ${b.reason}`);
  }
  return `${L.join('\n')}\n`;
}

// ---------- compare ----------

function loadRunFile(file) {
  requireRegularFile(file, 'report file');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new UsageError(`report file is not valid JSON: ${file}`);
  }
  const fail = (why) => new UsageError(`${file} is not a token-check run report (${why})`);
  if (!isObj(data) || data.tool !== 'token-check' || data.mode !== 'run') throw fail('save one with: run <transcript> --json');
  if (data.schema !== SCHEMA) throw fail(`schema ${data.schema} is not ${SCHEMA}`);
  const tok = (t, where) => {
    if (!isObj(t)) throw fail(`${where} missing`);
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'cacheWrite', 'fresh', 'all']) if (!isCount(t[k])) throw fail(`${where}.${k}`);
    return t;
  };
  const num = (v, where) => {
    if (!isCount(v)) throw fail(where);
    return v;
  };
  const arr = (v, where) => {
    if (!Array.isArray(v)) throw fail(where);
    return v;
  };
  const sd = data.subagents;
  if (!isObj(sd) || !isObj(data.files) || !isObj(data.context) || !isObj(data.files.repeated)) throw fail('sections missing');
  return {
    transcript: cleanPath(data.transcript),
    calls: num(data.calls, 'calls'),
    tokens: tok(data.tokens, 'tokens'),
    context: { start: num(data.context.start, 'context.start'), peak: num(data.context.peak, 'context.peak') },
    toolCalls: num(data.toolCalls, 'toolCalls'),
    tools: arr(data.tools, 'tools').map((t, i) => ({ name: cleanName(isObj(t) ? t.name : null), count: num(isObj(t) ? t.count : null, `tools[${i}]`) })),
    files: {
      distinct: num(data.files.distinct, 'files.distinct'),
      reads: num(data.files.reads, 'files.reads'),
      repeated: { files: num(data.files.repeated.files, 'files.repeated.files'), extraReads: num(data.files.repeated.extraReads, 'files.repeated.extraReads') },
      list: arr(data.files.list, 'files.list').map((f, i) => ({ path: cleanPath(isObj(f) ? f.path : null), reads: num(isObj(f) ? f.reads : null, `files.list[${i}]`) })),
    },
    steps: arr(data.steps, 'steps').map((s, i) => {
      if (!isObj(s)) throw fail(`steps[${i}]`);
      return {
        call: num(s.call, `steps[${i}].call`),
        growth: num(s.growth, `steps[${i}].growth`),
        tools: arr(s.tools, `steps[${i}].tools`).map((t) => ({ name: cleanName(isObj(t) ? t.name : null), path: isObj(t) && t.path !== null && t.path !== undefined ? cleanPath(t.path) : null })),
      };
    }),
    subagents: { files: num(sd.files, 'subagents.files'), calls: num(sd.calls, 'subagents.calls'), tokens: tok(sd.tokens, 'subagents.tokens') },
  };
}

function compareRuns(a, b) {
  const sessionA = a.tokens.all + a.subagents.tokens.all;
  const sessionB = b.tokens.all + b.subagents.tokens.all;
  const perCall = (r) => (r.calls > 0 ? Math.round(r.tokens.all / r.calls) : 0);
  const metrics = [
    ['Model calls', a.calls, b.calls],
    ['Input', a.tokens.input, b.tokens.input],
    ['Output', a.tokens.output, b.tokens.output],
    ['Cache read', a.tokens.cacheRead, b.tokens.cacheRead],
    ['Cache write', a.tokens.cacheWrite, b.tokens.cacheWrite],
    ['Fresh (input + cache write + output)', a.tokens.fresh, b.tokens.fresh],
    ['All tokens (main session)', a.tokens.all, b.tokens.all],
    ['Sub-agent tokens', a.subagents.tokens.all, b.subagents.tokens.all],
    ['All tokens (main plus sub-agents)', sessionA, sessionB],
    ['Tokens per call (main session)', perCall(a), perCall(b)],
    ['Tool calls', a.toolCalls, b.toolCalls],
    ['Files read, distinct (Read tool only)', a.files.distinct, b.files.distinct],
    ['Files read, extra reads of a file already read', a.files.repeated.extraReads, b.files.repeated.extraReads],
    ['Start context (first call)', a.context.start, b.context.start],
    ['Peak context', a.context.peak, b.context.peak],
  ].map(([metric, x, y]) => ({ metric, a: x, b: y, diff: y - x, change: change(x, y) }));

  const names = new Map();
  for (const t of a.tools) names.set(t.name, [t.count, 0]);
  for (const t of b.tools) names.set(t.name, [(names.get(t.name) ?? [0, 0])[0], t.count]);
  const toolDiff = [...names].map(([name, [x, y]]) => ({ name, a: x, b: y, diff: y - x })).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff) || (p.name < q.name ? -1 : 1));

  const pa = new Set(a.files.list.map((f) => f.path));
  const pb = new Set(b.files.list.map((f) => f.path));
  const onlyA = [...pa].filter((p) => !pb.has(p)).sort();
  const onlyB = [...pb].filter((p) => !pa.has(p)).sort();

  // Every line below is filled from the two reports. Each reason is always printed, with its numbers, even when nothing changed.
  const than = (d, one, many) => (d === 0 ? `the same number of ${many} as` : `${fmt(Math.abs(d))} ${d > 0 ? 'more' : 'fewer'} ${Math.abs(d) === 1 ? one : many} than`);
  const stepText = (st) => `${fmt(st.growth)} tokens after call ${st.call} (${st.tools.map((t) => (t.path ? `${t.name} ${t.path}` : t.name)).join(', ') || 'no tool call'})`;
  const topSteps = (r) => (r.steps.length ? r.steps.slice(0, 3).map((st, i) => `${i + 1}) ${stepText(st)}`).join('; ') : 'none');
  const changed = toolDiff.filter((t) => t.diff !== 0).slice(0, 3).map((t) => `${t.name} A ${fmt(t.a)}, B ${fmt(t.b)}`);
  const shellA = shellCalls(a.tools);
  const shellB = shellCalls(b.tools);
  const why = [
    `Model calls: A ${fmt(a.calls)}, B ${fmt(b.calls)}. B made ${than(b.calls - a.calls, 'model call', 'model calls')} A (${change(a.calls, b.calls)}).`,
    `Tokens: B used ${than(sessionB - sessionA, 'token', 'tokens')} A, main plus sub-agents (${change(sessionA, sessionB)}). Fresh tokens: ${signed(b.tokens.fresh - a.tokens.fresh)}. Cache read: ${signed(b.tokens.cacheRead - a.tokens.cacheRead)}. Sub-agent tokens: ${signed(b.subagents.tokens.all - a.subagents.tokens.all)}.`,
    `Tool calls: A ${fmt(a.toolCalls)}, B ${fmt(b.toolCalls)}. B made ${than(b.toolCalls - a.toolCalls, 'tool call', 'tool calls')} A. ${changed.length ? `Largest changes by name: ${changed.join('; ')}.` : 'No tool changed in number.'}`,
    `Files read: A ${fmt(a.files.distinct)} distinct files in ${fmt(a.files.reads)} reads, B ${fmt(b.files.distinct)} in ${fmt(b.files.reads)}. B read ${than(b.files.distinct - a.files.distinct, 'distinct file', 'distinct files')} A. Only the Read tool is counted; Bash calls: A ${fmt(shellA)}, B ${fmt(shellB)}, whose file reads are not inspected.`,
    `Repeated reads: A ${fmt(a.files.repeated.extraReads)} extra reads of a file already read in ${fmt(a.files.repeated.files)} files, B ${fmt(b.files.repeated.extraReads)} in ${fmt(b.files.repeated.files)} files.`,
    `Start context: A ${fmt(a.context.start)}, B ${fmt(b.context.start)} (${signed(b.context.start - a.context.start)}). Tokens per call: A ${fmt(perCall(a))}, B ${fmt(perCall(b))} (${signed(perCall(b) - perCall(a))}).`,
    `Largest steps (context growth: tool results plus that call's own output): A ${topSteps(a)}. B ${topSteps(b)}.`,
  ];

  return {
    schema: SCHEMA,
    tool: 'token-check',
    mode: 'compare',
    a: a.transcript,
    b: b.transcript,
    metrics,
    toolDiff,
    filesOnlyInA: { count: onlyA.length, list: onlyA.slice(0, 10) },
    filesOnlyInB: { count: onlyB.length, list: onlyB.slice(0, 10) },
    why,
  };
}

function compareText(c) {
  const L = [];
  L.push(`Token check, compare: A ${c.a}, B ${c.b}. The difference is B minus A.`);
  L.push('');
  L.push(...table(['Measure', 'A', 'B', 'B minus A', 'Change'], c.metrics.map((m) => [m.metric, fmt(m.a), fmt(m.b), signed(m.diff), m.change])));
  L.push('');
  L.push('Tool calls by name, largest change first');
  if (c.toolDiff.length) L.push(...table(['Tool', 'A', 'B', 'B minus A'], c.toolDiff.map((t) => [t.name, fmt(t.a), fmt(t.b), signed(t.diff)])));
  else L.push('  none');
  L.push('');
  L.push(`Files read only in A: ${fmt(c.filesOnlyInA.count)}`);
  for (const p of c.filesOnlyInA.list) L.push(`  ${p}`);
  L.push(`Files read only in B: ${fmt(c.filesOnlyInB.count)}`);
  for (const p of c.filesOnlyInB.list) L.push(`  ${p}`);
  L.push('');
  L.push('Why (computed from the two reports; no model wrote these lines)');
  for (const line of c.why) L.push(`  - ${line}`);
  return `${L.join('\n')}\n`;
}

// ---------- turns ----------

function buildTurns(o) {
  requireRegularFile(o.files[0], 'transcript');
  const main = scanFile(path.resolve(o.files[0]));
  const rows = new Map();
  for (const c of main.calls) {
    if (!rows.has(c.turn)) rows.set(c.turn, { turn: c.turn, calls: 0, tokens: zeroTokens() });
    const e = rows.get(c.turn);
    e.calls++;
    for (const k of CLASSES) e.tokens[k] += c.counts[k];
  }
  const turns = [...rows.values()].sort((a, b) => a.turn - b.turn).map((e) => ({ turn: e.turn, calls: e.calls, tokens: tokenView(e.tokens) }));
  const counted = turns.filter((t) => t.turn > 0);
  const fresh = counted.map((t) => t.tokens.fresh);
  return {
    schema: SCHEMA,
    tool: 'token-check',
    mode: 'turns',
    transcript: path.basename(o.files[0]),
    turns: main.turns,
    turnsWithCalls: counted.length,
    beforeFirstTurn: turns.find((t) => t.turn === 0) ?? null,
    totals: {
      calls: main.calls.length,
      fresh: sum(turns.map((t) => t.tokens.fresh)),
      cacheRead: sum(turns.map((t) => t.tokens.cacheRead)),
      all: sum(turns.map((t) => t.tokens.all)),
      freshPerTurn: counted.length ? Math.round(sum(fresh) / counted.length) : 0,
      freshPerTurnMax: counted.length ? Math.max(...fresh) : 0,
    },
    shown: o.top === 0 ? counted : counted.slice(0, o.top),
    rows: counted.length,
    badInput: main.bad,
  };
}

function turnsText(r) {
  const L = [];
  L.push(`Token check, turns: transcript ${r.transcript}. A turn starts when you type a message. Sub-agent files are not read.`);
  L.push('');
  L.push(`  Turns you typed: ${fmt(r.turns)}; turns with model calls: ${fmt(r.turnsWithCalls)}; model calls: ${fmt(r.totals.calls)}`);
  L.push(`  Fresh tokens (input + cache write + output): ${fmt(r.totals.fresh)}; cache read: ${fmt(r.totals.cacheRead)}; all: ${fmt(r.totals.all)}`);
  L.push(`  Fresh tokens per turn: ${fmt(r.totals.freshPerTurn)} on average, ${fmt(r.totals.freshPerTurnMax)} at most`);
  if (r.beforeFirstTurn) L.push(`  Before your first message: ${fmt(r.beforeFirstTurn.calls)} calls, fresh ${fmt(r.beforeFirstTurn.tokens.fresh)}, cache read ${fmt(r.beforeFirstTurn.tokens.cacheRead)}`);
  L.push('');
  L.push(`Turns (showing ${r.shown.length} of ${r.rows})`);
  if (r.shown.length) L.push(...table(['Turn', 'Calls', 'Fresh', 'Cache read', 'All'], r.shown.map((t) => [t.turn, fmt(t.calls), fmt(t.tokens.fresh), fmt(t.tokens.cacheRead), fmt(t.tokens.all)])));
  else L.push('  none');
  if (r.badInput.length) {
    L.push('');
    L.push('Bad input');
    for (const b of r.badInput) L.push(`  ${b.path}:${b.line} ${b.reason}`);
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
  let report;
  let text;
  if (o.mode === 'run') {
    report = buildRun(o);
    text = runText;
  } else if (o.mode === 'turns') {
    report = buildTurns(o);
    text = turnsText;
  } else {
    report = compareRuns(loadRunFile(o.files[0]), loadRunFile(o.files[1]));
    text = compareText;
  }
  if (o.mode === 'run') report.why = whyLines(report);
  process.stdout.write(o.json ? `${JSON.stringify(report, null, 2)}\n` : text(report));
  return report.badInput && report.badInput.length > 0 ? 1 : 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  process.stderr.write(`token-check: ${err.message}\n`);
  process.exitCode = 2;
}
