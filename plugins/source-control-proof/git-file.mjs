import { lstat, open, readlink, realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { git, gitBytes, getStatus } from './git-status.mjs';
import { imageViews, isImagePath } from './git-images.mjs';
import { safePath } from './repo-path.mjs';

const maxBytes = 512 * 1024;
function decode(bytes) {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}
async function workingSource(root, path) {
  const target = safePath(root, path);
  const info = await lstat(target);
  if (info.isSymbolicLink()) return { text: await readlink(target), sourceLabel: 'Working copy · symbolic link' };
  if (!info.isFile()) return { message: 'This entry is a directory or Git submodule.' };
  const canonical = await realpath(target);
  const canonicalRoot = await realpath(root);
  safePath(canonicalRoot, relative(canonicalRoot, canonical));
  const file = await open(canonical, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { message: 'File is larger than the 512 KB viewer limit.' };
    const text = decode(buffer.subarray(0, bytesRead));
    return text === null ? { message: 'Binary or non-UTF-8 file. Source preview is unavailable.' } : { text, sourceLabel: 'Working copy' };
  } finally { await file.close(); }
}
async function stagedSource(root, file) {
  if (file.change === 'D') return { message: 'This file is deleted in the staged snapshot.' };
  const object = ':' + file.path;
  if ((await git(root, 'cat-file', '-t', object)).trim() !== 'blob') return { message: 'Git submodule. Source preview is unavailable.' };
  if (Number((await git(root, 'cat-file', '-s', object)).trim()) > maxBytes) return { message: 'File is larger than the 512 KB viewer limit.' };
  const text = decode(await gitBytes(root, 'show', '--no-ext-diff', '--no-textconv', object));
  return text === null ? { message: 'Binary or non-UTF-8 file. Source preview is unavailable.' } : { text, sourceLabel: 'Staged snapshot' };
}
export async function getFile({ repoPath, path, group, mode }) {
  if (!['staged', 'unstaged', 'untracked', 'conflicts'].includes(group) || !['source', 'diff'].includes(mode)) throw new Error('Invalid file view.');
  const status = await getStatus(repoPath);
  safePath(status.checkout, path);
  const file = status[group].find(f => f.path === path);
  if (!file) throw new Error('This file is no longer in ' + group + ' changes. Refresh the file list.');
  if (isImagePath(path)) return { checkout: status.checkout, path, group, mode,
    kind: 'image', images: await imageViews(status.checkout, file, group, mode),
    sourceLabel: group === 'staged' ? 'Staged snapshot' : 'Working copy' };
  let view;
  if (mode === 'source') {
    view = group === 'staged' ? await stagedSource(status.checkout, file)
      : file.change === 'D' ? { message: 'This file is deleted from the working copy.' }
      : await workingSource(status.checkout, path);
  } else if (group === 'untracked') {
    const source = await workingSource(status.checkout, path);
    if (source.message) view = source;
    else {
      const lines = source.text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      view = { text: lines.length ? '@@ -0,0 +1,' + lines.length + ' @@\n' + lines.map(line => '+' + line).join('\n') : '',
        sourceLabel: 'New file · not tracked' };
    }
  } else {
    const paths = file.originalPath ? [file.originalPath, path] : [path];
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--unified=3'];
    if (group === 'staged') args.push('--cached');
    const text = await git(status.checkout, ...args, '--', ...paths);
    view = Buffer.byteLength(text) > maxBytes ? { message: 'Diff is larger than the 512 KB viewer limit.' }
      : { text, sourceLabel: group === 'staged' ? 'HEAD → staged snapshot' : 'Staged snapshot → working copy' };
  }
  return { checkout: status.checkout, path, group, mode, ...view };
}
