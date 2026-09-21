// apps/backend/local-stack/stack/generation/reference_resolver.ts
//
// C-519: the host's reference resolver — the one place that turns a brief
// reference locator into verified bytes (or an explicit "not resolvable").
//
// 🔴 A hash is only ever produced from bytes that were actually read. A
// Markdown section, an `authoring:` handle or a remote URL resolves to
// `unresolved` with a reason; the plan turns that into a structured blocker
// for required references. Nothing is ever hashed "as a stand-in".
//
// Locator forms this resolver understands:
//
//   path/to/file.png                    → read the bytes, hash them
//   path/to/file.json#/json/pointer     → follow the RFC-6901 pointer, hash the
//                                         canonical JSON of the target value
//   https://…                           → unresolved (never downloaded)
//   authoring:<handle>                  → unresolved (authoring handle, not bytes)
//   anything that is not a binary asset → unresolved (locator is not bytes)
//
// Contract: C-519 Durable asset jobs and batch execution

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalJson, type ReferenceResolution, sha256Hex } from '@aikami/local-ai';
import type { AssetBrief } from '@aikami/types';

/** Extensions that carry hashable artifact bytes. */
const BINARY_ASSET_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.avif',
  '.svg',
  '.wav',
  '.ogg',
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.mp4',
  '.webm',
]);

/** Follows an RFC-6901 JSON pointer (`/npcs/village_elder/appearance`). */
const followJsonPointer = (document: unknown, pointer: string): unknown => {
  const segments = pointer
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = document;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/** Resolves one brief reference into verified bytes, or a reason it cannot. */
export const resolveBriefReference = async (options: {
  reference: AssetBrief['references'][number];
  /** Root every relative locator is resolved against. */
  rootDir: string;
}): Promise<ReferenceResolution> => {
  const { reference } = options;
  const unresolved = (reason: string): ReferenceResolution => ({
    referenceId: reference.id,
    status: 'unresolved',
    reason,
  });

  if (reference.locator.startsWith('authoring:')) {
    return unresolved(
      `"${reference.locator}" is an authoring handle, not artifact bytes — resolve the source and pin its hash`,
    );
  }
  if (reference.locator.includes('://')) {
    return unresolved(
      `"${reference.locator}" is a remote locator — the local runner never downloads references; supply the bytes and pin their hash`,
    );
  }

  const [rawPath, pointer] = reference.locator.split('#', 2);
  if (rawPath === undefined || rawPath.length === 0) {
    return unresolved(`"${reference.locator}" has no path component`);
  }
  const rootDir = resolve(options.rootDir);
  const absolutePath = resolve(rootDir, rawPath);
  const relativePath = relative(rootDir, absolutePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return unresolved(`file is outside the configured root: ${rawPath}`);
  }
  try {
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return unresolved(`file not found: ${rawPath}`);
    }
  } catch (error) {
    return unresolved(`unable to inspect ${rawPath}: ${(error as Error).message}`);
  }

  const extension = extname(absolutePath).toLowerCase();

  if (pointer !== undefined) {
    if (extension !== '.json') {
      return unresolved(
        `"${reference.locator}" points into a ${extension || 'extension-less'} document, which is not a JSON pointer target`,
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(absolutePath, 'utf8'));
    } catch (error) {
      return unresolved(`unreadable JSON at ${rawPath}: ${(error as Error).message}`);
    }
    const value = followJsonPointer(document, pointer);
    if (value === undefined) {
      return unresolved(`JSON pointer "#${pointer}" does not resolve in ${rawPath}`);
    }
    const bytes = new TextEncoder().encode(canonicalJson(value));
    return {
      referenceId: reference.id,
      status: 'resolved',
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
      sourcePath: `${rawPath}#${pointer}`,
    };
  }

  if (!BINARY_ASSET_EXTENSIONS.has(extension)) {
    return unresolved(
      `"${rawPath}" is a ${extension || 'extension-less'} document, not a binary artifact — a reference must resolve to bytes an engine can consume`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(absolutePath));
  } catch (error) {
    return unresolved(`unable to read ${rawPath}: ${(error as Error).message}`);
  }
  if (bytes.byteLength === 0) {
    return unresolved(`"${rawPath}" is empty (0 bytes) — refusing to hash an empty artifact`);
  }
  return {
    referenceId: reference.id,
    status: 'resolved',
    sha256: await sha256Hex(bytes),
    bytes: bytes.byteLength,
    sourcePath: rawPath.split(sep).join('/'),
  };
};
