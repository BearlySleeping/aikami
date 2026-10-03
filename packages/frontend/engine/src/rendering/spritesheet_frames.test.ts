// packages/frontend/engine/src/rendering/spritesheet_frames.test.ts
//
// Frame views are the one place where "the texture" is not the sheet: a frame
// is a rectangle over the sheet's shared GPU source. These tests pin that
// distinction and the boundary rules that keep a frame inside its cell.

import { describe, expect, test } from 'bun:test';
import { Texture, TextureSource } from 'pixi.js';
import { getSheetFrameAt, sliceSheetFrames } from './spritesheet_frames.ts';
import type { LpcSpritesheetLayout } from './texture_manager.ts';

const sheetOf = (width: number, height: number): Texture =>
  new Texture({ source: new TextureSource({ width, height }) });

const LAYOUT: LpcSpritesheetLayout = { frameWidth: 8, frameHeight: 8, columns: 2, rows: 2 };

describe('getSheetFrameAt', () => {
  test('returns a view over the sheet source, not a new texture', () => {
    const sheet = sheetOf(16, 16);
    const frame = getSheetFrameAt({ texture: sheet, layout: LAYOUT, frameIndex: 1 });

    expect(frame).not.toBeNull();
    // One GPU source, one pixel budget — the frame is a window onto it.
    expect(frame?.source).toBe(sheet.source);
    expect(frame?.width).toBe(8);
    expect(frame?.height).toBe(8);
    expect(frame?.frame.x).toBe(8);
    expect(frame?.frame.y).toBe(0);
  });

  test('indexes row-major', () => {
    const sheet = sheetOf(16, 16);
    const frame = getSheetFrameAt({ texture: sheet, layout: LAYOUT, frameIndex: 3 });
    expect(frame?.frame.x).toBe(8);
    expect(frame?.frame.y).toBe(8);
  });

  test('rejects a negative index and an index past the grid', () => {
    const sheet = sheetOf(16, 16);
    expect(getSheetFrameAt({ texture: sheet, layout: LAYOUT, frameIndex: -1 })).toBeNull();
    expect(getSheetFrameAt({ texture: sheet, layout: LAYOUT, frameIndex: 4 })).toBeNull();
  });

  test('clamps a partial trailing row instead of reading past the sheet', () => {
    // 20×8: two full columns of 8px fit, the third would overflow.
    const sheet = sheetOf(20, 8);
    const frames = sliceSheetFrames({ texture: sheet, layout: { ...LAYOUT, rows: 1 } });
    expect(frames).toHaveLength(2);
  });

  test('derives the omitted grid dimension from the sheet pixels', () => {
    const sheet = sheetOf(16, 24);
    const frames = sliceSheetFrames({
      texture: sheet,
      layout: { frameWidth: 8, frameHeight: 8, columns: 2 },
    });
    expect(frames).toHaveLength(6);
  });
});

describe('sliceSheetFrames', () => {
  test('emits every cell of the grid in row-major order', () => {
    const frames = sliceSheetFrames({ texture: sheetOf(16, 16), layout: LAYOUT });
    expect(frames.map((frame) => [frame.frame.x, frame.frame.y])).toEqual([
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ]);
  });

  test('rejects a zero frame size and a grid with no dimension', () => {
    expect(() =>
      sliceSheetFrames({ texture: sheetOf(16, 16), layout: { frameWidth: 0, frameHeight: 8 } }),
    ).toThrow(/Invalid frame dimensions/);
    expect(() =>
      sliceSheetFrames({ texture: sheetOf(16, 16), layout: { frameWidth: 8, frameHeight: 8 } }),
    ).toThrow(/at least `columns` or `rows`/);
  });

  test('returns nothing for a grid that resolves empty', () => {
    const frames = sliceSheetFrames({
      texture: sheetOf(16, 16),
      layout: { frameWidth: 8, frameHeight: 8, columns: 0, rows: 0 },
    });
    expect(frames).toEqual([]);
  });
});
