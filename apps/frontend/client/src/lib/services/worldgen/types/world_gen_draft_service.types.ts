// apps/frontend/client/src/lib/services/worldgen/types/world_gen_draft_service.types.ts
//
// G01 — the draft service's domain types.
//
// These live outside the service module because a service may only export its
// `*ServiceOptions` and `*ServiceInterface` (guard S10); capability and domain
// types belong with the feature, not bolted onto the class that consumes them.

import type { WorldGenDraft, WorldGenDraftStage } from '@aikami/schemas';
import type { TextGenerationServiceInterface } from '../../ai/text_generation_service.svelte.ts';

/** Structured extraction, the only provider entry point this service uses. */
export type WorldGenDraftTextCapabilities = Pick<
  TextGenerationServiceInterface,
  'extractStructure'
>;

/**
 * Durable draft persistence.
 *
 * `latest` is what makes a draft survive a REAL browser reload: a service
 * instance rebuilt from scratch holds nothing in memory, so `get(draftId)`
 * cannot know which id to ask for. There is no selected-draft id in G01, so the
 * newest row is the answer — see the service's `initialize`.
 */
export type WorldGenDraftStore = {
  upsert(draft: WorldGenDraft): Promise<void>;
  get(draftId: string): Promise<WorldGenDraft | undefined>;
  /** Newest-first. Rejects rather than returning a row that fails validation. */
  latest(limit?: number): Promise<WorldGenDraft[]>;
};

/** Resolves the durable store, or undefined when the device DB is unavailable. */
export type WorldGenDraftStoreResolver = () => Promise<WorldGenDraftStore | undefined>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle of the current run. */
export type WorldGenDraftRunStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';

/** Why a draft is not durable. Surfaced rather than swallowed. */
export type WorldGenDraftPersistence = 'unknown' | 'memory' | 'durable';

/** Observable state of the in-flight or last run. */
export type WorldGenDraftRunState = {
  runId: string;
  draftId: string;
  revision: number;
  status: WorldGenDraftRunStatus;
  /** Stages with a valid checkpoint, in execution order. */
  completedStages: readonly WorldGenDraftStage[];
  /** Stages that failed, with a named reason. */
  failures: readonly { stage: WorldGenDraftStage; message: string }[];
  /** Set only when the run ended badly. */
  error: string | undefined;
};
