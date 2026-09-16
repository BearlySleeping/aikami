// packages/frontend/theme/src/lib/theme/theme_archive_reader.ts
//
// C-530 AC-1 / AC-2 — the Worker-runtime ZIP extractor.
//
// `theme_archive.ts` is deliberately pure: it validates *already-extracted*
// entries, and the client's JSZip path is the only extractor the repo had. The
// Hub is a Cloudflare Worker with no ZIP dependency, so the server needs an
// extractor that runs on the same runtime as the route handler — and it must
// refuse a hostile archive *before* expanding a single entry, otherwise a
// compression bomb is paid for in memory before it is judged.
//
// 🔴 Order of operations is the security property, not an implementation
// detail:
//   1. Bound the archive bytes against `THEME_MAX_ARCHIVE_BYTES`.
//   2. Parse only the central directory (never the entry data).
//   3. Refuse entry count, expanded total, symlinks, non-canonical paths, case
//      collisions and per-entry compression ratio from the directory alone.
//   4. Only then decompress, each entry bounded by its own declared size.
//
// `DecompressionStream('deflate-raw')` is the supported execution path: it is
// the platform's own inflate, available in Workers, Bun and the browser, so no
// third-party archive library enters the trust boundary. When the runtime does
// not provide it the reader refuses with `archive.decompression-unavailable`
// rather than silently skipping validation — the caller surfaces that as the
// named `theme-sanitizer-unavailable` error.

import {
  THEME_MAX_ARCHIVE_BYTES,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
} from '@aikami/constants';
import type { ThemeValidationIssue } from '@aikami/types';
import {
  THEME_COMPRESSION_RATIO_FLOOR_BYTES,
  THEME_MAX_COMPRESSION_RATIO,
  type ThemeArchiveEntry,
} from './theme_archive.ts';
import { isCanonicalPackagePath } from './theme_package_validation.ts';

/** Result of reading an archive: the entries, or the reason it was refused. */
export type ThemeArchiveReadResult =
  | { readonly ok: true; readonly entries: readonly ThemeArchiveEntry[] }
  | { readonly ok: false; readonly issues: readonly ThemeValidationIssue[] };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const EOCD_MAX_SEARCH_BYTES = 65_557;
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;
/** ZIP64 sentinels — a package this large is far past the theme budget anyway. */
const ZIP64_ENTRY_SENTINEL = 0xffff;
const ZIP64_OFFSET_SENTINEL = 0xffffffff;
/** Unix file-type mask and the symlink type, from the external attributes. */
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK_TYPE = 0o120000;
const HOST_UNIX = 3;

const issue = (code: string, message: string, subject?: string): ThemeValidationIssue =>
  subject === undefined ? { code, message } : { code, message, subject };

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** One central-directory record, before any entry data is touched. */
type CentralEntry = {
  readonly path: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly method: number;
  readonly localHeaderOffset: number;
  readonly isSymlink: boolean;
  readonly isDirectory: boolean;
};

/** Locates the End Of Central Directory record, scanning back from the tail. */
const findEndOfCentralDirectory = (bytes: Uint8Array): number | undefined => {
  const earliest = Math.max(0, bytes.byteLength - EOCD_MAX_SEARCH_BYTES);
  for (let offset = bytes.byteLength - EOCD_MIN_BYTES; offset >= earliest; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return undefined;
};

/**
 * Parses the central directory only.
 *
 * A truncated or self-inconsistent directory is refused rather than clamped:
 * a package whose offsets do not describe itself cannot be validated.
 */
const parseCentralDirectory = (
  bytes: Uint8Array,
): { readonly entries: readonly CentralEntry[] } | { readonly issue: ThemeValidationIssue } => {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd === undefined) {
    return { issue: issue('archive.not-a-zip', 'The upload is not a ZIP archive.') };
  }

  const entryCount = readUint16(bytes, eocd + 10);
  const directorySize = readUint32(bytes, eocd + 12);
  const directoryOffset = readUint32(bytes, eocd + 16);

  if (
    entryCount === ZIP64_ENTRY_SENTINEL ||
    directoryOffset === ZIP64_OFFSET_SENTINEL ||
    directorySize === ZIP64_OFFSET_SENTINEL
  ) {
    return {
      issue: issue(
        'archive.zip64-unsupported',
        'ZIP64 archives are not accepted; a theme package is bounded well below that size.',
      ),
    };
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    return { issue: issue('archive.corrupt', 'The ZIP central directory is truncated.') };
  }
  if (entryCount > THEME_MAX_ENTRIES) {
    return {
      issue: issue(
        'archive.too-many-entries',
        `The archive contains ${entryCount} entries; the limit is ${THEME_MAX_ENTRIES}.`,
      ),
    };
  }

  const entries: CentralEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength) {
      return { issue: issue('archive.corrupt', 'The ZIP central directory is truncated.') };
    }
    if (readUint32(bytes, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return {
        issue: issue('archive.corrupt', 'A central-directory record has an unexpected signature.'),
      };
    }
    const host = readUint16(bytes, cursor + 4) >> 8;
    const method = readUint16(bytes, cursor + 10);
    const compressedBytes = readUint32(bytes, cursor + 20);
    const expandedBytes = readUint32(bytes, cursor + 24);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const externalAttributes = readUint32(bytes, cursor + 38);
    const localHeaderOffset = readUint32(bytes, cursor + 42);

    const nameStart = cursor + 46;
    if (nameStart + nameLength > bytes.byteLength) {
      return { issue: issue('archive.corrupt', 'An entry name runs past the archive end.') };
    }
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const isDirectory = path.endsWith('/');
    const unixMode = host === HOST_UNIX ? externalAttributes >>> 16 : 0;
    const isSymlink = !isDirectory && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE;

    entries.push({
      path,
      compressedBytes,
      expandedBytes,
      method,
      localHeaderOffset,
      isSymlink,
      isDirectory,
    });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return { entries };
};

/** Container-level refusals that need no entry data at all. */
const inspectContainer = (entries: readonly CentralEntry[]): readonly ThemeValidationIssue[] => {
  const issues: ThemeValidationIssue[] = [];
  const seen = new Set<string>();
  let compressedTotal = 0;
  let expandedTotal = 0;

  for (const entry of entries) {
    compressedTotal += entry.compressedBytes;
    expandedTotal += entry.expandedBytes;

    if (entry.isSymlink) {
      issues.push(
        issue(
          'archive.symlink-entry',
          `"${entry.path}" is a symbolic link. Symlinks are rejected — they can escape the package root.`,
          entry.path,
        ),
      );
      continue;
    }
    if (entry.isDirectory) {
      continue;
    }
    if (!isCanonicalPackagePath(entry.path)) {
      issues.push(
        issue(
          'archive.invalid-path',
          `"${entry.path}" is not a canonical package-relative path. Absolute paths, traversal and backslashes are rejected.`,
          entry.path,
        ),
      );
      continue;
    }
    const key = entry.path.toLowerCase();
    if (seen.has(key)) {
      issues.push(
        issue(
          'archive.duplicate-entry',
          `"${entry.path}" appears more than once (or collides case-insensitively with another entry).`,
          entry.path,
        ),
      );
      continue;
    }
    seen.add(key);

    // 🔴 The compression-ratio guard is applied here, from the directory
    // record — never after inflating. A bomb is refused, not decompressed.
    if (
      entry.expandedBytes >= THEME_COMPRESSION_RATIO_FLOOR_BYTES &&
      entry.compressedBytes > 0 &&
      entry.expandedBytes / entry.compressedBytes > THEME_MAX_COMPRESSION_RATIO
    ) {
      issues.push(
        issue(
          'archive.compression-bomb',
          `"${entry.path}" expands ${Math.round(entry.expandedBytes / entry.compressedBytes)}× (${entry.expandedBytes} bytes from ${entry.compressedBytes}); the limit is ${THEME_MAX_COMPRESSION_RATIO}×.`,
          entry.path,
        ),
      );
    }
  }

  if (compressedTotal > THEME_MAX_ARCHIVE_BYTES) {
    issues.push(
      issue(
        'archive.too-large',
        `The archive is ${compressedTotal} bytes; the limit is ${THEME_MAX_ARCHIVE_BYTES}.`,
      ),
    );
  }
  if (expandedTotal > THEME_MAX_EXPANDED_BYTES) {
    issues.push(
      issue(
        'archive.expands-too-large',
        `The archive expands to ${expandedTotal} bytes; the limit is ${THEME_MAX_EXPANDED_BYTES}.`,
      ),
    );
  }

  return issues;
};

const inflateDeflateRaw = async (
  compressed: Uint8Array,
  limit: number,
): Promise<Uint8Array | 'expands-too-large'> => {
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return 'expands-too-large';
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const sha256Of = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Extracts a theme archive under every archive-level limit.
 *
 * Returns the same `ThemeArchiveEntry[]` the client's JSZip path produces, so
 * `validateThemeArchive` gives the server and the client the *identical*
 * verdict on the same bytes.
 */
export const readThemeArchiveEntries = async (
  bytes: Uint8Array,
): Promise<ThemeArchiveReadResult> => {
  if (bytes.byteLength > THEME_MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      issues: [
        issue(
          'archive.too-large',
          `The upload is ${bytes.byteLength} bytes; the limit is ${THEME_MAX_ARCHIVE_BYTES}.`,
        ),
      ],
    };
  }

  const parsed = parseCentralDirectory(bytes);
  if ('issue' in parsed) {
    return { ok: false, issues: [parsed.issue] };
  }

  const containerIssues = inspectContainer(parsed.entries);
  if (containerIssues.length > 0) {
    // 🔴 Refused before a single entry was expanded.
    return { ok: false, issues: containerIssues };
  }

  if (parsed.entries.some((entry) => !entry.isDirectory && entry.method === COMPRESSION_DEFLATE)) {
    if (typeof DecompressionStream !== 'function') {
      return {
        ok: false,
        issues: [
          issue(
            'archive.decompression-unavailable',
            'This runtime has no deflate decompressor, so the package cannot be validated.',
          ),
        ],
      };
    }
  }

  const entries: ThemeArchiveEntry[] = [];
  for (const entry of parsed.entries) {
    if (entry.isDirectory) {
      entries.push({
        path: entry.path,
        compressedBytes: 0,
        expandedBytes: 0,
        isDirectory: true,
      });
      continue;
    }

    const localHeaderOffset = entry.localHeaderOffset;
    if (
      localHeaderOffset + 30 > bytes.byteLength ||
      readUint32(bytes, localHeaderOffset) !== LOCAL_HEADER_SIGNATURE
    ) {
      return { ok: false, issues: [issue('archive.corrupt', 'A local file header is missing.')] };
    }
    const nameLength = readUint16(bytes, localHeaderOffset + 26);
    const extraLength = readUint16(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedBytes;
    if (dataEnd > bytes.byteLength) {
      return { ok: false, issues: [issue('archive.corrupt', 'Entry data runs past the archive end.')] };
    }
    const compressed = bytes.subarray(dataStart, dataEnd);

    let data: Uint8Array;
    if (entry.method === COMPRESSION_STORED) {
      data = compressed.slice();
    } else if (entry.method === COMPRESSION_DEFLATE) {
      let inflated: Uint8Array | 'expands-too-large';
      try {
        inflated = await inflateDeflateRaw(compressed, entry.expandedBytes);
      } catch {
        return {
          ok: false,
          issues: [issue('archive.corrupt', `"${entry.path}" could not be decompressed.`, entry.path)],
        };
      }
      if (inflated === 'expands-too-large') {
        return {
          ok: false,
          issues: [
            issue(
              'archive.entry-exceeds-declared-size',
              `"${entry.path}" expands past its declared ${entry.expandedBytes} bytes.`,
              entry.path,
            ),
          ],
        };
      }
      data = inflated;
    } else {
      return {
        ok: false,
        issues: [
          issue(
            'archive.unsupported-compression',
            `"${entry.path}" uses compression method ${entry.method}; only stored and deflate are accepted.`,
            entry.path,
          ),
        ],
      };
    }

    entries.push({
      path: entry.path,
      compressedBytes: entry.compressedBytes,
      expandedBytes: data.byteLength,
      data,
      sha256: await sha256Of(data),
    });
  }

  return { ok: true, entries };
};

/** Serialises entries for a size-accounted manifest check (used by tests/CLI). */
export const encodeTextEntry = (text: string): Uint8Array => encoder.encode(text);
