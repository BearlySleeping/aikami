// scripts/src/lib/ops/__tests__/prop_atlas_packer.test.ts
//
// Guards the prop-atlas packer's contract:
//   - stable frame names survive packing (page/coords are build output)
//   - duplicate frame names are rejected
//   - pages respect the texture-size budget and spill to a new page
//   - every frame is packed with an extruded border
//   - packing is deterministic

import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  findDuplicateFrameNames,
  type PropAtlasSource,
  packPropAtlas,
} from '../prop_atlas_packer.ts';

const require = createRequire(join(import.meta.dir, '../../../../package.json'));
const sharp = require('sharp');

/** Solid RGBA frame with a distinct colour, so blits are verifiable. */
const makeFrame = async (
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 },
      },
    })
      .png()
      .toBuffer(),
  );

describe('packPropAtlas', () => {
  test('packs frames under their stable names and reports page geometry', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'ward_large.png', bytes: await makeFrame(192, 152, [10, 200, 10, 255]) },
      { name: 'oak.png', bytes: await makeFrame(126, 160, [200, 10, 10, 255]) },
      { name: 'barrel.png', bytes: await makeFrame(34, 48, [10, 10, 200, 255]) },
    ];

    const pages = await packPropAtlas({ sources, maxPageSize: 1024 });

    expect(pages.length).toBe(1);
    const page = pages[0] as (typeof pages)[number];
    expect(Object.keys(page.spritesheet.frames).sort()).toEqual([
      'barrel.png',
      'oak.png',
      'ward_large.png',
    ]);
    // Frame identity is the name; coordinates are present but never identity.
    for (const [name, frame] of Object.entries(page.spritesheet.frames)) {
      expect(name.endsWith('.png')).toBe(true);
      expect(frame.frame.w).toBeGreaterThan(0);
      expect(frame.frame.h).toBeGreaterThan(0);
    }
  });

  test('records each frame at its native size (no scaling)', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'ward_large.png', bytes: await makeFrame(192, 152, [1, 2, 3, 255]) },
      { name: 'table.png', bytes: await makeFrame(96, 42, [4, 5, 6, 255]) },
    ];
    const [page] = await packPropAtlas({ sources, maxPageSize: 1024 });
    expect(page?.spritesheet.frames['ward_large.png']?.frame).toMatchObject({ w: 192, h: 152 });
    expect(page?.spritesheet.frames['table.png']?.frame).toMatchObject({ w: 96, h: 42 });
  });

  test('rejects duplicate frame names rather than letting precedence become ambiguous', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'oak.png', bytes: await makeFrame(32, 32, [1, 1, 1, 255]) },
      { name: 'oak.png', bytes: await makeFrame(32, 32, [2, 2, 2, 255]) },
    ];
    await expect(packPropAtlas({ sources })).rejects.toThrow(/duplicate frame name "oak\.png"/);
  });

  test('spills to a new page when the size budget is exceeded', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'a.png', bytes: await makeFrame(200, 200, [1, 1, 1, 255]) },
      { name: 'b.png', bytes: await makeFrame(200, 200, [2, 2, 2, 255]) },
      { name: 'c.png', bytes: await makeFrame(200, 200, [3, 3, 3, 255]) },
    ];
    // 256px budget fits one 202px cell per row, so each frame needs its own page.
    const pages = await packPropAtlas({ sources, maxPageSize: 256 });
    expect(pages.length).toBe(3);
    expect(pages.map((page) => page.index)).toEqual([0, 1, 2]);
    expect(pages.every((page) => page.width <= 256 && page.height <= 256)).toBe(true);
  });

  test('never exceeds the page budget', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'a.png', bytes: await makeFrame(100, 100, [1, 1, 1, 255]) },
      { name: 'b.png', bytes: await makeFrame(100, 60, [2, 2, 2, 255]) },
      { name: 'c.png', bytes: await makeFrame(40, 90, [3, 3, 3, 255]) },
      { name: 'd.png', bytes: await makeFrame(180, 30, [4, 4, 4, 255]) },
    ];
    const pages = await packPropAtlas({ sources, maxPageSize: 256 });
    for (const page of pages) {
      expect(page.width).toBeLessThanOrEqual(256);
      expect(page.height).toBeLessThanOrEqual(256);
    }
    // Every frame landed exactly once across all pages.
    const packed = pages.flatMap((page) => page.frames).sort();
    expect(packed).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
  });

  test('rejects a frame that cannot fit a page instead of clipping it', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'huge.png', bytes: await makeFrame(300, 300, [1, 1, 1, 255]) },
    ];
    await expect(packPropAtlas({ sources, maxPageSize: 256 })).rejects.toThrow(
      /exceeds the 256px page budget/,
    );
  });

  test('extrudes each frame edge into its border', async () => {
    const sources: PropAtlasSource[] = [
      { name: 'solid.png', bytes: await makeFrame(8, 8, [255, 0, 0, 255]) },
    ];
    const [page] = await packPropAtlas({ sources, maxPageSize: 64, padding: 1 });
    const frame = page?.spritesheet.frames['solid.png']?.frame;
    expect(frame).toBeDefined();
    const { data, info } = await sharp(Buffer.from(page?.image ?? new Uint8Array()))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // The pixel immediately outside the frame rect must be the frame's edge
    // colour (extruded), never transparent — otherwise linear sampling at a
    // sprite edge pulls in transparent black and fringes the sprite.
    const leftOfFrame = ((frame?.y ?? 0) * info.width + ((frame?.x ?? 0) - 1)) * 4;
    expect(data[leftOfFrame + 3]).toBe(255);
    expect(data[leftOfFrame]).toBe(255);
    const aboveFrame = (((frame?.y ?? 0) - 1) * info.width + (frame?.x ?? 0)) * 4;
    expect(data[aboveFrame + 3]).toBe(255);
  });

  test('is deterministic — identical input yields identical pages', async () => {
    const build = async () =>
      packPropAtlas({
        sources: [
          { name: 'a.png', bytes: await makeFrame(60, 40, [9, 9, 9, 255]) },
          { name: 'b.png', bytes: await makeFrame(40, 60, [8, 8, 8, 255]) },
        ],
        maxPageSize: 256,
      });
    const first = await build();
    const second = await build();
    expect(first.map((page) => page.frames)).toEqual(second.map((page) => page.frames));
    expect(Buffer.from(first[0]?.image ?? []).equals(Buffer.from(second[0]?.image ?? []))).toBe(
      true,
    );
  });
});

describe('findDuplicateFrameNames', () => {
  test('reports a name declared by more than one source, with every owner', () => {
    const duplicates = findDuplicateFrameNames([
      { label: 'atlas', frames: ['grass.png', 'well.png'] },
      { label: 'props', frames: ['well.png', 'ward_large.png'] },
      { label: 'props-2', frames: ['well.png'] },
    ]);
    expect(duplicates).toEqual([{ name: 'well.png', sources: ['atlas', 'props', 'props-2'] }]);
  });

  test('returns nothing when every name is unique', () => {
    expect(
      findDuplicateFrameNames([
        { label: 'atlas', frames: ['grass.png'] },
        { label: 'props', frames: ['ward_large.png'] },
      ]),
    ).toEqual([]);
  });
});
