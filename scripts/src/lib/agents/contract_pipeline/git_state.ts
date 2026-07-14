// scripts/src/lib/agents/contract_pipeline/git_state.ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GitStateSnapshot } from './types.ts';

const gitLines = (options: { cwd: string; args: string[] }): string[] => {
  try {
    return execFileSync('git', options.args, {
      cwd: options.cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

/** Return all tracked and untracked paths currently changed from HEAD. */
export const changedPaths = (cwd: string): string[] => {
  const tracked = gitLines({ cwd, args: ['diff', '--name-only', 'HEAD'] });
  const untracked = gitLines({ cwd, args: ['ls-files', '--others', '--exclude-standard'] });
  return [...new Set([...tracked, ...untracked])].sort();
};

const fileHash = (options: { cwd: string; path: string }): string => {
  const absolutePath = resolve(options.cwd, options.path);
  if (!existsSync(absolutePath)) {
    return '<deleted>';
  }
  try {
    return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  } catch {
    return '<unreadable>';
  }
};

/** Hash one file's current content, including deleted/unreadable states. */
export const contentHash = (path: string): string => {
  if (!existsSync(path)) {
    return '<deleted>';
  }
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return '<unreadable>';
  }
};

/** Build a content-aware snapshot of the current Git working state. */
export const captureGitState = (cwd: string): GitStateSnapshot => {
  const files: Record<string, string> = {};
  for (const path of changedPaths(cwd)) {
    files[path] = fileHash({ cwd, path });
  }
  return { files, fingerprint: fingerprintFiles(files) };
};

/** Create a deterministic content fingerprint from a path-to-hash map. */
export const fingerprintFiles = (files: Readonly<Record<string, string>>): string => {
  const hash = createHash('sha256');
  for (const [path, contentHash] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(path);
    hash.update('\0');
    hash.update(contentHash);
    hash.update('\n');
  }
  return hash.digest('hex');
};

/** Return paths whose content or presence changed between snapshots. */
export const changedBetweenSnapshots = (options: {
  before: GitStateSnapshot;
  after: GitStateSnapshot;
}): string[] => {
  const paths = new Set([
    ...Object.keys(options.before.files),
    ...Object.keys(options.after.files),
  ]);
  return [...paths]
    .filter((path) => options.before.files[path] !== options.after.files[path])
    .sort();
};

/** Read the current HEAD commit hash. */
export const currentCommit = (cwd: string): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
};
