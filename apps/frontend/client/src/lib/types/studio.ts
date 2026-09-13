// apps/frontend/client/src/lib/types/studio.ts
//
// C-512: the Creator Studio's client-local seam types — the shapes the
// byte/descriptor workflow hands back to the ViewModel. They never leave the
// client, so they live in `$types` rather than `packages/shared`.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import type { GenerationEngineId } from '@aikami/types';

/** A generated-but-unsaved result, ready to be reviewed and saved. */
export type GeneratedAssetOutcome = {
  tag: string;
  sha256: string;
  engine: GenerationEngineId;
  seed?: number;
  sizeBytes: number;
  ext: string;
  mimeType: string;
  /** Object URL for the review step; revoked by `discard`. */
  previewUrl: string;
  isDemo: boolean;
};

/** Outcome of saving a previously generated result. */
export type GeneratedAssetSaveOutcome = {
  registered: boolean;
  tag: string;
  sha256: string;
  version?: number;
  unchanged?: boolean;
  /** Why the save was a no-op (`generation_disabled` | `not_initialized`). */
  reason?: string;
};

/** Outcome of deleting a locally generated asset. */
export type GeneratedAssetDeleteOutcome = {
  deleted: boolean;
  tag: string;
  /** Why nothing was deleted (`not_found` | `seed_tag` | `save_reference`). */
  reason?: string;
  /** Save ids whose payload mentions the tag (the substring-scan guard). */
  references: readonly string[];
  hash?: string;
};
