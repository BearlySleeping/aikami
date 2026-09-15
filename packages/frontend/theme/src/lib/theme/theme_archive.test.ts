// packages/frontend/theme/src/lib/theme/theme_archive.test.ts
//
// C-529 AC-3 / AC-4 — the package envelope.
//
// Export is tested for what it CONTAINS (and, more importantly, what it cannot
// contain), and import for what it REJECTS: entry-count and byte budgets,
// in-archive symlinks, case collisions, compression bombs, and the full
// structural verdict from the shared package validator.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  THEME_MAX_ARCHIVE_BYTES,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
} from '@aikami/constants';
import { OBSIDIAN_CHRONICLE_DARK, OBSIDIAN_CHRONICLE_LIGHT } from './builtin_theme.ts';
import {
  buildThemePackage,
  checkThemeArchiveContainer,
  THEME_ARCHIVE_MANIFEST_ENTRY,
  THEME_COMPRESSION_RATIO_FLOOR_BYTES,
  THEME_MAX_COMPRESSION_RATIO,
  type ThemeArchiveEntry,
  toArchiveEntries,
  validateThemeArchive,
} from './theme_archive.ts';

const hasher = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');

const encoder = new TextEncoder();

const build = () =>
  buildThemePackage(
    {
      id: 'obsidian-chronicle-starter',
      version: '1.0.0',
      name: 'Obsidian Chronicle Starter',
      authorDisplayName: 'Aikami',
      license: 'MIT',
      themeApiRange: '>=1.0 <2.0',
      variants: { light: OBSIDIAN_CHRONICLE_LIGHT, dark: OBSIDIAN_CHRONICLE_DARK },
    },
    hasher,
  );

const entry = (overrides: Partial<ThemeArchiveEntry> & { path: string }): ThemeArchiveEntry => ({
  compressedBytes: 100,
  expandedBytes: 200,
  ...overrides,
});

describe('C-529 AC-3 package export', () => {
  test('a built package declares every file it contains, with real bytes and hashes', async () => {
    const built = await build();
    const paths = built.files.map((file) => file.path).sort();
    expect(paths).toEqual([THEME_ARCHIVE_MANIFEST_ENTRY, 'tokens/dark.json', 'tokens/light.json']);
    expect(built.manifest.variants).toEqual({
      light: 'tokens/light.json',
      dark: 'tokens/dark.json',
    });
    // No assets were supplied, so the manifest declares none — an export never
    // invents entries.
    expect(built.manifest.assets).toEqual([]);
  });

  test('the exported manifest carries only the documented envelope fields', async () => {
    const built = await build();
    expect(Object.keys(built.manifest).sort()).toEqual([
      'assets',
      'author',
      'id',
      'kind',
      'license',
      'name',
      'schemaVersion',
      'themeApiRange',
      'variants',
      'version',
    ]);
    // Private data has no field to leak through: the manifest is assembled from
    // an allowlist, and every exported file is either a declared token file or a
    // declared asset.
    const manifestJson = JSON.stringify(built.manifest).toLowerCase();
    for (const forbidden of ['preference', 'campaign', 'save', 'secret', 'screenshot', 'device']) {
      expect(manifestJson).not.toContain(forbidden);
    }
    const variantFile = built.files.find((file) => file.path === 'tokens/light.json');
    const variantJson = JSON.parse(variantFile?.text ?? '{}');
    expect(Object.keys(variantJson).sort()).toEqual(['profileVersion', 'tokens', 'variant']);
  });

  test('a declared asset is hashed from its actual bytes, not from a caller value', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const built = await buildThemePackage(
      {
        id: 'with-asset',
        version: '1.0.0',
        name: 'With asset',
        authorDisplayName: 'Aikami',
        license: 'MIT',
        themeApiRange: '>=1.0 <2.0',
        variants: { light: OBSIDIAN_CHRONICLE_LIGHT },
        assets: [{ path: 'assets/ornament.png', mediaType: 'image/png', bytes }],
      },
      hasher,
    );
    expect(built.manifest.assets[0]?.bytes).toBe(bytes.byteLength);
    expect(built.manifest.assets[0]?.sha256).toBe(await hasher(bytes));
  });

  test('the optional HUD preset is declared but never applied by the package', async () => {
    const built = await buildThemePackage(
      {
        id: 'with-preset',
        version: '1.0.0',
        name: 'With preset',
        authorDisplayName: 'Aikami',
        license: 'MIT',
        themeApiRange: '>=1.0 <2.0',
        variants: { light: OBSIDIAN_CHRONICLE_LIGHT },
        hudPreset: 'presets/hud.json',
      },
      hasher,
    );
    expect(built.manifest.hudPreset).toBe('presets/hud.json');
  });

  test('a round trip through the archive reader validates', async () => {
    const built = await build();
    const entries = await toArchiveEntries(built, hasher, () => 100);
    const result = validateThemeArchive(entries);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.id).toBe('obsidian-chronicle-starter');
    expect(Object.keys(result.variants).sort()).toEqual(['dark', 'light']);
  });
});

describe('C-529 AC-4 archive container rejection', () => {
  test('rejects an in-archive symlink entry', () => {
    const issues = checkThemeArchiveContainer([
      entry({ path: 'theme.json' }),
      entry({ path: 'tokens/light.json', isSymlink: true }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain('archive.symlink-entry');
  });

  test('rejects too many entries', () => {
    const entries = Array.from({ length: THEME_MAX_ENTRIES + 1 }, (_, index) =>
      entry({ path: `tokens/${index}.json` }),
    );
    expect(checkThemeArchiveContainer(entries).map((issue) => issue.code)).toContain(
      'archive.too-many-entries',
    );
  });

  test('rejects an archive over the compressed ceiling', () => {
    const issues = checkThemeArchiveContainer([
      entry({
        path: 'theme.json',
        compressedBytes: THEME_MAX_ARCHIVE_BYTES + 1,
        expandedBytes: 10,
      }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain('archive.too-large');
  });

  test('rejects an archive that expands past the ceiling', () => {
    const issues = checkThemeArchiveContainer([
      entry({
        path: 'theme.json',
        compressedBytes: 10,
        expandedBytes: THEME_MAX_EXPANDED_BYTES + 1,
      }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain('archive.expands-too-large');
  });

  test('rejects a compression bomb', () => {
    const issues = checkThemeArchiveContainer([
      entry({
        path: 'assets/bomb.bin',
        compressedBytes: 2048,
        expandedBytes: THEME_COMPRESSION_RATIO_FLOOR_BYTES * 4,
      }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain('archive.compression-bomb');
  });

  test('does not flag a legitimately well-compressed small entry', () => {
    expect(
      checkThemeArchiveContainer([
        entry({ path: 'theme.json', compressedBytes: 64, expandedBytes: 4096 }),
      ]),
    ).toEqual([]);
    expect(THEME_MAX_COMPRESSION_RATIO).toBeGreaterThan(100);
  });

  test('rejects duplicate and case-colliding entry paths', () => {
    const issues = checkThemeArchiveContainer([
      entry({ path: 'tokens/light.json' }),
      entry({ path: 'TOKENS/Light.JSON' }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain('archive.duplicate-entry');
  });

  test('rejects traversal and absolute entry paths', () => {
    for (const path of ['../escape.json', '/etc/passwd', 'tokens\\light.json']) {
      expect(checkThemeArchiveContainer([entry({ path })]).map((issue) => issue.code)).toContain(
        'archive.invalid-path',
      );
    }
  });

  test('a hostile container is rejected before the manifest is ever read', () => {
    const result = validateThemeArchive([
      entry({ path: '../escape.json', data: encoder.encode('{}') }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeUndefined();
  });

  test('a container that passes but declares an undeclared file is still rejected', async () => {
    const built = await build();
    const entries = [
      ...(await toArchiveEntries(built, hasher, () => 100)),
      entry({ path: 'payload.js', data: encoder.encode('alert(1)'), sha256: 'x' }),
    ];
    const result = validateThemeArchive(entries);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain('package.undeclared-entry');
  });

  test('a tampered token file inside a valid archive is rejected', async () => {
    const built = await build();
    const entries = await toArchiveEntries(built, hasher, () => 100);
    const tampered = entries.map((item) =>
      item.path === 'tokens/light.json'
        ? {
            ...item,
            data: encoder.encode(
              JSON.stringify({
                profileVersion: 1,
                variant: 'light',
                tokens: {
                  'color.primary': { $type: 'color', $value: 'url(https://evil.example/x)' },
                },
              }),
            ),
          }
        : item,
    );
    const result = validateThemeArchive(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain('token.unsupported-color');
  });
});
