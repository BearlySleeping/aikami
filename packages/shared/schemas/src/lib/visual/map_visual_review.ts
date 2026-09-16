// packages/shared/schemas/src/lib/visual/map_visual_review.ts
//
// C-523 AC-2 — the VLM review schemas for a five-map art pass.
//
// These describe the answers a visual review asks about a rendered map, so
// they belong with the other shared visual schemas rather than inline in the
// e2e visual suite. The landmark variant composes the base geometry schema
// with the one question only an on-prop capture can answer.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { type Static, Type } from 'typebox';
import { mergeSchemas } from '../common/helpers.ts';

/** The geometry/readability questions every map capture answers. */
export const MapGeometrySchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  mapReadable: Type.Boolean({
    description: 'Whether the map reads as a coherent, intentionally composed pixel-art scene',
  }),
  tilesAreCrisp: Type.Boolean({
    description: 'Whether tile edges are hard-edged pixel art with no blur or stretching',
  }),
  noMissingFramePlaceholders: Type.Boolean({
    description: 'Whether zero magenta/blank/placeholder tiles or prop frames are visible',
  }),
  noStretchedFurniture: Type.Boolean({
    description: 'Whether zero props are visibly stretched, squashed or cropped mid-sprite',
  }),
  entrancesLookWalkable: Type.Boolean({
    description: 'Whether doors/gate openings/path junctions read as open, walkable ground',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

export type MapGeometry = Static<typeof MapGeometrySchema>;

/**
 * The landmark variant adds the one question only an on-prop capture can
 * answer, composed onto {@link MapGeometrySchema} so the shared fields stay
 * declared once.
 */
export const MapLandmarkSchema = mergeSchemas([
  MapGeometrySchema,
  Type.Object({
    landmarkVisible: Type.Boolean({
      description: 'Whether the landmark named in the prompt is present and recognisable',
    }),
  }),
]);

export type MapLandmark = Static<typeof MapLandmarkSchema>;
