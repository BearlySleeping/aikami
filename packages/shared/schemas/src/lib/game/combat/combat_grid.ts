// packages/shared/schemas/src/lib/game/combat/combat_grid.ts
//
// Leaf grid primitive shared by the combat state and the environmental
// schemas. It lives in its own module so `combat_environment.ts` can depend on
// it without importing `combat_state.ts` back (which would close a module
// cycle at TypeBox evaluation time and read `GridPointSchema` before it is
// initialised).
//
// Contract: C-531 AC-1

import Type, { type Static } from 'typebox';

/** Quantized tactical cell coordinates (architecture §25.1). */
export const GridPointSchema = Type.Object(
  {
    x: Type.Integer({ description: 'Tactical cell column' }),
    y: Type.Integer({ description: 'Tactical cell row' }),
  },
  { additionalProperties: false },
);

export type GridPoint = Static<typeof GridPointSchema>;

/** Total order on cells — the stable tie-break for every environmental sort. */
export const compareGridPoints = (a: GridPoint, b: GridPoint): number => a.y - b.y || a.x - b.x;

/** Canonical `"x:y"` cell key used by every occupancy/surface lookup. */
export const gridPointKey = (cell: GridPoint): string => `${cell.x}:${cell.y}`;
