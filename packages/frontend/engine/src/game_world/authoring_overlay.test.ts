// packages/frontend/engine/src/game_world/authoring_overlay.test.ts
//
// Emberwatch authoring overlay geometry. Pure shape assertions — no PixiJS.

import { describe, expect, test } from 'bun:test';
import {
  AUTHORING_OVERLAY_LAYERS,
  type AuthoringOverlayInput,
  buildAuthoringOverlayShapes,
} from './authoring_overlay.ts';

const input = (): AuthoringOverlayInput => ({
  width: 4,
  height: 3,
  tileSize: 32,
  blocked: new Uint8Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  reachable: new Uint8Array([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
  props: [
    {
      propId: 'well',
      x: 64,
      y: 96,
      renderWidth: 64,
      renderHeight: 80,
      anchorX: 0.5,
      anchorY: 1,
      collisionWidth: 22,
      collisionHeight: 14,
      shadowWidth: 46,
      shadowHeight: 18,
      isLandmark: true,
      isEvidence: true,
    },
  ],
  npcs: [{ npcId: 'elder', x: 32, y: 32 }],
  spawns: [{ spawnId: 'gate', x: 0, y: 0 }],
  transitions: [
    {
      id: 't1',
      x: 96,
      y: 0,
      width: 32,
      height: 32,
      targetMap: 'inn',
      targetSpawnId: 'inn_entrance',
      targetX: 448,
      targetY: 544,
    },
  ],
});

describe('buildAuthoringOverlayShapes', () => {
  test('defaults to every layer', () => {
    const shapes = buildAuthoringOverlayShapes(input());
    const layers = new Set(shapes.map((shape) => shape.layer));
    for (const layer of AUTHORING_OVERLAY_LAYERS) {
      expect(layers.has(layer), layer).toBe(true);
    }
  });

  test('prop render bounds honour the anchor origin', () => {
    const shapes = buildAuthoringOverlayShapes(input(), new Set(['propBounds']));
    const bounds = shapes.find((shape) => shape.layer === 'propBounds' && shape.kind === 'rect');
    expect(bounds?.kind).toBe('rect');
    if (bounds?.kind === 'rect') {
      expect(bounds.x).toBe(64 - 0.5 * 64);
      expect(bounds.y).toBe(96 - 1 * 80);
      expect(bounds.width).toBe(64);
      expect(bounds.height).toBe(80);
    }
  });

  test('prop collision and shadow footprints are separate from render bounds', () => {
    const shapes = buildAuthoringOverlayShapes(
      input(),
      new Set(['propCollision', 'shadowBounds', 'propAnchor']),
    );
    const collision = shapes.find((shape) => shape.layer === 'propCollision');
    const shadow = shapes.find((shape) => shape.layer === 'shadowBounds');
    const anchor = shapes.find((shape) => shape.layer === 'propAnchor');
    expect(collision?.kind).toBe('rect');
    expect(shadow?.kind).toBe('rect');
    expect(anchor?.kind).toBe('point');
    if (collision?.kind === 'rect') {
      expect(collision.width).toBe(22);
      expect(collision.x).toBe(64 - 11);
    }
    if (shadow?.kind === 'rect') {
      expect(shadow.width).toBe(46);
    }
  });

  test('transition bounds and destination labels are drawn', () => {
    const shapes = buildAuthoringOverlayShapes(input(), new Set(['transitions', 'destinations']));
    const rect = shapes.find((shape) => shape.layer === 'transitions' && shape.kind === 'rect');
    const destination = shapes.find((shape) => shape.layer === 'destinations');
    expect(rect?.kind).toBe('rect');
    expect(destination?.kind).toBe('label');
    if (destination?.kind === 'label') {
      // (448/32, 544/32) = (14, 17)
      expect(destination.text).toContain('14,17');
      expect(destination.text).toContain('→');
    }
  });

  test('destination labels can be selected without transition bounds', () => {
    const shapes = buildAuthoringOverlayShapes(input(), new Set(['destinations']));
    expect(shapes.length).toBeGreaterThan(0);
    expect(new Set(shapes.map((shape) => shape.layer))).toEqual(new Set(['destinations']));
  });

  test('connectivity marks only walkable unreachable cells', () => {
    const shapes = buildAuthoringOverlayShapes(input(), new Set(['connectivity']));
    const rects = shapes.filter((shape) => shape.kind === 'rect');
    // Cell index 3 (c=3,r=0) is walkable but unreachable; cell 2 is blocked.
    expect(rects.some((shape) => shape.kind === 'rect' && shape.x === 96 && shape.y === 0)).toBe(
      true,
    );
    expect(rects.some((shape) => shape.kind === 'rect' && shape.x === 64 && shape.y === 0)).toBe(
      false,
    );
  });

  test('a layer subset returns only that layer', () => {
    const shapes = buildAuthoringOverlayShapes(input(), new Set(['npcs']));
    expect(shapes.length).toBeGreaterThan(0);
    expect(new Set(shapes.map((shape) => shape.layer))).toEqual(new Set(['npcs']));
  });

  test('an empty layer set returns no shapes', () => {
    expect(buildAuthoringOverlayShapes(input(), new Set())).toEqual([]);
  });
});
