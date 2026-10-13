import { isAbsolute, relative, resolve, sep } from 'node:path';

export function safePath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) throw new Error('Invalid repository-relative file path.');
  const target = resolve(root, path), rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || rel === '.git' || rel.startsWith('.git' + sep)) throw new Error('File must be inside the checkout.');
  return target;
}
