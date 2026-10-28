import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addSkill } from '../tools/add-skill.mjs';
import { sourceRoot } from './helpers/consumer-cli.mjs';

// A copy of the real manifest and allowlist with one shipped skill's registration removed. The helper must put back
// exactly what shipped: same entries, same hashes, same allowlist lines.
async function copyWithout(skill) {
  const root = await mkdtemp(path.join(tmpdir(), 'add-skill-'));
  await cp(path.join(sourceRoot, 'template', 'shared-skills', skill), path.join(root, 'template', 'shared-skills', skill), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8'));
  const shipped = manifest.entries.filter((entry) => entry.source.startsWith(`template/shared-skills/${skill}/`));
  manifest.entries = manifest.entries.filter((entry) => !shipped.includes(entry));
  await writeFile(path.join(root, 'template-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const allow = (await readFile(path.join(sourceRoot, 'FILE-ALLOWLIST.txt'), 'utf8')).split('\n').filter((line) => !line.startsWith(`template/shared-skills/${skill}/`));
  await writeFile(path.join(root, 'FILE-ALLOWLIST.txt'), allow.join('\n'));
  return { root, shipped };
}

test('add-skill rebuilds the shipped registration of a one-file skill and a multi-file skill', async (t) => {
  for (const skill of ['today', 'scroll-story-component']) {
    const { root, shipped } = await copyWithout(skill);
    t.after(() => rm(root, { recursive: true, force: true }));
    const result = addSkill(root, skill);
    const rebuilt = JSON.parse(await readFile(path.join(root, 'template-manifest.json'), 'utf8')).entries;
    const byDestination = new Map(rebuilt.map((entry) => [entry.destination, entry]));
    assert.equal(result.added.length, shipped.length, `${skill}: one entry per shipped destination`);
    for (const entry of shipped) assert.deepEqual(byDestination.get(entry.destination), entry, `${skill}: ${entry.destination} matches the shipped entry`);
    const listed = (await readFile(path.join(root, 'FILE-ALLOWLIST.txt'), 'utf8')).split('\n');
    for (const entry of shipped) assert.ok(listed.includes(entry.source), `${skill}: ${entry.source} is allowlisted`);
  }
});

test('add-skill adds nothing on a second run and counts the skills', async (t) => {
  const { root } = await copyWithout('today');
  t.after(() => rm(root, { recursive: true, force: true }));
  addSkill(root, 'today');
  const before = await readFile(path.join(root, 'template-manifest.json'), 'utf8');
  const again = addSkill(root, 'today');
  assert.deepEqual([again.added, again.allowlisted], [[], []]);
  assert.equal(await readFile(path.join(root, 'template-manifest.json'), 'utf8'), before);
  const real = JSON.parse(await readFile(path.join(sourceRoot, 'template-manifest.json'), 'utf8')).entries;
  const realCount = new Set(real.map((entry) => entry.destination.match(/^\.claude\/skills\/([^/]+)\//)?.[1]).filter(Boolean)).size;
  assert.equal(again.skillCount, realCount, 'registering the removed skill again restores the shipped skill count');
});

test('add-skill refuses a bad name, a missing SKILL.md, a front matter name that differs, and a symbolic link', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'add-skill-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'template-manifest.json'), `${JSON.stringify({ entries: [] }, null, 2)}\n`);
  await writeFile(path.join(root, 'FILE-ALLOWLIST.txt'), 'README.md\n');
  const folder = (name) => path.join(root, 'template', 'shared-skills', name);
  await mkdir(folder('no-skill-md'), { recursive: true });
  await writeFile(path.join(folder('no-skill-md'), 'notes.md'), 'x\n');
  await mkdir(folder('wrong-name'), { recursive: true });
  await writeFile(path.join(folder('wrong-name'), 'SKILL.md'), '---\nname: other\ndescription: x\n---\n');
  await mkdir(folder('linked'), { recursive: true });
  await writeFile(path.join(folder('linked'), 'SKILL.md'), '---\nname: linked\ndescription: x\n---\n');
  await symlink(path.join(root, 'README.md'), path.join(folder('linked'), 'leak.md'));
  assert.throws(() => addSkill(root, '../escape'), /lowercase letters/);
  assert.throws(() => addSkill(root, 'no-skill-md'), /SKILL\.md does not exist/);
  assert.throws(() => addSkill(root, 'wrong-name'), /name: wrong-name/);
  assert.throws(() => addSkill(root, 'linked'), /symbolic link/);
  assert.equal(await readFile(path.join(root, 'FILE-ALLOWLIST.txt'), 'utf8'), 'README.md\n', 'a refused skill writes nothing');
});
