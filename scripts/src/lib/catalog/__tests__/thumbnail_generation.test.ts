// scripts/src/lib/catalog/__tests__/thumbnail_generation.test.ts
//
// C-396 AC-5: sprite-sheet previews are single-frame thumbnails, not raw
// sheets.
//
// Crop-correctness is asserted against KNOWN frame boundaries, not just "an
// image file was produced": each fixture frame is painted a distinct colour,
// and the generated thumbnail must be exactly the intended first frame of the
// first direction row — never part of two frames, never a mid-frame crop,
// never a wrong-direction frame.
//
// Fixture states cover the different frame grids called out by the contract:
// walk (9×4), thrust (8×4), idle (2×4) and the single-row hurt (6×1), plus an
// unknown state that must fall back to the defined safe frame and report.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sharp is a devDependency of scripts; import lazily like the module under test.
let sharp: typeof import('sharp').default;
let fixtureDir: string;

type Rgb = { r: number; g: number; b: number };

const FRAME = 64;

/** Paint a sheet where frame (0,0) is `frame0Color` and every other pixel is a constant filler. */
const makeSheet = async (framesPerRow: number, rows: number, frame0Color: Rgb): Promise<Buffer> => {
  const width = framesPerRow * FRAME;
  const height = rows * FRAME;
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isFrame0 = x < FRAME && y < FRAME;
      const color = isFrame0 ? frame0Color : { r: 30, g: 60, b: 120 };
      const i = (y * width + x) * 4;
      buf[i] = color.r;
      buf[i + 1] = color.g;
      buf[i + 2] = color.b;
      buf[i + 3] = 255;
    }
  }
  return sharp(buf, { raw: { width, height, channels: 4 } })
    .webp()
    .toBuffer();
};

/** Read the top-left pixel of a generated thumbnail. */
const readPixel = async (bytes: Uint8Array): Promise<Rgb> => {
  const { data } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
};

/** Read the bottom-right pixel of a generated thumbnail. */
const readCornerPixel = async (bytes: Uint8Array): Promise<Rgb> => {
  const { data, info } = await sharp(Buffer.from(bytes))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (info.height * info.width - 1) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
};

/** Euclidean distance between two colours. */
const colorDistance = (a: Rgb, b: Rgb): number =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

/**
 * Assert the bottom-right pixel belongs to frame 0, NOT the fixture's filler
 * colour (30,60,120) — a crop spilling into a neighbouring frame or direction
 * row would show filler at the corner. Distance comparison instead of a tight
 * per-channel tolerance: webp's lossy encoding shifts edge pixels by tens of
 * levels, so the meaningful boundary assertion is "closer to frame 0 than to
 * the filler", not "exactly frame 0".
 */
const expectCornerIsFrame0 = async (bytes: Uint8Array, frame0: Rgb): Promise<void> => {
  const corner = await readCornerPixel(bytes);
  const FILLER: Rgb = { r: 30, g: 60, b: 120 };
  expect(colorDistance(corner, frame0)).toBeLessThan(colorDistance(corner, FILLER));
};

const expectPixelClose = (actual: Rgb, expected: Rgb): void => {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(6);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(6);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(6);
};

beforeAll(async () => {
  sharp = (await import('sharp')).default;
  fixtureDir = mkdtempSync(join(tmpdir(), 'catalog-thumb-fixture-'));

  // walk: 9 frames × 4 rows, frame 0 = red
  writeFileSync(join(fixtureDir, 'walk.webp'), await makeSheet(9, 4, { r: 220, g: 30, b: 30 }));
  // thrust: 8 frames × 4 rows, frame 0 = green
  writeFileSync(join(fixtureDir, 'thrust.webp'), await makeSheet(8, 4, { r: 30, g: 200, b: 40 }));
  // idle: 2 frames × 4 rows, frame 0 = blue
  writeFileSync(join(fixtureDir, 'idle.webp'), await makeSheet(2, 4, { r: 40, g: 80, b: 230 }));
  // hurt: 6 frames × 1 row (single-direction layout), frame 0 = magenta
  writeFileSync(join(fixtureDir, 'hurt.webp'), await makeSheet(6, 1, { r: 200, g: 30, b: 180 }));
  // unknown state: 13 frames × 4 rows, frame 0 = orange (must still crop frame 0)
  writeFileSync(
    join(fixtureDir, 'mystate.webp'),
    await makeSheet(13, 4, { r: 240, g: 140, b: 20 }),
  );
  // single non-LPC image: a 256×256 portrait, top-left teal (thumbnail = whole image)
  writeFileSync(
    join(fixtureDir, 'portrait.webp'),
    await makeSheet(4, 4, { r: 20, g: 180, b: 170 }),
  );
});

afterAll(() => {});

describe('frame geometry table — C-396 AC-5', () => {
  test('known states resolve explicit geometry, never the fallback', async () => {
    const { resolveFrameGeometry } = await import('../thumbnail_generation.ts');
    expect(resolveFrameGeometry('walk')).toEqual({
      geometry: { frameSize: 64, framesPerRow: 9, rows: 4 },
      usedFallback: false,
    });
    expect(resolveFrameGeometry('thrust')).toEqual({
      geometry: { frameSize: 64, framesPerRow: 8, rows: 4 },
      usedFallback: false,
    });
    expect(resolveFrameGeometry('idle')).toEqual({
      geometry: { frameSize: 64, framesPerRow: 2, rows: 4 },
      usedFallback: false,
    });
    // Single-row state.
    expect(resolveFrameGeometry('hurt')).toEqual({
      geometry: { frameSize: 64, framesPerRow: 6, rows: 1 },
      usedFallback: false,
    });
  });

  test('unknown state falls back to the defined safe frame and reports', async () => {
    const { resolveFrameGeometry } = await import('../thumbnail_generation.ts');
    const result = resolveFrameGeometry('totally_unknown_state');
    expect(result.usedFallback).toBe(true);
    expect(result.geometry.frameSize).toBe(64);
  });

  test('state is derived from the tag last segment', async () => {
    const { extractStateFromTag } = await import('../thumbnail_generation.ts');
    expect(extractStateFromTag('lpc:hat:magic:celestial_adult:thrust')).toBe('thrust');
    expect(extractStateFromTag('sprites:combat:enemy_portrait')).toBe('enemy_portrait');
  });
});

describe('generateThumbnail — crop correctness against known boundaries', () => {
  test('walk crops the south-facing first frame (9×4 grid), never a mid-frame', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'walk.webp'),
      category: 'lpc',
      state: 'walk',
    });
    expect(thumb.geometry).toEqual({ frameSize: 64, framesPerRow: 9, rows: 4 });
    expect(thumb.usedFallback).toBe(false);
    expect(thumb.hash).toMatch(/^[a-f0-9]{64}$/);

    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expect(meta.format).toBe('webp');

    const pixel = await readPixel(thumb.bytes);
    expectPixelClose(pixel, { r: 220, g: 30, b: 30 });
  });

  test('thrust crops the first frame of its 8×4 grid — dims and corner prove the boundary', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'thrust.webp'),
      category: 'lpc',
      state: 'thrust',
    });
    expect(thumb.geometry.framesPerRow).toBe(8);
    // Exactly one frame — never wider/taller (a crop containing a second
    // frame or direction row would show filler at the corner).
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expectPixelClose(await readPixel(thumb.bytes), { r: 30, g: 200, b: 40 });
    // Boundary: the last pixel must still be frame 0, never the filler.
    await expectCornerIsFrame0(thumb.bytes, { r: 30, g: 200, b: 40 });
  });

  test('idle crops the first frame of its 2×4 grid', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'idle.webp'),
      category: 'lpc',
      state: 'idle',
    });
    expect(thumb.geometry.framesPerRow).toBe(2);
    expectPixelClose(await readPixel(thumb.bytes), { r: 40, g: 80, b: 230 });
  });

  test('hurt crops the single-row 6×1 layout correctly — dims and corner prove the boundary', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'hurt.webp'),
      category: 'lpc',
      state: 'hurt',
    });
    expect(thumb.geometry.rows).toBe(1);
    // Single-row sheet: the crop must be 64×64 and end before frame 1 —
    // the bottom-right pixel proves no neighbouring frame leaks in.
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expectPixelClose(await readPixel(thumb.bytes), { r: 200, g: 30, b: 180 });
    await expectCornerIsFrame0(thumb.bytes, { r: 200, g: 30, b: 180 });
  });

  test('unknown state still crops the top-left frame and reports the fallback', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'mystate.webp'),
      category: 'lpc',
      state: 'mystate',
    });
    expect(thumb.usedFallback).toBe(true);
    // The safe frame is frame 0 of row 0 — the orange frame.
    expectPixelClose(await readPixel(thumb.bytes), { r: 240, g: 140, b: 20 });
  });

  test('non-LPC image assets thumbnail the WHOLE image, not a 64px crop', async () => {
    const { generateThumbnail } = await import('../thumbnail_generation.ts');
    const thumb = await generateThumbnail({
      sourcePath: join(fixtureDir, 'portrait.webp'),
      category: 'sprites',
    });
    // Whole-image thumbnail: 256×256, top-left pixel is the portrait's frame-0 colour.
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expectPixelClose(await readPixel(thumb.bytes), { r: 20, g: 180, b: 170 });
  });

  test('thumbnail object keys live under thumbnails/, distinct from the asset sheet', async () => {
    const { thumbnailObjectKey } = await import('../thumbnail_generation.ts');
    const hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    expect(thumbnailObjectKey(hash)).toBe(
      'thumbnails/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.webp',
    );
    expect(thumbnailObjectKey(hash)).not.toContain('assets/');
  });
});

describe('pipeline integration — thumbnailHash lands in the republished index (AC-5)', () => {
  test('image entries gain thumbnailHash; audio entries do not; thumbnails upload under thumbnails/', async () => {
    const { mkdirSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'catalog-thumb-pipeline-'));
    mkdirSync(join(dir, 'lpc', 'hat', 'magic'), { recursive: true });
    mkdirSync(join(dir, 'music', 'exploration'), { recursive: true });
    mkdirSync(join(dir, 'sprites', 'combat'), { recursive: true });

    // Real images: thrust 8×4 (red frame 0), idle 2×4 (blue frame 0),
    // portrait 256×256, and one text-bytes .webp that sharp cannot decode
    // (must degrade to no thumbnail, not a hard failure).
    writeFileSync(
      join(dir, 'lpc/hat/magic/celestial_adult.thrust.webp'),
      await makeSheet(8, 4, { r: 220, g: 30, b: 30 }),
    );
    writeFileSync(
      join(dir, 'lpc/hat/magic/celestial_adult.idle.webp'),
      await makeSheet(2, 4, { r: 40, g: 80, b: 230 }),
    );
    writeFileSync(
      join(dir, 'sprites/combat/enemy_portrait.webp'),
      await makeSheet(4, 4, { r: 20, g: 180, b: 170 }),
    );
    writeFileSync(join(dir, 'lpc/hat/magic/corrupt_sheet.webp'), Buffer.from('not-an-image'));
    writeFileSync(join(dir, 'music/exploration/bgm_explore.webm'), Buffer.from('music-bytes'));

    const hashOf = (bytes: Uint8Array | string): string => {
      const { createHash } = require('node:crypto') as typeof import('node:crypto');
      return createHash('sha256').update(bytes).digest('hex');
    };
    const hThrust = hashOf('thrust');
    const hIdle = hashOf('idle');
    const hPortrait = hashOf('portrait');
    const hMusic = hashOf('music');
    const hCorrupt = hashOf('corrupt');

    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        scannedAt: '2026-08-15T00:00:00.000Z',
        count: 5,
        assets: {
          'lpc:hat:magic:celestial_adult:thrust': {
            tag: 'lpc:hat:magic:celestial_adult:thrust',
            category: 'lpc',
            subcategory: 'hat/magic',
            name: 'celestial_adult.thrust',
            path: 'lpc/hat/magic/celestial_adult.thrust.webp',
            ext: '.webp',
          },
          'lpc:hat:magic:celestial_adult:idle': {
            tag: 'lpc:hat:magic:celestial_adult:idle',
            category: 'lpc',
            subcategory: 'hat/magic',
            name: 'celestial_adult.idle',
            path: 'lpc/hat/magic/celestial_adult.idle.webp',
            ext: '.webp',
          },
          'lpc:hat:magic:corrupt_sheet': {
            tag: 'lpc:hat:magic:corrupt_sheet',
            category: 'lpc',
            subcategory: 'hat/magic',
            name: 'corrupt_sheet',
            path: 'lpc/hat/magic/corrupt_sheet.webp',
            ext: '.webp',
          },
          'music:exploration:bgm_explore': {
            tag: 'music:exploration:bgm_explore',
            category: 'music',
            subcategory: 'exploration',
            name: 'bgm_explore',
            path: 'music/exploration/bgm_explore.webm',
            ext: '.webm',
          },
          'sprites:combat:enemy_portrait': {
            tag: 'sprites:combat:enemy_portrait',
            category: 'sprites',
            subcategory: 'combat',
            name: 'enemy_portrait',
            path: 'sprites/combat/enemy_portrait.webp',
            ext: '.webp',
          },
        },
      }),
    );
    writeFileSync(
      join(dir, 'asset_hashes.json'),
      JSON.stringify({
        scannedAt: '2026-08-15T00:00:00.000Z',
        hashes: {
          'lpc:hat:magic:celestial_adult:thrust': { hash: hThrust, sizeBytes: 1 },
          'lpc:hat:magic:celestial_adult:idle': { hash: hIdle, sizeBytes: 1 },
          'lpc:hat:magic:corrupt_sheet': { hash: hCorrupt, sizeBytes: 1 },
          'music:exploration:bgm_explore': { hash: hMusic, sizeBytes: 1 },
          'sprites:combat:enemy_portrait': { hash: hPortrait, sizeBytes: 1 },
        },
      }),
    );
    writeFileSync(
      join(dir, 'asset_credits.json'),
      JSON.stringify({
        scannedAt: '2026-08-15T00:00:00.000Z',
        credits: {
          'lpc:hat:magic:celestial_adult:thrust': {
            licenses: ['OGA-BY 3.0'],
            authors: ['bluecarrot16'],
            sourceUrls: [],
            source: 'lpc',
          },
          'lpc:hat:magic:celestial_adult:idle': {
            licenses: ['OGA-BY 3.0'],
            authors: ['bluecarrot16'],
            sourceUrls: [],
            source: 'lpc',
          },
          'lpc:hat:magic:corrupt_sheet': {
            licenses: ['OGA-BY 3.0'],
            authors: ['bluecarrot16'],
            sourceUrls: [],
            source: 'lpc',
          },
          'music:exploration:bgm_explore': {
            licenses: ['MIT'],
            authors: ['Aikami Studio'],
            sourceUrls: [],
            source: 'project',
          },
          'sprites:combat:enemy_portrait': {
            licenses: ['MIT'],
            authors: ['Aikami Studio'],
            sourceUrls: [],
            source: 'project',
          },
        },
      }),
    );

    const { FakeR2Client } = await import('./fixtures.ts');
    const { runCatalogPublish } = await import('../pipeline.ts');
    const client = new FakeR2Client();
    const report = await runCatalogPublish({
      config: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
        endpoint: 'https://example.com',
        bucket: 'test',
        originUrl: 'https://assets.example.com',
      },
      client,
      gameDataDir: dir,
    });

    expect(report.ok).toBe(true);
    // 3 image entries generated (corrupt one degrades, music skipped).
    expect(report.thumbnails.generated).toBe(3);
    expect(report.thumbnails.skippedNonImage).toBe(1);
    expect(report.thumbnails.decodeFailedTags).toEqual(['lpc:hat:magic:corrupt_sheet']);

    // Every thumbnail object lives under the thumbnails/ prefix.
    const thumbKeys = [...client.objects.keys()].filter((key) => key.startsWith('thumbnails/'));
    expect(thumbKeys).toHaveLength(3);
    expect(thumbKeys.every((key) => /^thumbnails\/[a-f0-9]{2}\//.test(key))).toBe(true);

    // The republished LPC shard carries thumbnailHash for the two decodable
    // entries; the corrupt one and the music entry do not.
    const lpcShard = client.objects.get('index/v1/lpc.json');
    expect(lpcShard).toBeDefined();
    const lpcShardBody = lpcShard?.body ?? new Uint8Array();
    const shardJson = JSON.parse(Buffer.from(lpcShardBody).toString('utf8')) as {
      entries: Array<{ tag: string; thumbnailHash?: string }>;
    };
    const byTag = new Map(shardJson.entries.map((entry) => [entry.tag, entry]));
    expect(byTag.get('lpc:hat:magic:celestial_adult:thrust')?.thumbnailHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(byTag.get('lpc:hat:magic:celestial_adult:idle')?.thumbnailHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(byTag.get('lpc:hat:magic:corrupt_sheet')?.thumbnailHash).toBeUndefined();
    expect(byTag.get('music:exploration:bgm_explore')?.thumbnailHash).toBeUndefined();

    // The thumbnail hash actually resolves: the bytes under its key are a
    // decodable 64×64 webp.
    const thrustEntry = byTag.get('lpc:hat:magic:celestial_adult:thrust');
    expect(thrustEntry?.thumbnailHash).toBeDefined();
    const thumbnailHash = thrustEntry?.thumbnailHash ?? '';
    const thumbObj = client.objects.get(
      `thumbnails/${thumbnailHash.slice(0, 2)}/${thumbnailHash}.webp`,
    );
    expect(thumbObj).toBeDefined();
    const thumbBody = thumbObj?.body ?? new Uint8Array();
    const meta = await sharp(Buffer.from(thumbBody)).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });
});
