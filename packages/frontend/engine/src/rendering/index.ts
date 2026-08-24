// packages/frontend/engine/src/rendering/index.ts

export {
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from './animation_controller.ts';
export {
  type LpcCellFamily,
  type LpcSheetGeometry,
  resolveLpcSheetGeometry,
} from './lpc_sheet_geometry.ts';
export { initLpcShaders, packRecipeToUboBuffer, SpriteComposer } from './sprite_composer.ts';
export { installNearestTextureDefault } from './texture_defaults.ts';
export type { LpcAtlasData, TextureManagerConfig } from './texture_manager.ts';
export {
  generateLpcAtlas,
  PALETTE_LUT_BYTE_LENGTH,
  preparePaletteLUT,
  TextureManager,
} from './texture_manager.ts';
export type {
  TilemapChunk,
  TilemapChunkRendererOptions,
  TilemapChunkRenderResult,
} from './tilemap_chunk_renderer.ts';
export { buildTilemapChunks, frustumCullChunks } from './tilemap_chunk_renderer.ts';
