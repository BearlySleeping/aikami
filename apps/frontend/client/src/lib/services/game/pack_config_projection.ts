// apps/frontend/client/src/lib/services/game/pack_config_projection.ts
//
// Projects manifest props into the `PackConfig` that crosses the worker
// boundary. Extracted from `game_engine_service.svelte.ts` (which is at its
// reviewed size ceiling) — the projection is a pure function with no service
// state, so it belongs with the rest of the pack-config shaping.
//
// Optional schema fields are carried ONLY when present — never emitted as
// explicit `undefined`, which would fail the worker's TypeBox validation after
// structured clone (C-376 round 2).

import type { ContentPackProp, PackConfig } from '@aikami/types';

/** One projected prop entry (the value shape of `PackConfig.props`). */
export type ProjectedProp = PackConfig['props'][string];

/** Projects every manifest prop into the worker-boundary shape. */
export const projectPackProps = (
  props: Record<string, ContentPackProp> | undefined,
): PackConfig['props'] =>
  Object.fromEntries(
    Object.entries(props ?? {}).map(([propId, def]) => {
      const projected: ProjectedProp = { name: def.name, frame: def.frame };
      if (def.isWalkable !== undefined) {
        projected.isWalkable = def.isWalkable;
      }
      // C-378 AC-7: the manifest anchor must cross the worker boundary so the
      // engine can apply custom prop anchors (non-default pivot) — without it,
      // multi-tile props silently fall back to (0.5, 1).
      if (def.anchor !== undefined) {
        projected.anchor = def.anchor;
      }
      if (def.collision) {
        projected.collision = def.collision;
      }
      // C-496/C-529: the authored logical world size and contact shadow must
      // cross the boundary with the prop so the renderer can decouple world
      // footprint from texture packing (a 512px frame can render at 32×48).
      if (def.renderSize !== undefined) {
        projected.renderSize = def.renderSize;
      }
      if (def.shadow !== undefined) {
        projected.shadow = def.shadow;
      }
      return [propId, projected];
    }),
  );
