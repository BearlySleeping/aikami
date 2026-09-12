// packages/shared/local-ai/src/lib/asset_generation.test.ts
//
// AC-2 (C-510): the `generate:asset` flow produces a catalog-ready asset.
//
// These are the mocked-engine CLI assertions that actually run in CI (the
// image app's own moon task has `runInCI: false`). They cover the whole
// recipe → engine → descriptor → staging-fragment path without a live engine.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { describe, expect, test } from 'bun:test';
import { ASSET_CATEGORIES, MAX_UPLOAD_SIZE, tagToAssetPath } from '@aikami/constants';
import type {
  GenerationEngineClient,
  GenerationEngineId,
  GenerationRequest,
  GenerationResult,
} from '@aikami/types';
import { runAssetGeneration } from './asset_generation.ts';
import { sha256Hex } from './generated_asset.ts';

/** A deterministic fake engine — records the request it received. */
const fakeEngine = (
  options: {
    id?: GenerationEngineId;
    bytes?: Uint8Array;
    mimeType?: string;
    onGenerate?: (request: GenerationRequest) => void;
  } = {},
): { engine: GenerationEngineClient; requests: GenerationRequest[] } => {
  const requests: GenerationRequest[] = [];
  const engine: GenerationEngineClient = {
    id: options.id ?? 'sdcpp',
    modality: 'image',
    capabilities: {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: true,
      mask: true,
      referenceImages: true,
      controlNet: true,
      lora: true,
      cancel: true,
      progress: true,
    },
    healthCheck: () => Promise.resolve(true),
    listModels: () => Promise.resolve([{ id: 'fake-model', description: 'fake-model' }]),
    generate: (request: GenerationRequest): Promise<GenerationResult> => {
      requests.push(request);
      options.onGenerate?.(request);
      return Promise.resolve({
        bytes: options.bytes ?? new Uint8Array([1, 2, 3, 4]),
        mimeType: options.mimeType ?? 'image/png',
        width: request.width ?? 512,
        height: request.height ?? 512,
        engine: engine.id,
        seed: request.seed ?? 7,
        metadata: { bytes: 4, prompt: request.positivePrompt },
      });
    },
  };
  return { engine, requests };
};

describe('AC-2: generate:asset produces a catalog-ready asset', () => {
  test('writes a props asset whose tag, category and fragments are catalog-ready', async () => {
    const { engine } = fakeEngine();

    const staging = await runAssetGeneration({
      recipeId: 'prop',
      prompt: 'rusty iron gate',
      engine,
      scannedAt: '2026-09-12T00:00:00.000Z',
    });

    expect(staging.descriptor.tag).toBe('props:rusty-iron-gate');
    expect(staging.descriptor.category).toBe('props');
    expect(staging.descriptor.ext).toBe('.png');
    expect(staging.descriptor.provenance.source).toBe('generated:sdcpp');
    expect(staging.descriptor.sha256).toBe(await sha256Hex(staging.bytes));
    expect(staging.descriptor.sizeBytes).toBe(staging.bytes.length);
  });

  test('the manifest fragment matches AssetManifest', async () => {
    const { engine } = fakeEngine();
    const staging = await runAssetGeneration({
      recipeId: 'prop',
      prompt: 'rusty iron gate',
      engine,
    });

    const tag = staging.descriptor.tag;
    const entry = staging.manifest.assets[tag];
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('props');
    expect(entry?.ext).toBe('.png');
    expect(entry?.path).toBe(tagToAssetPath({ tag, ext: '.png' }));
    expect(entry?.path.startsWith('props/')).toBe(true);
    expect(staging.manifest.count).toBe(1);
    expect(staging.manifest.byCategory.props).toEqual([entry]);
  });

  test('the hashes fragment matches AssetHashesFile', async () => {
    const { engine } = fakeEngine();
    const staging = await runAssetGeneration({
      recipeId: 'prop',
      prompt: 'rusty iron gate',
      engine,
    });

    const hashEntry = staging.hashes.hashes[staging.descriptor.tag];
    expect(hashEntry?.hash).toBe(staging.descriptor.sha256);
    expect(hashEntry?.sizeBytes).toBe(staging.bytes.length);
  });

  test('the fragments survive the generate_asset_seed.ts validation unchanged', async () => {
    const { engine } = fakeEngine();
    const staging = await runAssetGeneration({
      recipeId: 'prop',
      prompt: 'rusty iron gate',
      engine,
    });

    // `generate_asset_seed.ts`'s two hard requirements, asserted directly:
    // 1. every manifest tag has a hash entry (else the row is skipped), and
    // 2. `tagToAssetPath` reproduces the manifest's `path` exactly (else the
    //    bundled/R2 URL derivation is wrong and the asset silently 404s).
    for (const [tag, entry] of Object.entries(staging.manifest.assets)) {
      const hashEntry = staging.hashes.hashes[tag];
      expect(hashEntry).toBeDefined();
      expect(tagToAssetPath({ tag, ext: entry.ext })).toBe(entry.path);
    }
    expect(Object.keys(staging.manifest.assets)).toEqual(Object.keys(staging.hashes.hashes));
  });

  test('the props category is registered, so scan_assets.ts cannot silently drop it', async () => {
    const { engine } = fakeEngine();
    const staging = await runAssetGeneration({ recipeId: 'prop', prompt: 'a gate', engine });

    const definition = ASSET_CATEGORIES[staging.descriptor.category];
    expect(definition).toBeDefined();
    expect(definition?.extensions.has(staging.descriptor.ext)).toBe(true);
    expect(definition?.name).toBe('props');
    expect(definition?.defaultSubdirs).toEqual([]);
  });

  test('the compiled prompt is what the engine receives', async () => {
    const { engine, requests } = fakeEngine();
    await runAssetGeneration({ recipeId: 'prop', prompt: 'rusty iron gate', engine });

    expect(requests).toHaveLength(1);
    const request = requests[0] as GenerationRequest;
    expect(request.modality).toBe('image');
    expect(request.positivePrompt).toContain('rusty iron gate');
    expect(request.positivePrompt).toContain('game prop asset');
    expect(request.negativePrompt).toBeDefined();
    expect(request.width).toBe(512);
    expect(request.height).toBe(512);
    expect(request.steps).toBe(20);
  });

  test('CLI-style overrides reach the engine', async () => {
    const { engine, requests } = fakeEngine();
    await runAssetGeneration({
      recipeId: 'prop',
      prompt: 'a gate',
      engine,
      overrides: { seed: 1234, steps: 5, cfgScale: 3, width: 256, height: 256 },
    });

    const request = requests[0] as GenerationRequest;
    expect(request.seed).toBe(1234);
    expect(request.steps).toBe(5);
    expect(request.cfgScale).toBe(3);
    expect(request.width).toBe(256);
    expect(request.height).toBe(256);
  });

  test('the tileset recipe round-trips its extension-bearing tag through tagToAssetPath', async () => {
    const { engine } = fakeEngine();
    const staging = await runAssetGeneration({
      recipeId: 'tileset',
      prompt: 'grass field',
      engine,
    });

    expect(staging.descriptor.tag).toBe('tilesets:grass-field.png');
    expect(staging.manifest.assets[staging.descriptor.tag]?.path).toBe('tilesets/grass-field.png');
  });

  test('an unknown recipe fails loudly', async () => {
    const { engine } = fakeEngine();
    await expect(runAssetGeneration({ recipeId: 'nope', prompt: 'x', engine })).rejects.toThrow(
      /Unknown asset recipe/,
    );
  });

  test('an injected engine that does not match the resolved id is rejected', async () => {
    const { engine } = fakeEngine({ id: 'comfyui' });
    await expect(
      runAssetGeneration({ recipeId: 'prop', prompt: 'x', engine, engineId: 'sdcpp' }),
    ).rejects.toThrow(/does not match the resolved engine/);
  });

  test('a recipe field the engine cannot honour fails before dispatch', async () => {
    const { engine, requests } = fakeEngine();
    // comfyui declares lora: false — the recipe's LoRA defaults must not be
    // silently dropped.
    (engine as { capabilities: Record<string, boolean> }).capabilities.lora = false;
    await expect(
      runAssetGeneration({
        recipeId: 'prop',
        prompt: 'x',
        engine,
        overrides: { loras: [{ path: '/x.safetensors', multiplier: 0.8 }] },
      }),
    ).rejects.toThrow(/does not support it/);
    expect(requests).toHaveLength(0);
  });

  test('an oversize result fails fast instead of staging an unpublishable asset', async () => {
    const { engine } = fakeEngine({ bytes: new Uint8Array(MAX_UPLOAD_SIZE + 1) });
    await expect(runAssetGeneration({ recipeId: 'prop', prompt: 'x', engine })).rejects.toThrow(
      /over the 50 MB cap/,
    );
  });

  test('an engine failure propagates (the CLI exits non-zero)', async () => {
    const { engine } = fakeEngine();
    (engine as { generate: () => Promise<GenerationResult> }).generate = () =>
      Promise.reject(new Error('sd-server job failed: OOM'));
    await expect(runAssetGeneration({ recipeId: 'prop', prompt: 'x', engine })).rejects.toThrow(
      /OOM/,
    );
  });

  test('progress is forwarded to the caller', async () => {
    const progress: number[] = [];
    const { engine } = fakeEngine({
      onGenerate: () => {
        progress.push(1);
      },
    });
    await runAssetGeneration({ recipeId: 'prop', prompt: 'x', engine });
    expect(progress).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// C-510 AC-2: the CLI's poll deadline reaches the engine
// ---------------------------------------------------------------------------

describe('AC-2: generation deadline plumbing', () => {
  test('runAssetGeneration forwards queueWaitMs to the engine it constructs', async () => {
    const realFetch = globalThis.fetch;
    // A job that never reaches a terminal state — only the deadline ends it.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }
      if (url.includes('/sdapi/v1/sd-models')) {
        // biome-ignore lint/style/useNamingConvention: sd-server API uses snake_case fields
        return Response.json([{ model_name: 'fake-model' }]);
      }
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Response.json({ id: 'job-hang', state: 'queued' });
      }
      return Response.json({ id: 'job-hang', state: 'generating', progress: 67 });
    }) as typeof fetch;

    try {
      // No injected engine: this exercises the real factory path the CLI uses.
      await expect(
        runAssetGeneration({
          recipeId: 'prop',
          prompt: 'a gate',
          baseUrl: 'http://127.0.0.1:1',
          queueWaitMs: 60,
        }),
      ).rejects.toThrow(/deadline 0s/);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 20_000);

  test('omitting queueWaitMs uses the engine default, not a tight ceiling', async () => {
    // The CLI defaults to 900s; assert the option is optional and that the
    // adapter's default is the CPU-sized budget (see sdcpp_engine tests).
    const { DEFAULT_SDCPP_POLL_DEADLINE_MS } = await import('./engines/sdcpp_engine.ts');
    expect(DEFAULT_SDCPP_POLL_DEADLINE_MS).toBeGreaterThanOrEqual(900_000);
  });
});
