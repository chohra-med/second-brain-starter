// Tests for template/shared-skills/usage-dashboard/usage-dashboard.mjs, the script the starter installs.
//   node --test test/usage-dashboard.test.mjs
// Each test builds its own fake projects folder under os.tmpdir() and removes it afterwards.
// Paths are built with node:path or from URLs, so the file runs on Linux, macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanup, consumerRoot, planDigest, runCli } from './helpers/consumer-cli.mjs';

const SKILL_DIR = fileURLToPath(new URL('../template/shared-skills/usage-dashboard/', import.meta.url));
const SCRIPT = path.join(SKILL_DIR, 'usage-dashboard.mjs');
const SHIPPED_PRICES = path.join(SKILL_DIR, 'usage-prices.json');
const MARKER = 'ZZ-PLANTED-MARKER-41';

// Test prices: one model, round numbers, so hand-computed costs are easy.
const TEST_MODEL = 'claude-haiku-5-5';
const TEST_PRICES = {
  currency: 'USD',
  unit: 'per million tokens',
  asOf: '2026-10-13',
  source: 'test fixture',
  models: {
    [TEST_MODEL]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  },
};

function withFixture(files, fn, { prices = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-dash-test-'));
  try {
    const projects = path.join(root, 'projects');
    fs.mkdirSync(projects);
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(projects, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const text = typeof body === 'string'
        ? body
        : `${body.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;
      fs.writeFileSync(full, text);
    }
    const pricesPath = path.join(root, 'prices.json');
    if (prices) fs.writeFileSync(pricesPath, JSON.stringify(TEST_PRICES));
    return fn({ root, projects, pricesPath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(args, script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function runJson(args, script) {
  const r = run(['--json', ...args], script);
  assert.equal(r.code === 0 || r.code === 1, true, `unexpected exit ${r.code}: ${r.err}`);
  return { ...r, json: JSON.parse(r.out) };
}

const T = (iso) => iso;
const day = (d, h = 10) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

function usage(input = 0, output = 0, cacheRead = 0, cacheCreation = 0, extra = {}) {
  return { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation, ...extra };
}

function assistant({ id = 'msg_1', model = TEST_MODEL, usage: u = usage(), time = day(1), content = [{ type: 'text', text: 'ok' }], attr, sessionId = 'sess' } = {}) {
  const message = { role: 'assistant', model, usage: u, content };
  if (id !== null) message.id = id;
  const line = { type: 'assistant', sessionId, timestamp: time, message };
  if (attr !== undefined) line.attributionSkill = attr;
  return line;
}

function user({ content = 'hello', time = day(1) } = {}) {
  return { type: 'user', sessionId: 'sess', timestamp: time, message: { role: 'user', content } };
}

function skillBlock(id, skill) {
  return { type: 'tool_use', id, name: 'Skill', input: { skill } };
}

const pricesArg = (p) => ['--prices', p];

test('several lines with one message.id count as one call', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      user(),
      assistant({ id: 'm1', usage: usage(100, 50), content: [{ type: 'text', text: 'a' }] }),
      assistant({ id: 'm1', usage: usage(100, 50), content: [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: {} }] }),
      assistant({ id: 'm1', usage: usage(100, 50), content: [{ type: 'text', text: 'c' }] }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.totals.calls, 1);
    assert.equal(r.json.totals.tokens.input, 100);
    assert.equal(r.json.totals.tokens.output, 50);
  });
});

test('a synthetic line is not a call', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      assistant({ id: 'm1', model: '<synthetic>', usage: usage(999, 0) }),
      assistant({ id: 'm2', usage: usage(10, 0) }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.json.totals.calls, 1);
    assert.equal(r.json.totals.tokens.input, 10);
  });
});

test('an assistant line with no message.id is its own call', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      assistant({ id: null, usage: usage(10, 0) }),
      assistant({ id: null, usage: usage(10, 0) }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.json.totals.calls, 2);
    assert.equal(r.json.totals.tokens.input, 20);
  });
});

test('a sub-agent file is added to its session, shown as a share, and peak context ignores sub-agent calls', () => {
  withFixture({
    'proj-a/sess1.jsonl': [user(), assistant({ id: 'm1', usage: usage(100, 0, 1000) })],
    'proj-a/sess1/subagents/agent-1.jsonl': [assistant({ id: 's1', usage: usage(5000000, 0), time: day(1, 11) })],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.json.totals.sessions, 1);
    assert.equal(r.json.sessions.length, 1);
    const s = r.json.sessions[0];
    assert.equal(s.session, 'sess1');
    assert.equal(s.tokens.input, 5000100);
    assert.equal(s.calls, 2);
    assert.equal(s.peakContext, 1100, 'peak context must come from the main file only');
    assert.ok(Math.abs(s.subagentShare - 5000000 / 5001100) < 1e-5, `share was ${s.subagentShare}`);
    const text = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.match(text.out, /Sub-agent share of tokens: \d+\.\d%/);
    assert.doesNotMatch(text.out, /Sub-agent share of tokens: 0\.0%/);
  });
});

test('cache writes split into 5 minute and 1 hour, and fall back when cache_creation is missing', () => {
  withFixture({
    'proj-a/split.jsonl': [
      assistant({ id: 'm1', usage: usage(0, 0, 0, 500, { cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } }) }),
    ],
    'proj-a/fallback.jsonl': [
      assistant({ id: 'm2', usage: usage(0, 0, 0, 700) }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    const split = r.json.sessions.find((s) => s.session === 'split');
    const fallback = r.json.sessions.find((s) => s.session === 'fallback');
    assert.equal(split.tokens.cacheWrite5m, 200);
    assert.equal(split.tokens.cacheWrite1h, 300);
    assert.equal(fallback.tokens.cacheWrite5m, 700);
    assert.equal(fallback.tokens.cacheWrite1h, 0);
  });
});

test('the cost of one call equals the hand-computed number for each of the five token classes', () => {
  const million = 1000000;
  withFixture({
    'proj-a/in.jsonl': [assistant({ id: 'a', usage: usage(million) })],
    'proj-a/out.jsonl': [assistant({ id: 'b', usage: usage(0, million) })],
    'proj-a/read.jsonl': [assistant({ id: 'c', usage: usage(0, 0, million) })],
    'proj-a/w5.jsonl': [assistant({ id: 'd', usage: usage(0, 0, 0, 0, { cache_creation: { ephemeral_5m_input_tokens: million, ephemeral_1h_input_tokens: 0 } }) })],
    'proj-a/w1.jsonl': [assistant({ id: 'e', usage: usage(0, 0, 0, 0, { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: million } }) })],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    const cost = (name) => r.json.sessions.find((s) => s.session === name).costUSD;
    const expected = { in: 3, out: 15, read: 0.3, w5: 3.75, w1: 6 };
    for (const [name, value] of Object.entries(expected)) {
      assert.ok(Math.abs(cost(name) - value) < 1e-9, `${name}: got ${cost(name)}, want ${value}`);
    }
  });
});

test('a model missing from the price file shows no price and its tokens are still in the totals', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'm1', model: 'claude-unknown-9', usage: usage(500, 0) })],
  }, ({ projects, pricesPath }) => {
    const text = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /claude-unknown-9\s+1\s+500\s+500[^\n]*no price/);
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.json.totals.tokens.input, 500);
    assert.equal(r.json.totals.unpricedCalls, 1);
    assert.equal(r.json.byModel[0].costUSD, null);
  });
});

test('no price file given and none beside the script: tokens only, and the output says so', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'm1', usage: usage(10, 0) })],
  }, ({ root, projects }) => {
    const copyDir = path.join(root, 'copy');
    fs.mkdirSync(copyDir);
    const copy = path.join(copyDir, 'usage-dashboard.mjs');
    fs.copyFileSync(SCRIPT, copy);
    const r = run(['--projects-dir', projects], copy);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /tokens only/);
    assert.equal(r.out.includes('$'), false, 'no money may be shown without a price file');
    const j = run(['--json', '--projects-dir', projects], copy);
    assert.equal(JSON.parse(j.out).totals.costUSD, null);
  });
});

test('skill uses are counted once per tool_use id, and attributionSkill tokens are summed per skill', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      assistant({ id: 'm1', usage: usage(10, 0), content: [skillBlock('tu1', 'example-skill')] }),
      assistant({ id: 'm1', usage: usage(10, 0), content: [skillBlock('tu1', 'example-skill')] }),
      assistant({ id: 'm2', usage: usage(20, 0), attr: 'example-skill', content: [skillBlock('tu2', 'example-skill')] }),
      assistant({ id: 'm3', usage: usage(30, 0), attr: 'example-skill' }),
      assistant({ id: 'm4', usage: usage(40, 0), attr: 'other-skill' }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    const vault = r.json.skills.find((s) => s.name === 'example-skill');
    assert.equal(vault.uses, 2);
    assert.equal(vault.sessions, 1);
    assert.equal(vault.attributedCalls, 2);
    assert.equal(vault.attributedTokens, 50);
    const other = r.json.skills.find((s) => s.name === 'other-skill');
    assert.equal(other.uses, 0);
    assert.equal(other.attributedTokens, 40);
  });
});

test('commands are found in string content and in text blocks, and not searched in sub-agent files', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      user({ content: '<command-name>/today</command-name> hi' }),
      { type: 'user', sessionId: 'sess', timestamp: day(1), message: { role: 'user', content: [
        { type: 'text', text: '<command-name>/sunday</command-name>' },
        { type: 'tool_result', content: '<command-name>/nope</command-name>' },
      ] } },
      assistant({ id: 'm1', usage: usage(10, 0) }),
    ],
    'proj-a/s1/subagents/agent-1.jsonl': [
      user({ content: '<command-name>/subonly</command-name>' }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    const names = r.json.commands.map((c) => c.name).sort();
    assert.deepEqual(names, ['/sunday', '/today']);
    assert.equal(r.json.commands.every((c) => c.uses === 1), true);
  });
});

test('a broken JSON line in the middle: exit 1, names path and line, good totals still printed, broken text not printed', () => {
  const body = [
    JSON.stringify(user()),
    JSON.stringify(assistant({ id: 'm1', usage: usage(10, 0) })),
    '{"type":"assistant","BROKENTEXT-XYZ": ',
    JSON.stringify(assistant({ id: 'm2', usage: usage(20, 0) })),
  ].join('\n') + '\n';
  withFixture({ 'proj-a/s1.jsonl': body }, ({ projects, pricesPath }) => {
    const file = path.join(projects, 'proj-a', 's1.jsonl');
    const r = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 1);
    assert.ok(r.out.includes(`${file}:3 not valid JSON`), r.out);
    assert.match(r.out, /Calls: 2/);
    assert.equal(r.out.includes('BROKENTEXT'), false);
    assert.equal(r.err.includes('BROKENTEXT'), false);
  });
});

test('an unterminated broken last line is skipped, exit 0', () => {
  const body = `${JSON.stringify(assistant({ id: 'm1', usage: usage(10, 0) }))}\n{"type":"assistant","message":{"id":"m9"`;
  withFixture({ 'proj-a/s1.jsonl': body }, ({ projects, pricesPath }) => {
    const r = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Calls: 1/);
    assert.equal(r.out.includes('Bad input'), false);
  });
});

test('a negative token count and a text token count: exit 1, each named by path and line', () => {
  const body = [
    JSON.stringify(assistant({ id: 'm1', usage: usage(-5, 0) })),
    JSON.stringify(assistant({ id: 'm2', usage: { input_tokens: 1, output_tokens: '12', cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })),
  ].join('\n') + '\n';
  withFixture({ 'proj-a/s1.jsonl': body }, ({ projects, pricesPath }) => {
    const file = path.join(projects, 'proj-a', 's1.jsonl');
    const r = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 1);
    assert.ok(r.out.includes(`${file}:1 negative count`), r.out);
    assert.ok(r.out.includes(`${file}:2 not a whole number`), r.out);
  });
});

test('privacy: the planted marker never appears in standard output or standard error, in text or JSON', () => {
  const lines = [
    { ...user({ content: `my prompt ${MARKER}` }), cwd: `/work/${MARKER}`, gitBranch: `branch-${MARKER}`, slug: `slug-${MARKER}` },
    assistant({ id: 'p1', usage: usage(5), content: [{ type: 'text', text: `assistant text ${MARKER}` }] }),
    assistant({ id: 'p0', usage: usage(5), content: [{ type: 'thinking', thinking: `thinking ${MARKER}` }] }),
    `{"type":"assistant","broken ${MARKER}`,
    assistant({ id: 'p2', usage: usage(5), content: [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: `echo ${MARKER}` } }] }),
    { type: 'user', sessionId: 'sess', timestamp: day(1), message: { role: 'user', content: [{ type: 'tool_result', content: `result ${MARKER}` }] } },
    { type: 'custom-title', sessionId: 'sess', customTitle: `title ${MARKER}` },
    assistant({ id: 'p3', usage: usage(5), content: [skillBlock('tu-skill', `bad ${MARKER} skill`)] }),
    user({ content: `<command-name>/zz!${MARKER}</command-name>` }),
    assistant({ id: 'p4', usage: usage(5), attr: `x ${MARKER}` }),
    assistant({ id: 'p5', model: `claude ${MARKER}`, usage: usage(5) }),
  ];
  const sub = [
    user({ content: `sub prompt ${MARKER}` }),
    assistant({ id: 'sa1', usage: usage(3), content: [{ type: 'text', text: `sub answer ${MARKER}` }] }),
  ];
  withFixture({ 'proj-a/s1.jsonl': lines, 'proj-a/s1/subagents/agent-1.jsonl': sub }, ({ projects, pricesPath }) => {
    const file = path.join(projects, 'proj-a', 's1.jsonl');
    const subFile = path.join(projects, 'proj-a', 's1', 'subagents', 'agent-1.jsonl');
    assert.ok(fs.readFileSync(file, 'utf8').includes(MARKER), 'the fixture must really contain the marker');
    assert.ok(fs.readFileSync(subFile, 'utf8').includes(MARKER), 'the sub-agent fixture must really contain the marker');
    // The broken line is bad input, so the run exits 1; the marker in it must still not be printed.
    const text = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(text.code, 1, text.err);
    assert.match(text.out, /Bad input/);
    assert.equal(text.out.includes(MARKER), false);
    assert.equal(text.err.includes(MARKER), false);
    const json = run(['--json', '--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(json.code, 1, json.err);
    assert.equal(json.out.includes(MARKER), false);
    assert.equal(json.err.includes(MARKER), false);
    const parsed = JSON.parse(json.out);
    assert.ok(parsed.byModel.some((m) => m.model === '(unreadable name)'));
    assert.ok(parsed.commands.some((c) => c.name === '(unreadable name)'));
  });
});

test('growing usage on one message id: the last line wins', () => {
  withFixture({
    'proj-a/s1.jsonl': [
      assistant({ id: 'g1', usage: usage(10, 5) }),
      assistant({ id: 'g1', usage: usage(40, 9) }),
      assistant({ id: 'g1', usage: usage(70, 12) }),
    ],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.json.totals.calls, 1);
    assert.equal(r.json.totals.tokens.input, 70);
    assert.equal(r.json.totals.tokens.output, 12);
  });
});

test('cache_creation with no split fields counts all writes as 5 minutes; a partial split keeps the rest', () => {
  withFixture({
    'proj-a/empty.jsonl': [assistant({ id: 'e1', usage: usage(0, 0, 0, 500, { cache_creation: {} }) })],
    'proj-a/partial.jsonl': [assistant({ id: 'p1', usage: usage(0, 0, 0, 500, { cache_creation: { ephemeral_1h_input_tokens: 200 } }) })],
  }, ({ projects, pricesPath }) => {
    const r = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    const empty = r.json.sessions.find((s) => s.session === 'empty');
    const partial = r.json.sessions.find((s) => s.session === 'partial');
    assert.equal(empty.tokens.cacheWrite5m, 500);
    assert.equal(empty.tokens.cacheWrite1h, 0);
    assert.equal(partial.tokens.cacheWrite5m, 300);
    assert.equal(partial.tokens.cacheWrite1h, 200);
  });
});

test('a null token count is bad input: exit 1, named by path and line, and the call is not counted', () => {
  const topNull = [
    JSON.stringify(assistant({ id: 'n1', usage: usage(10, 0) })),
    JSON.stringify(assistant({ id: 'n2', usage: { ...usage(0, 0), input_tokens: null } })),
  ].join('\n') + '\n';
  const splitNull = `${JSON.stringify(assistant({ id: 'n3', usage: usage(0, 0, 0, 0, { cache_creation: { ephemeral_5m_input_tokens: null, ephemeral_1h_input_tokens: 0 } }) }))}\n`;
  withFixture({ 'proj-a/top.jsonl': topNull, 'proj-a/split.jsonl': splitNull }, ({ projects, pricesPath }) => {
    const r = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 1, r.err);
    assert.ok(r.out.includes(`${path.join(projects, 'proj-a', 'top.jsonl')}:2 not a whole number`), r.out);
    assert.ok(r.out.includes(`${path.join(projects, 'proj-a', 'split.jsonl')}:1 not a whole number`), r.out);
    assert.match(r.out, /Calls: 1\n/);
  });
});

test('every call unpriced: the Totals line says no price, no $0 appears, and --json has null', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'u1', model: 'claude-unknown-9', usage: usage(500, 0) })],
    'proj-b/s2.jsonl': [assistant({ id: 'u2', model: 'claude-unknown-9', usage: usage(5, 5) })],
  }, ({ projects, pricesPath }) => {
    const text = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /Estimated cost at list prices: no price/);
    assert.equal(text.out.includes('$0'), false, text.out);
    const j = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(j.json.totals.costUSD, null);
    assert.equal(j.json.totals.unpricedCalls, 2);
    assert.equal(j.json.byModel[0].costUSD, null);
    assert.ok(j.json.sessions.every((s) => s.costUSD === null));
  });
});

test('a session with no model call and a skill with no attributed call show $0, not no price, and --json gives 0', () => {
  withFixture({
    'proj-a/nocall.jsonl': [
      user(),
      { type: 'assistant', sessionId: 'nocall', timestamp: day(2), message: { role: 'assistant', content: [skillBlock('tu-nc', 'example-skill')] } },
    ],
    'proj-a/priced.jsonl': [assistant({ id: 'pr1', usage: usage(1000000, 0) })],
  }, ({ projects, pricesPath }) => {
    const base = ['--projects-dir', projects, ...pricesArg(pricesPath)];
    const text = run(base);
    assert.equal(text.code, 0, text.err);
    assert.equal(/^\s*(nocall|example-skill)\b.*no price/m.test(text.out), false, text.out);
    assert.match(text.out, /^\s*nocall\s+proj-a\s+2026-10-01\s+0\s.*\$0\.0000/m);
    assert.match(text.out, /^\s*example-skill\s+1\s+1\s+0\s+0\s+\$0\.0000$/m);
    const j = runJson(base).json;
    const row = j.sessions.find((s) => s.session === 'nocall');
    assert.equal(row.calls, 0);
    assert.strictEqual(row.costUSD, 0);
    assert.strictEqual(j.sessions.find((s) => s.session === 'priced').costUSD, 3);
    const skill = j.skills.find((s) => s.name === 'example-skill');
    assert.equal(skill.uses, 1);
    assert.equal(skill.attributedCalls, 0);
    assert.strictEqual(skill.attributedCostUSD, 0);
  });
});

test('a repeated flag exits 2 with one line on standard error', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'r1', usage: usage(1, 0) })],
  }, ({ projects, pricesPath }) => {
    const base = ['--projects-dir', projects, ...pricesArg(pricesPath)];
    for (const extra of [['--top', '1', '--top', '2'], ['--json', '--json'], ['--since', '2026-10-01', '--since', '2026-10-02']]) {
      const r = run([...base, ...extra]);
      assert.equal(r.code, 2, `${extra.join(' ')}: exit ${r.code}`);
      assert.equal(r.out, '', `${extra.join(' ')}: standard output must be empty`);
      assert.equal(r.err.trim().split('\n').length, 1, `${extra.join(' ')}: one line of standard error`);
    }
  });
});

test('--since later than --until exits 2; equal dates are allowed', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'd1', usage: usage(1, 0), time: day(5) })],
  }, ({ projects, pricesPath }) => {
    const base = ['--projects-dir', projects, ...pricesArg(pricesPath)];
    const late = run([...base, '--since', '2026-10-05', '--until', '2026-10-01']);
    assert.equal(late.code, 2, late.err);
    assert.equal(late.out, '');
    assert.match(late.err, /--since is later than --until/);
    assert.equal(late.err.trim().split('\n').length, 1);
    const same = run([...base, '--since', '2026-10-05', '--until', '2026-10-05']);
    assert.equal(same.code, 0, same.err);
  });
});

test('--json carries estimateNote when it carries money, and not when there is no price', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'x1', usage: usage(10, 0) })],
  }, ({ root, projects, pricesPath }) => {
    const priced = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]).json;
    assert.equal(typeof priced.estimateNote, 'string');
    assert.match(priced.estimateNote, /not a bill/);
    const copyDir = path.join(root, 'copy2');
    fs.mkdirSync(copyDir);
    const copy = path.join(copyDir, 'usage-dashboard.mjs');
    fs.copyFileSync(SCRIPT, copy);
    const tokensOnly = JSON.parse(run(['--json', '--projects-dir', projects], copy).out);
    assert.equal(tokensOnly.totals.costUSD, null);
    assert.equal('estimateNote' in tokensOnly, false);
  });
});

// Creating a link can need a privilege on Windows. A permission error skips the link test with a message; any other error fails it.
function makeLink(t, make) {
  try {
    make();
    return true;
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`cannot create a symbolic link here (${err.code}), so the symbolic link test is skipped`);
      return false;
    }
    throw err;
  }
}

test('symbolic links are never followed: a linked project folder, subagents folder and transcript file add nothing and are counted', (t) => {
  withFixture({
    'proj-a/sessA.jsonl': [user(), assistant({ id: 'k1', usage: usage(10, 0) })],
  }, ({ root, projects, pricesPath }) => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(outside, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'proj'), { recursive: true });
    const linkedLine = `${JSON.stringify(assistant({ id: 'L1', usage: usage(7777, 0), content: [{ type: 'text', text: `linked ${MARKER}` }] }))}\n`;
    fs.writeFileSync(path.join(outside, 'main.jsonl'), linkedLine);
    fs.writeFileSync(path.join(outside, 'sub', 'agent-x.jsonl'), `${JSON.stringify(assistant({ id: 'L2', usage: usage(8888, 0), content: [{ type: 'text', text: `linked ${MARKER}` }] }))}\n`);
    fs.writeFileSync(path.join(outside, 'proj', 's9.jsonl'), `${JSON.stringify(assistant({ id: 'L3', usage: usage(9999, 0), content: [{ type: 'text', text: `linked ${MARKER}` }] }))}\n`);
    fs.mkdirSync(path.join(projects, 'proj-a', 'sessA'));
    if (!makeLink(t, () => fs.symlinkSync(path.join(outside, 'sub'), path.join(projects, 'proj-a', 'sessA', 'subagents'), 'dir'))) return;
    if (!makeLink(t, () => fs.symlinkSync(path.join(outside, 'main.jsonl'), path.join(projects, 'proj-a', 'linked.jsonl'), 'file'))) return;
    if (!makeLink(t, () => fs.symlinkSync(path.join(outside, 'proj'), path.join(projects, 'proj-link'), 'dir'))) return;
    const text = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /skipped links: 3\./);
    assert.equal(text.out.includes(MARKER), false);
    const j = runJson(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(j.json.skippedLinks, 3);
    assert.equal(j.json.totals.sessions, 1);
    assert.equal(j.json.totals.calls, 1);
    assert.equal(j.json.totals.tokens.input, 10);
    assert.equal(JSON.stringify(j.json).includes(MARKER), false);
  });
});

test('the script source has no forbidden imports or calls, and no personal path', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  // Built from pieces, so this file does not hold a personal absolute path as one literal.
  const homeMarker = '/' + 'Users' + '/';
  assert.equal(src.includes(homeMarker), false, 'no personal path in the script');
  // Bare names and node: names, in import ... from, import(...) and require(...) forms.
  for (const mod of ['child_process', 'http', 'https', 'net', 'dgram', 'tls', 'worker_threads']) {
    const ref = new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*['"\`](?:node:)?${mod}['"\`]`);
    assert.equal(ref.test(src), false, `forbidden import in script: ${mod}`);
    assert.equal(src.includes(`node:${mod}`), false, `forbidden node: name anywhere in script: node:${mod}`);
  }
  for (const forbidden of [
    'fetch(', 'writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'rmSync', 'rmdir', 'copyFile',
    'symlink', 'truncate', 'createWriteStream', 'chmod', 'utimes', 'spawn', 'exec(',
  ]) {
    assert.equal(src.includes(forbidden), false, `forbidden text in script: ${forbidden}`);
  }
});
test('--since, --until, --project and --top each change the output as the skill describes', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'm1', usage: usage(10, 0), time: day(1) })],
    'proj-a/s2.jsonl': [assistant({ id: 'm2', usage: usage(20, 0), time: day(5) })],
    'proj-b/s3.jsonl': [assistant({ id: 'm3', usage: usage(30, 0), time: day(10) })],
  }, ({ projects, pricesPath }) => {
    const base = ['--projects-dir', projects, ...pricesArg(pricesPath)];
    const since = runJson([...base, '--since', '2026-10-05']).json;
    assert.deepEqual(since.sessions.map((s) => s.session).sort(), ['s2', 's3']);
    const until = runJson([...base, '--until', '2026-10-05']).json;
    assert.deepEqual(until.sessions.map((s) => s.session).sort(), ['s1', 's2']);
    const project = runJson([...base, '--project', 'proj-b']).json;
    assert.deepEqual(project.sessions.map((s) => s.session), ['s3']);
    const top = runJson([...base, '--top', '1']).json;
    assert.equal(top.sessions.length, 1);
    assert.equal(top.sessionsShown, 1);
    assert.equal(top.totals.sessions, 3, 'totals must cover every kept session');
    assert.equal(top.totals.tokens.input, 60);
    const all = runJson([...base, '--top', '0']).json;
    assert.equal(all.sessions.length, 3);
  });
});

test('--json output parses as JSON and its totals equal the text totals', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'm1', usage: usage(1000000, 250, 4000, 0, { cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } }) })],
    'proj-a/s2.jsonl': [assistant({ id: 'm2', usage: usage(7, 3) })],
  }, ({ projects, pricesPath }) => {
    const base = ['--projects-dir', projects, ...pricesArg(pricesPath)];
    const text = run(base);
    assert.equal(text.code, 0, text.err);
    const json = runJson(base).json;
    assert.equal(Number(text.out.match(/Sessions: (\d+)/)[1]), json.totals.sessions);
    assert.equal(Number(text.out.match(/Calls: (\d+)/)[1]), json.totals.calls);
    assert.equal(Number(text.out.match(/, all (\d+)/)[1]), json.totals.tokens.total);
    const money = text.out.match(/Estimated cost at list prices: \$([\d.]+)/)[1];
    assert.equal(money, json.totals.costUSD.toFixed(2));
  });
});

test('each wrong use exits 2 with one line on standard error and nothing on standard output', () => {
  withFixture({
    'proj-a/s1.jsonl': [assistant({ id: 'm1', usage: usage(10, 0) })],
  }, ({ root, projects, pricesPath }) => {
    const writePrices = (name, models) => {
      const p = path.join(root, name);
      fs.writeFileSync(p, JSON.stringify({ models }));
      return p;
    };
    const full = { input: 1, output: 1, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 1 };
    const missingField = writePrices('missing.json', { [TEST_MODEL]: { input: 1, output: 1, cacheRead: 1, cacheWrite5m: 1 } });
    const negative = writePrices('negative.json', { [TEST_MODEL]: { ...full, cacheRead: -1 } });
    const notJson = path.join(root, 'notjson.json');
    fs.writeFileSync(notJson, '{ broken');
    const cases = [
      ['unknown flag', ['--projects-dir', projects, '--nope']],
      ['bad date', ['--projects-dir', projects, '--since', '2026-13-01']],
      ['bad date word', ['--projects-dir', projects, '--until', 'yesterday']],
      ['missing value', ['--projects-dir', projects, '--project']],
      ['missing folder', ['--projects-dir', path.join(root, 'does-not-exist')]],
      ['unreadable price file', ['--projects-dir', projects, '--prices', path.join(root, 'no-such-prices.json')]],
      ['price file not JSON', ['--projects-dir', projects, '--prices', notJson]],
      ['price file with a missing field', ['--projects-dir', projects, '--prices', missingField]],
      ['price file with a negative price', ['--projects-dir', projects, '--prices', negative]],
    ];
    for (const [label, args] of cases) {
      const r = run(args);
      assert.equal(r.code, 2, `${label}: exit ${r.code}, stderr ${r.err}`);
      assert.equal(r.out, '', `${label}: standard output must be empty`);
      assert.equal(r.err.trim().split('\n').length, 1, `${label}: one line of standard error`);
    }
    assert.ok(pricesPath);
  });
});

test('--help prints the usage and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage: node <path to>\/usage-dashboard\.mjs \[options\]/);
  assert.match(r.out, /--since/);
});

test('an empty projects folder exits 0 with zero sessions', () => {
  withFixture({}, ({ projects, pricesPath }) => {
    const r = run(['--projects-dir', projects, ...pricesArg(pricesPath)]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Sessions: 0/);
  });
});

test('the shipped price file has five price fields for each of four models', () => {
  const data = JSON.parse(fs.readFileSync(SHIPPED_PRICES, 'utf8'));
  assert.deepEqual(Object.keys(data.models).sort(), ['claude-fable-5-1', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  for (const row of Object.values(data.models)) {
    assert.deepEqual(Object.keys(row).sort(), ['cacheRead', 'cacheWrite1h', 'cacheWrite5m', 'input', 'output']);
  }
});

// ---------- the installed skill: a fresh init, verify, and the script run from the installed workspace ----------

async function installWorkspace(t, prefix) {
  const root = await consumerRoot(prefix);
  cleanup(t, root);
  const target = path.join(root, 'Usage Workspace');
  fs.mkdirSync(target);
  const planned = await runCli(['init', '--target', target]);
  const digest = planDigest(planned.stdout);
  assert.ok(digest, planned.stdout);
  const applied = await runCli(['init', '--target', target, '--apply', digest]);
  assert.equal(applied.code, undefined, applied.stdout);
  return { root, target };
}

function runScript(script, cwd, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

test('a fresh init installs the usage dashboard into both skill folders, byte for byte, and verify passes', async (t) => {
  const { target } = await installWorkspace(t, 'second-brain-usage-');
  for (const client of ['.agents', '.claude']) {
    for (const file of ['SKILL.md', 'usage-dashboard.mjs', 'usage-prices.json']) {
      const installed = fs.readFileSync(path.join(target, client, 'skills', 'usage-dashboard', file));
      assert.deepEqual(installed, fs.readFileSync(path.join(SKILL_DIR, file)), `${client} ${file} differs from the shipped file`);
    }
  }
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('after the installed price file is edited, verify still passes', async (t) => {
  const { target } = await installWorkspace(t, 'second-brain-usage-prices-');
  const priceFile = path.join(target, '.claude', 'skills', 'usage-dashboard', 'usage-prices.json');
  const before = fs.readFileSync(priceFile, 'utf8');
  const edited = before.replace('"asOf": "2026-10-06"', '"asOf": "2026-10-13"');
  assert.notEqual(edited, before, 'the planted edit changed the file');
  fs.writeFileSync(priceFile, edited);
  const verified = await runCli(['verify', '--target', target]);
  assert.equal(verified.code, undefined, verified.stdout);
  assert.match(verified.stdout, /Verification: OK/);
});

test('the installed script exits 0 on a clean fake transcript folder, 1 with one broken line named by file and line, and 0 again once restored', async (t) => {
  const { root, target } = await installWorkspace(t, 'second-brain-usage-run-');
  const fake = path.join(root, 'fake-projects');
  const file = path.join(fake, 'proj-a', 's1.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = (id) => JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2026-10-01T10:00:00.000Z',
    message: { id, model: TEST_MODEL, usage: usage(10, 5), content: [{ type: 'text', text: 'hello' }] },
  });
  const clean = `${good('f1')}\n${good('f2')}\n`;
  const broken = `${good('f1')}\n{"type":"assistant","BROKEN \n${good('f2')}\n`;
  fs.writeFileSync(file, clean);
  for (const client of ['.agents', '.claude']) {
    const script = path.join(target, client, 'skills', 'usage-dashboard', 'usage-dashboard.mjs');
    const r = runScript(script, target, ['--projects-dir', fake]);
    assert.equal(r.status, 0, `${client}: ${r.stderr}`);
    assert.match(r.stdout, /Calls: 2/, `${client}: two calls counted`);
  }
  const script = path.join(target, '.claude', 'skills', 'usage-dashboard', 'usage-dashboard.mjs');
  fs.writeFileSync(file, broken);
  const bad = runScript(script, target, ['--projects-dir', fake]);
  assert.equal(bad.status, 1, bad.stderr);
  assert.ok(bad.stdout.includes(`${file}:2 not valid JSON`), bad.stdout);
  assert.equal(bad.stdout.includes('BROKEN'), false, 'the broken text is not printed');
  fs.writeFileSync(file, clean);
  const restored = runScript(script, target, ['--projects-dir', fake]);
  assert.equal(restored.status, 0, restored.stderr);
});
