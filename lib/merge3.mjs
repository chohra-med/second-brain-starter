// Line-based three-way merge (diff3) in plain JavaScript, with no dependency.
//
// mergeThreeWay(base, local, template) merges two descendants of one base text.
// Lines keep their own line endings, so CRLF and LF bytes survive exactly, and a
// missing final newline is just a last line without one.
//
// A region is clean when only one side changed it, or both sides made the same
// change. Lines are compared first, as in GNU diff3, where changes to the same or
// adjacent lines conflict. Such a region is then merged again word by word with
// the same rule, a word being a run of non-space characters with the whitespace
// (line break included) after it. It resolves only if that merge is clean, so a
// conflict remains whenever both sides changed the same or adjacent words, or
// both inserted different text at one point. A conflict is rendered with markers
// for a person to resolve.

const MAX_LCS_CELLS = 25_000_000;

export function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

// A word carries the whitespace after it, so two edits merge only when at least
// one unchanged word separates them.
function tokenize(text) {
  return text.match(/^\s+|\S+\s*/gu) ?? [];
}

// Longest common subsequence matches between two arrays, as an array mapping each
// index of `left` to its matched index in `right`, or -1.
function matchIndexes(left, right) {
  const map = new Array(left.length).fill(-1);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    map[prefix] = prefix;
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) {
    map[left.length - 1 - suffix] = right.length - 1 - suffix;
    suffix += 1;
  }
  const n = left.length - prefix - suffix;
  const m = right.length - prefix - suffix;
  if (n === 0 || m === 0) return map;
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) return map;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = left[prefix + i] === right[prefix + j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[prefix + i] === right[prefix + j]) {
      map[prefix + i] = prefix + j;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return map;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Splits the three sequences into stable runs and changed chunks.
function chunks(base, local, template) {
  const toLocal = matchIndexes(base, local);
  const toTemplate = matchIndexes(base, template);
  const result = [];
  let o = 0;
  let a = 0;
  let b = 0;
  while (true) {
    if (o < base.length && toLocal[o] === a && toTemplate[o] === b) {
      const last = result.at(-1);
      if (last?.stable) last.base.push(base[o]);
      else result.push({ stable: true, base: [base[o]] });
      o += 1;
      a += 1;
      b += 1;
      continue;
    }
    let next = o;
    while (next < base.length && (toLocal[next] === -1 || toTemplate[next] === -1)) next += 1;
    const endA = next < base.length ? toLocal[next] : local.length;
    const endB = next < base.length ? toTemplate[next] : template.length;
    if (next > o || endA > a || endB > b) {
      result.push({ stable: false, base: base.slice(o, next), local: local.slice(a, endA), template: template.slice(b, endB) });
    }
    if (next >= base.length) break;
    o = next;
    a = endA;
    b = endB;
  }
  return result;
}

function resolveChunk(chunk) {
  if (sameArray(chunk.local, chunk.base)) return chunk.template;
  if (sameArray(chunk.template, chunk.base)) return chunk.local;
  if (sameArray(chunk.local, chunk.template)) return chunk.local;
  return null;
}

function mergeSequences(base, local, template) {
  const output = [];
  const conflicts = [];
  for (const chunk of chunks(base, local, template)) {
    if (chunk.stable) {
      output.push(...chunk.base);
      continue;
    }
    const resolved = resolveChunk(chunk);
    if (resolved !== null) output.push(...resolved);
    else {
      output.push({ conflict: chunk });
      conflicts.push(chunk);
    }
  }
  return { output, conflicts };
}

// Refines one conflicting region. Returns output items (strings, and smaller
// conflicts), or null when the region stays one conflict.
//  - Both sides inserted at the same point (empty base): when one insertion
//    contains the other line for line, the longer one is the merge. Otherwise
//    the region stays a conflict, narrowed to the lines that differ, so two
//    different insertions never interleave silently.
//  - Both sides changed the same lines: word-level diff3 over the region, where a
//    line break is part of the word before it.
function refine(chunk) {
  if (chunk.base.length === 0) {
    const toTemplate = matchIndexes(chunk.local, chunk.template);
    const agreed = chunk.local.filter((_, index) => toTemplate[index] !== -1);
    if (agreed.length === 0) return null;
    const merged = mergeSequences(agreed, chunk.local, chunk.template);
    const contained = agreed.length === chunk.local.length || agreed.length === chunk.template.length;
    if (contained || merged.conflicts.length > 0) return merged.output;
    return null;
  }
  const merged = mergeSequences(tokenize(chunk.base.join('')), tokenize(chunk.local.join('')), tokenize(chunk.template.join('')));
  if (merged.conflicts.length > 0) return null;
  return [merged.output.join('')];
}

function eolOf(...texts) {
  for (const text of texts) {
    const found = text.match(/\r?\n/);
    if (found) return found[0];
  }
  return '\n';
}

function closed(lines, eol) {
  if (lines.length === 0) return [];
  const last = lines.at(-1);
  return last.endsWith('\n') ? lines : [...lines.slice(0, -1), `${last}${eol}`];
}

/**
 * Three-way merge of UTF-8 text or bytes.
 * Returns { clean, text, conflicts } where `text` is the merged text when clean,
 * or the text with conflict markers when not.
 */
export function mergeThreeWay(baseInput, localInput, templateInput, labels = {}) {
  const base = Buffer.isBuffer(baseInput) ? baseInput.toString('utf8') : String(baseInput);
  const local = Buffer.isBuffer(localInput) ? localInput.toString('utf8') : String(localInput);
  const template = Buffer.isBuffer(templateInput) ? templateInput.toString('utf8') : String(templateInput);
  const { output } = mergeSequences(splitLines(base), splitLines(local), splitLines(template));
  const eol = eolOf(local, base, template);
  const localLabel = labels.local ?? 'local';
  const baseLabel = labels.base ?? 'base';
  const templateLabel = labels.template ?? 'template';
  const parts = [];
  let conflicts = 0;
  const items = [];
  for (const item of output) {
    if (typeof item === 'string') items.push(item);
    else items.push(...(refine(item.conflict) ?? [item]));
  }
  for (const item of items) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    conflicts += 1;
    const lastPart = parts.at(-1);
    if (lastPart !== undefined && !lastPart.endsWith('\n')) parts[parts.length - 1] = `${lastPart}${eol}`;
    parts.push(`<<<<<<< ${localLabel}${eol}`, ...closed(item.conflict.local, eol));
    parts.push(`||||||| ${baseLabel}${eol}`, ...closed(item.conflict.base, eol));
    parts.push(`=======${eol}`, ...closed(item.conflict.template, eol));
    parts.push(`>>>>>>> ${templateLabel}${eol}`);
  }
  return { clean: conflicts === 0, conflicts, text: parts.join('') };
}

/**
 * The whole-file proposal used when no base is known: both versions, marked.
 */
export function twoWayProposal(localInput, templateInput, labels = {}) {
  const local = Buffer.isBuffer(localInput) ? localInput.toString('utf8') : String(localInput);
  const template = Buffer.isBuffer(templateInput) ? templateInput.toString('utf8') : String(templateInput);
  const eol = eolOf(local, template);
  return [
    `<<<<<<< ${labels.local ?? 'local'}${eol}`,
    ...closed(splitLines(local), eol),
    `=======${eol}`,
    ...closed(splitLines(template), eol),
    `>>>>>>> ${labels.template ?? 'template'}${eol}`,
  ].join('');
}
