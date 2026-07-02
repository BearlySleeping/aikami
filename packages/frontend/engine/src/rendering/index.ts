// packages/frontend/engine/src/rendering/index.ts

export {
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from './animation_controller.ts';
export { initLpcShaders, packRecipeToUboBuffer, SpriteComposer } from './sprite_composer.ts';
export type { LpcAtlasData, TextureManagerConfig } from './texture_manager.ts';
export {
  generateLpcAtlas,
  PALETTE_LUT_BYTE_LENGTH,
  preparePaletteLUT,
  TextureManager,
} from './texture_manager.ts';
export type {
  TilemapChunkRendererOptions,
  TilemapChunkRenderResult,
} from './tilemap_chunk_renderer.ts';
export { buildTilemapChunks, frustumCullChunks } from './tilemap_chunk_renderer.ts';
