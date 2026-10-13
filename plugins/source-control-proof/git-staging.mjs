import { realpath } from 'node:fs/promises';
import { git, getStatus } from './git-status.mjs';
import { safePath } from './repo-path.mjs';

// Serialize requests per checkout index; external Git processes still use Git's index.lock.
const indexQueues = new Map();
export async function updateStaging({ repoPath, path, group, action }) {
  if (typeof repoPath !== 'string' || !['stage', 'unstage'].includes(action)) throw new Error('Invalid staging request.');
  if (action === 'unstage' ? group !== 'staged' : !['unstaged', 'untracked', 'conflicts'].includes(group)) throw new Error('Invalid staging group.');
  const initial = await getStatus(repoPath), root = initial.checkout, queueKey = await realpath(root);
  safePath(root, path);
  const previous = indexQueues.get(queueKey) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const status = await getStatus(root);
    const file = status[group].find(item => item.path === path);
    if (!file) throw new Error('This file is no longer in ' + group + ' changes. Refresh the file list.');
    if (action === 'stage') {
      // Stage just this working-copy path. A pre-existing staged rename's original
      // path is already removed from the index and must not be passed to git add.
      await git(root, 'add', '--', file.path);
    } else {
      const paths = file.originalPath ? [file.originalPath, file.path] : [file.path];
      for (const target of paths) safePath(root, target);
      let hasHead = true;
      try { await git(root, 'rev-parse', '--verify', 'HEAD'); } catch { hasHead = false; }
      if (hasHead) await git(root, 'restore', '--staged', '--', ...paths);
      else await git(root, 'rm', '--cached', '--force', '--', ...paths);
    }
    return getStatus(root);
  });
  indexQueues.set(queueKey, operation);
  try { return await operation; }
  finally { if (indexQueues.get(queueKey) === operation) indexQueues.delete(queueKey); }
}
