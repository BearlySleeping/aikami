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

import { MAX_UPLOAD_SIZE, tagToAssetPath } from '@aikami/constants';
import type {
  AssetEntry,
  AssetHashesFile,
  AssetManifest,
  GeneratedAsset,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationProgress,
} from '@aikami/types';
import { createGenerationEngine, type GenerationEngineOptions } from './engines/factory.ts';
import { toGeneratedAsset } from './generated_asset.ts';
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
  });

  const path = tagToAssetPath({ tag: descriptor.tag, ext: descriptor.ext });
  const pathSegments = path.split('/');
  const filename = pathSegments.at(-1) ?? path;
  const dotIndex = filename.lastIndexOf('.');

  const manifestEntry: AssetEntry = {
    tag: descriptor.tag,
    category: descriptor.category,
    subcategory: pathSegments.length > 2 ? pathSegments.slice(1, -1).join('/') : '',
    name: dotIndex >= 0 ? filename.slice(0, dotIndex) : filename,
    path,
    ext: descriptor.ext,
  };

  const scannedAt = options.scannedAt ?? new Date().toISOString();

  return {
    descriptor,
    bytes: result.bytes,
    manifest: {
      scannedAt,
      count: 1,
      assets: { [descriptor.tag]: manifestEntry },
      byCategory: { [descriptor.category]: [manifestEntry] },
    },
    hashes: {
      scannedAt,
      hashes: { [descriptor.tag]: { hash: descriptor.sha256, sizeBytes: descriptor.sizeBytes } },
    },
  };
};
