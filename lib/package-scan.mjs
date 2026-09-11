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
const CREDENTIAL = /\b(?:api[-_]?key|secret|access[-_]?token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{8,}/i;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/;

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

function encodedCandidates(text) {
  const candidates = [];
  for (const token of text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? []) {
    try {
      const decoded = Buffer.from(token.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
      if (decoded && /^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) candidates.push(decoded);
    } catch {
      // A non-base64-looking word is not a finding.
    }
  }
  for (const token of text.match(/(?:%[0-9a-f]{2}){4,}/gi) ?? []) {
    try {
      candidates.push(decodeURIComponent(token));
    } catch {
      // Invalid percent encoding is not a finding by itself.
    }
  }
  return candidates;
}

function inspectContent(bytes, member, findings) {
  const text = bytes.toString('utf8');
  for (const rule of rulesForContent(text)) addFinding(findings, rule, member);
  for (const candidate of encodedCandidates(text)) {
    for (const rule of rulesForContent(candidate)) addFinding(findings, `ENCODED_${rule}`, member);
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
      // Tests are enumerated and allowlist-checked, but intentionally keep
      // synthetic hostile strings used to prove the production scanner.
      // Candidate builders scan the distributed tree separately.
      if (!member.startsWith('test/')) inspectContent(await readFile(memberPath), member, findings);
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
