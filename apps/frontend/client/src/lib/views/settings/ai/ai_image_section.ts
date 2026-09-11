// apps/frontend/client/src/lib/views/settings/ai/ai_image_section.ts
//
// Pure image-section state and helpers for AI settings (AC-7): presets,
// quality levels, default params, and preview-state accessors. No state, no
// services — the ViewModel owns the reactive maps and delegates here.

import type { AiConnection, AiRole, ImageParams } from '@aikami/types';

/** State of the image connection preview (AC-7). */
export type ImagePreviewState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; url: string }
  | { status: 'error'; error: string };

/** A size preset applied to an image connection's params. */
export type ImageSizePreset = {
  id: string;
  label: string;
  role: AiRole;
  width: number;
  height: number;
};

/** A quality level mapped onto steps/cfg. */
export type ImageQualityLevel = {
  id: string;
  label: string;
  steps: number;
  cfg: number;
};

export const IMAGE_SIZE_PRESETS: readonly ImageSizePreset[] = [
  { id: 'portrait', label: 'Portrait (768×1024)', role: 'portrait', width: 768, height: 1024 },
  { id: 'scene', label: 'Scene (1024×768)', role: 'scene', width: 1024, height: 768 },
];

export const IMAGE_QUALITY_LEVELS: readonly ImageQualityLevel[] = [
  { id: 'draft', label: 'Draft', steps: 15, cfg: 5 },
  { id: 'standard', label: 'Standard', steps: 25, cfg: 7 },
  { id: 'high', label: 'High', steps: 35, cfg: 9 },
];

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  checkpoint: '',
  width: 512,
  height: 512,
  steps: 20,
  cfg: 7,
};

/** Resolves an image connection's params, falling back to the defaults. */
export const imageParamsFor = (connection: AiConnection | undefined): ImageParams => {
  if (connection?.capability !== 'image' || !('checkpoint' in connection.params)) {
    return DEFAULT_IMAGE_PARAMS;
  }
  return connection.params;
};

/** The preview URL for a ready preview state, else an empty string. */
export const imagePreviewUrlFor = (state: ImagePreviewState): string =>
  state.status === 'ready' ? state.url : '';

/** The preview error for an errored preview state, else an empty string. */
export const imagePreviewErrorFor = (state: ImagePreviewState): string =>
  state.status === 'error' ? state.error : '';
