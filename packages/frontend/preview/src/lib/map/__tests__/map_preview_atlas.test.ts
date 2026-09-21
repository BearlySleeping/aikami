// packages/frontend/preview/src/lib/map/__tests__/map_preview_atlas.test.ts
//
// C-507 — Explicit atlas frame resolution (map preview rebuild remainder).

import { describe, expect, it } from 'bun:test';
import {
  frameRectFromAtlas,
  type MapPreviewAtlas,
  type MapPreviewAtlasFrame,
} from '../map_preview_atlas';

const FRAMES: Readonly<Record<string, MapPreviewAtlasFrame>> = {
  'earth_0.png': { x: 0, y: 0, width: 16, height: 16 },
  'earth_3.png': { x: 0, y: 48, width: 16, height: 16 },
  'water_15.png': { x: 48, y: 48, width: 16, height: 16 },
};

describe('frameRectFromAtlas', () => {
  it('returns the source rect for a known frame (hit)', () => {
    expect(frameRectFromAtlas(FRAMES, 'water_15.png')).toEqual({
      x: 48,
      y: 48,
      width: 16,
      height: 16,
    });
  });

  it('returns undefined for an unknown frame (miss)', () => {
    expect(frameRectFromAtlas(FRAMES, 'lava_7.png')).toBeUndefined();
  });

  it('returns undefined for an empty map', () => {
    expect(frameRectFromAtlas({}, 'earth_0.png')).toBeUndefined();
  });

  it('carries non-square rects verbatim', () => {
    const frames: Readonly<Record<string, MapPreviewAtlasFrame>> = {
      'prop.png': { x: 4, y: 8, width: 24, height: 40 },
    };
    expect(frameRectFromAtlas(frames, 'prop.png')).toEqual({
      x: 4,
      y: 8,
      width: 24,
      height: 40,
    });
  });

  it('accepts a MapPreviewAtlas frames record', () => {
    const atlas: MapPreviewAtlas = {
      imageUrl: 'atlas.png',
      frames: FRAMES,
    };
    expect(frameRectFromAtlas(atlas.frames, 'earth_0.png')).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });
});
