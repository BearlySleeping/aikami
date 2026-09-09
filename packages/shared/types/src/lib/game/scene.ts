// packages/shared/types/src/lib/game/scene.ts
//
// C-505 — Canonical scene types.
//
// Type-only view of the normalized scene: the single in-memory interpretation
// shared by the engine's importers, the strict validator, the terrain
// compiler and the renderer. Re-exported from `@aikami/types` so the client,
// preview and tests never depend on the wire document shape directly.

export type {
  SceneDocument,
  SceneExtent,
  SceneTerrainSurface,
  SceneBakedSurface,
  SceneVisualLayer,
  ScenePlacement,
  SceneNavigation,
  SceneNavigationOverride,
  SceneTransition,
  SceneLayerRole,
  SceneTerrainMatchingMode,
} from '@aikami/schemas';

export { SCENE_EMPTY_FRAME_INDEX } from '@aikami/schemas';
