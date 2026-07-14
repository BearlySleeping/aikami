// packages/frontend/engine/src/__tests__/asset_manifest.test.ts
//
// Unit tests for the Asset Manifest Scanner (C-243).
// Tests: pathToTag, tagToPath, sanitizeAssetFilename, buildManifest,
// resolveAssetUrl, buildAssetTagList, buildAssetTree, validUniquePath.
//
// Contract: C-243

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetEntry, AssetManifest } from '@aikami/types';
import {
  buildAssetTagList,
  buildAssetTree,
  buildManifest,
  ensureAssetDirs,
  pathToTag,
  resolveAssetUrl,
  sanitizeAssetFilename,
  tagToPath,
  validUniquePath,
} from '../assets/asset_manifest.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `aikami-asset-test-${Date.now()}`);

beforeAll(async () => {
  await mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const writeTestFile = async (relPath: string): Promise<void> => {
  const fullPath = join(testDir, relPath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, 'test');
};

// ---------------------------------------------------------------------------
// pathToTag
// ---------------------------------------------------------------------------

describe('pathToTag', () => {
  test('converts simple path to tag', () => {
    expect(pathToTag('sprites/generic-fantasy/elf-male.png')).toBe(
      'sprites:generic-fantasy:elf-male',
    );
  });

  test('handles nested subdirectories', () => {
    expect(pathToTag('music/combat/fantasy/intense/battle.mp3')).toBe(
      'music:combat:fantasy:intense:battle',
    );
  });

  test('handles files without extension', () => {
    expect(pathToTag('sprites/custom/npc')).toBe('sprites:custom:npc');
  });

  test('handles double extensions', () => {
    expect(pathToTag('data/test.tar.gz')).toBe('data:test.tar');
  });
});

// ---------------------------------------------------------------------------
// tagToPath
// ---------------------------------------------------------------------------

describe('tagToPath', () => {
  test('converts tag back to path', () => {
    expect(tagToPath('sprites:generic-fantasy:elf-male', '.png')).toBe(
      'sprites/generic-fantasy/elf-male.png',
    );
  });

  test('handles nested tags', () => {
    expect(tagToPath('music:combat:fantasy:intense:battle', '.mp3')).toBe(
      'music/combat/fantasy/intense/battle.mp3',
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeAssetFilename
// ---------------------------------------------------------------------------

describe('sanitizeAssetFilename', () => {
  test('lowercases and replaces spaces', () => {
    expect(sanitizeAssetFilename('My Awesome File.png')).toBe('my-awesome-file.png');
  });

  test('removes path separator characters', () => {
    expect(sanitizeAssetFilename('test/file:name*.png')).toBe('test_file_name_.png');
  });

  test('normalizes unicode characters', () => {
    expect(sanitizeAssetFilename('café.png')).toBe('cafe.png');
  });
});

// ---------------------------------------------------------------------------
// ensureAssetDirs
// ---------------------------------------------------------------------------

describe('ensureAssetDirs', () => {
  test('creates all category directories', async () => {
    const dirs = join(testDir, 'ensure-test');
    await ensureAssetDirs(dirs);

    const { stat } = await import('node:fs/promises');

    // Check top-level categories exist
    for (const category of ['music', 'sfx', 'ambient', 'sprites', 'backgrounds']) {
      const s = await stat(join(dirs, category));
      expect(s.isDirectory()).toBe(true);
    }

    // Check nested subdirs
    const s = await stat(join(dirs, 'sprites', 'generic-fantasy'));
    expect(s.isDirectory()).toBe(true);

    await rm(dirs, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

describe('buildManifest', () => {
  test('builds manifest from populated directory', async () => {
    const dirs = join(testDir, 'scan-test');
    await ensureAssetDirs(dirs);

    // Create test files
    await writeTestFile(join(dirs, 'sprites/generic-fantasy/elf.png').replace(`${testDir}/`, ''));
    await writeTestFile(
      join(dirs, 'sprites/generic-fantasy/goblin.png').replace(`${testDir}/`, ''),
    );
    await writeTestFile(join(dirs, 'backgrounds/fantasy/forest.png').replace(`${testDir}/`, ''));
    await writeTestFile(
      join(dirs, 'music/exploration/fantasy/calm/wanderer.mp3').replace(`${testDir}/`, ''),
    );

    const manifest = await buildManifest(dirs);

    expect(manifest.count).toBe(4);
    expect(Object.keys(manifest.assets).length).toBe(4);

    // Tag lookup
    expect(manifest.assets['sprites:generic-fantasy:elf']).toBeDefined();
    expect(manifest.assets['sprites:generic-fantasy:elf']?.tag).toBe('sprites:generic-fantasy:elf');
    expect(manifest.assets['sprites:generic-fantasy:elf']?.category).toBe('sprites');
    expect(manifest.assets['sprites:generic-fantasy:elf']?.ext).toBe('.png');

    // Category grouping
    expect(manifest.byCategory.sprites).toBeDefined();
    expect(manifest.byCategory.sprites?.length).toBe(2);
    expect(manifest.byCategory.backgrounds?.length).toBe(1);
    expect(manifest.byCategory.music?.length).toBe(1);

    // Empty categories should have empty arrays
    expect(manifest.byCategory.sfx?.length).toBe(0);
    expect(manifest.byCategory.ambient?.length).toBe(0);

    await rm(dirs, { recursive: true, force: true });
  });

  test('excludes hidden files', async () => {
    const dirs = join(testDir, 'hidden-test');
    await ensureAssetDirs(dirs);

    await writeTestFile(
      join(dirs, 'sprites/generic-fantasy/visible.png').replace(`${testDir}/`, ''),
    );
    await writeTestFile(
      join(dirs, 'sprites/generic-fantasy/.hidden.png').replace(`${testDir}/`, ''),
    );

    // Let's write .hidden manually to the right path
    await writeFile(join(dirs, 'sprites/generic-fantasy/.hidden.png'), 'test');

    const manifest = await buildManifest(dirs);

    expect(manifest.count).toBe(1);
    expect(manifest.assets['sprites:generic-fantasy:visible']).toBeDefined();

    await rm(dirs, { recursive: true, force: true });
  });

  test('excludes unknown extensions', async () => {
    const dirs = join(testDir, 'ext-test');
    await ensureAssetDirs(dirs);

    await writeTestFile(join(dirs, 'sprites/generic-fantasy/valid.png').replace(`${testDir}/`, ''));
    await writeFile(join(dirs, 'sprites/generic-fantasy/bad.txt'), 'test');
    await writeFile(join(dirs, 'sprites/generic-fantasy/nope.pdf'), 'test');

    const manifest = await buildManifest(dirs);

    expect(manifest.count).toBe(1);
    expect(manifest.assets['sprites:generic-fantasy:valid']).toBeDefined();

    await rm(dirs, { recursive: true, force: true });
  });

  test('writes manifest.json to disk', async () => {
    const dirs = join(testDir, 'persist-test');
    const manifest = await buildManifest(dirs);

    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(join(dirs, 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.scannedAt).toBeDefined();
    expect(parsed.count).toBe(manifest.count);

    await rm(dirs, { recursive: true, force: true });
  });

  test('empty directories produce no entries', async () => {
    const dirs = join(testDir, 'empty-test');
    await ensureAssetDirs(dirs);

    // No files added
    const manifest = await buildManifest(dirs);

    expect(manifest.count).toBe(0);
    expect(Object.keys(manifest.assets).length).toBe(0);

    await rm(dirs, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// resolveAssetUrl
// ---------------------------------------------------------------------------

describe('resolveAssetUrl', () => {
  const manifest: AssetManifest = {
    scannedAt: '2026-01-01T00:00:00.000Z',
    count: 2,
    assets: {
      'backgrounds:fantasy:dark-forest': {
        tag: 'backgrounds:fantasy:dark-forest',
        category: 'backgrounds',
        subcategory: 'fantasy',
        name: 'dark-forest',
        path: 'backgrounds/fantasy/dark-forest.png',
        ext: '.png',
      },
      'sprites:generic-fantasy:elf': {
        tag: 'sprites:generic-fantasy:elf',
        category: 'sprites',
        subcategory: 'generic-fantasy',
        name: 'elf',
        path: 'sprites/generic-fantasy/elf.png',
        ext: '.png',
      },
    },
    byCategory: {
      music: [],
      sfx: [],
      ambient: [],
      sprites: [
        {
          tag: 'sprites:generic-fantasy:elf',
          category: 'sprites',
          subcategory: 'generic-fantasy',
          name: 'elf',
          path: 'sprites/generic-fantasy/elf.png',
          ext: '.png',
        },
      ],
      backgrounds: [
        {
          tag: 'backgrounds:fantasy:dark-forest',
          category: 'backgrounds',
          subcategory: 'fantasy',
          name: 'dark-forest',
          path: 'backgrounds/fantasy/dark-forest.png',
          ext: '.png',
        },
      ],
    },
  };

  test('resolves known tag to URL', () => {
    const url = resolveAssetUrl({
      tag: 'backgrounds:fantasy:dark-forest',
      manifest,
    });
    expect(url).toBe('/api/assets/file/backgrounds/fantasy/dark-forest.png');
  });

  test('returns null for unknown tag', () => {
    const url = resolveAssetUrl({
      tag: 'nonexistent:tag',
      manifest,
    });
    expect(url).toBeNull();
  });

  test('respects custom baseUrl', () => {
    const url = resolveAssetUrl({
      tag: 'sprites:generic-fantasy:elf',
      manifest,
      baseUrl: 'https://example.com/assets/',
    });
    expect(url).toBe('https://example.com/assets/sprites/generic-fantasy/elf.png');
  });

  test('handles special characters in path', () => {
    const m: AssetManifest = {
      ...manifest,
      assets: {
        'sprites:custom:my sprite': {
          tag: 'sprites:custom:my sprite',
          category: 'sprites',
          subcategory: 'custom',
          name: 'my sprite',
          path: 'sprites/custom/my sprite.png',
          ext: '.png',
        },
      },
    };
    const url = resolveAssetUrl({
      tag: 'sprites:custom:my sprite',
      manifest: m,
    });
    expect(url).toContain('my%20sprite.png');
  });
});

// ---------------------------------------------------------------------------
// buildAssetTagList
// ---------------------------------------------------------------------------

describe('buildAssetTagList', () => {
  test('formats tags grouped by category', () => {
    const manifest: AssetManifest = {
      scannedAt: '2026-01-01T00:00:00.000Z',
      count: 4,
      assets: {},
      byCategory: {
        music: [
          {
            tag: 'music:exploration:fantasy:calm:wanderer',
            category: 'music',
            subcategory: 'exploration/fantasy/calm',
            name: 'wanderer',
            path: 'music/exploration/fantasy/calm/wanderer.mp3',
            ext: '.mp3',
          },
        ],
        sfx: [
          {
            tag: 'sfx:ui:click',
            category: 'sfx',
            subcategory: 'ui',
            name: 'click',
            path: 'sfx/ui/click.wav',
            ext: '.wav',
          },
          {
            tag: 'sfx:combat:slash',
            category: 'sfx',
            subcategory: 'combat',
            name: 'slash',
            path: 'sfx/combat/slash.ogg',
            ext: '.ogg',
          },
        ],
        ambient: [],
        sprites: [],
        backgrounds: [
          {
            tag: 'backgrounds:fantasy:forest',
            category: 'backgrounds',
            subcategory: 'fantasy',
            name: 'forest',
            path: 'backgrounds/fantasy/forest.png',
            ext: '.png',
          },
        ],
      },
    };

    const tagList = buildAssetTagList(manifest);

    expect(tagList).toContain('backgrounds:');
    expect(tagList).toContain('backgrounds:fantasy:forest');
    expect(tagList).toContain('music:');
    expect(tagList).toContain('music:exploration:fantasy:calm:wanderer');
    expect(tagList).toContain('sfx:');
    expect(tagList).toContain('sfx:ui:click');

    // Empty categories should be omitted
    expect(tagList).not.toContain('ambient:');
    expect(tagList).not.toContain('sprites:');
  });
});

// ---------------------------------------------------------------------------
// buildAssetTree
// ---------------------------------------------------------------------------

describe('buildAssetTree', () => {
  test('builds hierarchical tree from manifest', () => {
    const assets: Record<string, AssetEntry> = {
      'sprites:generic-fantasy:elf': {
        tag: 'sprites:generic-fantasy:elf',
        category: 'sprites',
        subcategory: 'generic-fantasy',
        name: 'elf',
        path: 'sprites/generic-fantasy/elf.png',
        ext: '.png',
      },
      'backgrounds:fantasy:forest': {
        tag: 'backgrounds:fantasy:forest',
        category: 'backgrounds',
        subcategory: 'fantasy',
        name: 'forest',
        path: 'backgrounds/fantasy/forest.png',
        ext: '.png',
      },
    };

    const manifest: AssetManifest = {
      scannedAt: '2026-01-01T00:00:00.000Z',
      count: 2,
      assets,
      byCategory: {
        music: [],
        sfx: [],
        ambient: [],
        sprites: [assets['sprites:generic-fantasy:elf']],
        backgrounds: [assets['backgrounds:fantasy:forest']],
      },
    };

    const tree = buildAssetTree(manifest);

    // Root nodes should be categories
    expect(tree.length).toBeGreaterThan(0);

    const spritesNode = tree.find((n) => n.name === 'sprites');
    expect(spritesNode).toBeDefined();
    expect(spritesNode?.isDirectory).toBe(true);

    // Should have generic-fantasy subdirectory
    const gfNode = spritesNode?.children.find((n) => n.name === 'generic-fantasy');
    expect(gfNode).toBeDefined();
    expect(gfNode?.isDirectory).toBe(true);

    // Should have elf.png file
    const elfNode = gfNode?.children.find((n) => n.name === 'elf.png');
    expect(elfNode).toBeDefined();
    expect(elfNode?.isDirectory).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validUniquePath
// ---------------------------------------------------------------------------

describe('validUniquePath', () => {
  const manifest: AssetManifest = {
    scannedAt: '2026-01-01T00:00:00.000Z',
    count: 1,
    assets: {
      'sprites:generic-fantasy:elf': {
        tag: 'sprites:generic-fantasy:elf',
        category: 'sprites',
        subcategory: 'generic-fantasy',
        name: 'elf',
        path: 'sprites/generic-fantasy/elf.png',
        ext: '.png',
      },
    },
    byCategory: {
      music: [],
      sfx: [],
      ambient: [],
      sprites: [
        {
          tag: 'sprites:generic-fantasy:elf',
          category: 'sprites',
          subcategory: 'generic-fantasy',
          name: 'elf',
          path: 'sprites/generic-fantasy/elf.png',
          ext: '.png',
        },
      ],
      backgrounds: [],
    },
  };

  test('returns original path when no collision', () => {
    const result = validUniquePath(manifest, 'sprites/generic-fantasy/new-file.png');
    expect(result).toBe('sprites/generic-fantasy/new-file.png');
  });

  test('appends -1 suffix on first collision', () => {
    const result = validUniquePath(manifest, 'sprites/generic-fantasy/elf.png');
    expect(result).toBe('sprites/generic-fantasy/elf-1.png');
  });

  test('increments suffix on multiple collisions', () => {
    // Add elf-1 to manifest to simulate it already being taken
    const m: AssetManifest = {
      ...manifest,
      assets: {
        ...manifest.assets,
        'sprites:generic-fantasy:elf-1': {
          tag: 'sprites:generic-fantasy:elf-1',
          category: 'sprites',
          subcategory: 'generic-fantasy',
          name: 'elf-1',
          path: 'sprites/generic-fantasy/elf-1.png',
          ext: '.png',
        },
      },
    };
    const result = validUniquePath(m, 'sprites/generic-fantasy/elf.png');
    expect(result).toBe('sprites/generic-fantasy/elf-2.png');
  });
});
