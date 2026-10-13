import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';

const exec = promisify(execFile);
async function runGit(cwd, args, encoding) {
  const { stdout } = await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-C', cwd, ...args], {
    encoding, maxBuffer: 16 * 1024 * 1024, timeout: 10000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}
export const git = (cwd, ...args) => runGit(cwd, args, 'utf8');
export const gitBytes = (cwd, ...args) => runGit(cwd, args, 'buffer');

export function parseStatus(output) {
  const groups = { staged: [], unstaged: [], untracked: [], conflicts: [] };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const index = record[0], worktree = record[1];
    const file = { path: record.slice(3), status: record.slice(0, 2) };
    if (/[RC]/.test(index + worktree)) file.originalPath = records[++i];
    if (index === '?' && worktree === '?') groups.untracked.push(file);
    else if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(file.status)) groups.conflicts.push(file);
    else {
      if (index !== ' ') groups.staged.push({ ...file, change: index });
      if (worktree !== ' ') groups.unstaged.push({ ...file, change: worktree });
    }
  }
  return groups;
}

export async function getStatus(repoPath) {
  const launchDirectory = process.cwd();
  const contextSource = repoPath ? 'explicit checkout' : 'server launch directory';
  const checkout = repoPath || launchDirectory;
  if (!isAbsolute(checkout)) throw new Error('Checkout path must be absolute.');
  let root;
  try { root = (await git(checkout, 'rev-parse', '--show-toplevel')).trim(); }
  catch { throw new Error('No Git checkout at ' + checkout); }
  let branch;
  try { branch = (await git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')).trim(); }
  catch { branch = 'Detached HEAD · ' + (await git(root, 'rev-parse', '--short', 'HEAD')).trim(); }
  const status = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  return { checkout: root, branch, contextSource, launchDirectory,
    checkedAt: new Date().toISOString(), ...parseStatus(status) };
}
