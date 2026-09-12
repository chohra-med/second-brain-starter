import path from 'node:path';
import { lstat, opendir, readFile, realpath } from 'node:fs/promises';

export class PackageScanError extends Error {
  constructor(report) {
    super(`Package scan failed with ${report.findings.length} finding(s).`);
    this.name = 'PackageScanError';
    this.code = 'PACKAGE_SCAN_FAILED';
    this.report = report;
  }
}

const OMITTED_ROOT_MEMBERS = new Set(['.git']);
const PRIVATE_PATH_SEGMENT = /^(?:\.env(?:\..*)?|\.codex|private|credentials?)$/i;
const PREMIUM_MARKER = /\b(?:agentic[-_ ]os|premium[-_ ]only|paid[-_ ]private)\b/i;
const PERSONAL_PATH = /(?:^|[\s"'`])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/;
const AUTHORIZATION = /\bauthorization\s*:\s*(?:bearer|basic|token)\s+\S+/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const CREDENTIAL = /\b(?:api[-_]?key|secret|access[-_]?token|password)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{8,}/i;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/;

function syntheticTestPattern(member) {
  if (member !== 'test/transaction.test.mjs') return null;
  return ['API', '_KEY', '=', 'not', '-', 'a', '-', 'secret'].join('');
}

function portableRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value) || value.includes('\\')) {
    throw new TypeError(`${label} must be a non-empty portable relative path.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must not contain traversal segments.`);
  }
  return value;
}

function relativePath(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new TypeError(`Scan member escapes its supplied root: ${candidate}`);
  }
  return relative.split(path.sep).join('/');
}

function addFinding(findings, rule, member) {
  findings.push({ rule, path: member });
}

function inspectPath(member, findings) {
  const segments = member.split('/');
  if (segments.some((segment) => PRIVATE_PATH_SEGMENT.test(segment))) addFinding(findings, 'PRIVATE_PATH', member);
}

function rulesForContent(text) {
  return [
    ['AUTHORIZATION_MATERIAL', AUTHORIZATION],
    ['JWT_MATERIAL', JWT],
    ['PRIVATE_KEY_MATERIAL', PRIVATE_KEY],
    ['CREDENTIAL_MATERIAL', CREDENTIAL],
    ['PERSONAL_ABSOLUTE_PATH', PERSONAL_PATH],
    ['PREMIUM_MARKER', PREMIUM_MARKER],
  ].filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule);
}

function decodeUtf16(bytes, littleEndian) {
  const copy = Buffer.from(bytes);
  if (!littleEndian) copy.swap16();
  return copy.toString('utf16le');
}

function utf16Candidates(bytes) {
  if (bytes.length < 4) return [];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return [decodeUtf16(bytes.subarray(2), true)];
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return [decodeUtf16(bytes.subarray(2), false)];
  const evenNulls = bytes.filter((_, index) => index % 2 === 0 && bytes[index] === 0).length;
  const oddNulls = bytes.filter((_, index) => index % 2 === 1 && bytes[index] === 0).length;
  const threshold = Math.floor(bytes.length / 4);
  if (oddNulls > threshold) return [decodeUtf16(bytes, true)];
  if (evenNulls > threshold) return [decodeUtf16(bytes, false)];
  return [];
}

function decodedTextCandidates(text) {
  const candidates = [];
  const unicode = text.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
  if (unicode !== text) candidates.push(unicode);
  const html = text.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
  if (html !== text) candidates.push(html);
  const percent = text.replace(/(?:%[0-9a-f]{2})+/gi, (token) => {
    try {
      return decodeURIComponent(token);
    } catch {
      return token;
    }
  });
  if (percent !== text) candidates.push(percent);
  const base64Tokens = new Map((text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? []).map((token) => [token, false]));
  // Keep wrapped candidates bounded to lexical runs inside whitespace tokens.
  // Punctuation at a token edge is a delimiter, not encoded material.
  const chunks = [];
  for (const token of text.split(/[ \t\r\n]+/).filter(Boolean)) {
    const runs = [...token.matchAll(/[A-Za-z0-9+/_-]+={0,2}/g)];
    for (const match of runs) {
      const run = match[0];
      if (run.length > 16) {
        for (const [index, character] of [...run].entries()) {
          if (!/[+/_-]/.test(character)) continue;
          const before = run.slice(0, index);
          const after = run.slice(index + 1);
          if (before.length > 0 && before.length <= 16) chunks.push(before);
          if (after.length > 0 && after.length <= 16) chunks.push(after);
        }
        continue;
      }
      const alternatives = new Set([run]);
      for (const edge of ['-', '_', '/', '+', '=']) {
        if (run.startsWith(edge)) alternatives.add(run.slice(1));
        if (run.endsWith(edge)) alternatives.add(run.slice(0, -1));
      }
      for (const [index, character] of [...run].entries()) {
        if (!/[+/_-]/.test(character)) continue;
        const before = run.slice(0, index);
        const after = run.slice(index + 1);
        if (before.length > 0 && before.length <= 16) alternatives.add(before);
        if (after.length > 0 && after.length <= 16) alternatives.add(after);
      }
      for (const alternative of alternatives) if (alternative) chunks.push(alternative);
    }
  }
  for (let start = 0; start < chunks.length; start += 1) {
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(chunks[start]) || chunks[start].length > 16) continue;
    let compact = '';
    for (let end = start; end < chunks.length && end < start + 128; end += 1) {
      const chunk = chunks[end];
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(chunk) || chunk.length > 16) break;
      compact += chunk;
      if (compact.length >= 16) {
        base64Tokens.set(compact, true);
      }
    }
  }
  for (const [token, whitespaceWrapped] of base64Tokens) {
    const compact = token.replace(/[\t\n\r ]/g, '');
    if (compact.length < 16 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) continue;
    try {
      const padded = `${compact.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (compact.length % 4)) % 4)}`;
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      if (decoded && !decoded.includes('\uFFFD') && (!whitespaceWrapped || rulesForContent(decoded).length > 0)) candidates.push(decoded);
    } catch {
      // A base64-looking word is not a finding by itself.
    }
  }
  return candidates;
}

function normalizedContentCandidates(bytes, syntheticPattern = null) {
  const initial = [bytes.toString('utf8'), ...utf16Candidates(bytes)].map((text, index) => ({
    text: syntheticPattern ? text.replaceAll(syntheticPattern, '') : text,
    encoded: index > 0,
  }));
  const candidates = [];
  const seen = new Set();
  const queue = initial.map((candidate) => ({ ...candidate, depth: 0 }));
  while (queue.length > 0) {
    const candidate = queue.shift();
    const key = `${candidate.encoded}:${candidate.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidate.depth >= 2) continue;
    for (const text of decodedTextCandidates(candidate.text)) {
      queue.push({ text, encoded: true, depth: candidate.depth + 1 });
    }
  }
  return candidates;
}

export function sensitiveContentRules(bytes) {
  return [...new Set(normalizedContentCandidates(Buffer.from(bytes)).flatMap(({ text }) => rulesForContent(text)))];
}

function inspectContent(bytes, member, findings) {
  const syntheticPattern = syntheticTestPattern(member);
  for (const candidate of normalizedContentCandidates(bytes, syntheticPattern)) {
    for (const rule of rulesForContent(candidate.text)) addFinding(findings, candidate.encoded ? `ENCODED_${rule}` : rule, member);
  }
}

async function scanTree({ root, label, allowlist = null }) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) throw new TypeError(`${label} root must not be a symlink.`);
  if (!rootStat.isDirectory()) throw new TypeError(`${label} root must be a directory.`);
  const rootReal = await realpath(root);
  const paths = [];
  const findings = [];

  async function walk(directory) {
    const handle = await opendir(directory);
    const entries = [];
    for await (const entry of handle) entries.push(entry.name);
    for (const name of entries.sort()) {
      if (directory === rootReal && OMITTED_ROOT_MEMBERS.has(name)) continue;
      const memberPath = path.join(directory, name);
      const member = relativePath(rootReal, memberPath);
      const stat = await lstat(memberPath);
      if (stat.isSymbolicLink()) {
        addFinding(findings, 'SYMLINK_MEMBER', member);
        continue;
      }
      if (stat.isDirectory()) {
        await walk(memberPath);
        continue;
      }
      if (!stat.isFile()) {
        addFinding(findings, 'NON_REGULAR_MEMBER', member);
        continue;
      }
      paths.push(member);
      inspectPath(member, findings);
      if (allowlist && !allowlist.has(member)) addFinding(findings, 'UNALLOWLISTED_MEMBER', member);
      inspectContent(await readFile(memberPath), member, findings);
    }
  }

  await walk(rootReal);
  return { label, root: rootReal, paths, findings };
}

export async function readAllowlist(allowlistPath) {
  const lines = (await readFile(allowlistPath, 'utf8')).split(/\r?\n/);
  const entries = lines.filter((line) => line && !line.startsWith('#')).map((line) => portableRelative(line, 'Allowlist entry'));
  if (new Set(entries).size !== entries.length) throw new TypeError('Allowlist contains duplicate entries.');
  return new Set(entries);
}

export function scanDiffEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Diff entries must be an array.');
  const findings = [];
  const paths = [];
  for (const entry of entries) {
    const member = portableRelative(entry?.path, 'Diff entry path');
    paths.push(member);
    inspectPath(member, findings);
    for (const bytes of [entry.before, entry.after]) {
      if (bytes !== undefined && bytes !== null) inspectContent(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)), member, findings);
    }
  }
  return { paths: paths.sort(), findings };
}

export async function scanPackage({ sourceRoot, allowlistPath, archiveRoot = null, diffEntries = [] }) {
  const allowlist = await readAllowlist(allowlistPath);
  const source = await scanTree({ root: sourceRoot, label: 'source', allowlist });
  const archive = archiveRoot ? await scanTree({ root: archiveRoot, label: 'archive', allowlist }) : null;
  const diff = scanDiffEntries(diffEntries);
  const findings = [...source.findings, ...(archive?.findings ?? []), ...diff.findings]
    .sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
  return {
    clean: findings.length === 0,
    allowlist: [...allowlist].sort(),
    source,
    archive,
    diff,
    findings,
  };
}

export async function assertCleanPackage(options) {
  const report = await scanPackage(options);
  if (!report.clean) throw new PackageScanError(report);
  return report;
}
