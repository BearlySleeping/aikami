// packages/frontend/engine/src/assets/scene/scene_index.ts
//
// C-505 — Canonical scene module barrel.

export {
  canonicalSceneHash,
  loadNativeScene,
  parseNativeScene,
  SceneBudgetError,
  SceneUnsupportedFormatError,
  serializeScene,
} from './native_scene.ts';

export {
  type CompiledScene,
  type CompiledSceneLayer,
  compileScene,
  compileSceneToTilemap,
  type SceneCompileContext,
  type SceneEmissionReport,
} from './scene_compiler.ts';
export {
  type CanonicalMapLoad,
  loadMapCanonical,
  loadScene,
  type SceneLoadOptions,
  type SceneLoadResult,
  sceneFromNative,
  sceneFromTilemap,
} from './scene_loader.ts';
export {
  collectSceneErrors,
  logSceneError,
  type ScenePackReference,
  SceneValidationError,
  type SceneValidationOptions,
  validateScene,
} from './scene_validator.ts';
export {
  SceneConversionError,
  type TiledAdapterOptions,
  tilemapToScene,
} from './tiled_adapter.ts';
