// packages/frontend/engine/src/render.ts
// ---------------------------------------------------------------------------
// Render subpath — PixiJS rendering, GPU, environment UBO (no node:*)
// ---------------------------------------------------------------------------

// Register the custom-scheme (tauri://, file://) asset URL resolver with
// PixiJS before any Assets.load() call in the app. Idempotent.
import './assets/custom_scheme_url_resolver.ts';

// Environment UBO
export {
  COLOR_DAWN,
  COLOR_DUSK,
  COLOR_MIDNIGHT,
  COLOR_NOON,
  copyEnvironmentUBO,
  createEnvironmentUBO,
  DIURNAL_KEYFRAMES,
  ENV_UBO_OFFSETS,
  ENVIRONMENT_SHADER_STRUCT,
  ENVIRONMENT_UBO_BYTES,
  ENVIRONMENT_UBO_SIZE,
} from './environment/environment_ubo.ts';
// Pixi app
export type { PixiAppDebugMetrics, PixiAppInstance, PixiAppOptions } from './pixi_app.ts';
export { createPixiApp } from './pixi_app.ts';
export type { PixiInitOptions } from './pixi_init_options.ts';
export { isE2ETestMode, resolvePixiInitOptions } from './pixi_init_options.ts';
// Animation controller
export { AnimationController } from './rendering/animation_controller.ts';
// Layer bands
export type { WorldZBand } from './rendering/layer_bands.ts';
export {
  computeEntityZIndex,
  MIN_ENTITY_Y,
  WORLD_Z_BANDS,
} from './rendering/layer_bands.ts';
// Prop texture resolver
export type {
  CreatePropFrameResolverOptions,
  PropFrameResolverHandle,
  PropSpritesheet,
  PropTextureResolution,
  PropTextureResolver,
} from './rendering/prop_texture_resolver.ts';
export { createPropFrameResolver } from './rendering/prop_texture_resolver.ts';
// Scene Background
export type { SceneBackgroundOptions } from './rendering/scene_background.ts';
export { SceneBackground } from './rendering/scene_background.ts';
// Sprite composer
export type { PaletteSpriteOptions } from './rendering/sprite_composer.ts';
export {
  initLpcShaders,
  packRecipeToUboBuffer,
  SpriteComposer,
} from './rendering/sprite_composer.ts';
// Texture defaults
export { installNearestTextureDefault } from './rendering/texture_defaults.ts';
// Texture manager
export type { TextureManagerConfig } from './rendering/texture_manager.ts';
export { TextureManager } from './rendering/texture_manager.ts';
// Tilemap chunk renderer
export type {
  TilemapChunk,
  TilemapChunkRendererOptions,
  TilemapChunkRenderResult,
} from './rendering/tilemap_chunk_renderer.ts';
export { buildTilemapChunks, frustumCullChunks } from './rendering/tilemap_chunk_renderer.ts';
// Weather overlay
export type { WeatherOverlayOptions } from './rendering/weather_overlay.ts';
export { WeatherOverlay } from './rendering/weather_overlay.ts';
// Render systems
export type { RenderEntry } from './systems/render_system.ts';
export {
  animateEntitySystem,
  dirtyCheckAppearance,
  getEntityAnimationFrame,
  hasAppearanceChanged,
  invalidateComposedSprite,
  LpcBatchManager,
  resetAnimationTracking,
  resetAppearanceTracking,
  setupVisualObservers,
  syncAppearanceSystem,
  toCellDisplayPosition,
  toGridCellCenter,
  updateEntityUbo,
  updateRender,
  updateRenderFromBuffer,
} from './systems/render_system.ts';
// Tilemap render system
export type { TilemapRenderOptions, TilemapRenderResult } from './systems/tilemap_render_system.ts';
export { renderTilemap } from './systems/tilemap_render_system.ts';
