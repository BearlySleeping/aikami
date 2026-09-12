// packages/frontend/preview/src/index.ts
//
// Static preview components — no engine dependency.
// Hosts import from this entrypoint for LPC, tileset, prop, and map previews.

export {
  getLpcGrid,
  getLpcIconBackgroundPosition,
  getLpcIconBackgroundSize,
  getLpcIconCellPitch,
  type LpcGrid,
  type LpcIconBackgroundPositionOptions,
  type PickHeroCellOptions,
  pickHeroCell,
} from './lib/lpc/lpc_icon_frame';
export { default as LpcPreview } from './lib/lpc/lpc_preview.svelte';
export type {
  LpcPreviewViewModelInterface,
  LpcSlotDef,
} from './lib/lpc/lpc_preview_view_model.svelte';

export {
  createLpcRenderer,
  detectLpcSheetLayout,
  getLpcSpriteAnchor,
  type LpcRenderer,
  type LpcSheetLayout,
} from './lib/lpc/lpc_renderer';
export {
  createDefaultLpcPreviewState,
  decodeLpcPreviewState,
  encodeLpcPreviewState,
  LPC_PREVIEW_DEFAULT_ZOOM,
  LPC_PREVIEW_MAX_ZOOM,
  LPC_PREVIEW_MIN_ZOOM,
  type LpcLayerUrlEntry,
  type LpcPreviewState,
} from './lib/lpc/preview_url_state';
export { default as MapPreview } from './lib/map/map_preview.svelte';
export {
  frameRectFromAtlas,
  type MapPreviewAtlas,
  type MapPreviewAtlasFrame,
} from './lib/map/map_preview_atlas';
export type {
  MapPreviewViewModelInterface,
  MapPreviewViewModelOptions,
} from './lib/map/map_preview_view_model.svelte';
export { getMapPreviewViewModel } from './lib/map/map_preview_view_model.svelte';
export { default as PropPreview } from './lib/prop/prop_preview.svelte';
export type { PropPreviewViewModelInterface } from './lib/prop/prop_preview_view_model.svelte';
export { default as TilesetPreview } from './lib/tileset/tileset_preview.svelte';
export type { TilesetPreviewViewModelInterface } from './lib/tileset/tileset_preview_view_model.svelte';
export type { PreviewProps } from './lib/types';
