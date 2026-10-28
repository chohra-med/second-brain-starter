#!/usr/bin/env node
// Registers one new shared skill in template-manifest.json and FILE-ALLOWLIST.txt.
// usage: node tools/add-skill.mjs <skill-name>   (run from the repository root, after writing template/shared-skills/<skill-name>/SKILL.md)
// It copies nothing and edits no skill file. It adds, for every file under the skill folder, the two manifest entries
// (.agents/skills and .claude/skills) with the SHA-256 of the bytes, and the allowlist line. A second run adds nothing.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];

function filesUnder(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap((entry) => {
    const stat = lstatSync(path.join(directory, entry));
    if (stat.isSymbolicLink()) throw new Error(`${prefix}${entry} is a symbolic link; a skill holds regular files only`);
    return stat.isDirectory() ? filesUnder(path.join(directory, entry), `${prefix}${entry}/`) : [`${prefix}${entry}`];
  });
}

export function addSkill(root, name) {
  if (!NAME.test(name ?? '')) throw new Error('the skill name is lowercase letters, digits and single hyphens');
  const folder = path.join(root, 'template', 'shared-skills', name);
  const files = filesUnder(folder);
  if (!files.includes('SKILL.md')) throw new Error(`template/shared-skills/${name}/SKILL.md does not exist`);
  const skill = readFileSync(path.join(folder, 'SKILL.md'), 'utf8');
  const front = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  if (front.match(/^name:\s*(.+)$/m)?.[1].trim() !== name) throw new Error('the SKILL.md front matter must carry name: ' + name);
  if (!/^description:\s*\S/m.test(front)) throw new Error('the SKILL.md front matter must carry a description');

  const manifestPath = path.join(root, 'template-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const known = new Set(manifest.entries.map((entry) => entry.destination));
  const added = [];
  for (const file of files) {
    const source = `template/shared-skills/${name}/${file}`;
    const sha256 = createHash('sha256').update(readFileSync(path.join(folder, file))).digest('hex');
    for (const client of ['.agents', '.claude']) {
      const destination = `${client}/skills/${name}/${file}`;
      if (known.has(destination)) continue;
      manifest.entries.push({ source, destination, sha256, mergeKind: 'managed-file' });
      added.push(destination);
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const allowPath = path.join(root, 'FILE-ALLOWLIST.txt');
  const lines = readFileSync(allowPath, 'utf8').split('\n');
  const listed = new Set(lines);
  const missing = files.map((file) => `template/shared-skills/${name}/${file}`).filter((line) => !listed.has(line));
  if (missing.length > 0) {
    const last = lines.map((line) => line.startsWith('template/shared-skills/')).lastIndexOf(true);
    lines.splice(last + 1, 0, ...missing);
    writeFileSync(allowPath, lines.join('\n'));
  }

  const skills = new Set(manifest.entries.map((entry) => entry.destination.match(/^\.claude\/skills\/([^/]+)\//)?.[1]).filter(Boolean));
  return { added, allowlisted: missing, skillCount: skills.size, countWord: WORDS[skills.size] ?? String(skills.size) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = addSkill(process.cwd(), process.argv[2]);
    console.log(`manifest entries added: ${result.added.length}\nallowlist lines added: ${result.allowlisted.length}`);
    console.log(`The starter now installs ${result.countWord} skills. Still by hand: the README skills table and its "${result.countWord}" count (two places), the same count in docs/first-loop-and-projects.md and docs/free-and-builder-ai-os.md, and the installedSkills list and count in test/installer.test.mjs. Then run: node --test`);
  } catch (error) {
    console.error(`add-skill: ${error.message}`);
    process.exitCode = 1;
  }
}
