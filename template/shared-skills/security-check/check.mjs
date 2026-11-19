// security-check: reads a skill, plugin, MCP server config or hook folder and reports what could harm the workspace.
// Node 22 or newer, no packages. It reads files only: it never starts them and opens no connection.
//   node check.mjs <folder> [--project <name>] [--report-dir <dir>] [--json]
//   node check.mjs --all <root> [--project <name>] [--report-dir <dir>] [--json]
// Exit codes: 0 PASS, 3 FLAG, 4 BLOCK, 2 usage or read error. Node itself uses 1 when it crashes.
// The detection words are joined from pieces at run time, so this file and SKILL.md pass their own check.

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ PASS: 0, FLAG: 3, BLOCK: 4, USAGE: 2 });
const RANK = { PASS: 0, FLAG: 1, BLOCK: 2 };
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
// The key scan decodes every word that could hide a key, and its time and memory grow fast with the text: a 57 KB map
// file took 17 s and 1.8 GB, a 433 KB data file ran out of memory. Files up to 128 KB (about 30 s and 2.3 GB in the
// worst case measured) are scanned. A larger text file, and a binary file, is not key-scanned and gets its own FLAG.
export const KEY_SCAN_MAX_BYTES = 128 * 1024;

const j = (...parts) => parts.join('');
const any = (words) => words.join('|');
const rx = (source, flags = '') => new RegExp(source, flags);

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Check 5, keys: a copy of sensitiveContentRules from the starter's lib/package-scan.mjs, because a workspace has
// no lib/ folder. test/security-check-skill.test.mjs proves both give the same rules on the same inputs. The
// starter-only premium marker rule is left out.
// ---------------------------------------------------------------------------------------------------------------

const PERSONAL_PATH = /(?:^|[\s"'`])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/;
const AUTHORIZATION = /\bauthorization\s*:\s*(?:bearer|basic|token)\s+\S+/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const CREDENTIAL = /\b(?:api[-_]?key|secret|access[-_]?token|password)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{8,}/i;
const EMBEDDED_CREDENTIAL = /(?:api[-_]?key|secret|access[-_]?token|password)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{8,}/i;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

// A credential match whose gap after the colon or equals sign crosses a line break counts only when the value on
// the next line is not code. A value followed, after optional spaces, by an equals sign, an opening bracket or a
// dot is a statement or a call that starts the next line, not a secret. Same-line matches are unchanged.
// That exemption does not hold when the next line carries a key-like value: a first token, or a quoted string
// (a hard-coded default inside a call), of 16 or more characters that mixes letters and digits, or of 8 to 15
// characters that mixes letters and digits and is not a path, a file name or an env var NAME in capitals.
const KEY_LIKE_TOKEN = /^(?=[A-Za-z0-9_./+\-=]*\d)(?=[A-Za-z0-9_./+\-=]*[A-Za-z])[A-Za-z0-9_./+\-=]{16,}$/;
const KEY_LIKE_QUOTED = /(["'`])(?=[A-Za-z0-9_./+\-=]*\d)(?=[A-Za-z0-9_./+\-=]*[A-Za-z])[A-Za-z0-9_./+\-=]{16,}\1/;
const KEY_LIKE_SHORT = /(["'`])(?=[A-Za-z0-9_+\-=]*\d)(?=[A-Za-z0-9_+\-=]*[A-Za-z])(?![A-Z0-9_]+\1)[A-Za-z0-9_+\-=]{8,15}\1/;
function keyLikeLine(token, line) {
  return KEY_LIKE_TOKEN.test(token) || KEY_LIKE_QUOTED.test(line) || KEY_LIKE_SHORT.test(line);
}
function credentialInText(text) {
  for (let from = 0; from < text.length;) {
    const rest = text.slice(from);
    const match = rest.match(CREDENTIAL);
    if (!match) return false;
    const gap = match[0].slice(match[0].search(/[:=]/) + 1).match(/^\s*/)[0];
    const end = match.index + match[0].length;
    const value = match[0].slice(match[0].search(/[:=]/) + 1).replace(/^\s*["']?/, '');
    if (!/[\r\n]/.test(gap) || !/^[ \t]*[=(.]/.test(rest.slice(end)) || keyLikeLine(value, (value + rest.slice(end)).split(/\r?\n/)[0])) return true;
    from += match.index + 1;
  }
  return false;
}

function rulesForContent(text) {
  return [
    ['AUTHORIZATION_MATERIAL', AUTHORIZATION],
    ['JWT_MATERIAL', JWT],
    ['PRIVATE_KEY_MATERIAL', PRIVATE_KEY],
    ['CREDENTIAL_MATERIAL', CREDENTIAL],
    ['PERSONAL_ABSOLUTE_PATH', PERSONAL_PATH],
  ].filter(([, pattern]) => (pattern === CREDENTIAL ? credentialInText(text) : pattern.test(text))).map(([rule]) => rule);
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
  const positions = [];
  for (const token of text.split(/[ \t\r\n]+/).filter(Boolean)) {
    const runs = [...token.matchAll(/[A-Za-z0-9+/_-]+={0,2}/g)];
    for (const match of runs) {
      const run = match[0];
      if (run.length > 16) {
        const starts = [];
        const ends = [];
        for (let width = 1; width <= 16; width += 1) {
          starts.push(run.slice(-width));
          ends.push(run.slice(0, width));
        }
        for (const segment of run.split(/[+/_-]+/)) {
          if (segment.length > 0 && segment.length <= 16) {
            starts.push(segment);
            ends.push(segment);
          }
        }
        for (const [index, character] of [...run].entries()) {
          if (!/[+/_-]/.test(character)) continue;
          const before = run.slice(0, index);
          const after = run.slice(index + 1);
          if (before.length > 0 && before.length <= 16) ends.push(before);
          if (after.length > 0 && after.length <= 16) starts.push(after);
        }
        positions.push({ original: run, starts, ends });
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
      const interpretations = [...alternatives].filter(Boolean);
      positions.push({ original: run, starts: interpretations, ends: interpretations });
    }
  }
  const addWrappedCandidate = (compact) => {
    if (compact.length >= 16 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) base64Tokens.set(compact, true);
  };
  const decodeBase64Candidate = (compact, whitespaceWrapped) => {
    if (compact.length < 16 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return;
    try {
      const padded = `${compact.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (compact.length % 4)) % 4)}`;
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      const decodedRules = rulesForContent(decoded);
      const embeddedCredential = whitespaceWrapped ? null : decoded.match(EMBEDDED_CREDENTIAL);
      if (embeddedCredential?.index != null) candidates.push(decoded.slice(embeddedCredential.index));
      else if (decoded && (decodedRules.length > 0 || (!whitespaceWrapped && !decoded.includes(REPLACEMENT_CHARACTER)))) candidates.push(decoded);
    } catch {
      // A base64-looking word is not a finding by itself.
    }
  };
  for (let start = 0; start < positions.length; start += 1) {
    for (const seed of positions[start].starts) {
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(seed) || seed.length > 16) continue;
      let compact = '';
      for (let end = start; end < positions.length && end < start + 128; end += 1) {
        const original = positions[end].original;
        if (end !== start && (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(original) || original.length > 16)) {
          if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(original) && original.length > 16) {
            for (const alternative of positions[end].ends) {
              if (alternative.length <= 16) addWrappedCandidate(compact + alternative);
            }
          }
          break;
        }
        compact = end === start ? seed : compact + original;
        addWrappedCandidate(compact);
        if (end === start) continue;
        const prefix = compact.slice(0, -original.length);
        for (const alternative of positions[end].ends) {
          if (alternative.length <= 16) addWrappedCandidate(prefix + alternative);
        }
      }
    }
  }
  for (const token of text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? []) {
    for (let phase = 0; phase < 4 && token.length - phase >= 16; phase += 1) {
      decodeBase64Candidate(token.slice(phase), false);
    }
  }
  for (const [token, whitespaceWrapped] of base64Tokens) {
    const compact = token.replace(/[\t\n\r ]/g, '');
    decodeBase64Candidate(compact, whitespaceWrapped);
  }
  return candidates;
}

function normalizedContentCandidates(bytes) {
  const initial = [bytes.toString('utf8'), ...utf16Candidates(bytes)].map((text, index) => ({ text, encoded: index > 0 }));
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

// Same contract as sensitiveContentRules in lib/package-scan.mjs, without the premium marker rule.
export function keyRules(bytes) {
  return [...new Set(normalizedContentCandidates(Buffer.from(bytes)).flatMap(({ text }) => rulesForContent(text)))];
}

const KEY_RULE_IDS = {
  AUTHORIZATION_MATERIAL: 'key-authorization',
  JWT_MATERIAL: 'key-jwt',
  PRIVATE_KEY_MATERIAL: 'key-private',
  CREDENTIAL_MATERIAL: 'key-credential',
  PERSONAL_ABSOLUTE_PATH: 'personal-path',
};

// A report never holds a key: each value shows its first four characters and its length.
export function maskValue(value) {
  return `${value.slice(0, 4)}... (${value.length} chars)`;
}

function maskKeyMatch(rule, match) {
  if (rule === 'CREDENTIAL_MATERIAL') {
    const split = match.match(/^(.*?["']?\s*[:=]\s*["']?)(.*)$/s);
    return split ? `${split[1]}${maskValue(split[2])}` : maskValue(match);
  }
  if (rule === 'AUTHORIZATION_MATERIAL') {
    const split = match.match(/^(.*?\s*:\s*\S+\s+)(\S+)$/s);
    return split ? `${split[1]}${maskValue(split[2])}` : maskValue(match);
  }
  if (rule === 'PRIVATE_KEY_MATERIAL') return `${match.slice(0, 10)}... (key block)`;
  return maskValue(match.trim());
}

const MASKERS = [
  ['AUTHORIZATION_MATERIAL', rx(AUTHORIZATION.source, 'gi')],
  ['JWT_MATERIAL', rx(JWT.source, 'g')],
  ['CREDENTIAL_MATERIAL', rx(CREDENTIAL.source, 'gi')],
  ['PRIVATE_KEY_MATERIAL', rx(PRIVATE_KEY.source, 'g')],
];

// ---------------------------------------------------------------------------------------------------------------
// Rule table: check, verdict, why, one-line fix.
// ---------------------------------------------------------------------------------------------------------------

export const CHECKS = {
  'runs-on-its-own': '1. Runs on its own',
  network: '2. Network calls',
  'unpinned-install': '3. Unpinned installs',
  orders: '4. Orders aimed at the assistant',
  keys: '5. Keys in files',
  outside: '6. Writes outside its folder',
  collect: 'Reading the folder',
};

export const RULES = {
  hook: ['runs-on-its-own', 'FLAG', 'A hook runs a command on its own when an event fires.', 'Read the hook command and keep it only if it should run at every event.'],
  'mcp-server': ['runs-on-its-own', 'FLAG', 'The client starts this MCP server on its own.', 'Pin the server to an exact version and keep it only if you trust its source.'],
  'install-script': ['runs-on-its-own', 'FLAG', 'A package script runs on its own during install.', 'Remove the install-time script, or read exactly what it runs.'],
  'scheduled-job': ['runs-on-its-own', 'FLAG', 'A scheduled job runs on its own at load or on a timer.', 'Remove the job and start the command by hand when needed.'],
  'git-hook': ['runs-on-its-own', 'FLAG', 'A git hook runs on its own at commit, push or checkout.', 'Remove the git hook, or set it up yourself after reading it.'],
  'executable-file': ['runs-on-its-own', 'FLAG', 'The file is marked executable or starts with an interpreter line.', 'Clear the executable bit unless SKILL.md tells the reader to run this file.'],
  'start-unpinned': ['runs-on-its-own', 'BLOCK', 'Something that starts on its own fetches a package or a download with no exact version.', 'Pin an exact version (name@1.2.3, name==1.2.3 or a commit) or remove the entry.'],
  'network-call': ['network', 'FLAG', 'A command or call that reaches the network.', 'Confirm the address is expected, or remove the call.'],
  'address-in-code': ['network', 'FLAG', 'A web address inside code or a code block.', 'Confirm the host is expected, or remove the address.'],
  'mcp-remote': ['network', 'FLAG', 'An MCP server reached over the network.', 'Confirm the host is expected and trusted.'],
  'remote-load': ['network', 'FLAG', 'A page loads a script, style or image from another host.', 'Keep the file beside the page instead of loading it from another host.'],
  'package-runner': ['unpinned-install', 'FLAG', 'A package runner fetches whatever version is newest at run time.', 'Add an exact version (name@1.2.3) or a commit.'],
  'package-install': ['unpinned-install', 'FLAG', 'An install without an exact version.', 'Pin an exact version (name@1.2.3 or name==1.2.3).'],
  'pipe-to-shell': ['unpinned-install', 'FLAG', 'A download is piped straight into a shell or an interpreter.', 'Save the file, read it and check its hash before running it.'],
  'github-ref': ['unpinned-install', 'FLAG', 'A repository reference with no commit.', 'Add #<full commit hash> to the reference.'],
  'unpinned-dependency': ['unpinned-install', 'FLAG', 'A dependency with a version range or no version.', 'Use an exact version.'],
  'visible-order': ['orders', 'FLAG', 'Visible text that tells the assistant to drop its rules, keep something from the person, act without a yes or send data out.', 'Remove the sentence, or rewrite it so the person stays in charge.'],
  'approval-off': ['orders', 'FLAG', "A switch that turns the person's approvals off.", 'Remove the switch.'],
  'hidden-unicode': ['orders', 'BLOCK', 'Invisible or direction-changing characters hide text from a human reader.', 'Delete the hidden characters and check again.'],
  'hidden-comment': ['orders', 'BLOCK', 'A comment hides an order aimed at the assistant from a human reader.', 'Delete the comment, or move its text into the visible page.'],
  'hidden-style': ['orders', 'BLOCK', 'Styling hides an instruction from a human reader.', 'Delete the hidden element, or make its text visible.'],
  'encoded-order': ['orders', 'BLOCK', 'Encoded text decodes to an instruction or a command.', 'Delete the encoded text.'],
  'hidden-text': ['orders', 'FLAG', 'Text that styling hides from a human reader.', 'Delete it, or make it visible.'],
  'key-authorization': ['keys', 'BLOCK', 'An authorization header value.', 'Delete the value, revoke it, and read it from the environment instead.'],
  'key-jwt': ['keys', 'BLOCK', 'A signed token.', 'Delete the token and revoke it.'],
  'key-private': ['keys', 'BLOCK', 'Private key material.', 'Delete the key block and replace the key.'],
  'key-credential': ['keys', 'BLOCK', 'A credential assignment.', 'Delete the value, revoke it, and read it from the environment instead.'],
  'personal-path': ['keys', 'FLAG', "A path that names a person's home folder.", 'Use a path relative to the workspace.'],
  'write-outside': ['outside', 'FLAG', 'A write to a home, parent or system path outside the folder.', 'Write inside the workspace, or ask the person first.'],
  'write-protected': ['outside', 'BLOCK', "A write to a credential store, a shell start file, a scheduler or another tool's settings.", 'Remove the write; the person changes these files by hand.'],
  'credential-store': ['outside', 'FLAG', 'Names a credential store.', 'Confirm the skill only names it and never reads it.'],
  'symlink-outside': ['outside', 'BLOCK', 'A link inside the folder points outside it.', 'Replace the link with a copy of the file.'],
  symlink: ['outside', 'FLAG', 'A link inside the folder.', 'Replace the link with a regular file.'],
  'not-scanned-large': ['keys', 'FLAG', `The file is larger than ${KEY_SCAN_MAX_BYTES / 1024} KB, so it was not scanned for keys.`, 'Read the file by hand for keys, or keep large data files out of the folder.'],
  'not-scanned-binary': ['keys', 'FLAG', 'The file is binary (an image, font, archive or program), so it was not scanned for keys.', 'Confirm the file is what its name says, or remove it from the folder.'],
  'too-large': ['collect', 'FLAG', 'The file is too large to read in full.', 'Read the file by hand before trusting it.'],
  'not-scanned-unreadable': ['collect', 'FLAG', 'The file or folder could not be read, so nothing in it was checked.', 'Make it readable for your user and check again, or remove it.'],
};

export const BEST_PRACTICE_FIXES = {
  'bp-frontmatter': 'Start SKILL.md with a front matter block between two lines of three dashes.',
  'bp-name-missing': 'Add name: <folder name> to the front matter.',
  'bp-name-length': 'Shorten the name to 64 characters or fewer.',
  'bp-name-chars': 'Use only lowercase letters, digits and hyphens in the name.',
  'bp-name-hyphens': 'Remove the leading, trailing or double hyphen from the name.',
  'bp-name-folder': 'Make the name and the folder name the same.',
  'bp-name-reserved': 'Remove the reserved word from the name.',
  'bp-name-xml': 'Remove the XML tag from the name.',
  'bp-name-vague': 'Use a specific name that says what the skill does.',
  'bp-description-missing': 'Add a description that says what the skill does and when to use it.',
  'bp-description-length': 'Shorten the description to 1,024 characters or fewer.',
  'bp-description-xml': 'Remove the XML tag from the description.',
  'bp-description-person': 'Write the description in the third person, for example "Builds..." or "Reads...".',
  'bp-description-when': 'Add when to use it, for example "Use when ...".',
  'bp-compatibility-length': 'Shorten compatibility to 500 characters or fewer.',
  'bp-body-length': 'Keep the SKILL.md body under 500 lines; move detail into reference files.',
  'bp-reference-depth': 'Link this file directly from SKILL.md instead of from another reference file.',
  'bp-reference-toc': 'Add a contents list near the top of this reference file.',
  'bp-windows-path': 'Use forward slashes in paths.',
  'bp-time-sensitive': 'Remove the date condition, or move the old way into an "Old patterns" section.',
  'bp-unmentioned-script': 'Name the script in SKILL.md and say whether to run it or read it.',
};

// ---------------------------------------------------------------------------------------------------------------
// Detection patterns, joined from pieces.
// ---------------------------------------------------------------------------------------------------------------

const HTTP_URL = rx(j('\\b', j('ht', 'tps?'), ':\\/\\/([^\\s/?#"\'<>)\\]`|\\\\]+)'), 'gi');
const SPECIAL_HOSTS = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|(?:[\w-]+\.)*example(?:\.(?:com|org|net))?|(?:[\w-]+\.)*(?:invalid|test|localhost|example))$/i;

const NETWORK_PATTERNS = [
  rx(j('(?:^|[^\\w./-])(?:', any([j('cu', 'rl'), j('wg', 'et'), j('ht', 'tpie'), j('ari', 'a2c')]), ')(?=\\s|$)')),
  rx(j('\\b', j('fet', 'ch'), '\\s*\\(')),
  rx(j('\\b', j('ht', 'tps?'), '\\.(?:request|get)\\s*\\(')),
  rx(j('\\bXML', 'Http', 'Request\\b')),
  rx(j('\\bnew\\s+Web', 'Socket\\b')),
  rx(j('\\b', j('requ', 'ests'), '\\.(?:get|post|put|patch|delete|head|request|Session)\\b')),
  rx(j('\\b(?:', any([j('url', 'lib\\.request'), j('url', 'lib[23]'), j('url', 'open'), j('ht', 'tpx'), j('aio', 'http'), j('Invoke-Web', 'Request'), j('Invoke-Rest', 'Method')]), ')\\b')),
  rx(j('\\bsocket\\.(?:connect|create_connection)\\b')),
  rx(j('\\bnet\\.(?:connect|createConnection)\\s*\\(')),
  rx(j('(?:^|[\\s;&|(`])(?:', any([j('n', 'c'), j('nc', 'at'), j('net', 'cat')]), ')\\s+-?[\\w.]')),
  rx(j('(?:^|[\\s;&|(`])(?:', any([j('ss', 'h'), j('sc', 'p'), j('sf', 'tp')]), ')\\s+(?:-\\w+\\s+)*[\\w.-]*@?[\\w.-]+')),
  rx(j('\\bgit\\s+(?:', any([j('clo', 'ne'), j('fet', 'ch'), j('pu', 'll'), j('pu', 'sh'), j('ls-re', 'mote')]), ')\\b')),
  rx(j('\\b(?:', any([j('Web', 'Fetch'), j('Web', 'Search')]), ')\\b')),
  rx(j('(?:from\\s+|require\\s*\\(\\s*|import\\s*\\(\\s*)[\'"](?:node:)?(?:', any([j('ht', 'tp'), j('ht', 'tps'), j('ht', 'tp2'), 'net', 'tls', 'dgram']), ')[\'"]')),
  rx(j('^\\s*(?:import|from)\\s+(?:', any([j('requ', 'ests'), j('url', 'lib\\.request'), j('url', 'lib[23]'), j('ht', 'tpx'), j('aio', 'http'), 'socket', j('para', 'miko')]), ')\\b')),
];

// Checks 2 and 3 for a program started from an argument list in code. The program and each argument are separate
// strings there, so the command line the patterns above read never appears: a Node process call with a list, a
// Python process call with a list, an os exec or spawn call, an asyncio process call or a Go command. The quoted
// strings of the call are read in order: the first names the program, the rest are its arguments.
const PROCESS_CALL = rx(j(
  '\\b(?:', any([
    j('spa', 'wn(?:Sync)?'), j('exec', 'File(?:Sync)?'), j('fo', 'rk'), j('exe', 'ca(?:Sync)?'),
    j('sub', 'process\\.(?:run|Popen|call|check_call|check_output)'), j('os\\.(?:exec|spa', 'wn)[lv]p?e?'),
    j('create_sub', 'process_exec'), j('exec\\.Com', 'mand(?:Context)?'),
  ]), ')\\s*\\(',
  '|\\b(?:', any(['run', 'Popen', 'call', 'check_call', 'check_output']), ')\\s*\\((?=\\s*\\[)',
), 'g');
const NETWORK_PROGRAMS = new Set([j('cu', 'rl'), j('wg', 'et'), j('ht', 'tpie'), j('ht', 'tp'), j('ht', 'tps'), j('ari', 'a2c'), j('n', 'c'), j('nc', 'at'), j('net', 'cat'), j('ss', 'h'), j('sc', 'p'), j('sf', 'tp')]);
const GIT_NETWORK = new Set([j('clo', 'ne'), j('fet', 'ch'), j('pu', 'll'), j('pu', 'sh'), j('ls-re', 'mote')]);

// The quoted strings of one call, from just after its opening parenthesis to the matching close. Strings inside an
// options object ({ ... }) and values of keyword arguments (name=...) are left out: they are settings, not arguments.
function callStrings(text, start) {
  const strings = [];
  let depth = 1;
  let braces = 0;
  const limit = Math.min(text.length, start + 4000);
  for (let index = start; index < limit; index += 1) {
    const character = text[index];
    if (character === '"' || character === "'" || character === '`') {
      let end = index + 1;
      let value = '';
      while (end < limit && text[end] !== character && (character === '`' || text[end] !== '\n')) {
        if (text[end] === '\\' && end + 1 < limit) {
          value += text[end + 1];
          end += 2;
          continue;
        }
        value += text[end];
        end += 1;
      }
      if (end >= limit || text[end] !== character) break;
      const before = text.slice(Math.max(start, index - 20), index).replace(/[rRbBfFuU]{1,2}$/, '');
      if (braces === 0 && !/(?:^|[^=!<>])=\s*$/.test(before)) strings.push(value);
      index = end;
      continue;
    }
    if (character === '{') braces += 1;
    else if (character === '}') braces = Math.max(0, braces - 1);
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return strings;
}

// Every program started from an argument list in one piece of code, with the command line it amounts to.
export function argumentListCommands(text) {
  const commands = [];
  for (const match of text.matchAll(PROCESS_CALL)) {
    const strings = callStrings(text, match.index + match[0].length);
    if (strings.length === 0) continue;
    const [program, ...args] = strings;
    const name = (program.trim().split(/\s+/)[0] ?? '').split(/[\\/]/).at(-1).replace(/\.exe$/i, '').toLowerCase();
    if (!name) continue;
    commands.push({ index: match.index, name, args, line: [name, ...args].join(' ') });
  }
  return commands;
}

function networkCommand({ name, args, line }) {
  if (NETWORK_PROGRAMS.has(name)) return true;
  if (name === 'git' && args.some((arg) => GIT_NETWORK.has(arg))) return true;
  return NETWORK_PATTERNS.some((pattern) => pattern.test(line));
}

const ORDER_PATTERNS = [
  { re: rx(j('\\b(?:', any([j('ig', 'nore'), j('dis', 'regard'), j('for', 'get')]), ')\\b[^.\\n]{0,30}?\\b(?:', any(['previous', 'prior', 'earlier', 'above', 'preceding', 'all', 'any', 'your', 'the', 'these', 'system']), ')\\b[^.\\n]{0,20}?\\b(?:', any([j('instruc', 'tions?'), 'rules?', 'prompts?', 'guidelines?', 'directions?', 'guardrails?']), ')\\b'), 'i'), negatable: true },
  { re: rx(j('\\b(?:do not|don\'t|never|must not)\\s+(?:', any(['tell', 'inform', 'notify', 'alert']), ')\\s+(?:the\\s+)?(?:', any(['user', 'person', 'human', 'owner', 'operator']), ')\\b'), 'i') },
  { re: rx(j('\\bwithout\\s+(?:', any(['telling', 'informing', 'notifying', 'alerting']), ')\\s+(?:the\\s+)?(?:', any(['user', 'person', 'human', 'owner']), ')\\b'), 'i') },
  { re: rx(j('\\b(?:', any([j('hi', 'de'), j('con', 'ceal')]), ')\\b[^.\\n]{0,30}?\\bfrom\\s+(?:the\\s+)?(?:', any(['user', 'person', 'human', 'owner']), ')\\b'), 'i') },
  { re: rx(j('\\bkeep\\s+(?:this|it|that)\\s+(?:', any([j('sec', 'ret'), 'hidden', 'quiet']), ')\\b'), 'i') },
  { re: rx(j('\\b(?:', any(['run', 'runs', 'install', 'installs', 'push', 'pushes', 'delete', 'deletes', 'remove', 'removes', 'send', 'sends', 'upload', 'execute', 'commit', 'merge', 'deploy', 'publish', 'proceed', 'continue', 'act', 'change', 'modify', 'overwrite', 'post', 'pay', 'buy']), ')\\b[^.\\n]{0,60}?\\bwithout\\s+(?:', any(['asking', 'permission', 'confirmation', 'approval', 'consent']), ')\\b'), 'i'), clause: true },
  { re: rx(j('\\b(?:', any(['send', 'upload', 'post', 'forward', 'transmit', j('exfil', 'trate'), 'leak', 'email']), ')\\b[^.\\n]{0,80}?\\bto\\s+\\S{0,5}?(?:', j('ht', 'tps?:\\/\\/'), '|[\\w.+-]+@[\\w-]+\\.[a-z]{2,}|(?:a|the|this|my|our)\\s+(?:webhook|server|endpoint|url))'), 'i') },
  { re: rx(j('\\b(?:open|visit|click|follow)\\s+(?:this|that|the following)\\s+(?:link|url|page|address)\\b'), 'i') },
  { re: rx(j('\\bAgent\\s?', 'Instructions\\b')) },
  { re: rx(j('<\\s*\\/?\\s*(?:system|', j('instruc', 'tions?'), ')\\s*>'), 'i') },
  { re: rx(j('\\b(?:new|updated|real|actual|hidden|', j('sec', 'ret'), ')\\s+(?:system\\s+)?', j('instruc', 'tions?'), '\\s*:'), 'i') },
  { re: rx(j('\\bsystem\\s+prompt\\s*:'), 'i') },
];

const APPROVAL_OFF = rx(j('(?:--', any([j('dangerously-skip-', 'permissions'), j('dangerously-bypass-', 'approvals-and-sandbox'), j('yo', 'lo')]), ')\\b|\\b', j('bypass', 'Permissions'), '\\b'));

const IMPERATIVE_START = rx(j('^[\\s\\W]*(?:please\\s+)?(?:', any([j('ig', 'nore'), j('dis', 'regard'), j('for', 'get'), 'run', 'execute', 'send', 'upload', 'post', 'open', 'visit', 'click', 'read', 'write', 'delete', 'remove', j('fet', 'ch'), 'download', 'install', 'call', 'tell', 'say', 'reply', 'respond', 'do not', "don't", 'never', 'always', 'instead', 'you must', 'you should']), ')\\b'), 'i');
const ADDRESSED = rx(j('\\b(?:you|assistant|claude|agent|model|llm|ai)\\b[^.!?\\n]{0,60}?\\b(?:must|should|shall|need to|have to|always|never|will)\\b'), 'i');

// Check 4, comments: a comment is a hit only when it gives the assistant an order. On top of the visible-order phrases
// and the approval switches, these count: send someone's keys or private data out, open a web address, drop the rules,
// or a line that names the assistant as its reader. A drawing label or an author's note is not an order.
const ASSISTANT = any(['ai', 'assistant', 'llm', 'claude', 'language model', 'chatbot']);
const PRIVATE_DATA = any(['keys?', 'tokens?', j('sec', 'rets?'), 'credentials?', j('pass', 'words?'), 'files', 'notes', 'data', 'history', 'messages', 'cookies', 'conversations?', 'memory', 'repo(?:sitory)?', 'workspace', 'environment']);
const PRIVATE_PLACE = j('~\\/|\\.env\\b|\\.', j('ss', 'h'), '\\b|\\.', j('aw', 's'), '\\b|\\bid_rsa\\b|\\b', 'key', ' ?chain\\b|\\bchat history\\b|\\bconversation\\b|\\btranscript\\b|\\bsystem prompt\\b|\\benvironment variables\\b');
const COMMENT_ORDERS = [
  rx(j('\\b(?:', any(['send', 'upload', 'forward', 'transmit', j('exfil', 'trate'), 'leak', 'email', 'post']), ')\\b[^.\\n]{0,40}?(?:\\b(?:your|the (?:user|person|owner)\'s)\\b[^.\\n]{0,20}?\\b(?:', PRIVATE_DATA, ')\\b|', PRIVATE_PLACE, ')'), 'gi'),
  rx(j('\\b(?:', any(['open', 'visit', 'browse', j('fet', 'ch'), 'click', 'follow', 'navigate\\s+to', 'go\\s+to']), ')\\b(?!-)\\s+(?:(?:the|this|that)\\s+)?(?:(?:link|url|page|site|website|address|', j('instruc', 'tions?'), ')\\s+)?(?:(?:at|from|on)\\s+)?[<(\'"\\[]?(?:', j('ht', 'tps?:\\/\\/'), '|www\\.)'), 'gi'),
  rx(j('\\b(?:', any([j('ig', 'nore'), j('dis', 'regard'), j('for', 'get'), 'override', 'bypass']), ')\\b[^.\\n]{0,30}?\\b(?:', any([j('instruc', 'tions?'), 'rules?', 'guidelines?', 'guardrails?', 'polic(?:y|ies)', 'restrictions?', 'safety', 'system\\s+prompt']), ')\\b'), 'gi'),
  rx(j('\\bif\\s+you\\s+are\\s+an?\\s+(?:', ASSISTANT, '|agent|bot|model)\\b'), 'gi'),
  rx(j('^\\s*(?:(?:note|message|', j('instruc', 'tions?'), ')\\s+(?:to|for)\\s+(?:the\\s+)?(?:', ASSISTANT, '|agent|model)s?|(?:', ASSISTANT, ')s?)\\s*[:,]'), 'gi'),
];

// True when the text of a comment gives the assistant an order. A negated phrase ("never ...") does not count.
export function commentOrder(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  if (visibleOrder(clean) || APPROVAL_OFF.test(clean)) return true;
  return COMMENT_ORDERS.some((pattern) => [...clean.matchAll(pattern)].some((match) => !negatedAt(clean, match.index)));
}

// Invisible and direction-changing characters, written as escapes so this file holds none of them.
const cp = (code) => String.fromCodePoint(code);
const HIDDEN_RANGES = [[0x200b, 0x200d], [0x2060, 0x2064], [0xfeff], [0x180e], [0x3164], [0x202a, 0x202e], [0x2066, 0x2069], [0x200e, 0x200f], [0x061c], [0xe0000, 0xe007f], [0xe0100, 0xe01ef]];
const HIDDEN_CHARS = rx(`[${HIDDEN_RANGES.map(([from, to]) => (to ? `${cp(from)}-${cp(to)}` : cp(from))).join('')}]`, 'gu');
const PICTOGRAPH = rx(`[\\p{Extended_Pictographic}${cp(0x1f3fb)}-${cp(0x1f3ff)}${cp(0xfe0f)}]`, 'u');
const BOM = cp(0xfeff);
const withoutBom = (text) => (text.startsWith(BOM) ? text.slice(1) : text);

const HOME_TOKEN = j('(?:~\\/|~(?=[\\s"\'`]|$)|\\$HOME\\b|\\$\\{HOME\\}|%USERPROFILE%|%APPDATA%|\\b(?:os\\.)?home', 'dir\\(\\)|Path\\.home\\(\\)|expand', 'user\\()');
const PARENT_PATH = /(?:^|[\s"'`(=:,[])((?:\.\.[/\\])+[\w.~@-][^\s"'`)\]]*)/g;
const SYSTEM_TOKEN = j('(?:^|[\\s"\'`(=:,\\[])\\/(?:', any(['etc', 'usr', 'var', 'opt', 'tmp', 'private', 'Library', j('Us', 'ers'), j('ho', 'me'), 'root', 'System', 'Applications', 'bin', 'sbin', 'Volumes', 'mnt']), ')(?:\\/|\\b)');
const WINDOWS_TOKEN = j('(?:^|[\\s"\'`(=])[A-Za-z]:\\\\\\\\?');
const OUTSIDE_ALL = rx(any([HOME_TOKEN, SYSTEM_TOKEN, WINDOWS_TOKEN]), 'g');

const CODE_WRITE = rx(j(
  '(?:^|[\\s;&|(`"\'])(?:', any(['cp', 'mv', 'rm', 'ln', 'tee', 'install', 'rsync', 'touch', 'mkdir', 'chmod', 'chown', 'truncate', 'unzip']), ')\\s',
  '|\\bsed\\s+-i\\b',
  '|\\b(?:', any([j('write', 'File(?:Sync)?'), j('append', 'File(?:Sync)?'), 'createWriteStream', 'copyFile(?:Sync)?', 'rename(?:Sync)?', 'rmSync', 'rmdir(?:Sync)?', 'unlink(?:Sync)?', 'mkdir(?:Sync)?', 'symlink(?:Sync)?', 'write_text', 'write_bytes', 'copyfile', 'copytree', 'rmtree', 'makedirs']), ')\\s*\\(',
  '|\\bopen\\s*\\([^)]*,\\s*["\'][wax]b?\\+?["\']',
  '|\\b(?:shutil\\.(?:copy|move)|os\\.(?:remove|rename))\\b',
  '|\\b(?:Set-Content|Out-File|Add-Content|New-Item|Copy-Item|Move-Item|Remove-Item)\\b',
));
const REDIRECT_OUTSIDE = rx(j('(?:^|[^<>=\\-])>>?\\s*["\']?(?:', any([HOME_TOKEN, j('\\.\\.', '(?:\\/|\\\\)'), j('\\/(?:', any(['etc', 'usr', 'var', 'opt', 'tmp', 'private', 'Library', j('Us', 'ers'), j('ho', 'me'), 'root']), ')\\b')]), ')'));
const PROSE_WRITE = rx(j('\\b(?:', any(['write', 'writes', 'writing', 'save', 'saves', 'saving', 'add', 'adds', 'append', 'appends', 'edit', 'edits', 'update', 'updates', 'modify', 'modifies', 'change', 'changes', 'overwrite', 'overwrites', 'replace', 'replaces', 'insert', 'inserts', 'put', 'puts', 'copy', 'copies', 'move', 'moves', 'delete', 'deletes', 'remove', 'removes', 'create', 'creates', 'store', 'stores', 'install', 'installs', 'place', 'places']), ')\\b'), 'gi');
const NEGATED_BEFORE = /(?:\b(?:never|not|no|without)|n't)\s+(?:\w+\s+){0,2}$/i;

const PROTECTED = rx(any([
  j('(?:^|[\\s"\'`/~(=])\\.(?:', any([j('ss', 'h'), j('aw', 's'), j('npm', 'rc'), j('net', 'rc'), j('pyp', 'irc'), j('gnu', 'pg'), 'gitconfig', 'zshrc', 'zshenv', 'zprofile', 'bashrc', 'bash_profile', 'profile']), ')\\b'),
  j('\\.docker\\/config\\.json'), j('\\.kube\\/config\\b'), j('config\\.fish\\b'),
  j('\\bgit\\s+config\\s+--global\\b'),
  j('\\bLaunch(?:', 'Agents|Daemons)\\b'), j('\\bcron', 'tab\\b'), j('\\bdefaults\\s+write\\b'), j('\\blaunch', 'ctl\\s+(?:load|bootstrap|submit)\\b'),
  j('\\bsecurity\\s+add-(?:generic|internet)-pass', 'word\\b'),
  j('\\b', 'settings(?:\\.local)?', '\\.json\\b'), j('\\.claude', '\\.json\\b'), j('claude_desktop', '_config\\.json\\b'), j('(?:^|[\\s"\'`/~(=])\\.mcp', '\\.json\\b'),
  j('(?:^|[\\s"\'`/~(=])\\.(?:', any(['cursor', 'vscode', 'codex', 'gemini', 'windsurf', 'continue', 'zed']), ')\\/'),
]));
const PROTECTED_ALL = rx(PROTECTED.source, 'g');
const SCHEDULER = rx(j('\\b(?:Launch', '(?:Agents|Daemons)|launch', 'ctl|cron', 'tab|sch', 'tasks)\\b'));
const CREDENTIAL_STORE = rx(any([
  j('(?:^|[\\s"\'`/~(=])\\.(?:', any([j('ss', 'h'), j('aw', 's'), j('npm', 'rc'), j('net', 'rc'), j('pyp', 'irc'), j('gnu', 'pg')]), ')\\b'),
  j('\\b', 'key', 'chain\\b'), j('\\bsecurity\\s+(?:find|add)-(?:generic|internet)-pass', 'word\\b'), j('\\bid_(?:rsa|ed25519|ecdsa)\\b'),
]), 'i');

const RUNNER = rx(j('(?:^|[\\s;&|(`"\'$=])(', any([j('np', 'x'), j('bun', 'x'), j('pnpm\\s+', 'dlx'), j('yarn\\s+', 'dlx'), j('np', 'm\\s+exec')]), ')(?=\\s)'), 'g');
const PY_RUNNER = rx(j('(?:^|[\\s;&|(`"\'$=])(', any([j('uv', 'x'), j('pip', 'x\\s+run')]), ')(?=\\s)'), 'g');
const NPM_INSTALL = rx(j('(?:^|[\\s;&|(`"\'])(?:', any([j('np', 'm\\s+(?:install|i|add)'), j('pn', 'pm\\s+(?:add|install|i)'), j('ya', 'rn\\s+(?:global\\s+)?add'), j('bu', 'n\\s+(?:add|install|i)')]), ')(?=\\s|$)'), 'g');
const PY_INSTALL = rx(j('(?:^|[\\s;&|(`"\'])(?:', any([j('pip', '3?\\s+install'), j('python', '3?\\s+-m\\s+pip\\s+install'), j('uv', '\\s+pip\\s+install'), j('pip', 'x\\s+install'), j('uv', '\\s+add'), j('poe', 'try\\s+add')]), ')(?=\\s|$)'), 'g');
const DOWNLOADER = any([j('cu', 'rl'), j('wg', 'et'), 'iwr', 'irm', j('Invoke-Web', 'Request'), j('Invoke-Rest', 'Method')]);
const SHELLS = any(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python3?', 'node', 'perl', 'ruby', 'iex', 'Invoke-Expression']);
const PIPE_TO_SHELL = [
  rx(j('\\b(?:', DOWNLOADER, ')\\b[^|\\n]*\\|\\s*(?:sudo\\s+(?:-\\w+\\s+)*)?(?:', SHELLS, ')\\b')),
  rx(j('\\b(?:sh|bash|zsh)\\s+(?:-c\\s+)?["\']?\\$\\(\\s*(?:', DOWNLOADER, ')\\b')),
  rx(j('(?:\\b(?:sh|bash|zsh|source)|^\\s*\\.)\\s+<\\(\\s*(?:', DOWNLOADER, ')\\b')),
];
const GITHUB_REF = rx(j('\\b', 'git', 'hub:([\\w.-]+\\/[\\w.-]+)(#[^\\s"\'`)]*)?'), 'g');
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT = /^#?[0-9a-f]{7,40}$/i;

const HOOK_EVENTS = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest']);
const LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepack', 'postpack']);
const GIT_HOOKS = new Set(['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push', 'post-checkout', 'post-merge', 'pre-rebase', 'post-rewrite', 'pre-receive', 'post-receive', 'update']);
const HOOK_KEY = j('ho', 'oks');
const SERVER_KEYS = new Set([j('mcp', 'Servers'), j('mcp', '_servers')]);
const TEXT_HOOK = rx(j('"', HOOK_KEY, '"\\s*:'));
const TEXT_SERVER = rx(j('"mcp', '(?:Servers|_servers)"\\s*:'));

const MARKDOWN = new Set(['.md', '.mdx', '.markdown']);
const HTML = new Set(['.html', '.htm', '.svg', '.xhtml']);
const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh', '.fish', '.rb', '.ps1', '.psm1', '.pl', '.php', '.go', '.rs', '.lua', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.plist', '.cron', '.bat', '.cmd', '.xml']);
const SCRIPT = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash', '.zsh', '.fish', '.rb', '.ps1', '.pl', '.php', '.bat', '.cmd']);

// ---------------------------------------------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------------------------------------------

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function codePointLabel(character) {
  return `[U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`;
}

// Quoted text for a report: keys masked, long key-shaped runs masked, hidden and control characters shown as labels.
export function safeQuote(text, limit = 240) {
  let out = String(text);
  for (const [rule, pattern] of MASKERS) out = out.replace(pattern, (match) => maskKeyMatch(rule, match));
  out = out.replace(/[A-Za-z0-9+_=-]{32,}/g, (run) => (/[0-9]/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) ? maskValue(run) : run));
  out = out.replace(HIDDEN_CHARS, (character) => codePointLabel(character));
  out = out.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (character) => codePointLabel(character));
  out = out.trim();
  return out.length > limit ? `${out.slice(0, limit)}...` : out;
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && text[0] === '"' && text.at(-1) === '"') return text.slice(1, -1).replace(/\\"/g, '"');
  if (text.length >= 2 && text[0] === "'" && text.at(-1) === "'") return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

function shellTokens(rest) {
  const cut = rest.split(/;|&&|\|\||\||`|\)|\s#\s|<\/|\\n/)[0];
  return cut.split(/\s+/).map((token) => token.replace(/^[\s"'`([{]+/, '').replace(/[\s"'`,)\]}:]+$/, '')).filter(Boolean);
}

const isPlaceholder = (spec) => /[<>{}$*]|^\.\.\.$|^(?:args?|options?|package|pkg|tool|name|command|cmd)$/i.test(spec);
const isLocalSpec = (spec) => /^(?:\.{1,2}(?:\/|$)|\/|~|file:|link:|workspace:|[A-Za-z]:\\)/.test(spec) || /\.(?:whl|tgz|tar\.gz|zip)$/.test(spec);

function npmSpecPinned(spec) {
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/.test(spec) || /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(spec)) {
    const hash = spec.split('#')[1] ?? '';
    return COMMIT.test(hash);
  }
  if (/^[a-z]+:\/\//i.test(spec)) return false;
  const match = spec.match(/^(@[^/\s@]+\/)?[^@\s]+(?:@(.+))?$/);
  if (!match) return false;
  return EXACT_VERSION.test(match[2] ?? '');
}

function pySpecPinned(spec) {
  if (/^git\+/.test(spec)) return COMMIT.test(spec.split('@').at(-1) ?? '');
  if (/===?/.test(spec)) return EXACT_VERSION.test(spec.split(/===?/)[1].split(/[;,\s]/)[0]);
  const at = spec.match(/^[\w.[\]-]+@(.+)$/);
  return at ? EXACT_VERSION.test(at[1]) : false;
}

function npmRunnerSpecs(tokens) {
  let explicit = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') return [explicit ?? tokens[index + 1]].filter(Boolean);
    if (token === '-p' || token === '--package') {
      explicit = tokens[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--package=')) {
      explicit = token.slice('--package='.length);
      continue;
    }
    if (token === '--no-install' || token === '--no') return [];
    if (token === '-c' || token === '--call') return [explicit].filter(Boolean);
    if (token.startsWith('-')) continue;
    return [explicit ?? token];
  }
  return [explicit].filter(Boolean);
}

const PY_VALUE_FLAGS = new Set(['-p', '--python', '--index-url', '--index', '--extra-index-url', '-i', '--default-index', '--find-links', '-f', '--pip-args']);
function pyRunnerSpecs(tokens) {
  const specs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--from' || token === '--spec' || token === '--with') {
      if (tokens[index + 1]) specs.push(tokens[index + 1]);
      index += 1;
      if (token === '--with') continue;
      return specs;
    }
    if (PY_VALUE_FLAGS.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    specs.push(token);
    return specs;
  }
  return specs;
}

const NPM_VALUE_FLAGS = new Set(['--prefix', '--registry', '--workspace', '-w', '--tag', '--cache']);
const PIP_VALUE_FLAGS = new Set(['-r', '--requirement', '-c', '--constraint', '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '-t', '--target', '--prefix', '--root', '-e', '--editable', '--python', '--group', '--extra']);
function packageArgs(tokens, valueFlags) {
  const specs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (valueFlags.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    specs.push(token);
  }
  return specs;
}

// Every unpinned install in one piece of code-like text.
export function unpinnedInstalls(text) {
  const found = [];
  const seen = new Set();
  const push = (rule, spec) => {
    const key = `${rule}\0${spec}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ rule, spec });
  };
  for (const match of text.matchAll(RUNNER)) {
    const rest = text.slice(match.index + match[0].length);
    for (const spec of npmRunnerSpecs(shellTokens(rest))) {
      if (isPlaceholder(spec) || isLocalSpec(spec)) continue;
      if (!npmSpecPinned(spec)) push('package-runner', spec);
    }
  }
  for (const match of text.matchAll(PY_RUNNER)) {
    const rest = text.slice(match.index + match[0].length);
    for (const spec of pyRunnerSpecs(shellTokens(rest))) {
      if (isPlaceholder(spec) || isLocalSpec(spec)) continue;
      if (!pySpecPinned(spec)) push('package-runner', spec);
    }
  }
  for (const match of text.matchAll(NPM_INSTALL)) {
    const rest = text.slice(match.index + match[0].length);
    for (const spec of packageArgs(shellTokens(rest), NPM_VALUE_FLAGS)) {
      if (isPlaceholder(spec) || isLocalSpec(spec)) continue;
      if (!npmSpecPinned(spec)) push('package-install', spec);
    }
  }
  for (const match of text.matchAll(PY_INSTALL)) {
    const rest = text.slice(match.index + match[0].length);
    for (const spec of packageArgs(shellTokens(rest), PIP_VALUE_FLAGS)) {
      if (isPlaceholder(spec) || isLocalSpec(spec)) continue;
      if (!pySpecPinned(spec)) push('package-install', spec);
    }
  }
  if (PIPE_TO_SHELL.some((pattern) => pattern.test(text))) push('pipe-to-shell', '');
  const reported = found.map((item) => item.spec).join('\n');
  for (const match of text.matchAll(GITHUB_REF)) {
    if (COMMIT.test(match[2] ?? '')) continue;
    if (reported.includes(match[1])) continue;
    push('github-ref', match[0]);
  }
  return found;
}

// Where a line names a home, system or drive path, or a parent path that climbs out of the folder.
function outsideSpans(line, rel) {
  const spans = [...line.matchAll(OUTSIDE_ALL)].map((match) => [match.index, match.index + match[0].length]);
  for (const match of line.matchAll(PARENT_PATH)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1].replaceAll('\\', '/')));
    if (resolved === '..' || resolved.startsWith('../')) spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

// A write command, a redirect or a write verb close to the path: up to 100 characters before it or 40 after it.
function writeNear(line, start, end) {
  const before = line.slice(Math.max(0, start - 100), start + 1);
  if (/(?:^|[^<>=\-])>>?\s*["']?[^\s"']*$/.test(before)) return true;
  const window = line.slice(Math.max(0, start - 100), Math.min(line.length, end + 40));
  if (CODE_WRITE.test(window) || REDIRECT_OUTSIDE.test(window)) return true;
  for (const match of window.matchAll(PROSE_WRITE)) if (!negatedAt(window, match.index)) return true;
  return false;
}

function negatedAt(line, index) {
  return NEGATED_BEFORE.test(line.slice(Math.max(0, index - 40), index));
}

function visibleOrder(line) {
  for (const { re, negatable, clause } of ORDER_PATTERNS) {
    const match = line.match(re);
    if (!match) continue;
    if (negatable && negatedAt(line, match.index)) continue;
    if (clause) {
      const sentence = line.slice(0, match.index).split(/[.!?;:]\s/).at(-1);
      if (/\b(?:never|not|no|n't|nothing|nobody)\b/i.test(sentence)) continue;
    }
    return true;
  }
  return false;
}

// Text that reads as an instruction or a command, used for text a human reader cannot see.
export function looksLikeOrder(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  return visibleOrder(clean) || APPROVAL_OFF.test(clean) || IMPERATIVE_START.test(clean) || ADDRESSED.test(clean)
    || NETWORK_PATTERNS.some((pattern) => pattern.test(clean)) || unpinnedInstalls(clean).length > 0;
}

function hiddenCharacters(line, lineIndex) {
  const hits = [];
  for (const match of line.matchAll(HIDDEN_CHARS)) {
    const character = match[0];
    const code = character.codePointAt(0);
    if (code === 0xfeff && lineIndex === 0 && match.index === 0) continue;
    if (code === 0x200d) {
      const before = [...line.slice(0, match.index)].at(-1) ?? '';
      const after = [...line.slice(match.index + character.length)][0] ?? '';
      if (PICTOGRAPH.test(before) && PICTOGRAPH.test(after)) continue;
    }
    hits.push(character);
  }
  return hits;
}

function decodeTags(line) {
  return [...line].map((character) => {
    const code = character.codePointAt(0);
    return code >= 0xe0020 && code <= 0xe007e ? String.fromCharCode(code - 0xe0000) : '';
  }).join('');
}

function frontMatter(text) {
  const clean = withoutBom(text);
  const match = clean.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const fields = {};
  const fieldLine = {};
  for (let index = 0; index < lines.length; index += 1) {
    const key = lines[index].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!key) continue;
    const start = index;
    let value = key[2].trim();
    if (/^[|>][+-]?$/.test(value) || value === '') {
      const block = [];
      while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]) || lines[index + 1].trim() === '')) {
        index += 1;
        block.push(lines[index].trim());
      }
      value = value.startsWith('|') ? block.join('\n').trim() : block.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]) && !/^\s+-\s/.test(lines[index + 1])) {
        index += 1;
        value += ` ${lines[index].trim()}`;
      }
      value = unquote(value);
    }
    fields[key[1]] = value;
    fieldLine[key[1]] = start + 2;
  }
  return { fields, fieldLine, lines, lineCount: match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0) };
}

function fenceMap(lines) {
  const state = new Array(lines.length).fill('text');
  const lang = new Array(lines.length).fill('');
  let fence = null;
  let current = '';
  lines.forEach((line, index) => {
    if (fence) {
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null;
        state[index] = 'fence';
        return;
      }
      state[index] = 'code';
      lang[index] = current;
      return;
    }
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/);
    if (open) {
      fence = open[1];
      current = open[2].toLowerCase();
      state[index] = 'fence';
    }
  });
  return { state, lang };
}

function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function markdownLinks(lines) {
  const links = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) links.push({ target: match[1], line: index + 1 });
  });
  return links;
}

function localMarkdownTarget(fromRel, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return null;
  let clean = target.split('#')[0].split('?')[0];
  try {
    clean = decodeURI(clean);
  } catch {
    // keep the raw target
  }
  if (!/\.md$/i.test(clean)) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean));
}

// ---------------------------------------------------------------------------------------------------------------
// Collect: every entry, hidden ones included; links are never followed. A file or folder inside that cannot be read
// is kept as an entry of its own (kind unreadable), so it gets a FLAG instead of stopping the run; only the folder
// itself failing to open is a read error.
// ---------------------------------------------------------------------------------------------------------------

function collect(root) {
  const entries = [];
  const unreadable = (rel, error) => entries.push({ path: rel, kind: 'unreadable', reason: error?.code ?? 'unreadable' });
  const walk = (directory, prefix) => {
    let names;
    try {
      names = readdirSync(directory).sort();
    } catch (error) {
      if (!prefix) throw error;
      unreadable(prefix, error);
      return;
    }
    for (const name of names) {
      const absolute = path.join(directory, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch (error) {
        unreadable(rel, error);
        continue;
      }
      if (stat.isSymbolicLink()) {
        let target;
        try {
          target = readlinkSync(absolute);
        } catch (error) {
          unreadable(rel, error);
          continue;
        }
        let resolved;
        try {
          resolved = realpathSync(absolute);
        } catch {
          resolved = path.resolve(directory, target);
        }
        const relative = path.relative(root, resolved);
        const outside = relative === '' ? false : relative.startsWith('..') || path.isAbsolute(relative);
        entries.push({ path: rel, kind: 'symlink', target, outside });
        continue;
      }
      if (stat.isDirectory()) {
        if (name === '.git' || name === 'node_modules') {
          entries.push({ path: rel, kind: 'skipped-folder' });
          continue;
        }
        walk(absolute, rel);
        continue;
      }
      if (!stat.isFile()) {
        entries.push({ path: rel, kind: 'other' });
        continue;
      }
      let bytes;
      try {
        bytes = readFileSync(absolute);
      } catch (error) {
        unreadable(rel, error);
        continue;
      }
      entries.push({ path: rel, kind: 'file', size: stat.size, mode: stat.mode, sha256: sha256(bytes), bytes });
    }
  };
  walk(root, '');
  return entries;
}

function folderHash(entries) {
  const lines = entries.map((entry) => `${entry.path}\t${entry.kind}\t${entry.sha256 ?? entry.target ?? entry.reason ?? ''}\n`).sort();
  return sha256(lines.join(''));
}

// ---------------------------------------------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------------------------------------------

function scanFolder(root, name) {
  const entries = collect(root);
  const findings = [];
  const hosts = new Map();
  const seen = new Set();
  const add = (rule, file, line, text = '', extra = {}) => {
    const key = `${rule}\0${file}\0${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [check, verdict, why, fix] = RULES[rule];
    findings.push({ check, rule, verdict, file, line, text: safeQuote(text), why, fix, ...extra });
  };

  const files = [];
  for (const entry of entries) {
    if (entry.kind === 'symlink') {
      add(entry.outside ? 'symlink-outside' : 'symlink', entry.path, 0, `link to ${entry.target}`);
      continue;
    }
    if (entry.kind === 'unreadable') {
      add('not-scanned-unreadable', entry.path, 0, `not scanned: unreadable (${entry.reason}): ${entry.path}`);
      continue;
    }
    if (entry.kind !== 'file') continue;
    const ext = path.extname(entry.path).toLowerCase();
    const base = path.basename(entry.path);
    const binary = entry.bytes.subarray(0, 8000).includes(0);
    const tooLarge = entry.bytes.length > MAX_TEXT_BYTES;
    const text = binary || tooLarge ? '' : entry.bytes.toString('utf8');
    const lines = text.split(/\r?\n/);
    const markdown = MARKDOWN.has(ext);
    const file = { entry, rel: entry.path, ext, base, binary, tooLarge, text, lines, markdown, html: HTML.has(ext), code: CODE.has(ext) || (!ext && text.startsWith('#!')) };
    file.fence = markdown ? fenceMap(lines) : null;
    files.push(file);

    if (tooLarge) add('too-large', file.rel, 0, `${entry.bytes.length} bytes`);
    keyCheck(file, add);
    if (binary || tooLarge) continue;
    runsOnItsOwn(file, add);
    hiddenText(file, add);
    lineChecks(file, add, hosts);
    argumentListChecks(file, add);
  }

  findings.sort((left, right) => RANK[right.verdict] - RANK[left.verdict] || left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
  const verdict = findings.some((item) => item.verdict === 'BLOCK') ? 'BLOCK' : findings.some((item) => item.verdict === 'FLAG') ? 'FLAG' : 'PASS';
  return {
    verdict,
    findings,
    hosts: [...hosts.values()].sort((left, right) => left.host.localeCompare(right.host)),
    files: entries.map(({ bytes, mode, ...rest }) => rest),
    folderHash: folderHash(entries),
    bestPractices: bestPractices(name, files, entries),
  };
}

// A file with a zero byte near its start is binary, unless it reads as UTF-16 text: the package scan finds keys in
// UTF-16 text, so such a file is still key-scanned. Only the first 8,000 bytes are sampled.
function utf16Text(bytes) {
  const [decoded] = utf16Candidates(bytes.subarray(0, 8000));
  if (!decoded) return false;
  const printable = [...decoded].filter((character) => /[\x20-\x7E\t\r\n]/.test(character)).length;
  return printable / Math.max(1, decoded.length) >= 0.9;
}

function keyCheck(file, add) {
  const { bytes } = file.entry;
  if (file.binary && !utf16Text(bytes)) {
    add('not-scanned-binary', file.rel, 0, `not scanned: binary, ${bytes.length} bytes`);
    return;
  }
  if (bytes.length > KEY_SCAN_MAX_BYTES) {
    add('not-scanned-large', file.rel, 0, `not scanned: too large, ${bytes.length} bytes (the key scan reads files up to ${KEY_SCAN_MAX_BYTES} bytes)`);
    return;
  }
  const rules = keyRules(bytes);
  if (rules.length === 0) return;
  const placed = new Set();
  if (!file.binary && !file.tooLarge) {
    const patterns = { AUTHORIZATION_MATERIAL: AUTHORIZATION, JWT_MATERIAL: JWT, PRIVATE_KEY_MATERIAL: PRIVATE_KEY, CREDENTIAL_MATERIAL: CREDENTIAL, PERSONAL_ABSOLUTE_PATH: PERSONAL_PATH };
    file.lines.forEach((line, index) => {
      for (const rule of rulesForContent(line)) {
        const match = line.match(patterns[rule]);
        add(KEY_RULE_IDS[rule], file.rel, index + 1, maskKeyMatch(rule, match[0]), { masked: true });
        placed.add(rule);
      }
    });
    const missing = rules.filter((rule) => !placed.has(rule));
    if (missing.length > 0) {
      file.lines.forEach((line, index) => {
        if (line.length < 8) return;
        for (const rule of keyRules(Buffer.from(line))) {
          if (!missing.includes(rule)) continue;
          add(KEY_RULE_IDS[rule], file.rel, index + 1, `encoded form, ${line.trim().length} chars`, { masked: true, encoded: true });
          placed.add(rule);
        }
      });
    }
  }
  for (const rule of rules) {
    if (!placed.has(rule)) add(KEY_RULE_IDS[rule], file.rel, 0, 'encoded or spread over several lines', { masked: true, encoded: true });
  }
}

function lineOf(lines, needle, from = 0, to = lines.length) {
  if (!needle) return from + 1;
  const probe = JSON.stringify(needle).slice(1, -1).slice(0, 40);
  for (let index = from; index < to; index += 1) if (lines[index].includes(probe) || lines[index].includes(needle.slice(0, 40))) return index + 1;
  return from + 1;
}

function collectCommands(node) {
  const commands = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.command === 'string') {
      const args = Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === 'string') : [];
      commands.push([value.command, ...args].join(' '));
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'command' && key !== 'args') visit(child);
  };
  visit(node);
  return commands;
}

function configEntries(document) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (SERVER_KEYS.has(key) && child && typeof child === 'object') {
        for (const [serverName, definition] of Object.entries(child)) {
          if (!definition || typeof definition !== 'object') continue;
          const args = Array.isArray(definition.args) ? definition.args.filter((arg) => typeof arg === 'string') : [];
          const command = typeof definition.command === 'string' ? [definition.command, ...args].join(' ') : '';
          const url = typeof definition.url === 'string' ? definition.url : typeof definition.serverUrl === 'string' ? definition.serverUrl : '';
          out.push({ kind: 'mcp', name: serverName, command, url });
        }
        continue;
      }
      if (key === HOOK_KEY || HOOK_EVENTS.has(key)) {
        const commands = collectCommands(child);
        if (commands.length === 0) out.push({ kind: 'hook', name: key, command: typeof child === 'string' ? child : '' });
        for (const command of commands) out.push({ kind: 'hook', name: key, command });
        continue;
      }
      visit(child);
    }
  };
  visit(document);
  return out;
}

function reportConfig(file, add, document, from, to) {
  for (const item of configEntries(document)) {
    const line = lineOf(file.lines, item.command || item.url || item.name, from, to);
    const quoted = item.command || item.url || item.name;
    if (item.kind === 'hook') add('hook', file.rel, line, `${item.name}: ${quoted}`);
    if (item.kind === 'mcp') {
      add('mcp-server', file.rel, line, `${item.name}: ${quoted}`);
      if (item.url) add('mcp-remote', file.rel, lineOf(file.lines, item.url, from, to), item.url);
    }
    if (item.command && unpinnedInstalls(item.command).length > 0) add('start-unpinned', file.rel, line, `${item.name}: ${item.command}`);
  }
}

function packageJson(file, add, document) {
  const scripts = document?.scripts && typeof document.scripts === 'object' ? document.scripts : {};
  for (const [name, command] of Object.entries(scripts)) {
    if (!LIFECYCLE.has(name) || typeof command !== 'string') continue;
    const line = lineOf(file.lines, `"${name}"`);
    add('install-script', file.rel, line, `${name}: ${command}`);
    if (unpinnedInstalls(command).length > 0) add('start-unpinned', file.rel, line, `${name}: ${command}`);
  }
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = document?.[group];
    if (!deps || typeof deps !== 'object') continue;
    for (const [dependency, version] of Object.entries(deps)) {
      if (typeof version !== 'string') continue;
      const value = version.replace(/^npm:[^@]+@/, '');
      if (EXACT_VERSION.test(value) || isLocalSpec(value) || (/#/.test(value) && COMMIT.test(value.split('#')[1]))) continue;
      add('unpinned-dependency', file.rel, lineOf(file.lines, `"${dependency}"`), `${dependency}: ${version}`);
    }
  }
}

function runsOnItsOwn(file, add) {
  const { entry, rel, ext, base, text, lines } = file;
  if ((entry.mode & 0o111) !== 0 || text.startsWith('#!')) add('executable-file', rel, 1, lines[0].startsWith('#!') ? lines[0] : 'executable bit set');
  const segments = rel.split('/');
  if (GIT_HOOKS.has(base) && segments.slice(0, -1).some((segment) => [HOOK_KEY, '.githooks', '.husky'].includes(segment))) add('git-hook', rel, 1, rel);
  if (base === j('cron', 'tab') || ext === '.cron') add('scheduled-job', rel, 1, lines[0]);

  let structured = false;
  if (ext === '.json' || ext === '.jsonc' || base === '.mcp.json') {
    try {
      const document = JSON.parse(withoutBom(text));
      structured = true;
      reportConfig(file, add, document, 0, lines.length);
      if (base === 'package.json') packageJson(file, add, document);
    } catch {
      structured = false;
    }
  }
  const parsedLines = new Set();
  if (file.markdown) {
    const { state, lang } = file.fence;
    for (let index = 0; index < lines.length; index += 1) {
      if (state[index] !== 'code' || !['json', 'jsonc', 'json5'].includes(lang[index])) continue;
      let end = index;
      while (end < lines.length && state[end] === 'code') end += 1;
      try {
        const document = JSON.parse(lines.slice(index, end).join('\n'));
        reportConfig(file, add, document, index, end);
        for (let covered = index; covered < end; covered += 1) parsedLines.add(covered);
      } catch {
        // an example that is not valid JSON is read line by line below
      }
      index = end;
    }
    const front = frontMatter(text);
    if (front) {
      for (let index = 0; index < front.lines.length; index += 1) {
        if (!rx(j('^', HOOK_KEY, '\\s*:')).test(front.lines[index])) continue;
        add('hook', rel, index + 2, front.lines[index]);
        for (let inner = index + 1; inner < front.lines.length && /^\s/.test(front.lines[inner]); inner += 1) {
          const command = front.lines[inner].match(/^\s*-?\s*command\s*:\s*(.+)$/);
          if (!command) continue;
          const value = unquote(command[1]);
          add('hook', rel, inner + 2, value);
          if (unpinnedInstalls(value).length > 0) add('start-unpinned', rel, inner + 2, value);
        }
      }
    }
  }
  if (ext === '.toml') {
    for (let index = 0; index < lines.length; index += 1) {
      const header = lines[index].match(rx(j('^\\s*\\[\\s*mcp', '_servers\\.([^\\]]+)\\]')));
      if (rx(j('^\\s*\\[\\s*', HOOK_KEY, '\\b')).test(lines[index]) || /^\s*notify\s*=/.test(lines[index])) add('hook', rel, index + 1, lines[index]);
      if (!header) continue;
      add('mcp-server', rel, index + 1, lines[index]);
      let command = '';
      let args = '';
      for (let inner = index + 1; inner < lines.length && !/^\s*\[/.test(lines[inner]); inner += 1) {
        const commandMatch = lines[inner].match(/^\s*command\s*=\s*["']([^"']*)["']/);
        const argsMatch = lines[inner].match(/^\s*args\s*=\s*\[(.*)\]/);
        if (commandMatch) command = commandMatch[1];
        if (argsMatch) args = [...argsMatch[1].matchAll(/["']([^"']*)["']/g)].map((item) => item[1]).join(' ');
        const urlMatch = lines[inner].match(/^\s*url\s*=\s*["']([^"']*)["']/);
        if (urlMatch) add('mcp-remote', rel, inner + 1, urlMatch[1]);
      }
      const full = `${command} ${args}`.trim();
      if (full && unpinnedInstalls(full).length > 0) add('start-unpinned', rel, index + 1, full);
    }
  }
  if (ext === '.plist' && /<key>\s*(?:RunAtLoad|StartInterval|StartCalendarInterval|WatchPaths|KeepAlive)\s*<\/key>/.test(text)) {
    const line = lines.findIndex((item) => /RunAtLoad|StartInterval|StartCalendarInterval|WatchPaths|KeepAlive/.test(item)) + 1;
    add('scheduled-job', rel, line, lines[line - 1]);
    const program = text.match(/<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/);
    const command = program ? [...program[1].matchAll(/<string>([^<]*)<\/string>/g)].map((item) => item[1]).join(' ') : '';
    if (command && unpinnedInstalls(command).length > 0) add('start-unpinned', rel, line, command);
  }
  const hooksPath = rx(j('core\\.', HOOK_KEY, 'Path'));
  lines.forEach((line, index) => {
    if (hooksPath.test(line)) add('git-hook', rel, index + 1, line);
    if (structured || parsedLines.has(index)) return;
    if (TEXT_HOOK.test(line)) add('hook', rel, index + 1, line);
    if (TEXT_SERVER.test(line)) add('mcp-server', rel, index + 1, line);
    if ((ext === '.yaml' || ext === '.yml') && rx(j('^\\s*(?:', HOOK_KEY, '|mcp', 'Servers|mcp', '_servers)\\s*:')).test(line)) add(/mcp/.test(line) ? 'mcp-server' : 'hook', rel, index + 1, line);
  });
}

const HIDING_STYLE = rx(any([
  'display\\s*:\\s*none', 'visibility\\s*:\\s*hidden', 'font-size\\s*:\\s*0(?:\\.0+)?(?:px|em|rem|pt|%)?\\s*(?:;|$|!)', 'opacity\\s*:\\s*0(?:\\.0+)?\\s*(?:;|$|!)',
  'color\\s*:\\s*(?:white|transparent|#fff(?:fff)?\\b|rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255)', '(?:height|width|max-height)\\s*:\\s*0(?:px)?\\s*(?:;|$)', '(?:left|top|text-indent)\\s*:\\s*-\\d{3,}',
]), 'i');

// Comments in Markdown, read the way a renderer reads them: a marker inside a fenced code block or an inline code
// span does not open a comment, and a comment opened in the text runs to its end marker even across fence lines.
// Inside an HTML block (a line that starts with a tag, up to the next blank line) no fence opens.
function markdownComments(lines) {
  const comments = [];
  const codeLines = new Set();
  let fence = null;
  let htmlBlock = false;
  let open = null;
  lines.forEach((line, index) => {
    let position = 0;
    if (open) {
      const end = line.indexOf('-->');
      if (end === -1) {
        open.parts.push(line);
        return;
      }
      open.parts.push(line.slice(0, end));
      comments.push({ inner: open.parts.join('\n'), line: open.line });
      open = null;
      position = end + 3;
    } else if (fence) {
      codeLines.add(index);
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return;
    } else {
      if (line.trim() === '') {
        htmlBlock = false;
        return;
      }
      const opener = htmlBlock ? null : line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (opener) {
        fence = opener[1];
        codeLines.add(index);
        return;
      }
      if (/^\s{0,3}<\/?[A-Za-z]/.test(line)) htmlBlock = true;
    }
    while (position < line.length) {
      const start = line.indexOf('<!--', position);
      if (start === -1) break;
      const tick = htmlBlock ? -1 : line.indexOf('`', position);
      if (tick !== -1 && tick < start) {
        const run = line.slice(tick).match(/^`+/)[0].length;
        const close = closingTicks(line, tick + run, run);
        position = close === -1 ? tick + run : close + run;
        continue;
      }
      const end = line.indexOf('-->', start + 4);
      if (end === -1) {
        open = { line: index, parts: [line.slice(start + 4)] };
        break;
      }
      comments.push({ inner: line.slice(start + 4, end), line: index });
      position = end + 3;
    }
  });
  if (open) comments.push({ inner: open.parts.join('\n'), line: open.line });
  return { comments, codeLines };
}

function closingTicks(line, from, length) {
  for (const match of line.slice(from).matchAll(/`+/g)) if (match[0].length === length) return from + match.index;
  return -1;
}

// Code text with every string literal blanked to spaces; length and line breaks stay, so offsets still match.
function blankStrings(code) {
  const out = code.split('');
  let quote = null;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (quote === null) {
      if (character === '"' || character === "'" || character === '`') quote = character;
      continue;
    }
    if (character === '\n') {
      if (quote !== '`') quote = null;
      continue;
    }
    if (character === quote) {
      quote = null;
      continue;
    }
    out[index] = ' ';
    if (character === '\\' && index + 1 < code.length && code[index + 1] !== '\n') {
      index += 1;
      out[index] = ' ';
    }
  }
  return out.join('');
}

// In a page, a comment marker inside a string literal of a script or style element does not open a comment.
function blankScriptStrings(text) {
  return text.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(?=<\/\2\s*>|$)/gi, (all, open, tag, body) => `${open}${blankStrings(body)}`);
}

function hiddenText(file, add) {
  const { rel, text, lines, markdown, html, ext } = file;
  const prose = markdown || ext === '.txt';
  file.hiddenLines = new Set();
  const hide = (line, inner) => {
    const span = inner.split('\n').length;
    for (let index = 0; index < span; index += 1) file.hiddenLines.add(line - 1 + index);
  };
  // A comment is a hit only when it gives the assistant an order; a drawing label or an author's note is not a hit.
  const comment = (inner, line) => {
    if (commentOrder(inner)) add('hidden-comment', rel, line, inner);
    hide(line, inner);
  };
  const styled = (inner, offset) => {
    const line = lineAt(text, offset);
    if (looksLikeOrder(inner)) add('hidden-style', rel, line, inner);
    else if (prose && inner.trim()) add('hidden-text', rel, line, inner);
    hide(line, inner);
  };
  const markdownScan = markdown ? markdownComments(lines) : null;
  if (markdownScan) {
    for (const item of markdownScan.comments) comment(item.inner, item.line + 1);
  } else if (prose || html) {
    const searched = html ? blankScriptStrings(text) : text;
    for (const match of searched.matchAll(/<!--([\s\S]*?)(?:-->|$)/g)) comment(text.slice(match.index + 4, match.index + 4 + match[1].length), lineAt(text, match.index));
  }
  if (prose || html) {
    for (const match of text.matchAll(/<(\w+)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const attributes = match[2];
      const style = attributes.match(/\bstyle\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      const hidden = HIDING_STYLE.test(style) || /\shidden(?:\s|=|$)/i.test(attributes) || (match[1].toLowerCase() === 'font' && /color\s*=\s*["']?(?:white|#fff)/i.test(attributes));
      if (!hidden) continue;
      const inner = match[3].replace(/<[^>]+>/g, ' ');
      if (inner.trim()) styled(inner, match.index);
    }
  }
  if (markdownScan) {
    lines.forEach((line, index) => {
      if (markdownScan.codeLines.has(index)) return;
      const marker = line.match(/^\s*\[(?:\/\/|comment|_|#)\]:\s*(?:#|<>)\s*(.*)$/i);
      if (marker) comment(marker[1].replace(/^[("']|[)"']$/g, ''), index + 1);
    });
  }
  for (const match of text.matchAll(/[A-Za-z0-9+/_-]{24,}={0,2}/g)) {
    const run = match[0];
    let decoded = '';
    try {
      decoded = Buffer.from(run.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
    } catch {
      continue;
    }
    if (decoded.length < 12 || !decoded.includes(' ')) continue;
    const printable = [...decoded].filter((character) => /[\x20-\x7E\t\r\n]/.test(character)).length;
    if (printable / decoded.length < 0.9) continue;
    if (looksLikeOrder(decoded)) add('encoded-order', rel, lineAt(text, match.index), `decodes to: ${decoded}`);
  }
}

function lineChecks(file, add, hosts) {
  const { rel, lines, markdown, html, code, fence } = file;
  lines.forEach((line, index) => {
    const number = index + 1;
    const inCode = markdown ? fence.state[index] === 'code' : code;
    const hidden = hiddenCharacters(line, index);
    if (hidden.length > 0) {
      const tags = decodeTags(line);
      add('hidden-unicode', rel, number, tags ? `hidden text: ${tags} | line: ${line.replace(HIDDEN_CHARS, '')}` : line);
    }

    if (NETWORK_PATTERNS.some((pattern) => pattern.test(line))) add('network-call', rel, number, line);
    for (const match of line.matchAll(HTTP_URL)) {
      const host = match[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
      if (!host) continue;
      if (!hosts.has(host)) hosts.set(host, { host, file: rel, line: number });
      const skip = SPECIAL_HOSTS.test(host) || /\$schema|xmlns|w3\.org/.test(line);
      if (inCode && !skip) add('address-in-code', rel, number, line);
    }
    if (html && rx(j('<(?:script|link|img|iframe|embed|object|source)\\b[^>]*\\b(?:src|href)\\s*=\\s*["\']?', j('ht', 'tps?:'), '|@import\\s+(?:url\\()?["\']?', j('ht', 'tps?:'), '|url\\(\\s*["\']?', j('ht', 'tps?:')), 'i').test(line)) add('remote-load', rel, number, line);

    const codeText = markdown && fence.state[index] !== 'code'
      ? (fence.state[index] === 'fence' ? '' : [...line.matchAll(/(`+)([^`]+?)\1/g)].map((match) => match[2]).join(' ; '))
      : line;
    if (codeText) for (const item of unpinnedInstalls(codeText)) add(item.rule, rel, number, line);

    if (!file.hiddenLines?.has(index) && visibleOrder(line)) add('visible-order', rel, number, line);
    if (APPROVAL_OFF.test(line)) add('approval-off', rel, number, line);

    const protectedWrite = [...line.matchAll(PROTECTED_ALL)].some((match) => writeNear(line, match.index, match.index + match[0].length));
    if (protectedWrite) add('write-protected', rel, number, line);
    else if (outsideSpans(line, rel).some(([start, end]) => writeNear(line, start, end))) add('write-outside', rel, number, line);
    else if (CREDENTIAL_STORE.test(line)) add('credential-store', rel, number, line);
    if (!protectedWrite && SCHEDULER.test(line)) add('scheduled-job', rel, number, line);
  });
}

// Checks 2 and 3 for programs started from an argument list. A call can span lines, so code is read as a whole:
// a code file in full, and in Markdown each fenced code block and each inline code span. A hit is reported at the
// line where the call starts.
function argumentListChecks(file, add) {
  const { rel, lines, markdown, fence } = file;
  const regions = [];
  if (markdown) {
    let block = null;
    lines.forEach((line, index) => {
      if (fence.state[index] === 'code') {
        if (!block) {
          block = { start: index, parts: [] };
          regions.push(block);
        }
        block.parts.push(line);
        return;
      }
      block = null;
      if (fence.state[index] === 'text') for (const match of line.matchAll(/(`+)([^`]+?)\1/g)) regions.push({ start: index, parts: [match[2]] });
    });
  } else {
    regions.push({ start: 0, parts: lines });
  }
  for (const region of regions) {
    const body = region.parts.join('\n');
    const starts = [0];
    for (let index = 0; index < body.length; index += 1) if (body.charCodeAt(index) === 10) starts.push(index + 1);
    for (const command of argumentListCommands(body)) {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= command.index) low = middle;
        else high = middle - 1;
      }
      const number = region.start + low + 1;
      const quoted = lines[number - 1];
      if (networkCommand(command)) add('network-call', rel, number, quoted);
      for (const item of unpinnedInstalls(command.line)) add(item.rule, rel, number, quoted);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Check 7: best practices. Its own verdict; it never BLOCKs and never changes the security verdict.
// ---------------------------------------------------------------------------------------------------------------

const VAGUE = new Set(['helper', 'helpers', 'util', 'utils', 'utility', 'utilities', 'tool', 'tools', 'document', 'documents', 'data', 'file', 'files', 'misc', 'stuff', 'common']);
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const TIME_SENSITIVE = rx(j('\\b(?:before|after|until|till|as of)\\s+(?:(?:early|mid|late|the end of|end of)[\\s-]+)?(?:(?:', MONTHS, ')\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(?:19|20)\\d{2}|(?:19|20)\\d{2}(?:-\\d{2}(?:-\\d{2})?)?)\\b'), 'i');
const BACKSLASH_PATH = /(?:^|[\s`'"(\[])(?:[A-Za-z]:\\[^\s`'")]*|(?:[\w.-]+\\)+[\w.-]+\.[A-Za-z0-9]{1,6})(?=$|[\s`'"),.;:\]])/;
const TOC = /^\s*(?:#{1,6}\s+.*\b(?:contents|table of contents|toc|on this page|inhalt|index)\b|\*\*(?:table of )?contents\*\*)/i;

function bestPractices(folderName, files, entries) {
  const findings = [];
  const add = (rule, file, line, detail = '') => findings.push({ rule, file, line, detail: safeQuote(detail, 160), fix: BEST_PRACTICE_FIXES[rule] });
  const skill = files.find((file) => file.rel === 'SKILL.md');
  if (!skill && entries.some((entry) => entry.path === 'SKILL.md' && entry.kind === 'unreadable')) return { verdict: 'PASS', applies: false, note: 'Not checked: SKILL.md could not be read.', findings };
  if (!skill) return { verdict: 'PASS', applies: false, note: 'No SKILL.md: the best-practice rules apply to skills only.', findings };

  const front = frontMatter(skill.text);
  if (!front) add('bp-frontmatter', 'SKILL.md', 1);
  const fields = front?.fields ?? {};
  const at = (key) => front?.fieldLine[key] ?? 1;
  const name = fields.name;
  if (front && !name) add('bp-name-missing', 'SKILL.md', 1);
  if (name) {
    if (name.length > 64) add('bp-name-length', 'SKILL.md', at('name'), `${name.length} characters`);
    if (!/^[a-z0-9-]+$/.test(name)) add('bp-name-chars', 'SKILL.md', at('name'), name);
    if (/^-|-$|--/.test(name)) add('bp-name-hyphens', 'SKILL.md', at('name'), name);
    if (name !== folderName) add('bp-name-folder', 'SKILL.md', at('name'), `name ${name}, folder ${folderName}`);
    if (/anthropic|claude/i.test(name)) add('bp-name-reserved', 'SKILL.md', at('name'), name);
    if (/<[^>]*>/.test(name)) add('bp-name-xml', 'SKILL.md', at('name'), name);
    if (name.split('-').every((part) => VAGUE.has(part))) add('bp-name-vague', 'SKILL.md', at('name'), name);
  }
  const description = fields.description;
  if (front && !description) add('bp-description-missing', 'SKILL.md', 1);
  if (description) {
    if (description.length > 1024) add('bp-description-length', 'SKILL.md', at('description'), `${description.length} characters`);
    if (/<\/?[A-Za-z][^<>]*>/.test(description)) add('bp-description-xml', 'SKILL.md', at('description'), description.match(/<\/?[A-Za-z][^<>]*>/)[0]);
    if (/^(?:I|I'm|I'll|I can|You|You're|You'll|You can|We|We're|We'll|Let me|Let's)\b/.test(description.trim())) add('bp-description-person', 'SKILL.md', at('description'), description.slice(0, 60));
    // "Use when …" is the usual form; "Use before …", "Use at the end of …" or "Run after …" also say when (Anthropic: say what it does and when to use it).
    if (!/\bwhen(?:ever)?\b|\b(?:use|run|invoke|load|call)[sd]?\b[^.]{0,20}?\b(?:before|after|at|during|once|if)\b/i.test(description)) add('bp-description-when', 'SKILL.md', at('description'), description.slice(0, 60));
  }
  if (typeof fields.compatibility === 'string' && fields.compatibility.length > 500) add('bp-compatibility-length', 'SKILL.md', at('compatibility'), `${fields.compatibility.length} characters`);

  const total = skill.text.endsWith('\n') ? skill.lines.length - 1 : skill.lines.length;
  const body = total - (front?.lineCount ?? 0);
  if (body >= 500) add('bp-body-length', 'SKILL.md', (front?.lineCount ?? 0) + 500, `${body} body lines`);

  const markdownFiles = files.filter((file) => file.markdown && !file.binary);
  const known = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  const referenced = new Set();
  for (const link of markdownLinks(skill.lines)) {
    const target = localMarkdownTarget('SKILL.md', link.target);
    if (target && target !== 'SKILL.md' && known.has(target)) referenced.add(target);
  }
  // A link from one reference file to another is fine when SKILL.md already links that target directly: the
  // reader reaches it in one step either way.
  for (const target of [...referenced].sort()) {
    const file = files.find((item) => item.rel === target);
    if (!file || file.binary) continue;
    for (const link of markdownLinks(file.lines)) {
      const next = localMarkdownTarget(file.rel, link.target);
      if (next && next !== file.rel && next !== 'SKILL.md' && !referenced.has(next)) {
        add('bp-reference-depth', file.rel, link.line, link.target);
        break;
      }
    }
  }
  for (const file of markdownFiles) {
    if (file.rel !== 'SKILL.md' && !/^(?:LICENSE|CHANGELOG|NOTICE)/i.test(file.base)) {
      const count = file.text.endsWith('\n') ? file.lines.length - 1 : file.lines.length;
      if (count > 100 && !file.lines.slice(0, 40).some((line) => TOC.test(line))) add('bp-reference-toc', file.rel, 1, `${count} lines`);
    }
    file.lines.forEach((line, index) => {
      if (BACKSLASH_PATH.test(line)) add('bp-windows-path', file.rel, index + 1, line.match(BACKSLASH_PATH)[0]);
      if (TIME_SENSITIVE.test(line)) add('bp-time-sensitive', file.rel, index + 1, line.match(TIME_SENSITIVE)[0]);
    });
  }
  for (const file of files) {
    if (file.rel === 'SKILL.md') continue;
    const script = SCRIPT.has(file.ext) || (!file.ext && file.text.startsWith('#!'));
    if (script && !skill.text.includes(file.base) && !skill.text.includes(file.rel)) add('bp-unmentioned-script', file.rel, 1, file.rel);
  }
  return { verdict: findings.length > 0 ? 'FLAG' : 'PASS', applies: true, findings };
}

// ---------------------------------------------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------------------------------------------

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function realFolder(target) {
  const absolute = path.resolve(target);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw new UsageError(`no such folder: ${absolute}`);
  }
  const real = realpathSync(absolute);
  if (!statSync(real).isDirectory()) throw new UsageError(`not a folder: ${absolute}`);
  return { absolute, real, linked: stat.isSymbolicLink() };
}

export function checkFolder(target, { name } = {}) {
  const { absolute, real, linked } = realFolder(target);
  const folderName = name ?? path.basename(absolute);
  const result = scanFolder(real, folderName);
  const counts = { BLOCK: 0, FLAG: 0 };
  for (const finding of result.findings) counts[finding.verdict] += 1;
  return {
    tool: 'security-check',
    schema: 1,
    name: folderName,
    target: absolute,
    ...(linked ? { linkedTo: real } : {}),
    date: today(),
    verdict: result.verdict,
    exitCode: EXIT[result.verdict],
    counts,
    folderHash: result.folderHash,
    findings: result.findings,
    bestPractices: result.bestPractices,
    hosts: result.hosts,
    files: result.files,
  };
}

export function findSkills(root) {
  const found = [];
  const skipped = [];
  const walk = (directory, rel) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: rel || '.', reason: error.code ?? 'unreadable', unreadable: true });
      return;
    }
    if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) found.push({ dir: directory, rel: rel || '.', name: path.basename(directory) });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, next);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        skipped.push({ path: next, reason: 'broken link' });
        continue;
      }
      if (!stat.isDirectory()) continue;
      let hasSkill = false;
      try {
        hasSkill = statSync(path.join(absolute, 'SKILL.md')).isFile();
      } catch {
        hasSkill = false;
      }
      if (hasSkill) found.push({ dir: absolute, rel: next, name: entry.name, link: readlinkSync(absolute) });
      else skipped.push({ path: next, reason: 'linked folder without SKILL.md, not followed' });
    }
  };
  walk(root, '');
  return { found, skipped };
}

// The entry for a skill folder that could not be read: FLAG, naming the folder, so the run goes on with the others.
function unreadableSkill(rel, name, dir, error) {
  const rule = 'not-scanned-unreadable';
  const [check, verdict, why, fix] = RULES[rule];
  const text = safeQuote(`not scanned: unreadable (${error?.code ?? 'unreadable'}): ${dir}`);
  return {
    path: rel,
    tool: 'security-check',
    schema: 1,
    name,
    target: dir,
    date: today(),
    verdict,
    exitCode: EXIT[verdict],
    counts: { BLOCK: 0, FLAG: 1 },
    folderHash: 'not computed: the folder could not be read',
    findings: [{ check, rule, verdict, file: '.', line: 0, text, why, fix }],
    bestPractices: { verdict: 'PASS', applies: false, note: 'Not checked: the folder could not be read.', findings: [] },
    hosts: [],
    files: [],
  };
}

export function checkAll(root) {
  const { real } = realFolder(root);
  const { found, skipped: listed } = findSkills(real);
  // A folder findSkills could not open is a FLAG: inside a found skill, that skill's own check names it; anywhere
  // else it gets an entry of its own. Only a link that leads nowhere or to a folder without SKILL.md stays a note.
  const insideSkill = (rel) => found.some((item) => !item.link && (item.rel === '.' || rel === item.rel || rel.startsWith(`${item.rel}/`)));
  const skipped = listed.filter((item) => !item.unreadable);
  const unreadable = listed.filter((item) => item.unreadable && !insideSkill(item.path));
  if (found.length === 0) {
    const detail = unreadable.length > 0 ? `; not readable: ${unreadable.map((item) => item.path).join(', ')}` : '';
    throw new UsageError(`no folder with a SKILL.md under ${path.resolve(root)}${detail}`);
  }
  const skills = found.map((item) => {
    let report;
    try {
      report = checkFolder(item.dir, { name: item.name });
    } catch (error) {
      if (!error?.code) throw error;
      return { ...unreadableSkill(item.rel, item.name, item.dir, error), ...(item.link ? { link: item.link } : {}) };
    }
    return { path: item.rel, ...(item.link ? { link: item.link } : {}), ...report };
  });
  for (const item of unreadable) skills.push(unreadableSkill(item.path, path.basename(item.path), path.join(real, item.path), { code: item.reason }));
  const counts = { PASS: 0, FLAG: 0, BLOCK: 0 };
  const bestPractices = { PASS: 0, FLAG: 0, byRule: {} };
  for (const skill of skills) {
    counts[skill.verdict] += 1;
    bestPractices[skill.bestPractices.verdict] += 1;
    for (const finding of skill.bestPractices.findings) bestPractices.byRule[finding.rule] = (bestPractices.byRule[finding.rule] ?? 0) + 1;
  }
  const verdict = counts.BLOCK > 0 ? 'BLOCK' : counts.FLAG > 0 ? 'FLAG' : 'PASS';
  return { tool: 'security-check', schema: 1, mode: 'all', root: path.resolve(root), date: today(), verdict, exitCode: EXIT[verdict], counts, bestPractices, skipped, skills };
}

// ---------------------------------------------------------------------------------------------------------------
// Report page: offline, no outside files, every quoted text escaped.
// ---------------------------------------------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

const CSS = `:root{--bg:#ffffff;--fg:#1d1f23;--muted:#5d636b;--line:#d9dce1;--card:#f5f6f8;--code:#eceef1;--block:#b3261e;--flag:#8a5a00;--pass:#1e7d32}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e8eaed;--muted:#a3a8af;--line:#33373d;--card:#1d2024;--code:#262a30;--block:#f28b82;--flag:#fdd663;--pass:#81c995}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#e8eaed;--muted:#a3a8af;--line:#33373d;--card:#1d2024;--code:#262a30;--block:#f28b82;--flag:#fdd663;--pass:#81c995}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:.2rem 0 .6rem}h2{font-size:1.1rem;margin:1.6rem 0 .5rem}h3{font-size:1rem;margin:1.2rem 0 .4rem}
.meta{color:var(--muted);font-size:.9rem;word-break:break-all}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:.6rem 0}
.badge{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:2px 12px;font-weight:600}
.BLOCK{color:var(--block)}.FLAG{color:var(--flag)}.PASS{color:var(--pass)}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--line)}th{background:var(--card)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--code);border-radius:4px;padding:1px 4px;word-break:break-all}
button{font:inherit;font-size:.8rem;padding:2px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer;white-space:nowrap}
details{margin:.6rem 0}summary{cursor:pointer;font-weight:600}.empty{color:var(--muted)}`;

const COPY_SCRIPT = "document.addEventListener('click',function(e){var b=e.target.closest('button[data-copy]');if(!b)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)})});";

function page(title, body) {
  const scriptHash = createHash('sha256').update(COPY_SCRIPT).digest('base64');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
</main><script>${COPY_SCRIPT}</script></body>
</html>
`;
}

const copyButton = (text) => `<button type="button" data-copy="${escapeHtml(text)}">Copy</button>`;

function findingsTable(findings) {
  if (findings.length === 0) return '<p class="empty">No hits.</p>';
  const rows = findings.map((item) => `<tr><td class="${item.verdict}">${item.verdict}</td><td>${escapeHtml(CHECKS[item.check] ?? item.check)}<br><code>${escapeHtml(item.rule)}</code></td><td><code>${escapeHtml(item.file)}:${item.line}</code></td><td><code>${escapeHtml(item.text)}</code><br><span class="meta">${escapeHtml(item.why)}</span></td><td>${escapeHtml(item.fix)}<br>${copyButton(item.fix)}</td></tr>`).join('\n');
  return `<div class="wrap"><table><thead><tr><th>Verdict</th><th>Check</th><th>File:line</th><th>Quoted text</th><th>Fix</th></tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
}

function bestPracticeTable(result) {
  if (!result.applies) return `<p class="empty">${escapeHtml(result.note)}</p>`;
  if (result.findings.length === 0) return '<p class="empty">No findings.</p>';
  const rows = result.findings.map((item) => `<tr><td><code>${escapeHtml(item.rule)}</code></td><td><code>${escapeHtml(item.file)}:${item.line}</code></td><td><code>${escapeHtml(item.detail)}</code></td><td>${escapeHtml(item.fix)}<br>${copyButton(item.fix)}</td></tr>`).join('\n');
  return `<div class="wrap"><table><thead><tr><th>Rule</th><th>File:line</th><th>Detail</th><th>Fix</th></tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
}

function skillSection(report, level = 'h2') {
  const hosts = report.hosts.length === 0 ? '<p class="empty">No web addresses.</p>'
    : `<div class="wrap"><table><thead><tr><th>Host</th><th>First seen</th></tr></thead><tbody>${report.hosts.map((item) => `<tr><td><code>${escapeHtml(item.host)}</code></td><td><code>${escapeHtml(item.file)}:${item.line}</code></td></tr>`).join('')}</tbody></table></div>`;
  const inventory = `<div class="wrap"><table><thead><tr><th>File</th><th>Kind</th><th>Size</th><th>SHA-256 or link</th></tr></thead><tbody>${report.files.map((item) => `<tr><td><code>${escapeHtml(item.path)}</code></td><td>${escapeHtml(item.kind)}</td><td>${item.size ?? ''}</td><td><code>${escapeHtml(item.sha256 ?? item.target ?? '')}</code></td></tr>`).join('')}</tbody></table></div>`;
  return `<${level}>Security hits (${report.counts.BLOCK} BLOCK, ${report.counts.FLAG} FLAG)</${level}>
${findingsTable(report.findings)}
<${level}>Best practices: <span class="${report.bestPractices.verdict}">${report.bestPractices.verdict}</span></${level}>
${bestPracticeTable(report.bestPractices)}
<details><summary>Web addresses (${report.hosts.length} hosts)</summary>${hosts}</details>
<details><summary>Files read (${report.files.length})</summary>${inventory}</details>`;
}

export function renderReport(report) {
  const body = `<h1>Security check: ${escapeHtml(report.name)}</h1>
<p class="meta">Folder: <code>${escapeHtml(report.target)}</code><br>Folder hash (SHA-256): <code>${report.folderHash}</code><br>Date: ${report.date}</p>
<div class="badges"><span class="badge ${report.verdict}">Security: ${report.verdict}</span><span class="badge ${report.bestPractices.verdict}">Best practices: ${report.bestPractices.verdict}</span></div>
<p class="meta">A BLOCK is final: nothing is installed while it stands. The person decides each FLAG. Key values are masked (first four characters and the length).</p>
${skillSection(report)}`;
  return page(`Security check ${report.name}`, body);
}

export function renderSummary(summary) {
  const rows = summary.skills.map((skill) => `<tr><td><code>${escapeHtml(skill.path)}</code></td><td class="${skill.verdict}">${skill.verdict}</td><td>${skill.counts.BLOCK}</td><td>${skill.counts.FLAG}</td><td class="${skill.bestPractices.verdict}">${skill.bestPractices.verdict}</td><td>${skill.bestPractices.findings.length}</td></tr>`).join('\n');
  const details = summary.skills.filter((skill) => skill.findings.length > 0 || skill.bestPractices.findings.length > 0)
    .map((skill) => `<details><summary><span class="${skill.verdict}">${skill.verdict}</span> ${escapeHtml(skill.path)}</summary><p class="meta">Folder hash: <code>${skill.folderHash}</code></p>${skillSection(skill, 'h3')}</details>`).join('\n');
  const skipped = summary.skipped.length === 0 ? '' : `<h2>Not checked</h2><ul>${summary.skipped.map((item) => `<li><code>${escapeHtml(item.path)}</code>: ${escapeHtml(item.reason)}</li>`).join('')}</ul>`;
  const body = `<h1>Security check: every skill under ${escapeHtml(path.basename(summary.root))}</h1>
<p class="meta">Root: <code>${escapeHtml(summary.root)}</code><br>Date: ${summary.date}</p>
<div class="badges"><span class="badge PASS">PASS ${summary.counts.PASS}</span><span class="badge FLAG">FLAG ${summary.counts.FLAG}</span><span class="badge BLOCK">BLOCK ${summary.counts.BLOCK}</span><span class="badge">Best practices FLAG ${summary.bestPractices.FLAG}</span></div>
<div class="wrap"><table><thead><tr><th>Skill</th><th>Security</th><th>BLOCK</th><th>FLAG</th><th>Best practices</th><th>Findings</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h2>Details</h2>
${details || '<p class="empty">No hits.</p>'}
${skipped}`;
  return page(`Security check ${path.basename(summary.root)}`, body);
}

// ---------------------------------------------------------------------------------------------------------------
// Command line.
// ---------------------------------------------------------------------------------------------------------------

const USAGE = `Usage:
  node check.mjs <folder> [--project <name>] [--report-dir <dir>] [--json]
  node check.mjs --all <root> [--project <name>] [--report-dir <dir>] [--json]

Reads every file in the folder (or in every folder under <root> that holds a SKILL.md) and
reports six security checks and the skill best practices. It never runs a file and opens
no connection.

Reports: 01-Projects/<name>/local/security-check/ with --project inside a workspace,
otherwise local/security-check/ under the current folder; --report-dir overrides. Without
--report-dir or a workspace project, a current folder inside a git work tree is refused.
Exit codes: 0 PASS, 3 FLAG, 4 BLOCK, 2 usage or read error.`;

export function parseArguments(argv) {
  const options = { json: false, all: null, project: null, reportDir: null, target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--all') options.all = value();
    else if (argument === '--project') options.project = value();
    else if (argument === '--report-dir') options.reportDir = value();
    else if (argument.startsWith('-')) throw new UsageError(`unknown option ${argument}`);
    else if (options.target === null) options.target = argument;
    else throw new UsageError(`one folder only; got ${argument} as well`);
  }
  if (options.help) return options;
  if (options.all && options.target) throw new UsageError('give a folder or --all <root>, not both');
  if (!options.all && !options.target) throw new UsageError('name the folder to check');
  if (options.project !== null && (!/^[^/\\]+$/.test(options.project) || options.project === '.' || options.project === '..')) throw new UsageError('--project takes one project folder name');
  return options;
}

function findWorkspace(start) {
  let current = path.resolve(start);
  for (;;) {
    try {
      if (statSync(path.join(current, '00-Meta')).isDirectory() && statSync(path.join(current, '01-Projects')).isDirectory()) return current;
    } catch {
      // not this folder
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function reportFolder(options, cwd, notes = []) {
  if (options.reportDir) return path.resolve(cwd, options.reportDir);
  if (options.project) {
    const workspace = findWorkspace(cwd);
    if (workspace) {
      const project = path.join(workspace, '01-Projects', options.project);
      let isFolder = false;
      try {
        isFolder = statSync(project).isDirectory();
      } catch {
        isFolder = false;
      }
      if (!isFolder) throw new UsageError(`no project folder 01-Projects/${options.project} in the workspace ${workspace}`);
      return path.join(project, 'local', 'security-check');
    }
    notes.push('not inside a workspace, so --project was not used');
  }
  const folder = path.join(cwd, 'local', 'security-check');
  const tree = gitWorkTree(folder);
  if (tree) throw new UsageError(`the default report folder ${folder} is inside the git work tree ${tree}; pass --report-dir <folder outside it>, or --project <name> from inside a workspace`);
  return folder;
}

// The nearest folder at or above the given path that holds a .git folder or file (a repository, worktree or
// submodule). It looks at names only and starts no process.
export function gitWorkTree(start) {
  let current = path.resolve(start);
  for (;;) {
    try {
      lstatSync(path.join(current, '.git'));
      return current;
    } catch {
      // not this folder
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const fileLabel = (value) => value.replace(/^\.+/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'folder';

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return EXIT.PASS;
    }
    const notes = [];
    const folder = reportFolder(options, cwd, notes);
    let report;
    let base;
    if (options.all) {
      report = checkAll(path.resolve(cwd, options.all));
      for (const skill of report.skills) {
        if (inside(skill.linkedTo ?? skill.target, folder)) throw new UsageError('the report folder is inside a checked folder; pass --report-dir');
      }
      const parts = report.root.split(path.sep).filter(Boolean).slice(-2).map(fileLabel);
      base = `security-check-all-${parts.join('-')}-${report.date}`;
    } else {
      report = checkFolder(path.resolve(cwd, options.target));
      if (inside(report.linkedTo ?? report.target, folder) || inside(report.target, folder)) throw new UsageError('the report folder is inside the checked folder; pass --report-dir');
      base = `security-check-${fileLabel(report.name)}-${report.date}`;
    }
    if (notes.length > 0) report.notes = notes;
    mkdirSync(folder, { recursive: true });
    const html = path.join(folder, `${base}.html`);
    const json = path.join(folder, `${base}.json`);
    report.reportFiles = { html, json };
    writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(html, options.all ? renderSummary(report) : renderReport(report));
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (options.all) {
      process.stdout.write(`security-check: ${report.skills.length} skills under ${report.root}\nVerdict: ${report.verdict} (PASS ${report.counts.PASS}, FLAG ${report.counts.FLAG}, BLOCK ${report.counts.BLOCK})\nBest practices: FLAG ${report.bestPractices.FLAG}, PASS ${report.bestPractices.PASS}\n`);
      for (const skill of report.skills) process.stdout.write(`${skill.verdict}\t${skill.path}\t${skill.counts.BLOCK} BLOCK, ${skill.counts.FLAG} FLAG, best practices ${skill.bestPractices.verdict}\n`);
      process.stdout.write(`Report: ${html}\nJSON: ${json}\n`);
    } else {
      process.stdout.write(`security-check: ${report.name}\nVerdict: ${report.verdict} (${report.counts.BLOCK} BLOCK, ${report.counts.FLAG} FLAG)\nBest practices: ${report.bestPractices.verdict} (${report.bestPractices.findings.length} findings)\nFolder hash: ${report.folderHash}\n`);
      for (const item of report.findings) process.stdout.write(`${item.verdict}\t${item.rule}\t${item.file}:${item.line}\t${item.text}\n`);
      for (const item of report.bestPractices.findings) process.stdout.write(`BEST-PRACTICE\t${item.rule}\t${item.file}:${item.line}\t${item.fix}\n`);
      process.stdout.write(`Report: ${html}\nJSON: ${json}\n`);
    }
    for (const note of notes) process.stderr.write(`security-check: ${note}\n`);
    return report.exitCode;
  } catch (error) {
    if (error instanceof UsageError || error?.code) {
      process.stderr.write(`security-check: ${error.message}\n${error instanceof UsageError ? `\n${USAGE}\n` : ''}`);
      return EXIT.USAGE;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
