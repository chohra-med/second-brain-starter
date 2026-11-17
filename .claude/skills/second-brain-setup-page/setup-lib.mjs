// Shared by build.mjs (renders the setup pages) and answers.mjs (checks a pasted answers block).
// Reads one choices file, resolves an "extends" base and its overrides, and computes the choices
// fingerprint that the page prints in its answers block. No network, no process, no writes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const KINDS = new Set(['choice', 'multi', 'text']);
const ID = /^[A-Z][0-9]{1,2}$/;
const CODE = /^[a-z][a-z0-9-]{0,23}$/;

function fail(message) {
  const error = new Error(message);
  error.code = 'CHOICES_INVALID';
  throw error;
}

export function loadForm(file) {
  const own = JSON.parse(readFileSync(file, 'utf8'));
  let items = { ...own.items };
  if (own.extends) {
    const base = JSON.parse(readFileSync(path.join(path.dirname(file), own.extends), 'utf8'));
    items = { ...base.items, ...own.items };
    for (const [id, change] of Object.entries(own.overrides ?? {})) {
      if (!items[id]) fail(`override for unknown item ${id}`);
      items[id] = { ...items[id], ...change };
    }
  }
  const order = [];
  for (const section of own.sections) {
    for (const id of section.items) {
      if (!items[id]) fail(`section ${section.id} names unknown item ${id}`);
      if (order.includes(id)) fail(`item ${id} is listed twice`);
      order.push(id);
    }
  }
  const resolved = order.map((id) => validateItem(id, items[id]));
  return { ...own, items: resolved, byId: Object.fromEntries(resolved.map((item) => [item.id, item])), fingerprint: fingerprint(own, resolved) };
}

function validateItem(id, raw) {
  if (!ID.test(id)) fail(`bad item id ${id}`);
  const item = { id, ...raw };
  if (!KINDS.has(item.kind)) fail(`${id}: unknown kind ${item.kind}`);
  for (const key of ['title', 'why', 'does']) if (typeof item[key] !== 'string' || !item[key]) fail(`${id}: missing ${key}`);
  if (item.kind === 'text') {
    if (!Array.isArray(item.fields) || item.fields.length < 1 || item.fields.length > 3) fail(`${id}: a text item needs 1 to 3 fields`);
    if (item.rec !== undefined && item.rec !== null) fail(`${id}: a text item has no recommendation`);
    item.rec = null;
    return item;
  }
  if (!Array.isArray(item.options) || item.options.length < 2) fail(`${id}: needs at least two options`);
  const codes = item.options.map((option) => option.code);
  for (const code of codes) if (!CODE.test(code)) fail(`${id}: bad option code ${code}`);
  // "none" is reserved: the answers block writes it for a multi item with nothing ticked.
  if (codes.includes('none')) fail(`${id}: the option code none is reserved`);
  if (new Set(codes).size !== codes.length) fail(`${id}: option codes repeat`);
  if (item.kind === 'choice' && item.rec !== null && !codes.includes(item.rec)) fail(`${id}: recommendation ${item.rec} is not an option`);
  if (item.kind === 'multi' && (!Array.isArray(item.rec) || item.rec.some((code) => !codes.includes(code)))) fail(`${id}: multi recommendation must list known codes`);
  if (item.rec !== null && !item.recWhy) fail(`${id}: a recommendation needs its reason`);
  if (item.text && item.text.for !== 'always' && !(Array.isArray(item.text.for) && item.text.for.every((code) => codes.includes(code)))) fail(`${id}: text.for must be "always" or known codes`);
  return item;
}

// The fingerprint covers what an answer means: ids, kinds, option codes, recommendations, text slots and
// conditions. Wording changes alone do not change it; a new or removed option does.
export function fingerprint(form, items) {
  const canonical = {
    form: form.form,
    version: form.version,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      options: (item.options ?? []).map((option) => option.code),
      rec: item.rec,
      text: item.kind === 'text' ? item.fields.length : item.text ? item.text.for : null,
      showIf: item.showIf ?? null,
    })),
    sections: form.sections.map((section) => ({ items: section.items, showIf: section.showIf ?? null })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 12);
}

// Which item ids are visible for a set of answers, following section and item conditions.
export function visibleIds(form, codesById) {
  const holds = (condition) => !condition || Object.entries(condition).every(([id, allowed]) => (codesById[id] ?? []).some((code) => allowed.includes(code)));
  const ids = [];
  for (const section of form.sections) {
    if (!holds(section.showIf)) continue;
    for (const id of section.items) if (holds(form.byId[id].showIf)) ids.push(id);
  }
  return ids;
}
