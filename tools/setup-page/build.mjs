#!/usr/bin/env node
// Builds the setup page of the second-brain-setup-page skill from its choices file.
// usage (from the repository root):
//   node tools/setup-page/build.mjs <choices.json> <out.html> [<choices.json> <out.html> ...]
//   node tools/setup-page/build.mjs --check <choices.json> <page.html> [...]   (exit 1 when a page differs from a fresh build)
// The page loads nothing from anywhere: its policy allows only its own script and style, by SHA-256 hash, and the
// build refuses any outside address or loader. It starts no process and opens no network connection.
// The openOS page: node tools/setup-page/build.mjs .agents/skills/second-brain-setup-page/choices.json .agents/skills/second-brain-setup-page/assets/second-brain-setup.html
// then copy the skill folder to .claude/skills/second-brain-setup-page/ (test/setup-page.test.mjs checks both).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadForm } from '../../.agents/skills/second-brain-setup-page/setup-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(path.join(here, 'page-template.html'), 'utf8');
const script = readFileSync(path.join(here, 'page-script.js'), 'utf8');

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const BANNED = ['http://', 'https://', '//cdn', '@import', 'url(', ' src=', '<link', '<iframe', '<img'];

function recLabels(item) {
  if (item.kind === 'multi') return item.rec.length === item.options.length ? 'all of them' : 'the ones marked Recommended';
  return item.options.find((option) => option.code === item.rec).label;
}

function renderItem(item, hiddenByItem) {
  const id = item.id;
  const out = [];
  out.push(`<fieldset class="item" id="item-${id}" data-kind="${item.kind}"${hiddenByItem ? ' hidden' : ''}>`);
  out.push(`<legend><span class="iid">${id}</span>${esc(item.title)}</legend>`);
  out.push(`<p class="why">${esc(item.why)}</p>`);
  if (item.kind === 'text') {
    item.fields.forEach((field, index) => {
      const fid = `${id}-t${index + 1}`;
      const control = (field.lines ?? 1) > 1
        ? `<textarea id="${fid}" rows="${field.lines}" maxlength="${field.max ?? 300}" placeholder="${esc(field.placeholder ?? '')}"></textarea>`
        : `<input type="text" id="${fid}" maxlength="${field.max ?? 300}" placeholder="${esc(field.placeholder ?? '')}" autocomplete="off">`;
      out.push(`<div class="field"><label for="${fid}">${esc(field.label)}</label>${control}</div>`);
    });
    out.push('<p class="rec none"><b>No recommendation:</b> these are your own words. Leave it empty and the assistant saves Unknown and asks again later.</p>');
  } else {
    if (item.choiceLabel) out.push(`<p class="fl">${esc(item.choiceLabel)}:</p>`);
    out.push('<div class="opts">');
    const rec = item.rec === null ? [] : Array.isArray(item.rec) ? item.rec : [item.rec];
    for (const option of item.options) {
      const oid = `${id}-o-${option.code}`;
      const type = item.kind === 'multi' ? 'checkbox' : 'radio';
      const hint = option.hint ? `<span class="hint">${esc(option.hint)}</span>` : '';
      const badge = rec.includes(option.code) ? '<span class="badge">Recommended</span>' : '';
      out.push(`<label class="opt" for="${oid}"><input type="${type}" name="${id}" id="${oid}" value="${option.code}"><span class="ol">${esc(option.label)}${hint}</span>${badge}</label>`);
    }
    out.push('</div>');
    if (item.text) {
      const always = item.text.for === 'always';
      out.push(`<div class="txt" id="${id}-textwrap"${always ? '' : ' hidden'}><label for="${id}-text">${esc(item.text.label)}</label><input type="text" id="${id}-text" maxlength="${item.text.max ?? 200}" placeholder="${esc(item.text.placeholder ?? '')}" autocomplete="off"></div>`);
    }
    if (item.rec === null) out.push('<p class="rec none"><b>No recommendation:</b> only you know this one.</p>');
    else out.push(`<p class="rec"><b>Why we recommend ${esc(recLabels(item))}:</b> ${esc(item.recWhy)}</p>`);
  }
  out.push(`<p class="does"><b>What happens:</b> ${esc(item.does)}</p>`);
  if (item.example) out.push(`<details class="ex"><summary>Example</summary><p>${esc(item.example)}</p></details>`);
  const buttons = [];
  if (item.kind !== 'text' && item.rec !== null) buttons.push(`<button type="button" data-rec="${id}">Do what you recommend</button>`);
  buttons.push(`<button type="button" class="quiet" data-note="${id}" aria-expanded="false" aria-controls="${id}-notewrap" aria-label="Add a comment on ${id}">Comment</button>`);
  const state = item.kind === 'text' ? 'Optional.' : '';
  out.push(`<div class="row">${buttons.join('')}<span class="state" id="${id}-state" aria-live="polite">${state}</span></div>`);
  out.push(`<div class="note" id="${id}-notewrap" hidden><label for="${id}-note">Your comment on ${id} (optional)</label><textarea id="${id}-note" rows="2" maxlength="600"></textarea></div>`);
  out.push('</fieldset>');
  return out.join('\n');
}

export function render(choicesFile) {
  const form = loadForm(choicesFile);
  const sections = form.sections.map((section) => {
    const body = section.items.map((id) => renderItem(form.byId[id], Boolean(form.byId[id].showIf))).join('\n');
    return `<section class="sec" id="sec-${section.id}" aria-labelledby="h-${section.id}"${section.showIf ? ' hidden' : ''}>\n<h2 id="h-${section.id}">${esc(section.title)}</h2>\n${body}\n</section>`;
  }).join('\n');
  const data = {
    form: form.form,
    version: form.version,
    fingerprint: form.fingerprint,
    sections: form.sections.map((section) => ({ id: section.id, items: section.items, showIf: section.showIf ?? null })),
    items: form.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      rec: item.rec,
      showIf: item.showIf ?? null,
      options: (item.options ?? []).map((option) => ({ code: option.code, label: option.label })),
      text: item.text ? { for: item.text.for } : null,
      fields: item.kind === 'text' ? item.fields.map(() => 1) : [],
    })),
  };
  const style = template.match(/<style>([\s\S]*?)<\/style>/)[1];
  const csp = [
    "default-src 'none'",
    `script-src ${sha(script)}`,
    `style-src ${sha(style)}`,
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const html = template
    .replace('{{CSP}}', () => csp)
    .replaceAll('{{TITLE}}', () => esc(form.title))
    .replace('{{TOOL}}', () => esc(form.tool))
    .replace('{{LEDE}}', () => esc(form.lede))
    .replace('{{ALWAYS}}', () => form.always.map((line) => `<li>${esc(line)}</li>`).join(''))
    .replace('{{SECTIONS}}', () => sections)
    .replace('{{DATA}}', () => jsonForScript(data))
    .replace('{{SCRIPT}}', () => script);
  // Self-checks: nothing from outside, no placeholder left, the hashed bytes are the bytes in the page.
  for (const banned of BANNED) {
    if (html.includes(banned)) throw new Error(`${choicesFile}: the page contains ${banned}`);
  }
  if (/\{\{[A-Z]+\}\}/.test(html)) throw new Error(`${choicesFile}: a placeholder is left`);
  if (html.match(/<script>([\s\S]*?)<\/script>/)[1] !== script) throw new Error('script bytes changed while rendering');
  return { html, form, csp };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === '--check';
  if (checkOnly) args.shift();
  if (args.length === 0 || args.length % 2 !== 0) {
    console.error('usage: node tools/setup-page/build.mjs [--check] <choices.json> <page.html> [<choices.json> <page.html> ...]');
    process.exit(2);
  }
  for (let index = 0; index < args.length; index += 2) {
    const target = path.resolve(args[index + 1]);
    const { html, form } = render(path.resolve(args[index]));
    if (checkOnly) {
      let current = null;
      try { current = readFileSync(target, 'utf8'); } catch { current = null; }
      const same = current === html;
      console.log(`${same ? 'up to date' : 'DIFFERS from a fresh build'}: ${args[index + 1]} (form ${form.form} v${form.version}, choices ${form.fingerprint})`);
      if (!same) process.exitCode = 1;
    } else {
      writeFileSync(target, html);
      console.log(`wrote ${args[index + 1]}: form ${form.form} v${form.version}, choices ${form.fingerprint}, ${form.items.length} items, ${Buffer.byteLength(html)} bytes`);
    }
  }
}
