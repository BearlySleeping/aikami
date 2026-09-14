// apps/backend/local-stack/stack/generation/preparation.ts
//
// C-520: the deterministic-preparation stage of the batch runner.
//
// The runner owns job state and durability; preparation owns pixels and the
// report that justifies them. Keeping the stage in its own module means the
// orchestration loop never grows a second responsibility, and the contract
// between them is three small types instead of an inlined callback.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { mimeTypeForExt, sha256Hex, toGeneratedAsset } from '@aikami/local-ai';
import type {
  AssetRecipe,
  GeneratedAsset,
  GenerationEngineId,
  MediaValidationReport,
} from '@aikami/types';

/** What a preparation hook receives — verified raw bytes, never a candidate. */
export type BatchPreparationContext = {
  readonly itemId: string;
  readonly recipeId: string;
  readonly engineId: GenerationEngineId;
  readonly prompt: string;
  readonly rawBytes: Uint8Array;
  readonly rawSha256: string;
};

/** What a preparation hook returns. */
export type BatchPreparationResult = {
  readonly bytes: Uint8Array;
  /** SHA-256 of the prepared bytes; the runner trusts this only for the report. */
  readonly preparedSha256?: string;
  /** Media-validation report persisted by the CLI for review. */
  readonly report?: MediaValidationReport;
};

/** One job's preparation outcome, surfaced to the CLI. */
export type BatchMediaValidationRecord = {
  readonly itemId: string;
  readonly recipeId: string;
  readonly rawSha256: string;
  readonly preparedSha256: string;
  readonly report: MediaValidationReport;
};

/** The preparation hook shape the runner accepts. */
export type BatchPreparationHook = (
  context: BatchPreparationContext,
) => Promise<BatchPreparationResult>;

/** What {@link applyPreparation} produced for one job. */
export type AppliedPreparation = {
  /** The bytes to stage — the prepared bytes when a hook ran. */
  readonly bytes: Uint8Array;
  /**
   * The descriptor to stage with those bytes. Re-derived when preparation
   * changed them, so `preparedHash` always describes what is actually written.
   */
  readonly descriptor: GeneratedAsset;
  /** Present only when the hook produced a review report. */
  readonly record?: BatchMediaValidationRecord;
};

/**
 * Runs the preparation stage for one job.
 *
 * The raw blob is already durable and content-addressed before this is called,
 * and it is never rewritten — accepted originals stay immutable, and a
 * crash-resumed run prepares the same verified raw bytes again instead of
 * regenerating them.
 */
export const applyPreparation = async (options: {
  prepare: BatchPreparationHook;
  context: BatchPreparationContext;
  descriptor: GeneratedAsset;
  recipe: AssetRecipe;
  tag: string;
}): Promise<AppliedPreparation> => {
  const prepared = await options.prepare(options.context);
  const preparedSha256 = await sha256Hex(prepared.bytes);

  let descriptor = options.descriptor;
  if (preparedSha256 !== options.context.rawSha256) {
    descriptor = await toGeneratedAsset(
      {
        bytes: prepared.bytes,
        mimeType: mimeTypeForExt(options.recipe.output.ext),
        engine: options.context.engineId,
        metadata: { prompt: options.context.prompt },
      },
      options.recipe,
      options.context.engineId,
      { prompt: options.context.prompt, tag: options.tag },
    );
  }

  return {
    bytes: prepared.bytes,
    descriptor,
    ...(prepared.report === undefined
      ? {}
      : {
          record: {
            itemId: options.context.itemId,
            recipeId: options.context.recipeId,
            rawSha256: options.context.rawSha256,
            preparedSha256,
            report: prepared.report,
          },
        }),
  };
};
