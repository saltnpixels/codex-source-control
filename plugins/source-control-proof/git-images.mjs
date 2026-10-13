import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, relative } from 'node:path';
import { git, gitBytes } from './git-status.mjs';
import { safePath } from './repo-path.mjs';

const maxBytes = 8 * 1024 * 1024;
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
export const isImagePath = path => Object.hasOwn(types, extname(path).toLowerCase());
function preview(path, bytes, label) {
  return { label, byteSize: bytes.length, revision: createHash('sha256').update(bytes).digest('hex'), mimeType: types[extname(path).toLowerCase()],
    dataUrl: 'data:' + types[extname(path).toLowerCase()] + ';base64,' + bytes.toString('base64') };
}
async function workingImage(root, path, label) {
  const target = safePath(root, path);
  let info;
  try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') return { label, message: 'File not present in this snapshot.' }; throw error; }
  if (!info.isFile()) return { label, message: 'Image preview is unavailable for symbolic links or directories.' };
  if (info.size > maxBytes) return { label, byteSize: info.size, message: 'Image exceeds the 8 MB preview limit.' };
  const canonical = await realpath(target), canonicalRoot = await realpath(root);
  safePath(canonicalRoot, relative(canonicalRoot, canonical));
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    if (offset > maxBytes) return { label, byteSize: offset, message: 'Image exceeds the 8 MB preview limit.' };
    return preview(path, buffer.subarray(0, offset), label);
  } finally { await file.close(); }
}
async function gitImage(root, path, snapshot, label) {
  const object = snapshot === 'index' ? ':' + path : 'HEAD:' + path;
  let type;
  try { type = (await git(root, 'cat-file', '-t', object)).trim(); }
  catch { return { label, message: 'File not present in this snapshot.' }; }
  if (type !== 'blob') return { label, message: 'Image preview is unavailable for this Git object.' };
  const size = Number((await git(root, 'cat-file', '-s', object)).trim());
  if (size > maxBytes) return { label, byteSize: size, message: 'Image exceeds the 8 MB preview limit.' };
  return preview(path, await gitBytes(root, 'cat-file', 'blob', object), label);
}
export async function imageViews(root, file, group, mode) {
  const current = () => group === 'staged' ? gitImage(root, file.path, 'index', 'Staged') : workingImage(root, file.path, 'Working copy');
  if (mode === 'source' || group === 'untracked') return [await current()];
  const before = group === 'staged' || group === 'conflicts'
    ? gitImage(root, file.originalPath || file.path, 'HEAD', 'HEAD')
    : gitImage(root, file.path, 'index', 'Staged');
  return Promise.all([before, current()]);
}
