// skill-sync: the weekly report on the skills of one workspace. Second Brain Starter edition: report only.
// Node 22 or newer, no packages. It changes no skill, no lock file and no sources list.
//   node sync.mjs --workspace <dir> [--offline] [--report-dir <dir>] [--json]
//   node sync.mjs --print-schedule [--os macos|linux|windows] [--workspace <dir>]
// Exit codes: 0 nothing for you, 3 something needs you, 4 the security check found a BLOCK, 2 usage or read error.
// Its one network use is git ls-remote: the newest commit id of each approved https:// or file:// address in
// .skill-sync/skills-sources.json, after the address list is written to the report folder; none with --offline.
// It starts git and the security check with argument lists, never through a shell, and runs no file of a skill.
// --print-schedule prints three paths, then one section of assets/schedule.txt unchanged. It registers no job.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ NOTHING: 0, NEEDS_YOU: 3, BLOCK: 4, USAGE: 2 });
export const ROOTS = ['.claude/skills', '.agents/skills'];
const STATE = '.skill-sync';
const SOURCES = 'skills-sources.json';
const LOCK = 'skills.lock.json';
const ADAPTERS = 'adapters.json';
const KINDS = new Set(['external', 'ours', 'local', 'bundled']);
const ADDRESS = /^(?:https|file):\/\/[^\s'"`<>\\]+$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const TIMEOUT_MS = 30000;

class UsageError extends Error {}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 200);
const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// ---------------------------------------------------------------------------------------------------------------
// Step 1, inventory: every SKILL.md under .claude/skills and .agents/skills, each skill folder hashed file by file.
// ---------------------------------------------------------------------------------------------------------------

// A file or folder that cannot be read is listed with its error code instead of stopping the run; the security
// check gives it a FLAG.
function folderFiles(dir) {
  const files = [];
  const unreadable = (rel, error) => files.push({ path: rel || '.', unreadable: error?.code ?? 'unreadable' });
  const walk = (current, prefix) => {
    let names;
    try {
      names = readdirSync(current).sort(byText);
    } catch (error) {
      unreadable(prefix, error);
      return;
    }
    for (const name of names) {
      if (name === '.git' || name === 'node_modules') continue;
      const absolute = path.join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      try {
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) files.push({ path: rel, link: readlinkSync(absolute) });
        else if (stat.isDirectory()) walk(absolute, rel);
        else if (stat.isFile()) files.push({ path: rel, sha256: observedFile(absolute).sha256 });
      } catch (error) {
        unreadable(rel, error);
      }
    }
  };
  walk(dir, '');
  return files;
}

const fileKey = (file) => file.sha256 ?? (file.link !== undefined ? `link:${file.link}` : `unreadable:${file.unreadable}`);
export const folderSha256 = (files) => sha256(files.map((file) => `${file.path}\t${fileKey(file)}\n`).sort(byText).join(''));

function findSkills(root) {
  const found = [];
  const skipped = [];
  const walk = (dir, rel) => {
    let entries, before;
    try {
      before = statSync(dir);
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: rel || '.', reason: error.code ?? 'unreadable', unreadable: true });
      return;
    }
    if (rel && entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) found.push({ name: rel, dir });
    for (const entry of entries.sort((left, right) => byText(left.name, right.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(dir, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, next);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      let real;
      try {
        real = realpathSync(absolute);
      } catch {
        skipped.push({ path: next, reason: 'broken link' });
        continue;
      }
      try {
        if (!statSync(real).isDirectory()) continue;
        if (existsSync(path.join(real, 'SKILL.md'))) found.push({ name: next, dir: real, link: readlinkSync(absolute) });
        else skipped.push({ path: next, reason: 'linked folder without SKILL.md, not followed' });
      } catch(e) { skipped.push({path:next,reason:e.code ?? 'unreadable',unreadable:true}); }
    }
    try {
      const after = statSync(dir), again = readdirSync(dir).sort(byText);
      if (!stableStat(before,after) || JSON.stringify(entries.map(e=>e.name).sort(byText))!==JSON.stringify(again)) skipped.push({path:rel || '.',reason:'discovery-changed',unreadable:true});
    } catch(e) { skipped.push({path:rel || '.',reason:e.code ?? 'unreadable',unreadable:true}); }
  };
  walk(root, '');
  return { found, skipped };
}

export function inventory(workspace) {
  const roots = {};
  const byName = new Map();
  for (const root of ROOTS) {
    const absolute = path.join(workspace, ...root.split('/'));
    try { lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') continue;
      roots[root] = { path: absolute, skills: 0, skipped: [{ path: '.', reason: error.code ?? 'unreadable', unreadable: true }] };
      continue;
    }
    const { found, skipped } = findSkills(absolute);
    roots[root] = { path: absolute, skills: found.length, skipped };
    for (const item of found) {
      const files = folderFiles(item.dir);
      const copy = { root, installed: `${root}/${item.name}`, ...(item.link ? { link: item.link } : {}), files, folderSha256: folderSha256(files) };
      if (!byName.has(item.name)) byName.set(item.name, {});
      byName.get(item.name)[root] = copy;
    }
  }
  const names = [...byName.keys()].sort(byText);
  const withCopies = names.filter((name) => Object.keys(byName.get(name)).length > 1);
  const differ = withCopies.filter((name) => new Set(Object.values(byName.get(name)).map((copy) => copy.folderSha256)).size > 1);
  const only = Object.fromEntries(ROOTS.map((root) => [root, names.filter((name) => Object.keys(byName.get(name)).length === 1 && byName.get(name)[root])]));
  const skillFiles = names.reduce((total, name) => total + Object.keys(byName.get(name)).length, 0);
  return {
    roots,
    byName,
    names,
    differ,
    only,
    counts: { skillFiles, names: names.length, namesWithCopies: withCopies.length, copiesThatDiffer: differ.length, onlyClaude: only['.claude/skills'].length, onlyAgents: only['.agents/skills'].length },
  };
}

// Snapshot observation is a cooperative-writer check, not an atomic or hostile-writer proof.
const statKey = s => [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs];
const stableStat = (a,b) => JSON.stringify(statKey(a)) === JSON.stringify(statKey(b));
const control = value => /[\x00-\x1f\x7f]/.test(value);
function observedFile(file) {
  // Windows has no O_NOFOLLOW (the constant is undefined there). The file was just read with lstat and must be a regular
  // file, and fstat of the opened file must match that lstat (same device, inode, mode, size and times), so a link put in
  // its place between the two calls is still refused.
  const before = lstatSync(file);
  if (!before.isFile()) throw new Error('expected regular file');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const start = fstatSync(fd); if (!stableStat(before,start)) throw new Error('file changed before read');
    const bytes = readFileSync(fd), end = fstatSync(fd), after = lstatSync(file);
    if (!stableStat(start,end) || !stableStat(end,after) || bytes.length !== start.size) throw new Error('file changed during read');
    return { size: bytes.length, sha256: sha256(bytes), mode: start.mode & 0o111 };
  } finally { closeSync(fd); }
}
function observedSkill(workspace, root, name) {
  const target = path.join(workspace,root,name), initial = lstatSync(target);
  const rootLink = initial.isSymbolicLink() ? readlinkSync(target) : null;
  if (rootLink !== null && control(rootLink)) throw new Error('control character in root link');
  const real = realpathSync(target), actual = statSync(real);
  if (!actual.isDirectory()) throw new Error('skill root is not a directory');
  const manifest = [], metadata = [];
  const walk = (dir,prefix) => {
    const before = lstatSync(dir); if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('directory replaced');
    const names = readdirSync(dir).sort(byText);
    metadata.push([prefix,statKey(before)]);
    for (const n of names) {
      const rel = prefix ? `${prefix}/${n}` : n, file = path.join(dir,n);
      if (control(rel)) throw new Error('control character in path');
      const st = lstatSync(file);
      if (st.isSymbolicLink()) {
        const target = readlinkSync(file); if (control(target)) throw new Error('control character in link');
        let resolved; try { resolved = realpathSync(file); } catch { resolved = path.resolve(dir,target); }
        const relative = path.relative(real,resolved), outside = relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative));
        if (!stableStat(st,lstatSync(file)) || readlinkSync(file)!==target) throw new Error('link changed');
        manifest.push({path:rel,kind:'symlink',target,outside});metadata.push([rel,statKey(st)]);
      } else if (st.isDirectory()) {
        if (n === '.git' || n === 'node_modules') { manifest.push({path:rel,kind:'skipped-folder'});metadata.push([rel,statKey(st)]); }
        else walk(file,rel);
      } else if (st.isFile()) {
        const seen = observedFile(file);manifest.push({path:rel,kind:'file',size:seen.size,sha256:seen.sha256});metadata.push([rel,statKey(st),seen.mode]);
      } else { manifest.push({path:rel,kind:'other'});metadata.push([rel,statKey(st)]); }
    }
    if (JSON.stringify(names)!==JSON.stringify(readdirSync(dir).sort(byText)) || !stableStat(before,lstatSync(dir))) throw new Error('directory changed during read');
  };
  walk(real,'');
  if (!stableStat(initial,lstatSync(target)) || !stableStat(actual,statSync(real)) || realpathSync(target)!==real || (rootLink !== null && readlinkSync(target)!==rootLink)) throw new Error('skill root changed');
  manifest.sort((a,b)=>byText(a.path,b.path));metadata.sort((a,b)=>byText(a[0],b[0]));
  const scannerTarget = path.join(realpathSync(path.join(workspace,root)),name);
  return {target,scannerTarget,real,rootLink,manifest,metadata,rootStat:statKey(initial),realStat:statKey(actual)};
}
function observation(workspace,inv) {
  const roots = [], projections = [], mapPath = path.join(workspace,STATE,'adapters.json');
  try {
    for (const root of ROOTS) {
      const absolute = path.join(workspace,root); let st;
      try { st=lstatSync(absolute); } catch (e) { if(e.code==='ENOENT') { roots.push([root,'absent']);continue; } throw e; }
      const link=st.isSymbolicLink()?readlinkSync(absolute):null;
      if (control(root) || (link!==null && control(link))) throw new Error('control character in root');
      const resolved=realpathSync(absolute), resolvedStat=statSync(absolute);
      roots.push([root,statKey(st),link,resolved,inv.roots[root]?.skipped ?? [],statKey(resolvedStat)]);
      for(const name of inv.names) if(inv.byName.get(name)[root]) {
        if (control(name)) throw new Error('control character in skill path');
        const observed=observedSkill(workspace,root,name), old=inv.byName.get(name)[root];
        const legacy=observed.manifest.filter(e=>(e.kind==='file'||e.kind==='symlink') && !e.path.split('/').some(x=>x==='.git'||x==='node_modules')).map(e=>e.kind==='file'?{path:e.path,sha256:e.sha256}:{path:e.path,link:e.target});
        if (folderSha256(legacy)!==old.folderSha256) throw new Error('inventory changed before observation');
        projections.push({root,name,...observed});
      }
      if (!stableStat(st,lstatSync(absolute)) || !stableStat(resolvedStat,statSync(absolute)) || realpathSync(absolute)!==resolved) throw new Error('discovery root changed');
    }
    let config;try { const before=lstatSync(mapPath), data=observedFile(mapPath), after=lstatSync(mapPath); if(!stableStat(before,after)) throw new Error('adapter mapping changed'); config={...data,identity:statKey(before)}; } catch(e) { if(e.code==='ENOENT') config=null; else throw e; }
    return {roots,projections,config};
  } catch(e) { return {error:e.message}; }
}
function manifestValid(row, observed) {
  if (!observed || row.target!==observed.scannerTarget || (row.link ?? null)!==observed.rootLink || (row.linkedTo ?? null)!==(observed.rootLink===null?null:observed.real) || !Array.isArray(row.files)) return false;
  const rows=[];
  for (const f of row.files) {
    if (!f || typeof f.path!=='string' || !f.path || path.posix.isAbsolute(f.path) || f.path.split('/').some(x=>!x || x==='.' || x==='..') || control(f.path)) return false;
    const keys=Object.keys(f).sort().join(',');
    if (f.kind==='file' && keys==='kind,path,sha256,size' && Number.isSafeInteger(f.size) && f.size>=0 && /^[0-9a-f]{64}$/.test(f.sha256)) rows.push({path:f.path,kind:f.kind,size:f.size,sha256:f.sha256});
    else if (f.kind==='symlink' && keys==='kind,outside,path,target' && typeof f.target==='string' && !control(f.target) && typeof f.outside==='boolean') rows.push({path:f.path,kind:f.kind,target:f.target,outside:f.outside});
    else if (['other','skipped-folder'].includes(f.kind) && keys==='kind,path') rows.push({path:f.path,kind:f.kind});
    else return false;
  }
  if (new Set(rows.map(f=>f.path)).size!==rows.length) return false;
  const producerHash=sha256(rows.map(f=>`${f.path}\t${f.kind}\t${f.sha256??f.target??''}\n`).sort(byText).join(''));
  rows.sort((a,b)=>byText(a.path,b.path));
  return producerHash===row.folderHash && JSON.stringify(rows)===JSON.stringify(observed.manifest);
}

// ---------------------------------------------------------------------------------------------------------------
// The person's own files: the sources list and the lock. This edition reads them and never writes them.
// ---------------------------------------------------------------------------------------------------------------

function readJson(file, label, key) {
  if (!existsSync(file)) return null;
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new UsageError(`${label} is not valid JSON: ${file}`);
  }
  if (!document || !Array.isArray(document[key]) || document[key].some((row) => !row || typeof row.name !== 'string' || !row.name)) {
    throw new UsageError(`${label} needs a "${key}" list whose rows each have a "name": ${file}`);
  }
  return document;
}

function changedFiles(lockFiles = [], files = []) {
  const before = new Map(lockFiles.map((file) => [file.path, fileKey(file)]));
  const after = new Map(files.map((file) => [file.path, fileKey(file)]));
  const changed = [];
  for (const [file, hash] of after) if (before.get(file) !== hash) changed.push(before.has(file) ? `${file} (changed)` : `${file} (new)`);
  for (const file of before.keys()) if (!after.has(file)) changed.push(`${file} (removed)`);
  return changed.sort(byText);
}

const item = (section, kind, name, text, extra = {}) => ({ section, kind, name, text, ...extra });

function adapterItems(workspace, inv, adapters) {
  const items = [];
  for (const row of adapters) {
    const copies = inv.byName.get(row.name) ?? {};
    const owner = copies['.claude/skills'];
    const adapter = copies['.agents/skills'];
    if (!owner) items.push(item('review', 'adapter-owner-missing', row.name, `Mapped owner ${row.owner} is missing.`));
    if (!adapter) { items.push(item('review', 'adapter-missing', row.name, `Mapped adapter ${row.adapter} is missing.`)); continue; }
    let entries;
    try { entries = readdirSync(path.join(workspace, path.dirname(row.adapter))); } catch { entries = ['(unreadable)']; }
    const extra = entries.filter((name) => name !== 'SKILL.md');
    if (extra.length) items.push(item('review', 'adapter-extra-file', row.name, `Adapter has extra files: ${extra.join(', ')}.`));
    const relativeOwner = path.relative(path.dirname(path.join(workspace, row.adapter)), path.join(workspace, row.owner)).split(path.sep).join('/');
    let body = '';
    try { body = readFileSync(path.join(workspace, row.adapter), 'utf8'); } catch {}
    const required = `Read and follow the canonical owner at [${relativeOwner}](${relativeOwner}), resolving the link from this installed skill folder. Resolve the owner's relative paths from the owner folder. Preserve its scope, data, authorization and publication boundaries and applicable workspace instructions. If a required capability is unavailable, report it; do not invent an equivalent or infer authorization.`;
    const lines = body.split(/\r?\n/);
    const approvedExtra = [''];
    const trailing = lines.slice(8);
    const recognized = JSON.stringify(trailing) === JSON.stringify(approvedExtra) && lines[0] === '---' && lines[1] === `name: ${row.name}` && lines[2] === `description: ${row.description}` && lines[3] === '---' && lines[4] === '' && lines[5] === `# ${row.name}` && lines[6] === '' && lines[7] === required;
    if (!recognized) items.push(item('review', 'adapter-misdirected', row.name, `Adapter does not link to mapped owner ${row.owner}.`));
  }
  return items;
}

function readAdapters(workspace) {
  const doc = readJson(path.join(workspace, STATE, ADAPTERS), `${STATE}/${ADAPTERS}`, 'adapters');
  if (doc && (Object.keys(doc).length !== 1 || !Array.isArray(doc.adapters))) throw new UsageError('Invalid adapter mapping structure');
  const rows = doc?.adapters ?? [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'adapter,description,name,owner') throw new UsageError('Invalid adapter mapping structure');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(row.name) || typeof row.description !== 'string' || !row.description || /[\r\n]/.test(row.description) || seen.has(row.name) || row.owner !== `.claude/skills/${row.name}/SKILL.md` || row.adapter !== `.agents/skills/${row.name}/SKILL.md`) throw new UsageError('Invalid or duplicate adapter mapping');
    seen.add(row.name);
  }
  return rows;
}

function copyItems(inv, adapters, workspaceForCopyItems) {
  const invalid = new Set(adapterItems(workspaceForCopyItems, inv, adapters).filter(x => ['adapter-misdirected','adapter-owner-missing','adapter-missing','adapter-extra-file'].includes(x.kind)).map(x => x.name));
  const mapped = new Set(adapters.filter(row => !invalid.has(row.name)).map(row => row.name));
  return inv.differ.filter(name => !mapped.has(name)).map((name) => {
    const copies = Object.values(inv.byName.get(name));
    const [first, second] = copies;
    return item('review', 'copies-differ', name, `The copies in ${copies.map((copy) => copy.root).join(' and ')} differ: ${changedFiles(first.files, second.files).slice(0, 20).join(', ')}.`);
  });
}

function lockItems(inv, lock, adapters) {
  if (!lock) return [item('left', 'no-lock', null, `No lock file yet (${STATE}/${LOCK}). After reading this report, save the proposed lock as your baseline; the next run then reports every change against it.`)];
  const items = [];
  const locked = new Map(lock.skills.map((entry) => [entry.name, entry]));
  for (const name of inv.names) {
    const entry = locked.get(name);
    if (!entry) {
      items.push(item('left', 'not-in-lock', name, 'Installed, but not in the lock.'));
      continue;
    }
    const mapping = adapters.find(row => row.name === name);
    for (const copy of Object.values(inv.byName.get(name))) {
      const baseline = entry.projections?.find(projection => projection.root === copy.root) ?? (!mapping ? entry : null);
      if (!baseline) { items.push(item('left', 'projection-unbaselined', name, `${copy.installed} has no projection baseline.`)); continue; }
      if (copy.folderSha256 === baseline.folderSha256) continue;
      const files = changedFiles(baseline.files, copy.files);
      const kind = mapping ? (copy.root === '.claude/skills' ? 'owner-changed' : 'adapter-changed') : 'edited-here';
      items.push(item('left', kind, name, `${copy.installed} differs from the lock${files.length > 0 ? `: ${files.slice(0, 20).join(', ')}` : ''}. Reported only; nothing is undone.`, { installed: copy.installed, files }));
    }
  }
  for (const entry of lock.skills) {
    if (!inv.byName.has(entry.name)) items.push(item('left', 'missing', entry.name, `In the lock, but in neither ${ROOTS.join(' nor ')}.`));
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 3: the security check, with its best-practices pass, over each skills folder (check.mjs --all).
// ---------------------------------------------------------------------------------------------------------------

function checkScript(options, workspace) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = options.securityCheck
    ? [path.resolve(options.securityCheck)]
    : [path.join(here, '..', 'security-check', 'check.mjs'), ...ROOTS.map((root) => path.join(workspace, ...root.split('/'), 'security-check', 'check.mjs'))];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function runCheck(script, root, reportDir, expected, discovery, observed) {
  const result = spawnSync(process.execPath, [script, '--all', root, '--report-dir', reportDir, '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (result.error) return { error: result.error.message };
  let report;
  try { report = JSON.parse(result.stdout); } catch { return { error: 'the security check printed invalid JSON', block: result.status === 4, flag: result.status === 3 }; }
  const statuses = { PASS: 0, FLAG: 3, BLOCK: 4 }, rank = { PASS: 0, FLAG: 1, BLOCK: 2 };
  const rows = Array.isArray(report?.skills) ? report.skills : [];
  const known = x => Object.hasOwn(statuses, x);
  const count = x => Number.isSafeInteger(x) && x >= 0;
  const exactCounts = (object, expectedCounts) => object && typeof object === 'object' && !Array.isArray(object) && JSON.stringify(Object.keys(object).sort()) === JSON.stringify(Object.keys(expectedCounts).sort()) && Object.entries(expectedCounts).every(([k,v]) => count(object[k]) && object[k] === v);
  const severity = row => Math.max(known(row?.verdict) ? rank[row.verdict] : 0, ...(Array.isArray(row?.findings) ? row.findings.map(f => known(f?.verdict) ? rank[f.verdict] : 0) : [0]));
  const safeRows = rows.filter(row => row && typeof row.path === 'string').map(row => ({ ...row, verdict: ['PASS','FLAG','BLOCK'][severity(row)], findings: Array.isArray(row.findings) ? row.findings.filter(f => f && known(f.verdict) && typeof f.rule === 'string') : [], bestPractices: { verdict: row.bestPractices?.verdict === 'FLAG' || (Array.isArray(row.bestPractices?.findings) && row.bestPractices.findings.length) ? 'FLAG' : 'PASS', findings: Array.isArray(row.bestPractices?.findings) ? row.bestPractices.findings.filter(f => f && typeof f.rule === 'string') : [] } }));
  const rules = new Map(), total = { PASS: 0, FLAG: 0, BLOCK: 0 }, practice = { PASS: 0, FLAG: 0 };
  const validRows = rows.every(row => {
    if (!row || row.tool !== 'security-check' || row.schema !== 1 || typeof row.path !== 'string' || !known(row.verdict) || row.exitCode !== statuses[row.verdict] || !Array.isArray(row.findings) || !row.findings.every(f => f && ['FLAG','BLOCK'].includes(f.verdict) && typeof f.rule === 'string' && f.rule)) return false;
    const c = { BLOCK: 0, FLAG: 0 }; for (const f of row.findings) c[f.verdict]++;
    if (!exactCounts(row.counts,c) || rank[row.verdict] !== Math.max(0,...row.findings.map(f => rank[f.verdict]))) return false;
    const bp = row.bestPractices;
    if (!bp || !['PASS','FLAG'].includes(bp.verdict) || !Array.isArray(bp.findings) || !bp.findings.every(f => f && typeof f.rule === 'string' && f.rule) || bp.verdict !== (bp.findings.length ? 'FLAG' : 'PASS')) return false;
    total[row.verdict]++; practice[bp.verdict]++;
    for (const f of bp.findings) rules.set(f.rule, (rules.get(f.rule) ?? 0) + 1);
    return true;
  });
  const names = rows.map(row => row?.path).sort(byText), worst = total.BLOCK ? 'BLOCK' : total.FLAG ? 'FLAG' : 'PASS';
  const skipped = report?.skipped, validSkip = x => x && typeof x.path === 'string' && ['broken link','linked folder without SKILL.md, not followed'].includes(x.reason) && Object.keys(x).sort().join(',') === 'path,reason';
  const noteKeys = list => list.map(x => JSON.stringify([x.path,x.reason])).sort(byText);
  const expectedNotes = discovery.filter(x => !x.unreadable);
  const validSkips = Array.isArray(skipped) && skipped.every(validSkip) && new Set(noteKeys(skipped)).size === skipped.length && JSON.stringify(noteKeys(skipped)) === JSON.stringify(noteKeys(expectedNotes));
  const bp = report?.bestPractices, byRule = Object.fromEntries(rules);
  const practiceOk = bp && typeof bp === 'object' && !Array.isArray(bp) && JSON.stringify(Object.keys(bp).sort()) === JSON.stringify(['FLAG','PASS','byRule'].sort()) && count(bp.PASS) && count(bp.FLAG) && bp.PASS === practice.PASS && bp.FLAG === practice.FLAG && exactCounts(bp.byRule,byRule);
  const manifestsOk = rows.every(row => manifestValid(row, observed.find(x => x.name === row.path)));
  const consistent = manifestsOk && report?.tool === 'security-check' && report.schema === 1 && report.mode === 'all' && report.root === root && known(report.verdict) && result.status === statuses[report.verdict] && report.exitCode === result.status && validRows && new Set(names).size === names.length && JSON.stringify(names) === JSON.stringify([...expected].sort(byText)) && report.verdict === worst && exactCounts(report.counts,total) && practiceOk && validSkips && !discovery.some(x => x.unreadable);
  if (!consistent) return { report: { ...report, skills: safeRows }, error: 'security report or discovery is incomplete or inconsistent', block: result.status === 4 || report?.verdict === 'BLOCK' || rows.some(row => severity(row) === 2), flag: result.status === 3 || report?.verdict === 'FLAG' || rows.some(row => severity(row) === 1) };
  return { report };
}

const RANK = { PASS: 0, FLAG: 1, BLOCK: 2 };

function securityStep(options, workspace, inv, reportDir, snapshot) {
  const items = [];
  const perName = new Map();
  const runs = [];
  const script = checkScript(options, workspace);
  if (!script) {
    items.push(item('waiting', 'check-missing', null, 'The security-check skill was not found beside skill-sync or in the workspace skills folders, so no skill was checked. Install it, or name its check.mjs with --security-check.'));
    return { items, perName, runs, script: null };
  }
  for (const [root, info] of Object.entries(inv.roots)) {
    if (info.skills === 0) {
      if (info.skipped.some(x => x.unreadable)) { const error = 'unreadable discovery with no skills'; items.push(item('waiting', 'check-failed', null, `${root}: ${error}`)); runs.push({root, error}); }
      continue;
    }
    const expected = inv.names.filter(name => inv.byName.get(name)[root]);
    const { report, error, block, flag } = runCheck(script, info.path, path.join(reportDir, 'security-check'), expected, info.skipped, snapshot.projections?.filter(x=>x.root===root) ?? []);
    if (error) {
      items.push(item('waiting', 'check-failed', null, `The security check did not finish on ${root}: ${error}`));
      runs.push({ root, error });
      if (block) items.push(item('waiting', 'security-block', null, `Security check reported BLOCK for ${root} but its report was inconsistent.`));
      if (flag) items.push(item('review', 'security-flag', null, `Security check reported FLAG for ${root} but its report was inconsistent.`));
      if (!report) continue;
    }
    if (!error) runs.push({ root, verdict: report.verdict, counts: report.counts, report: report.reportFiles?.json ?? null });
    for (const skill of report.skills) {
      const current = perName.get(skill.path) ?? { security: 'PASS', bestPractices: 'PASS', rules: Object.create(null), practiceRules: Object.create(null), reports: new Set() };
      if (RANK[skill.verdict] > RANK[current.security]) current.security = skill.verdict;
      if (skill.bestPractices.verdict === 'FLAG') current.bestPractices = 'FLAG';
      for (const finding of skill.findings) current.rules[`${finding.verdict} ${finding.rule}`] = (current.rules[`${finding.verdict} ${finding.rule}`] ?? 0) + 1;
      for (const finding of skill.bestPractices.findings) current.practiceRules[finding.rule] = (current.practiceRules[finding.rule] ?? 0) + 1;
      if (report.reportFiles?.html) current.reports.add(report.reportFiles.html);
      perName.set(skill.path, current);
    }
  }
  for (const [name, result] of [...perName].sort(([left], [right]) => byText(left, right))) {
    const rules = Object.entries(result.rules).map(([rule, count]) => `${rule} x${count}`).join(', ');
    if (result.security === 'BLOCK') items.push(item('waiting', 'security-block', name, `Security check BLOCK (${rules}). A BLOCK is final: read the report and fix the files, or remove the skill.`));
    else if (result.security === 'FLAG') items.push(item('review', 'security-flag', name, `Security check FLAG (${rules}). Read each hit in the report and decide it.`));
  }
  return { items, perName, runs, script };
}

// ---------------------------------------------------------------------------------------------------------------
// Step 2 (upstream): the newest commit id of each approved outside source, read-only, after the list is written.
// ---------------------------------------------------------------------------------------------------------------

function planUpstream(sources, lock) {
  const locked = new Map((lock?.skills ?? []).map((entry) => [entry.name, entry]));
  const items = [];
  const calls = [];
  for (const row of sources?.sources ?? []) {
    const entry = locked.get(row.name);
    if (row.kind === 'local' || entry?.kind === 'local') {
      items.push(item('left', 'local-refused', row.name, 'A local skill is never looked up outside. Remove its row from the sources list.'));
      continue;
    }
    if (typeof row.address !== 'string' || !ADDRESS.test(row.address) || row.address.startsWith('-')) {
      items.push(item('left', 'address-refused', row.name, 'Only an https:// or file:// address is looked up; this row was not contacted.'));
      continue;
    }
    const ref = row.ref ?? 'HEAD';
    if (typeof ref !== 'string' || !REF.test(ref) || ref.includes('..')) {
      items.push(item('left', 'address-refused', row.name, 'The branch or tag name is not a plain name; this row was not contacted.'));
      continue;
    }
    if (typeof row.approved !== 'string' || !row.approved.trim()) {
      items.push(item('left', 'not-approved', row.name, 'The row has no "approved" date, so it was not contacted. Add the date of your yes to look it up.'));
      continue;
    }
    calls.push({ name: row.name, address: row.address, ref, pinned: entry?.commit ?? null });
  }
  return { items, calls };
}

function newestCommit(address, ref) {
  const result = spawnSync('git', ['-c', 'credential.helper=', 'ls-remote', '--', address, ref], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https:file', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never' },
  });
  if (result.error) return { error: result.error.code === 'ETIMEDOUT' ? `no answer within ${TIMEOUT_MS / 1000} s` : result.error.code === 'ENOENT' ? 'git is not installed' : result.error.message };
  if (result.status !== 0) return { error: firstLine(result.stderr) || `git ended with exit ${result.status}` };
  const refs = new Map();
  for (const line of result.stdout.split('\n')) {
    const [commit, name] = line.split('\t');
    if (COMMIT.test(commit ?? '') && name) refs.set(name, commit);
  }
  const order = ref === 'HEAD' ? ['HEAD'] : ref.startsWith('refs/') ? [`${ref}^{}`, ref] : [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`];
  for (const key of order) if (refs.has(key)) return { commit: refs.get(key), ref: key.replace(/\^\{\}$/, '') };
  return { error: `no branch or tag named ${ref} at this address` };
}

function upstreamStep(plan, offline, addressFile, date) {
  const lines = [
    `# skill-sync ${date}: the addresses this run ${offline ? 'would contact; none was contacted (--offline)' : 'contacts, read-only, for the newest commit id only'}.`,
    ...plan.calls.map((call) => `${call.name}\t${call.address}\t${call.ref}`),
  ];
  writeFileSync(addressFile, `${lines.join('\n')}\n`);
  const items = [];
  const results = [];
  if (offline) return { items, results: plan.calls.map((call) => ({ ...call, contacted: false })) };
  const cache = new Map();
  for (const call of plan.calls) {
    const key = `${call.address}\0${call.ref}`;
    if (!cache.has(key)) cache.set(key, newestCommit(call.address, call.ref));
    const answer = cache.get(key);
    results.push({ ...call, contacted: true, ...answer });
    if (answer.error) items.push(item('waiting', 'upstream-error', call.name, `Could not read the newest commit (${answer.error}). Not retried; the next run tries again.`));
    else if (!call.pinned) items.push(item('left', 'no-pin', call.name, `Newest commit ${answer.commit.slice(0, 12)} on ${answer.ref}. The lock has no pinned commit: write the commit you installed into the lock.`, { newest: answer.commit }));
    else if (call.pinned !== answer.commit) items.push(item('review', 'newer-upstream', call.name, `A newer commit exists: pinned ${call.pinned.slice(0, 12)}, newest ${answer.commit.slice(0, 12)} on ${answer.ref}. It may not touch this skill. Update by hand only after the security check passes on the new version.`, { pinned: call.pinned, newest: answer.commit }));
  }
  return { items, results };
}

// ---------------------------------------------------------------------------------------------------------------
// The proposed lock: today's state, for the person to save as the baseline. This script never writes the lock.
// ---------------------------------------------------------------------------------------------------------------

function proposedLock(workspace, inv, lock, sources, security, date) {
  const locked = new Map((lock?.skills ?? []).map((entry) => [entry.name, entry]));
  const rows = new Map((sources?.sources ?? []).map((row) => [row.name, row]));
  const skills = inv.names.map((name) => {
    const copies = inv.byName.get(name);
    const main = copies['.claude/skills'] ?? copies['.agents/skills'];
    const entry = locked.get(name);
    const row = rows.get(name);
    const kind = KINDS.has(entry?.kind) ? entry.kind : row && row.kind !== 'local' && typeof row.address === 'string' ? 'external' : 'local';
    const result = security.perName.get(name);
    return {
      workspace: path.basename(workspace),
      name,
      kind,
      source: kind === 'local' ? null : entry?.source ?? row?.address ?? null,
      commit: entry?.commit ?? null,
      path: entry?.path ?? row?.path ?? null,
      installed: Object.values(copies).map((copy) => copy.installed),
      projections: Object.values(copies).map(({root, files, folderSha256}) => ({root, files, folderSha256})),
      files: main.files,
      folderSha256: main.folderSha256,
      check: result ? { security: result.security, bestPractices: result.bestPractices, report: [...result.reports][0] ?? null, date } : null,
      approved: entry?.approved ?? null,
    };
  });
  return { schemaVersion: 1, workspace: path.basename(workspace), proposed: date, skills };
}

// ---------------------------------------------------------------------------------------------------------------
// Report page: offline, no outside files, every value escaped. Sections: Need your review, Left for you, Waiting, Done.
// ---------------------------------------------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

const CSS = `:root{--bg:#ffffff;--fg:#1d1f23;--muted:#5d636b;--line:#d9dce1;--card:#f5f6f8;--code:#eceef1;--block:#b3261e;--flag:#8a5a00;--pass:#1e7d32}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e8eaed;--muted:#a3a8af;--line:#33373d;--card:#1d2024;--code:#262a30;--block:#f28b82;--flag:#fdd663;--pass:#81c995}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#e8eaed;--muted:#a3a8af;--line:#33373d;--card:#1d2024;--code:#262a30;--block:#f28b82;--flag:#fdd663;--pass:#81c995}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:.2rem 0 .6rem}h2{font-size:1.1rem;margin:1.6rem 0 .5rem}
.meta{color:var(--muted);font-size:.9rem;word-break:break-all}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:.6rem 0}
.badge{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:2px 12px;font-weight:600}
.BLOCK{color:var(--block)}.FLAG{color:var(--flag)}.PASS{color:var(--pass)}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--line)}th{background:var(--card)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--code);border-radius:4px;padding:1px 4px;word-break:break-all}
button{font:inherit;font-size:.8rem;padding:2px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer;white-space:nowrap}
.empty{color:var(--muted)}`;

const COPY_SCRIPT = "document.addEventListener('click',function(e){var b=e.target.closest('button[data-copy]');if(!b)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)})});";
const copyButton = (text) => `<button type="button" data-copy="${escapeHtml(text)}">Copy</button>`;

function table(headers, rows, empty) {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<div class="wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>\n${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}\n</tbody></table></div>`;
}

const itemRows = (items) => items.map((entry) => [entry.name ? `<code>${escapeHtml(entry.name)}</code>` : '', `<code>${escapeHtml(entry.kind)}</code>`, escapeHtml(entry.text)]);

export function renderReport(report) {
  const { counts, sections } = report;
  const addresses = table(['Skill', 'Address', 'Branch or tag', 'Newest commit'], report.upstream.map((call) => [
    `<code>${escapeHtml(call.name)}</code>`, `<code>${escapeHtml(call.address)}</code>`, `<code>${escapeHtml(call.ref)}</code>`,
    call.contacted ? (call.error ? `<span class="FLAG">${escapeHtml(call.error)}</span>` : `<code>${escapeHtml(call.commit)}</code>`) : 'not contacted',
  ]), report.offline ? 'Offline run: no address was contacted.' : 'No approved outside source in the sources list: no address was contacted.');
  const inventoryRows = report.inventory.skills.map((skill) => [
    `<code>${escapeHtml(skill.name)}</code>`, escapeHtml(skill.installed.join(', ')), skill.copiesDiffer ? '<span class="FLAG">differ</span>' : skill.installed.length > 1 ? 'same' : 'one copy',
    skill.security ? `<span class="${skill.security}">${skill.security}</span>` : '', skill.bestPractices ? `<span class="${skill.bestPractices}">${skill.bestPractices}</span>` : '',
  ]);
  const practiceRows = report.bestPractices.filter((entry) => entry.verdict === 'FLAG').map((entry) => [`<code>${escapeHtml(entry.name)}</code>`, escapeHtml(Object.entries(entry.rules).map(([rule, count]) => `${rule} x${count}`).join(', '))]);
  const inv = report.inventory.counts;
  const lockCommand = report.reportFiles.lock ? `mkdir -p "${path.join(report.workspace, STATE)}" && cp "${report.reportFiles.lock}" "${path.join(report.workspace, STATE, LOCK)}"` : null;
  const body = `<h1>Skill sync: ${escapeHtml(path.basename(report.workspace))}</h1>
<p class="meta">Workspace: <code>${escapeHtml(report.workspace)}</code><br>Date: ${report.date}. Edition: Second Brain Starter, report only: nothing was fetched, installed or changed.</p>
<div class="badges"><span class="badge">Need your review ${counts.review}</span><span class="badge">Left for you ${counts.left}</span><span class="badge">Waiting ${counts.waiting}</span><span class="badge PASS">Done ${counts.done}</span></div>
<h2>Addresses ${report.offline ? 'not contacted (offline)' : 'contacted'}</h2>
<p class="meta">Written to <code>${escapeHtml(report.reportFiles.addresses)}</code> before the first call. Read-only: the newest commit id, no download, no token.</p>
${addresses}
<h2>Need your review (${counts.review})</h2>
${table(['Skill', 'What', 'Detail'], itemRows(sections.review), 'Nothing.')}
<h2>Left for you (${counts.left})</h2>
${table(['Skill', 'What', 'Detail'], itemRows(sections.left), 'Nothing.')}
<h2>Waiting (${counts.waiting})</h2>
${table(['Skill', 'What', 'Detail'], itemRows(sections.waiting), 'Nothing.')}
<h2>Done (${counts.done})</h2>
<p>${sections.done.length > 0 ? sections.done.map((name) => `<code>${escapeHtml(name)}</code>`).join(' ') : '<span class="empty">None.</span>'}</p>
<h2>Inventory</h2>
<p class="meta">${inv.skillFiles} skill files, ${inv.names} names, ${inv.namesWithCopies} names with a copy in both folders, ${inv.copiesThatDiffer} whose copies differ, ${inv.onlyClaude} only in .claude/skills, ${inv.onlyAgents} only in .agents/skills.</p>
${table(['Skill', 'Installed in', 'Copies', 'Security', 'Best practices'], inventoryRows, 'No skill found.')}
<p>The proposed lock is tied to observed scanned content in a cooperative workspace. Later changes, transient changes that are restored, and hostile writers are outside this check. A named security checker is trusted code, not an attested sandbox.</p>
<h2>Best practices (never blocks)</h2>
${table(['Skill', 'Rules'], practiceRows, 'Every checked skill follows the best-practice rules.')}
<h2>Your baseline</h2>
${lockCommand ? `<p>The proposed lock holds today's state: <code>${escapeHtml(report.reportFiles.lock)}</code>. This script never writes your lock. To make today's state your baseline, after reading this report, copy it yourself: <code>${escapeHtml(lockCommand)}</code> ${copyButton(lockCommand)}</p>` : `<p>No proposed lock is available because an observation, mapping or security check did not meet the baseline requirements.</p>`}`;
  const scriptHash = createHash('sha256').update(COPY_SCRIPT).digest('base64');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'">
<title>Skill sync ${escapeHtml(report.date)}</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
</main><script>${COPY_SCRIPT}</script></body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// The weekly schedule, Monday 09:00 in the system's own time zone. Never installed. The text lives in
// assets/schedule.txt, where the security check reads it like any other file; this script prints the three paths
// to put in it, then the section for one system unchanged.
// ---------------------------------------------------------------------------------------------------------------

export const SCHEDULE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'schedule.txt');

export function platformName(platform = process.platform) {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux';
}

// A line [macos], [linux] or [windows] starts a section. Its lines are kept as they are; the blank lines at its end
// are left out.
export function scheduleSections(text) {
  const sections = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\[([a-z]+)\]$/);
    if (marker) {
      current = [];
      sections[marker[1]] = current;
    } else if (current) current.push(line);
  }
  for (const [name, lines] of Object.entries(sections)) {
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    sections[name] = lines.join('\n');
  }
  return sections;
}

export function scheduleText(osName, { node, script, workspace }, file = SCHEDULE_FILE) {
  const section = scheduleSections(readFileSync(file, 'utf8'))[osName];
  if (!section) throw new UsageError(`${file} has no [${osName}] section`);
  return [
    'Your three paths, to put in place of the names in capitals below:',
    `NODE_PATH = ${node}`,
    `SCRIPT_PATH = ${script}`,
    `WORKSPACE_PATH = ${workspace}`,
    '',
    section,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Command line.
// ---------------------------------------------------------------------------------------------------------------

const USAGE = `Usage:
  node sync.mjs --workspace <dir> [--offline] [--report-dir <dir>] [--json]
  node sync.mjs --print-schedule [--os macos|linux|windows] [--workspace <dir>]

Reports on every skill in <dir>/.claude/skills and <dir>/.agents/skills: copies compared by hash,
the lock file compared, the security check with its best-practices pass, and the newest commit of
each approved outside source in ${STATE}/${SOURCES} (none with --offline). This open-source edition
reports only: it never fetches, installs or updates a skill, and never writes the lock.

Reports: ${STATE}/reports/ in the workspace, refused when git would track it; --report-dir overrides.
Exit codes: 0 nothing for you, 3 something needs you, 4 the security check found a BLOCK, 2 usage or read error.`;

export function parseArguments(argv) {
  const options = { workspace: null, offline: false, reportDir: null, json: false, printSchedule: false, os: null, securityCheck: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--workspace') options.workspace = value();
    else if (argument === '--offline') options.offline = true;
    else if (argument === '--report-dir') options.reportDir = value();
    else if (argument === '--json') options.json = true;
    else if (argument === '--print-schedule') options.printSchedule = true;
    else if (argument === '--os') options.os = value();
    else if (argument === '--security-check') options.securityCheck = value();
    else if (argument === '--fetch' || argument === '--update') throw new UsageError(`${argument} is not part of the open-source edition, which reports only. Update a skill by hand, after the security check passes on the new version.`);
    else throw new UsageError(`unknown option ${argument}`);
  }
  if (options.help) return options;
  if (options.os !== null && !['macos', 'linux', 'windows'].includes(options.os)) throw new UsageError('--os is macos, linux or windows');
  if (!options.printSchedule && !options.workspace) throw new UsageError('name the workspace with --workspace <dir>');
  return options;
}

// The nearest folder at or above the path that holds a .git folder or file.
function gitWorkTree(start) {
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function ignoredByGit(tree, folder) {
  const relative = `${path.relative(tree, folder).split(path.sep).join('/')}/`;
  const result = spawnSync('git', ['-C', tree, 'check-ignore', '-q', '--no-index', '--', relative], { encoding: 'utf8', timeout: TIMEOUT_MS });
  return result.status === 0;
}

function reportFolder(options, cwd, workspace) {
  const folder = options.reportDir ? path.resolve(cwd, options.reportDir) : path.join(workspace, STATE, 'reports');
  for (const root of ROOTS) {
    if (inside(path.join(workspace, ...root.split('/')), folder)) throw new UsageError(`the report folder is inside ${root}; pass --report-dir <folder outside it>`);
  }
  if (!options.reportDir) {
    const tree = gitWorkTree(folder);
    if (tree && !ignoredByGit(tree, folder)) throw new UsageError(`the default report folder ${folder} is inside the git work tree ${tree}, and git does not ignore it. Add ${STATE}/reports/ to that .gitignore, or pass --report-dir <folder>`);
  }
  return folder;
}

export function run(options, cwd) {
  const given = path.resolve(cwd, options.workspace);
  if (!existsSync(given) || !statSync(given).isDirectory()) throw new UsageError(`no such workspace folder: ${given}`);
  const workspace = realpathSync(given);
  if (!ROOTS.some((root) => existsSync(path.join(workspace, ...root.split('/'))))) throw new UsageError(`${workspace} has neither ${ROOTS.join(' nor ')}`);
  const reportDir = reportFolder(options, cwd, workspace);
  const sources = readJson(path.join(workspace, STATE, SOURCES), `${STATE}/${SOURCES}`, 'sources');
  const lock = readJson(path.join(workspace, STATE, LOCK), `${STATE}/${LOCK}`, 'skills');
  const date = today();
  mkdirSync(reportDir, { recursive: true });

  const inv = inventory(workspace);
  const initialSnapshot = observation(workspace,inv);
  let adapters = [];
  let mappingError = null;
  try { adapters = readAdapters(workspace); } catch (error) { mappingError = item('review', 'adapter-mapping-invalid', null, `Adapter mapping rejected: ${error.message}. All differences remain visible.`); }
  const items = [...(mappingError ? [mappingError, item('waiting','check-failed',null,'Adapter mapping is invalid; baseline withheld.')] : []), ...copyItems(inv, adapters, workspace), ...adapterItems(workspace, inv, adapters), ...lockItems(inv, lock, adapters)];
  const security = securityStep(options, workspace, inv, reportDir, initialSnapshot);
  items.push(...security.items);
  const plan = planUpstream(sources, lock);
  items.push(...plan.items);
  const reportFiles = {
    addresses: path.join(reportDir, `skill-sync-${date}-addresses.txt`),
    html: path.join(reportDir, `skill-sync-${date}.html`),
    json: path.join(reportDir, `skill-sync-${date}.json`),
    lock: items.some(entry => ['security-block', 'check-failed', 'check-missing', 'adapter-misdirected', 'adapter-owner-missing', 'adapter-missing', 'adapter-extra-file'].includes(entry.kind)) ? null : path.join(reportDir, `skill-sync-${date}.lock.json`),
  };
  const upstream = upstreamStep(plan, options.offline, reportFiles.addresses, date);
  items.push(...upstream.items);

  const finalInventory = inventory(workspace);
  const finalSnapshot = observation(workspace,finalInventory);
  if (initialSnapshot.error || finalSnapshot.error || JSON.stringify(initialSnapshot)!==JSON.stringify(finalSnapshot)) items.push(item('waiting','snapshot-changed',null,`Scan observation is incomplete or changed: ${initialSnapshot.error ?? finalSnapshot.error ?? 'workspace changed'}.`));
  if (items.some(entry => entry.kind === 'snapshot-changed')) reportFiles.lock = null;
  const sections = { review: [], left: [], waiting: [], done: [] };
  for (const entry of items) sections[entry.section].push(entry);
  const named = new Set(items.map((entry) => entry.name).filter(Boolean));
  sections.done = inv.names.filter((name) => !named.has(name));
  const counts = { review: sections.review.length, left: sections.left.length, waiting: sections.waiting.length, done: sections.done.length };
  const exitCode = items.some((entry) => entry.kind === 'security-block') ? EXIT.BLOCK : counts.review + counts.left + counts.waiting > 0 ? EXIT.NEEDS_YOU : EXIT.NOTHING;

  const report = {
    snapshotBinding: { guarantee: 'Observed cooperative workspace; later, transient and hostile mutations remain outside this check.', projections: initialSnapshot.projections?.map(p => ({root:p.root,name:p.name,manifestSha256:sha256(JSON.stringify(p.manifest)), scanReport:security.runs.find(r=>r.root===p.root)?.report ?? null})) ?? [] },
    tool: 'skill-sync',
    schema: 1,
    edition: 'oss',
    workspace,
    date,
    offline: options.offline,
    exitCode,
    counts,
    upstream: upstream.results,
    sections,
    inventory: {
      counts: inv.counts,
      roots: inv.roots,
      onlyIn: inv.only,
      skills: inv.names.map((name) => {
        const copies = Object.values(inv.byName.get(name));
        const result = security.perName.get(name);
        return { name, installed: copies.map((copy) => copy.installed), folderSha256: copies.map((copy) => copy.folderSha256), copiesDiffer: inv.differ.includes(name), security: result?.security ?? null, bestPractices: result?.bestPractices ?? null };
      }),
    },
    securityCheck: { script: security.script, runs: security.runs },
    bestPractices: [...security.perName].map(([name, result]) => ({ name, verdict: result.bestPractices, rules: result.practiceRules })).sort((left, right) => byText(left.name, right.name)),
    reportFiles,
  };
  if (reportFiles.lock) writeFileSync(reportFiles.lock, `${JSON.stringify(proposedLock(workspace, inv, lock, sources, security, date), null, 2)}\n`);
  writeFileSync(reportFiles.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportFiles.html, renderReport(report));
  return report;
}

function summary(report) {
  const inv = report.inventory.counts;
  const runs = report.securityCheck.runs.map((entry) => (entry.error ? `${entry.root}: did not finish` : `${entry.root}: ${entry.verdict} (PASS ${entry.counts.PASS}, FLAG ${entry.counts.FLAG}, BLOCK ${entry.counts.BLOCK})`));
  const contacted = report.upstream.filter((call) => call.contacted).length;
  const lines = [
    `skill-sync ${report.date}: ${report.workspace}`,
    `Inventory: ${inv.skillFiles} skill files, ${inv.names} names, ${inv.namesWithCopies} with a copy in both folders, ${inv.copiesThatDiffer} whose copies differ, ${inv.onlyClaude} only in .claude/skills, ${inv.onlyAgents} only in .agents/skills`,
    `Security check: ${runs.join('; ') || 'not run'}; best practices FLAG on ${report.bestPractices.filter((entry) => entry.verdict === 'FLAG').length}`,
    `Upstream: ${report.offline ? 'offline, no address contacted' : `${contacted} of ${report.upstream.length} approved addresses contacted`}`,
    `Need your review ${report.counts.review}, Left for you ${report.counts.left}, Waiting ${report.counts.waiting}, Done ${report.counts.done}`,
  ];
  for (const section of ['review', 'left', 'waiting']) for (const entry of report.sections[section]) lines.push(`${section}\t${entry.kind}\t${entry.name ?? '-'}\t${entry.text}`);
  lines.push(`Report: ${report.reportFiles.html}`, `JSON: ${report.reportFiles.json}`, `Proposed lock: ${report.reportFiles.lock}`);
  return `${lines.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return EXIT.NOTHING;
    }
    if (options.printSchedule) {
      const workspace = path.resolve(cwd, options.workspace ?? '.');
      process.stdout.write(`${scheduleText(options.os ?? platformName(), { node: process.execPath, script: fileURLToPath(import.meta.url), workspace })}\n`);
      return EXIT.NOTHING;
    }
    const report = run(options, cwd);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : summary(report));
    return report.exitCode;
  } catch (error) {
    if (error instanceof UsageError || error?.code) {
      process.stderr.write(`skill-sync: ${error.message}\n${error instanceof UsageError ? `\n${USAGE}\n` : ''}`);
      return EXIT.USAGE;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
