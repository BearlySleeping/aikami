// packages/shared/local-ai/src/lib/asset_generation.ts
//
// The engine-agnostic generation runner behind `generate:asset` (C-510).
//
// Pure: it resolves a recipe, dispatches to a `GenerationEngineClient`, derives
// the shared `GeneratedAsset` descriptor and returns the catalog-ready staging
// fragments. It touches no filesystem — the Bun CLI owns the writes — so the
// whole flow is unit-testable in CI with a mocked engine.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { MAX_UPLOAD_SIZE } from '@aikami/constants';
import type {
  AssetHashesFile,
  AssetManifest,
  GeneratedAsset,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationProgress,
  GenerationRequestAudit,
} from '@aikami/types';
import { buildAssetFragments } from './asset_staging_fragments.ts';
import { createGenerationEngine, type GenerationEngineOptions } from './engines/factory.ts';
import { toGeneratedAsset } from './generated_asset.ts';
import { buildGenerationRequestAudit } from './generation_audit.ts';
import {
  compileRecipeRequest,
  type RecipeOverrides,
  requireRecipe,
  validateRequestCapabilities,
} from './recipes/recipe_registry.ts';

/** What a successful run produced, ready for either sink. */
export type AssetGenerationStaging = {
  /** The shared descriptor — hashed, tagged, provenance-carrying. */
  descriptor: GeneratedAsset;
  /** Raw bytes, exactly `descriptor.sizeBytes` long. */
  bytes: Uint8Array;
  /** Single-entry `AssetManifest` fragment, consumable without hand-editing. */
  manifest: AssetManifest;
  /** Single-entry `AssetHashesFile` fragment. */
  hashes: AssetHashesFile;
  /**
   * C-517 — the requested/effective/measured audit for this run, carried out of
   * the runner so the CLI can report it and C-518 can persist it.
   */
  audit: GenerationRequestAudit;
};

/** Options for {@link runAssetGeneration}. */
export type AssetGenerationOptions = {
  /** Recipe id, e.g. 'prop'. */
  recipeId: string;
  /** The user prompt, substituted into the recipe's template. */
  prompt: string;
  /** Engine override — otherwise the recipe's engine, then sd.cpp. */
  engineId?: GenerationEngineId;
  /** Engine base URL. Empty/unset means "not configured". */
  baseUrl?: string;
  /**
   * Poll deadline in milliseconds — how long to wait for the engine to finish.
   * Defaults to the engine adapter's own budget
   * (`DEFAULT_SDCPP_POLL_DEADLINE_MS`, 900s), which is sized for CPU
   * sd-server runs. The CLI exposes it as `--timeout <seconds>`.
   */
  queueWaitMs?: number;
  /** Per-run parameter overrides on top of the recipe defaults. */
  overrides?: RecipeOverrides;
  /**
   * Extra engine construction options (C-511) — e.g. the ACE-Step artifact
   * reader and checkpoint/output directories. `baseUrl`/`queueWaitMs` are
   * owned by the dedicated options above and win over this object.
   */
  engineOptions?: Omit<GenerationEngineOptions, 'baseUrl' | 'queueWaitMs'>;
  /** Progress callback (0..1 fraction, engine-agnostic label). */
  onProgress?: (progress: GenerationProgress) => void;
  /** Abort signal — the engine's native cancel is issued on abort. */
  signal?: AbortSignal;
  /**
   * Pre-built engine. Supplied by tests and by callers that already own an
   * engine instance (the frontend resolves one through its own factory).
   */
  engine?: GenerationEngineClient;
  /** Timestamp recorded in the staging fragments. Defaults to now. */
  scannedAt?: string;
  /**
   * Explicit registry tag (C-519). The batch runner pins a tag per brief item
   * (`batch:<briefId>:<itemId>`) so a repeated prompt can never overwrite a
   * different item's staged revision. Defaults to the recipe's tag template.
   */
  tag?: string;
};

/**
 * Runs one generation end to end.
 *
 * @throws Error on an unknown recipe, an engine/capability mismatch, an
 *         oversize result, or any engine failure. Never reports success for
 *         an asset that cannot reach the catalog.
 */
export const runAssetGeneration = async (
  options: AssetGenerationOptions,
): Promise<AssetGenerationStaging> => {
  const recipe = requireRecipe(options.recipeId);

  const engineId = options.engineId ?? recipe.engine ?? 'sdcpp';
  const engine =
    options.engine ??
    createGenerationEngine(engineId, {
      baseUrl: options.baseUrl,
      queueWaitMs: options.queueWaitMs,
      verifyModel: true,
      ...options.engineOptions,
    });

  if (engine.id !== engineId) {
    throw new Error(
      `Injected engine "${engine.id}" does not match the resolved engine "${engineId}" for recipe "${recipe.id}"`,
    );
  }

  // Fail loudly before dispatch — never silently strip an unsupported field.
  // The compiled request is validated (not just the recipe) so a per-run
  // override cannot smuggle in a field the engine cannot honour.
  const request = compileRecipeRequest(recipe, options.prompt, options.overrides);
  validateRequestCapabilities(request, engine.id, engine.capabilities, `Recipe "${recipe.id}"`);

  const result = await engine.generate(request, {
    signal: options.signal,
    onProgress: options.onProgress,
  });

  if (result.bytes.length === 0) {
    throw new Error('Generation engine returned an empty result');
  }

  if (result.bytes.length > MAX_UPLOAD_SIZE) {
    throw new Error(
      `Generated asset is ${(result.bytes.length / 1024 / 1024).toFixed(1)} MB — over the ${MAX_UPLOAD_SIZE / 1024 / 1024} MB cap`,
    );
  }

  const descriptor = await toGeneratedAsset(result, recipe, engine.id, {
    prompt: options.prompt,
    ...(options.tag === undefined ? {} : { tag: options.tag }),
  });

  const scannedAt = options.scannedAt ?? new Date().toISOString();
  const fragments = buildAssetFragments({ descriptor, scannedAt });

  return {
    descriptor,
    bytes: result.bytes,
    manifest: fragments.manifest,
    hashes: fragments.hashes,
    audit: buildGenerationRequestAudit({ request, result }),
  };
};
