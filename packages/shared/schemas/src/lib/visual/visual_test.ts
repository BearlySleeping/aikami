// packages/shared/schemas/src/lib/visual/visual_test.ts
//
// Visual test schemas for E2E visual regression tests.
// These schemas define the expected structure of AI-generated visual
// assessment responses for various UI scenarios.

import { Type } from 'typebox';

/**
 * Schema for sandbox loaded visual test assessment.
 * Validates that a tilemap with a character is correctly rendered.
 */
export const SandboxLoadedSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  mapRendered: Type.Boolean({ description: 'Whether a tilemap is rendered on the canvas' }),
  characterVisible: Type.Boolean({
    description: 'Whether a single visible humanoid character is standing on the map',
  }),
  noPlaceholders: Type.Boolean({
    description: 'No untextured placeholders or solid-color blocks',
  }),
  characterInBounds: Type.Boolean({
    description: 'Character is drawn within the map bounds, not outside',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

/**
 * Schema for collision overlay visual test assessment.
 * Validates that collision overlay correctly tints blocked cells.
 */
export const CollisionOverlaySchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  tintedCells: Type.Boolean({
    description: 'Tinted cells cover solid features — walls, water, cliffs',
  }),
  noTintOnFloor: Type.Boolean({
    description: 'No tint on open walkable floor areas',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

/**
 * Schema for z-order visual test assessment.
 * Validates that character occlusion and z-ordering work correctly.
 */
export const ZOrderSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterOccluded: Type.Boolean({
    description: 'In the "behind" case the character is partly occluded by the object',
  }),
  characterOccluding: Type.Boolean({
    description: 'In the "in front" case the character fully occludes the object\'s base',
  }),
  noOverlapOcclusion: Type.Boolean({
    description: 'No case shows the character both overlapping and occluded',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});
