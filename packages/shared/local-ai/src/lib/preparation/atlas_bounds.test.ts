// packages/shared/local-ai/src/lib/preparation/atlas_bounds.test.ts
//
// C-520 AC-6: atlas frame bounds, capacity and frame resolution.
//
// Contract: C-520 Versioned image workflows and asset preparation
import { describe, expect, test } from 'bun:test';
import { ATLAS_VALIDATION_CODES, EMBERWATCH_TERRAIN_ATLAS_CAPACITY } from '@aikami/constants';
import {
  type AtlasPage,
  buildAtlasFrameIndex,
  findUnresolvedFrameReferences,
  validateAtlas,
  validateAtlasPages,
} from './atlas_bounds.ts';

const codesOf = (issues: readonly { code: string }[]): string[] =>
  issues.map((issue) => issue.code);

const page = (name: string, frames: AtlasPage['frames'], size = 512): AtlasPage => ({
  name,
  width: size,
  height: size,
  frames,
});

describe('C-520 AC-6: an irregular prop set packs within bounds', () => {
  test('valid pages produce no issue', () => {
    const pages = [
      page('props.webp', [
        { name: 'ward_large.png', x: 1, y: 1, width: 192, height: 152 },
        { name: 'table.png', x: 197, y: 1, width: 96, height: 42 },
      ]),
    ];
    expect(validateAtlasPages({ pages, maxPageSize: 2048, paddingPx: 1, extrudePx: 1 })).toEqual(
      [],
    );
  });

  test('the frame index resolves every packed name to its page', () => {
    const pages = [
      page('props.webp', [{ name: 'ward_large.png', x: 1, y: 1, width: 8, height: 8 }]),
      page('props-2.webp', [{ name: 'inn.png', x: 1, y: 1, width: 8, height: 8 }]),
    ];
    const index = buildAtlasFrameIndex(pages);
    expect(index.get('ward_large.png')?.page).toBe('props.webp');
    expect(index.get('inn.png')?.page).toBe('props-2.webp');
  });
});

describe('C-520 AC-6: overflow fails visibly', () => {
  test('a page above the texture budget is a capacity overflow', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [], 4096)],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.capacityOverflow);
  });

  test('a frame larger than one page can never be packed', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [{ name: 'huge.png', x: 1, y: 1, width: 4096, height: 64 }])],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.frameExceedsPage);
  });

  test('terrain capacity is explicit, so an overrun is reported rather than evicting a cell', () => {
    const frames = Array.from(
      { length: EMBERWATCH_TERRAIN_ATLAS_CAPACITY.cells + 1 },
      (_unused, index) => ({
        name: `terrain-${index}`,
        x: 1,
        y: 1,
        width: 8,
        height: 8,
      }),
    );
    const issues = validateAtlasPages({
      pages: [page('atlas.webp', frames)],
      maxPageSize: 2048,
      paddingPx: 0,
      extrudePx: 0,
      capacityCells: EMBERWATCH_TERRAIN_ATLAS_CAPACITY.cells,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.capacityOverflow);
    expect(
      issues.some((issue) =>
        issue.message.includes(String(EMBERWATCH_TERRAIN_ATLAS_CAPACITY.cells + 1)),
      ),
    ).toBe(true);
  });

  test('a dropped frame is visible when the packer expected more', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [{ name: 'a.png', x: 1, y: 1, width: 8, height: 8 }])],
      maxPageSize: 2048,
      paddingPx: 0,
      extrudePx: 0,
      expectedFrameCounts: { 'props.webp': 3 },
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.capacityOverflow);
    expect(issues.some((issue) => issue.message.includes('silent drop'))).toBe(true);
  });

  test('a duplicate frame name across pages has no defined winner and is refused', () => {
    const issues = validateAtlasPages({
      pages: [
        page('props.webp', [{ name: 'ward.png', x: 1, y: 1, width: 8, height: 8 }]),
        page('props-2.webp', [{ name: 'ward.png', x: 1, y: 1, width: 8, height: 8 }]),
      ],
      maxPageSize: 2048,
      paddingPx: 0,
      extrudePx: 0,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.duplicateFrameName);
  });
});

describe('C-520 AC-6: padding and extrusion bounds', () => {
  test('a frame exactly fitting the page-edge extrusion is accepted', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [{ name: 'exact.png', x: 1, y: 1, width: 510, height: 510 }])],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
    });
    expect(issues).toEqual([]);
  });

  test('two frames with less than the configured padding are rejected', () => {
    const issues = validateAtlasPages({
      pages: [
        page('props.webp', [
          { name: 'first.png', x: 1, y: 1, width: 16, height: 16 },
          { name: 'second.png', x: 20, y: 1, width: 16, height: 16 },
        ]),
      ],
      maxPageSize: 2048,
      paddingPx: 2,
      extrudePx: 1,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.invalidPadding);
  });

  test('a frame with no room for its extruded border is out of bounds', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [{ name: 'edge.png', x: 500, y: 1, width: 16, height: 16 }], 512)],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.frameOutOfPageBounds);
  });

  test('a frame pressed against the page edge breaks the extruded border', () => {
    const issues = validateAtlasPages({
      pages: [page('props.webp', [{ name: 'flush.png', x: 0, y: 0, width: 16, height: 16 }])],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.invalidPadding);
  });
});

describe('C-520 AC-6: expected pages cannot disappear', () => {
  test('a missing page with expected frames is a capacity overflow', () => {
    const issues = validateAtlasPages({
      pages: [],
      maxPageSize: 2048,
      paddingPx: 1,
      extrudePx: 1,
      expectedFrameCounts: { 'props-2.webp': 3, 'empty.webp': 0 },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ATLAS_VALIDATION_CODES.capacityOverflow);
    expect(issues[0]?.page).toBe('props-2.webp');
  });
});

describe('C-520 AC-6: every referenced frame must resolve', () => {
  test('a reference with no packed frame degrades to a fallback tile — so it fails the build', () => {
    const pages = [page('props.webp', [{ name: 'ward.png', x: 1, y: 1, width: 8, height: 8 }])];
    const index = buildAtlasFrameIndex(pages);
    expect(findUnresolvedFrameReferences({ index, referenced: ['ward.png'] })).toEqual([]);
    expect(findUnresolvedFrameReferences({ index, referenced: ['ward.png', 'ghost.png'] })).toEqual(
      ['ghost.png'],
    );

    const issues = validateAtlas({
      pages,
      maxPageSize: 2048,
      paddingPx: 0,
      extrudePx: 0,
      referencedFrames: ['ward.png', 'ghost.png'],
    });
    expect(codesOf(issues)).toContain(ATLAS_VALIDATION_CODES.missingFrame);
  });

  test('a map referencing only packed frames validates clean', () => {
    const pages = [
      page('props.webp', [
        { name: 'ward.png', x: 1, y: 1, width: 192, height: 152 },
        { name: 'inn.png', x: 197, y: 1, width: 256, height: 224 },
      ]),
    ];
    expect(
      validateAtlas({
        pages,
        maxPageSize: 2048,
        paddingPx: 1,
        extrudePx: 1,
        referencedFrames: ['ward.png', 'inn.png'],
      }),
    ).toEqual([]);
  });
});
