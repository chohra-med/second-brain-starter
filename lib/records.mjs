import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { connectSupport as S } from './installer.mjs';

// Read-only record hygiene lint behind `verify --records`. It reads each project's
// roadmap.md and progress.md under 01-Projects/ and reports shape problems. It never
// writes, moves or rewrites anything.

export const STATUS_WORDS = ['Open', 'In progress', 'Blocked', 'Done', 'Verified'];
export const SIZE_LIMIT_BYTES = 15 * 1024;
export const PROGRESS_ENTRY_LIMIT = 10;
const PROJECTS_DIRECTORY = '01-Projects';

function cells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const isTableLine = (line) => line.trim().startsWith('|');
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line.trim());

/** Lints one roadmap. Returns problem strings; an empty list means the shape is clean. */
export function lintRoadmap(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    if (isTableLine(line)) {
      if (!current) {
        current = { start: index, lines: [] };
        blocks.push(current);
      }
      current.lines.push({ line, number: index + 1 });
    } else {
      current = null;
    }
  });
  const taskTables = [];
  for (const block of blocks) {
    const [header, separator, ...rows] = block.lines;
    const isTable = separator && isSeparator(separator.line);
    if (!isTable) {
      for (const row of block.lines) problems.push(`line ${row.number}: a table row outside a table (no header and separator line above it)`);
      continue;
    }
    const statusColumn = cells(header.line).indexOf('Status');
    if (statusColumn === -1) continue;
    taskTables.push(block);
    for (const row of rows) {
      const word = cells(row.line)[statusColumn] ?? '';
      if (!STATUS_WORDS.includes(word)) problems.push(`line ${row.number}: unknown status word "${word}" (use ${STATUS_WORDS.join(', ')})`);
    }
  }
  if (taskTables.length === 0) problems.push('no task table with a Status column');
  if (taskTables.length > 1) problems.push(`${taskTables.length} task tables with a Status column; keep one table per roadmap (lines ${taskTables.map((block) => block.start + 1).join(', ')})`);
  return problems;
}

/** Lints one progress log by size and entry count. */
export function lintProgress(text, byteLength) {
  const problems = [];
  const entries = text.split(/\r?\n/).filter((line) => /^## /.test(line)).length;
  if (entries > PROGRESS_ENTRY_LIMIT) problems.push(`${entries} entries; move all but the newest ${PROGRESS_ENTRY_LIMIT} to 04-Archives/Projects/<project>/progress-YYYY.md and leave a pointer`);
  if (byteLength > SIZE_LIMIT_BYTES) problems.push(`${byteLength} bytes, over about ${SIZE_LIMIT_BYTES / 1024} KB; move older entries to the archive`);
  return problems;
}

export function lintSize(byteLength) {
  return byteLength > SIZE_LIMIT_BYTES ? [`${byteLength} bytes, over about ${SIZE_LIMIT_BYTES / 1024} KB; move Verified rows to the archive`] : [];
}

/**
 * Walks every direct child folder of 01-Projects/ (real folders only, never symlinks)
 * and lints its roadmap.md and progress.md. Read only.
 */
export async function lintWorkspaceRecords({ targetPath, sourceRoot = S.INSTALLER_ROOT }) {
  const target = await S.resolveTarget(targetPath, sourceRoot);
  const projectsPath = path.join(target, PROJECTS_DIRECTORY);
  await S.assertNoSymlinkAncestors(projectsPath, 'Projects folder', target);
  const stat = await S.lstatOrNull(projectsPath);
  const findings = [];
  const skipped = [];
  let files = 0;
  if (!stat?.isDirectory()) return { target, files, findings, skipped: [`${PROJECTS_DIRECTORY}/ is missing`] };
  for (const name of (await readdir(projectsPath)).sort()) {
    const folder = path.join(projectsPath, name);
    const folderStat = await S.lstatOrNull(folder);
    if (folderStat?.isSymbolicLink()) {
      skipped.push(`${PROJECTS_DIRECTORY}/${name}/ is a symlink and is not read`);
      continue;
    }
    if (!folderStat?.isDirectory()) continue;
    for (const file of ['roadmap.md', 'progress.md']) {
      const relative = `${PROJECTS_DIRECTORY}/${name}/${file}`;
      let bytes;
      try {
        bytes = await S.readRegularFile(path.join(folder, file), relative);
      } catch (error) {
        skipped.push(`${relative}: ${error.code ?? 'unreadable'}`);
        continue;
      }
      if (bytes === null) continue;
      files += 1;
      const text = bytes.toString('utf8');
      const problems = file === 'roadmap.md' ? [...lintRoadmap(text), ...lintSize(bytes.length)] : lintProgress(text, bytes.length);
      for (const problem of problems) findings.push({ path: relative, problem });
    }
  }
  return { target, files, findings, skipped };
}
