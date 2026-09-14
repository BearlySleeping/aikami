// apps/frontend/client/src/lib/types/studio.ts
//
// C-512: the Creator Studio's client-local seam types — the shapes the
// byte/descriptor workflow hands back to the ViewModel. They never leave the
// client, so they live in `$types` rather than `packages/shared`.
//
// C-513 moved the ViewModel's seam declarations here too: the capability
// interface and the display rows describe *data* shapes, not behaviour, so they
// belong with the rest of the app-local types rather than inside the unit that
// owns the studio's behaviour. The runtime-neutral mutation outcome stays
// shared through `@aikami/types`.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation, C-513

import type {
  GenerationEngineId,
  LibraryEntry,
  StudioMutationOutcome,
  StudioRecipeOption,
} from '@aikami/types';
import type { StudioAudioReview } from '../views/studio/studio_audio_review.ts';
import type { CommunityPublishOutcome } from './community_assets.ts';

export type { StudioAudioReview } from '../views/studio/studio_audio_review.ts';

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

/** A library row prepared for rendering — no formatting in the view. */
export type StudioLibraryRow = {
  tag: string;
  category: string;
  provenanceLabel: string;
  sizeLabel: string;
  ext: string;
  createdAtLabel: string;
};

/** One emotion row of a generated expression pack. */
export type StudioPackRow = {
  emotion: string;
  tag: string;
  status: string;
};

/** The generation and library operations the studio consumes. */
export type StudioCapabilities = {
  /**
   * Opens the local asset registry + cache and loads the runtime engine config.
   *
   * The studio can be deep-linked before the game boot pipeline runs, so it
   * must not assume the registry is open: without this, `listLibrary()` throws
   * `AssetManager is not initialised` and a save is a silent `not_initialized`.
   */
  ensureReady(): Promise<void>;
  /**
   * Recipe options with per-modality engine availability.
   *
   * Async because availability comes from an engine probe, not a constant.
   */
  listRecipeOptions(): Promise<readonly StudioRecipeOption[]>;
  /** Generates bytes for a recipe + prompt; nothing is persisted yet. */
  generate(options: {
    recipeId: string;
    prompt: string;
    negativePrompt?: string;
    npcId?: string;
    emotion?: string;
    /** Reference face (data URL) for a consistent expression pack. */
    initImage?: string;
  }): Promise<GeneratedAssetOutcome>;
  /** Persists the last generated result for `tag`. */
  save(options: { tag: string }): Promise<GeneratedAssetSaveOutcome>;
  /** Aborts the in-flight generation, if any. */
  cancelGeneration(): void;
  /** Locally generated assets, newest first. */
  listLibrary(): Promise<LibraryEntry[]>;
  renameGenerated(options: { from: string; to: string }): Promise<LibraryEntry>;
  deleteGenerated(options: { tag: string; force?: boolean }): Promise<StudioMutationOutcome>;
  /** `PUBLIC_ASSET_GENERATION` — false makes every save a no-op. */
  isGenerationEnabled(): boolean;
  /** `PUBLIC_ASSET_PUBLISHING` — false hides the publish action (C-513). */
  isPublishingEnabled(): boolean;
  /**
   * C-521: `PUBLIC_AUDIO_GENERATION` — false disables NEW audio generation
   * only. Playback, the catalog and accepted assets are unaffected.
   */
  isAudioGenerationEnabled?(): boolean;
  /**
   * C-521: the decoded-buffer review player for an audio candidate. Omitted in
   * image-only wiring, where the panel is not rendered at all.
   */
  audioReview?: StudioAudioReview;
  /**
   * Publishes a library asset to the community namespace (C-513 AC-1).
   *
   * Explicit and online: nothing about local creation or use depends on it.
   */
  publish(request: { tag: string; title: string }): Promise<CommunityPublishOutcome>;
};
