// apps/backend/local-stack/stack/generation/audio_import.ts
//
// C-521 AC-2 (second half): the import transport for owned/licensed recordings.
//
// "Imported owned/licensed recordings enter the same finishing/analysis path
// and produce a rendition record." That means an import is not a special case
// downstream — it is a *master source*. This module resolves a brief-declared
// locator to bounded master bytes; everything after that (analysis, loudness
// targets, rendition hashes, lineage) is the same `finishAudioMaster` code
// path a generated master takes.
//
// Bounding rules, all enforced before a byte is read:
//
//   * the locator must resolve inside a declared import root (no traversal);
//   * the extension must be one the installed catalog accepts (`AUDIO_EXTS`);
//   * the file must be a regular file within `MAX_UPLOAD_SIZE`.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AUDIO_EXTS, MAX_UPLOAD_SIZE } from '@aikami/constants';

/** The default root an import locator must stay inside. */
export const DEFAULT_AUDIO_IMPORT_ROOT = 'apps/backend/image/src/audio/imports';

/** A resolved import source. */
export type ResolvedAudioImport =
  | { ok: true; path: string; extension: string; bytes: number }
  | { ok: false; code: string; message: string };

/** True when `child` is inside `parent` (or is `parent`). */
const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith(sep) && !isAbsolute(rel));
};

/**
 * Resolves a brief-declared locator to a readable master file.
 *
 * Never throws: a refused import is a typed result the runner turns into a job
 * failure with the same code, so the report says *why* rather than "ENOENT".
 */
export const resolveAudioImport = (options: {
  locator: string;
  /** Root the locator must stay inside. Defaults to the repo's import root. */
  importRoot: string;
  /** Catalog extensions. Defaults to the installed `AUDIO_EXTS`. */
  allowedExtensions?: ReadonlySet<string>;
  maxBytes?: number;
}): ResolvedAudioImport => {
  const allowed = options.allowedExtensions ?? AUDIO_EXTS;
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_SIZE;
  const root = resolve(options.importRoot);
  const locator = options.locator.trim();
  if (locator.length === 0) {
    return {
      ok: false,
      code: 'import_locator_empty',
      message: 'the item declares an empty import locator',
    };
  }
  if (locator.includes('\0')) {
    return {
      ok: false,
      code: 'import_locator_rejected',
      message: 'the import locator contains a NUL byte',
    };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(locator)) {
    return {
      ok: false,
      code: 'import_locator_rejected',
      message: `the import locator "${locator.slice(0, 80)}" is a URL — an owned/licensed recording is read from a bounded local root, never fetched`,
    };
  }
  const candidate = isAbsolute(locator) ? resolve(locator) : resolve(root, locator);
  if (!isInside(root, candidate)) {
    return {
      ok: false,
      code: 'import_locator_rejected',
      message: `the import locator "${locator}" resolves outside the declared import root "${root}"`,
    };
  }
  const extension = candidate.slice(candidate.lastIndexOf('.')).toLowerCase();
  if (!allowed.has(extension)) {
    return {
      ok: false,
      code: 'import_format_unsupported',
      message: `"${extension || '(none)'}" is not one of the installed catalog's audio extensions (${[...allowed].join(' ')})`,
    };
  }
  if (!existsSync(candidate)) {
    return {
      ok: false,
      code: 'import_source_missing',
      message: `no recording exists at the declared import locator "${locator}"`,
    };
  }
  const stats = statSync(candidate);
  if (!stats.isFile()) {
    return {
      ok: false,
      code: 'import_source_missing',
      message: `the declared import locator "${locator}" is not a regular file`,
    };
  }
  if (stats.size > maxBytes) {
    return {
      ok: false,
      code: 'import_source_too_large',
      message: `the recording at "${locator}" is ${stats.size} bytes, above the ${maxBytes}-byte ceiling`,
    };
  }
  if (stats.size === 0) {
    return {
      ok: false,
      code: 'import_source_empty',
      message: `the recording at "${locator}" is empty`,
    };
  }
  return { ok: true, path: candidate, extension, bytes: stats.size };
};

/**
 * Reads the bytes of an already-resolved import.
 *
 * Separate from {@link resolveAudioImport} so the decision is testable without
 * touching the filesystem.
 */
export const readAudioImport = async (resolved: { path: string }): Promise<Uint8Array> =>
  new Uint8Array(await Bun.file(resolved.path).arrayBuffer());
