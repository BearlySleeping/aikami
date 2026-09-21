// scripts/src/lib/catalog/workspace_files.ts
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tagToAssetPath } from '@aikami/constants';
import { logger } from '$logger';

/** SHA-256 is the address and integrity boundary, never an S3 multipart ETag. */
export const digestBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Reject traversal, control characters and ambiguous path components before filesystem access. */
export const checkRelativePath = (path: string): string => {
  if (
    !path ||
    /[\\:]/.test(path) ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe workspace path: ${JSON.stringify(path)}`);
  }
  return path;
};

/** Reuse the runtime tag-to-path convention; content packs never overwrite tracked sources. */
export const entryWorkingPath = (entry: { tag: string; ext: string; category: string }): string => {
  checkRelativePath(entry.tag.replaceAll(':', '/'));
  const path = tagToAssetPath({ tag: entry.tag, ext: entry.ext });
  return checkRelativePath(
    `${entry.category === 'contentPacks' ? 'content-packs' : 'game-data'}/${path}`,
  );
};

/** ENOENT is the only absent-file case; permissions and IO failures must propagate. */
export const readOptional = async (path: string): Promise<Uint8Array | undefined> => {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

/**
 * Refuse symlink escapes, including existing ancestors of the workspace itself.
 *
 * The ancestor walk stops at the normalized workspace root: anything above it
 * (the repository, the user's home) is not the workspace's business, and
 * walking to the filesystem root made every path pay for lstat calls on
 * directories the workspace does not own.
 */
export const workspacePath = async (options: { root: string; path: string }): Promise<string> => {
  checkRelativePath(options.path);
  const workspaceRoot = resolve(options.root);
  const target = resolve(workspaceRoot, options.path);
  let ancestor = target;
  while (true) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink()) {
        throw new Error(`Workspace symlinks are not supported: ${ancestor}`);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    if (ancestor === workspaceRoot) {
      break;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      break;
    }
    ancestor = parent;
  }
  return target;
};

/** Temp + rename prevents interrupted downloads from becoming valid cached objects. */
export const atomicWrite = async (options: {
  root: string;
  path: string;
  bytes: Uint8Array;
}): Promise<void> => {
  const target = await workspacePath(options);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.partial`;
  try {
    await writeFile(temporary, options.bytes, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
};

/** Serialize local state consistently so plans/snapshots can be addressed by hash. */
export const jsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, undefined, 2)}\n`);

/** List regular working files only; never follow a user-created symlink during sync. */
export const listWorkingFiles = async (root: string): Promise<string[]> => {
  const directory = await workspacePath({ root, path: 'working' });
  await mkdir(directory, { recursive: true });
  const files: string[] = [];
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlink: ${child}`);
      }
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        files.push(
          child
            .slice(directory.length + 1)
            .split(sep)
            .join('/'),
        );
      } else {
        throw new Error(`Not a regular file: ${child}`);
      }
    }
  };
  await walk(directory);
  return files.sort();
};

/** One writer per workspace; a crashed process leaves an explicit recoverable lock. */
export const withWorkspaceLock = async <Result>(options: {
  root: string;
  run(): Promise<Result>;
}): Promise<Result> => {
  logger.debug('withWorkspaceLock');
  const lock = await workspacePath({ root: options.root, path: '.lock' });
  await mkdir(options.root, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(
        `Workspace is locked: ${lock}. Check for an active process before removing it.`,
      );
    }
    throw error;
  }
  try {
    return await options.run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
};
