import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';

// Plan-only discovery for `workspace-plan`. It reads folder entries and nothing else: no writes, no git
// commands, no network. A repository is a direct child folder of the parent that holds a real `.git`
// folder. Symbolic links, files, nested folders and the proposed workspace folder are never listed.
export const WORKSPACE_FOLDER = 'Second Brain';

export async function planWorkspace(givenParent) {
  const existing = await lstat(givenParent).catch(() => null);
  if (!existing) throw new TypeError(`workspace-plan: parent folder does not exist: ${givenParent}`);
  // A parent may sit behind a link (for example /tmp on macOS). Resolve it once; the listing below never follows links.
  const parentPath = await realpath(givenParent);
  const parentStat = await lstat(parentPath);
  if (!parentStat.isDirectory()) throw new TypeError('workspace-plan: --parent must be a folder. Nothing was changed.');

  const hub = path.join(parentPath, WORKSPACE_FOLDER);
  const hubStat = await lstat(hub).catch(() => null);
  const repositories = [];
  const skipped = [];

  const entries = (await readdir(parentPath, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === WORKSPACE_FOLDER) continue;
    if (!entry.isDirectory()) continue;
    const child = path.join(parentPath, entry.name);
    try {
      const git = await lstat(path.join(child, '.git'));
      if (git.isDirectory()) repositories.push({ name: entry.name, path: child });
    } catch (error) {
      if (error.code !== 'ENOENT') skipped.push({ name: entry.name, reason: 'unreadable' });
    }
  }

  return {
    parent: parentPath,
    hub,
    hubExists: hubStat !== null,
    repositories,
    skipped,
  };
}
