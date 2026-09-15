// packages/frontend/theme/src/lib/theme/theme_archive.ts
//
// C-529 AC-3 / AC-4 — the theme package envelope: building one for export, and
// reading one back under archive-level limits.
//
// 🔴 This module is pure. It never touches a filesystem or an archive library:
// the caller (the client's JSZip import path, or the CLI's directory reader)
// hands it already-extracted entries, and every decision is a function of those
// bytes. That is what makes the archive-level adversarial cases — entry count,
// compressed and expanded totals, in-archive symlinks, case collisions and
// compression bombs — testable without a ZIP writer in the test.
//
// Export builds the envelope from an allowlist of fields, so private
// preferences, save data, device ids, tokens and live screenshots are excluded
// by construction rather than by a filter that could be forgotten.

import {
  THEME_MAX_ARCHIVE_BYTES,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
  THEME_PACKAGE_KIND,
  THEME_PACKAGE_SCHEMA_VERSION,
} from '@aikami/constants';
import type { ThemePackageManifest, ThemeTokenFile } from '@aikami/schemas';
import { parseThemePackageManifest } from '@aikami/schemas';
import type { ThemeValidationIssue } from '@aikami/types';
import {
  isCanonicalPackagePath,
  type ThemePackageReader,
  type ThemePackageValidation,
  validateThemePackage,
} from './theme_package_validation.ts';

/** The manifest entry name inside a package archive. */
export const THEME_ARCHIVE_MANIFEST_ENTRY = 'theme.json';

/**
 * Largest expanded:compressed ratio tolerated for a single entry.
 *
 * A legitimate theme asset compresses perhaps 3–20×. A thousand-fold expansion
 * of a non-trivial entry is a bomb: it costs the extractor far more memory than
 * the archive costs to ship.
 */
export const THEME_MAX_COMPRESSION_RATIO = 1000;

/** Smallest expanded size at which the ratio guard applies (avoids false hits). */
export const THEME_COMPRESSION_RATIO_FLOOR_BYTES = 1024 * 1024;

/** One already-extracted archive entry. */
export type ThemeArchiveEntry = {
  /** Entry path, as stored in the archive (may be hostile — that is the point). */
  readonly path: string;
  /** Bytes the entry occupies inside the compressed archive. */
  readonly compressedBytes: number;
  /** Bytes the entry occupies once expanded. */
  readonly expandedBytes: number;
  readonly isDirectory?: boolean;
  /** True when the archive marks this entry as a symbolic link. */
  readonly isSymlink?: boolean;
  /** Expanded contents, when the caller has already read them. */
  readonly data?: Uint8Array;
  /** Lowercase hex SHA-256 of `data`, when the caller can compute it. */
  readonly sha256?: string;
};

/** Reads one entry as text without decoding more than once per call. */
const decoder = new TextDecoder();

/**
 * Validates the archive container before any entry is read.
 *
 * Returns the issues found; an empty array means the container itself is safe to
 * walk. Entry-level (manifest/token/asset) validation happens afterwards through
 * the shared package validator, so both halves agree on the same verdict.
 */
export const checkThemeArchiveContainer = (
  entries: readonly ThemeArchiveEntry[],
): readonly ThemeValidationIssue[] => {
  const issues: ThemeValidationIssue[] = [];
  const seen = new Set<string>();

  if (entries.length > THEME_MAX_ENTRIES) {
    issues.push({
      code: 'archive.too-many-entries',
      message: `The archive contains ${entries.length} entries; the limit is ${THEME_MAX_ENTRIES}.`,
    });
  }

  let compressedTotal = 0;
  let expandedTotal = 0;

  for (const entry of entries) {
    compressedTotal += entry.compressedBytes;
    expandedTotal += entry.expandedBytes;

    if (entry.isSymlink === true) {
      issues.push({
        code: 'archive.symlink-entry',
        message: `"${entry.path}" is a symbolic link. Symlinks are rejected — they can escape the package root.`,
        subject: entry.path,
      });
    }
    if (entry.isDirectory === true) {
      // Directories carry no content; they are ignored rather than rejected so a
      // normal zip layout is not treated as hostile.
      continue;
    }
    if (!isCanonicalPackagePath(entry.path)) {
      issues.push({
        code: 'archive.invalid-path',
        message: `"${entry.path}" is not a canonical package-relative path. Absolute paths, traversal and backslashes are rejected.`,
        subject: entry.path,
      });
      continue;
    }
    const key = entry.path.toLowerCase();
    if (seen.has(key)) {
      issues.push({
        code: 'archive.duplicate-entry',
        message: `"${entry.path}" appears more than once (or collides case-insensitively with another entry).`,
        subject: entry.path,
      });
      continue;
    }
    seen.add(key);

    if (
      entry.expandedBytes >= THEME_COMPRESSION_RATIO_FLOOR_BYTES &&
      entry.compressedBytes > 0 &&
      entry.expandedBytes / entry.compressedBytes > THEME_MAX_COMPRESSION_RATIO
    ) {
      issues.push({
        code: 'archive.compression-bomb',
        message: `"${entry.path}" expands ${Math.round(entry.expandedBytes / entry.compressedBytes)}× (${entry.expandedBytes} bytes from ${entry.compressedBytes}); the limit is ${THEME_MAX_COMPRESSION_RATIO}×.`,
        subject: entry.path,
      });
    }
  }

  if (compressedTotal > THEME_MAX_ARCHIVE_BYTES) {
    issues.push({
      code: 'archive.too-large',
      message: `The archive is ${compressedTotal} bytes; the limit is ${THEME_MAX_ARCHIVE_BYTES}.`,
    });
  }
  if (expandedTotal > THEME_MAX_EXPANDED_BYTES) {
    issues.push({
      code: 'archive.expands-too-large',
      message: `The archive expands to ${expandedTotal} bytes; the limit is ${THEME_MAX_EXPANDED_BYTES}.`,
    });
  }

  return issues;
};

/**
 * Validates a whole theme archive.
 *
 * The container is checked first; only when it is safe is the manifest read and
 * handed to the shared package validator. Nothing is rendered or activated by
 * this call — the caller stages the result and commits it separately.
 */
export const validateThemeArchive = (
  entries: readonly ThemeArchiveEntry[],
): ThemePackageValidation => {
  const containerIssues = checkThemeArchiveContainer(entries);
  if (containerIssues.length > 0) {
    return {
      ok: false,
      errors: containerIssues,
      warnings: [],
      variants: {},
      report: [`entries: ${entries.length}`],
    };
  }

  const byPath = new Map<string, ThemeArchiveEntry>();
  for (const entry of entries) {
    if (entry.isDirectory !== true) {
      byPath.set(entry.path.toLowerCase(), entry);
    }
  }
  const readEntry = (path: string): ThemeArchiveEntry | undefined => byPath.get(path.toLowerCase());

  const reader: ThemePackageReader = {
    manifestJson: (() => {
      const entry = readEntry(THEME_ARCHIVE_MANIFEST_ENTRY);
      return entry?.data === undefined ? undefined : decoder.decode(entry.data);
    })(),
    entries: entries.filter((entry) => entry.isDirectory !== true).map((entry) => entry.path),
    readText: (path) => {
      const entry = readEntry(path);
      return entry?.data === undefined ? undefined : decoder.decode(entry.data);
    },
    readBytes: (path) => readEntry(path)?.data,
    sha256: (path) => readEntry(path)?.sha256,
  };

  return validateThemePackage(reader);
};

// ── Export ─────────────────────────────────────────────────────────────────

/** One file to write into an exported package archive. */
export type ThemePackageFile = {
  readonly path: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
};

/** A declared asset the exporter should include. */
export type ThemePackageAssetInput = {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
};

/** Everything an export may contain — an allowlist, not a filter. */
export type ThemePackageBuildInput = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly authorDisplayName: string;
  readonly license: string;
  readonly themeApiRange: string;
  readonly variants: Partial<Record<ThemeTokenFile['variant'], ThemeTokenFile>>;
  readonly assets?: readonly ThemePackageAssetInput[];
  readonly preview?: string;
  readonly hudPreset?: string;
};

/** Result of building an export: the manifest and the files that go with it. */
export type ThemePackageBuild = {
  readonly manifest: ThemePackageManifest;
  readonly files: readonly ThemePackageFile[];
};

/** Computes a lowercase hex SHA-256 for bytes. Injected so this stays pure. */
export type ThemePackageHasher = (bytes: Uint8Array) => Promise<string>;

const encoder = new TextEncoder();

/**
 * Builds a portable theme package from validated token data.
 *
 * 🔴 The manifest is assembled field by field from {@link ThemePackageBuildInput}.
 * Private preferences, save data, device identifiers, tokens, secrets and live
 * screenshots have no field here at all, so they cannot leak into an export —
 * there is no "strip these" step that a future edit could skip.
 *
 * Asset `bytes` and `sha256` are computed from the actual content, never
 * copied from a caller-supplied value.
 */
export const buildThemePackage = async (
  input: ThemePackageBuildInput,
  hash: ThemePackageHasher,
): Promise<ThemePackageBuild> => {
  const files: ThemePackageFile[] = [];
  const variantPaths: { light?: string; dark?: string } = {};

  for (const variant of ['light', 'dark'] as const) {
    const tokenFile = input.variants[variant];
    if (tokenFile === undefined) {
      continue;
    }
    const path = `tokens/${variant}.json`;
    variantPaths[variant] = path;
    files.push({ path, text: `${JSON.stringify(tokenFile, undefined, 2)}\n` });
  }

  const assets: ThemePackageManifest['assets'] = [];
  for (const asset of input.assets ?? []) {
    assets.push({
      path: asset.path,
      mediaType: asset.mediaType,
      bytes: asset.bytes.byteLength,
      sha256: await hash(asset.bytes),
    });
    files.push({ path: asset.path, bytes: asset.bytes });
  }

  const manifest: ThemePackageManifest = {
    schemaVersion: THEME_PACKAGE_SCHEMA_VERSION,
    kind: THEME_PACKAGE_KIND,
    id: input.id,
    version: input.version,
    themeApiRange: input.themeApiRange,
    name: input.name,
    author: { displayName: input.authorDisplayName },
    license: input.license,
    variants: variantPaths,
    assets,
    ...(input.preview === undefined ? {} : { preview: input.preview }),
    ...(input.hudPreset === undefined ? {} : { hudPreset: input.hudPreset }),
  };

  files.push({
    path: THEME_ARCHIVE_MANIFEST_ENTRY,
    text: `${JSON.stringify(manifest, undefined, 2)}\n`,
  });

  return { manifest, files };
};

/** Reads a built package back into archive entries (used to verify an export). */
export const toArchiveEntries = async (
  build: ThemePackageBuild,
  hash: ThemePackageHasher,
  compress: (file: ThemePackageFile) => number,
): Promise<readonly ThemeArchiveEntry[]> => {
  const entries: ThemeArchiveEntry[] = [];
  for (const file of build.files) {
    const bytes = file.bytes ?? encoder.encode(file.text ?? '');
    entries.push({
      path: file.path,
      compressedBytes: compress(file),
      expandedBytes: bytes.byteLength,
      data: bytes,
      sha256: await hash(bytes),
    });
  }
  return entries;
};

/** Parses a manifest value that came from an archive entry. */
export const parseArchiveManifest = (value: unknown): ThemePackageManifest | undefined =>
  parseThemePackageManifest(value);
