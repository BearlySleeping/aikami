// packages/frontend/theme/src/lib/theme/theme_archive_reader.test.ts
//
// C-530 AC-1 / AC-2 — the Worker-runtime ZIP extractor.
//
// The archive is built here by hand (a ~60-line ZIP writer over
// `node:zlib.deflateRawSync`) rather than by a library, because the hostile
// cases this reader exists to refuse — a symlink entry, a case collision, a
// compression bomb — cannot be produced by a well-behaved writer.

import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { THEME_MAX_ENTRIES } from '@aikami/constants';
import { readThemeArchiveEntries } from './theme_archive_reader.ts';
import { validateThemeArchive } from './theme_archive.ts';

const encoder = new TextEncoder();

type ZipInput = {
  readonly path: string;
  readonly text?: string;
  readonly data?: Uint8Array;
  readonly isDirectory?: boolean;
  readonly isSymlink?: boolean;
  /** Override the *declared* uncompressed size in the central directory. */
  readonly declaredExpandedBytes?: number;
  readonly method?: 'store' | 'deflate';
};

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** A deliberately small ZIP writer, hostile-capable. */
const buildZip = (inputs: readonly ZipInput[]): Uint8Array => {
  const chunks: number[] = [];
  const central: number[] = [];

  for (const input of inputs) {
    const nameBytes = [...encoder.encode(input.path)];
    const raw =
      input.data ?? (input.isDirectory ? new Uint8Array() : encoder.encode(input.text ?? ''));
    const method = input.method ?? 'deflate';
    const stored = method === 'store' || input.isDirectory === true;
    const payload = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const declared = input.declaredExpandedBytes ?? raw.byteLength;
    const localOffset = chunks.length;

    chunks.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(stored ? 0 : 8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(raw)),
      ...u32(payload.byteLength),
      ...u32(declared),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...payload,
    );

    // Unix host (3) so the external attributes carry a file type; a symlink is
    // how an archive escapes its own root.
    const unixMode = input.isSymlink ? 0o120777 : input.isDirectory ? 0o040755 : 0o100644;
    central.push(
      ...u32(0x02014b50),
      ...u16(0x031e),
      ...u16(20),
      ...u16(0),
      ...u16(stored ? 0 : 8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(raw)),
      ...u32(payload.byteLength),
      ...u32(declared),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(unixMode << 16),
      ...u32(localOffset),
      ...nameBytes,
    );
  }

  const directoryOffset = chunks.length;
  const directory = central;
  return new Uint8Array([
    ...chunks,
    ...directory,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(inputs.length),
    ...u16(inputs.length),
    ...u32(directory.length),
    ...u32(directoryOffset),
    ...u16(0),
  ]);
};

const validManifest = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: 'aikami-theme',
    id: 'archive-reader-fixture',
    version: '1.0.0',
    themeApiRange: '>=1.0 <2.0',
    name: 'Archive Reader Fixture',
    author: { displayName: 'Test' },
    license: 'MIT',
    variants: { dark: 'tokens/dark.json' },
    assets: [],
    ...overrides,
  });

const validTokens = JSON.stringify({
  profileVersion: 1,
  variant: 'dark',
  tokens: { 'color.base-100': { $type: 'color', $value: '#101014' } },
});

describe('AC-1: the Worker extractor reads a well-formed package', () => {
  test('extracts entries with real compressed sizes and digests', async () => {
    const archive = buildZip([
      { path: 'theme.json', text: validManifest() },
      { path: 'tokens/dark.json', text: validTokens },
    ]);

    const read = await readThemeArchiveEntries(archive);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.entries.map((entry) => entry.path)).toEqual([
      'theme.json',
      'tokens/dark.json',
    ]);
    for (const entry of read.entries) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.compressedBytes).toBeGreaterThan(0);
      expect(entry.data).toBeDefined();
    }
  });

  test('the shared package validator accepts the extracted entries', async () => {
    const archive = buildZip([
      { path: 'theme.json', text: validManifest() },
      { path: 'tokens/dark.json', text: validTokens },
    ]);

    const read = await readThemeArchiveEntries(archive);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    const validation = validateThemeArchive(read.entries);
    expect(validation.ok).toBe(true);
    expect(validation.manifest?.id).toBe('archive-reader-fixture');
    expect(validation.variants.dark?.length ?? 0).toBeGreaterThan(0);
  });

  test('a stored (uncompressed) archive is accepted too', async () => {
    const archive = buildZip([
      { path: 'theme.json', text: validManifest(), method: 'store' },
      { path: 'tokens/dark.json', text: validTokens, method: 'store' },
    ]);
    const read = await readThemeArchiveEntries(archive);
    expect(read.ok).toBe(true);
  });
});

describe('AC-2: hostile archives are refused before expansion', () => {
  test('a non-ZIP upload is refused', async () => {
    const read = await readThemeArchiveEntries(encoder.encode('not a zip at all'));
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues[0]?.code).toBe('archive.not-a-zip');
  });

  test('an entry count past the limit is refused', async () => {
    const inputs: ZipInput[] = [{ path: 'theme.json', text: validManifest() }];
    for (let index = 0; index <= THEME_MAX_ENTRIES; index += 1) {
      inputs.push({ path: `filler/${index}.txt`, text: 'x' });
    }
    const read = await readThemeArchiveEntries(buildZip(inputs));
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues[0]?.code).toBe('archive.too-many-entries');
  });

  test('a symlink entry is refused', async () => {
    const read = await readThemeArchiveEntries(
      buildZip([
        { path: 'theme.json', text: validManifest() },
        { path: 'escape', isSymlink: true, data: encoder.encode('/etc/passwd') },
      ]),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues.map((entry) => entry.code)).toContain('archive.symlink-entry');
  });

  test('a traversal path is refused', async () => {
    const read = await readThemeArchiveEntries(
      buildZip([
        { path: 'theme.json', text: validManifest() },
        { path: '../outside.json', text: '{}' },
      ]),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues.map((entry) => entry.code)).toContain('archive.invalid-path');
  });

  test('a case collision is refused', async () => {
    const read = await readThemeArchiveEntries(
      buildZip([
        { path: 'theme.json', text: validManifest() },
        { path: 'Tokes.json', text: '{}' },
        { path: 'tokes.json', text: '{}' },
      ]),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues.map((entry) => entry.code)).toContain('archive.duplicate-entry');
  });

  test('a compression bomb is refused WITHOUT being decompressed', async () => {
    // 🔴 The payload is deliberately not valid deflate. If the reader inflated
    // before judging, this would surface as `archive.corrupt`; a bomb verdict
    // proves the ratio guard ran on the directory record alone.
    const archive = buildZip([
      { path: 'theme.json', text: validManifest() },
      {
        path: 'assets/bomb.bin',
        data: encoder.encode('not-deflate'),
        declaredExpandedBytes: 8 * 1024 * 1024,
      },
    ]);
    const read = await readThemeArchiveEntries(archive);
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues.map((entry) => entry.code)).toContain('archive.compression-bomb');
  });

  test('an entry that expands past its declared size is refused', async () => {
    const read = await readThemeArchiveEntries(
      buildZip([
        { path: 'theme.json', text: validManifest() },
        { path: 'assets/liar.bin', text: 'x'.repeat(4096), declaredExpandedBytes: 16 },
      ]),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues.map((entry) => entry.code)).toContain('archive.entry-exceeds-declared-size');
  });

  test('an archive past the byte budget is refused before parsing', async () => {
    const read = await readThemeArchiveEntries(new Uint8Array(11 * 1024 * 1024));
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.issues[0]?.code).toBe('archive.too-large');
  });

  test('a package with an undeclared entry is refused by the shared validator', async () => {
    const archive = buildZip([
      { path: 'theme.json', text: validManifest() },
      { path: 'tokens/dark.json', text: validTokens },
      { path: 'extra.txt', text: 'smuggled' },
    ]);
    const read = await readThemeArchiveEntries(archive);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    const validation = validateThemeArchive(read.entries);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((entry) => entry.code)).toContain('package.undeclared-entry');
  });
});
