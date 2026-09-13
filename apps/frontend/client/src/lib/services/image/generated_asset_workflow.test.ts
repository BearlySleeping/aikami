// apps/frontend/client/src/lib/services/image/generated_asset_workflow.test.ts
//
// C-512: the byte/descriptor seam — generate returns a reviewable descriptor
// without persisting, save performs the registry write, and the tag override
// puts NPC-bound assets on the resolver tag.
//
// The production singletons are mocked so the seam is exercised in isolation.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GeneratedAsset } from '@aikami/types';
import type { GeneratedAssetOutcome } from '$types';

mock.module('../assets/asset_manager.svelte.ts', () => ({ assetManager: {} }));
mock.module('./image_generation_service.svelte.ts', () => ({ imageGenerationService: {} }));

const { createGeneratedAssetWorkflow } = await import('./generated_asset_workflow.ts');
const { registerRecipe } = await import('@aikami/local-ai');

type GenerateImageResult = {
  blob: Blob;
  mimeType: string;
  engineId: 'sdcpp';
  isDemo: boolean;
};

/**
 * A genuine 1×1 PNG. C-517 AC-2: the seam sniffs the bytes, so a fixture that
 * merely CLAIMS `image/png` is no longer accepted.
 */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1X1_BYTES = Uint8Array.from(atob(PNG_1X1_BASE64), (char) => char.charCodeAt(0));

/** A genuine 1×1 lossless WebP — a container the PNG bytes do not have. */
const WEBP_1X1_BASE64 = 'UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAc=';
const WEBP_1X1_BYTES = Uint8Array.from(atob(WEBP_1X1_BASE64), (char) => char.charCodeAt(0));

const pngBlob = (bytes: Uint8Array = PNG_1X1_BYTES): Blob =>
  new Blob([bytes], { type: 'image/png' });

/**
 * A test-only recipe that declares `.webp` — no SHIPPED recipe may until C-520
 * ships a real transformation, but the reconciliation seam still has to work.
 */
const registerWebpProbeRecipe = (): void => {
  try {
    registerRecipe({
      id: 'test-client-webp-probe',
      category: 'props',
      modality: 'image',
      engine: 'sdcpp',
      promptTemplate: '{{prompt}}, a webp probe',
      output: { ext: '.webp' },
      tagTemplate: 'props:webp-{{slug}}',
    });
  } catch {
    // Already registered by an earlier case in this file.
  }
};

const createDeps = (
  options: { registerFails?: unknown; image?: Partial<GenerateImageResult> } = {},
) => {
  const registerCalls: { asset: GeneratedAsset; bytes: Uint8Array }[] = [];
  const generateImage = mock(
    async (): Promise<GenerateImageResult> => ({
      blob: pngBlob(),
      mimeType: 'image/png',
      engineId: 'sdcpp',
      isDemo: false,
      ...options.image,
    }),
  );

  const registerGenerated = mock(async (asset: GeneratedAsset, bytes: Uint8Array) => {
    if (options.registerFails !== undefined) {
      throw options.registerFails;
    }
    registerCalls.push({ asset, bytes });
    return { registered: true, tag: asset.tag, sha256: asset.sha256, version: 1, unchanged: false };
  });

  return {
    registerCalls,
    generateImage,
    registerGenerated,
    workflow: createGeneratedAssetWorkflow({ generateImage, registerGenerated }),
  };
};

describe('generated_asset_workflow — generate (C-512 AC-1)', () => {
  test('derives the prompt-slug tag for a standalone asset and does not persist', async () => {
    const { workflow, registerGenerated } = createDeps();

    const outcome = await workflow.generate({
      recipeId: 'prop',
      prompt: 'Rusty iron gate',
    });

    expect(outcome.tag).toBe('props:rusty-iron-gate');
    expect(outcome.ext).toBe('.png');
    expect(outcome.mimeType).toBe('image/png');
    expect(outcome.sizeBytes).toBe(PNG_1X1_BYTES.length);
    expect(outcome.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(registerGenerated).not.toHaveBeenCalled();
  });

  test('an NPC-bound portrait lands on the resolver tag, not the prompt slug', async () => {
    const { workflow } = createDeps();

    const outcome = await workflow.generate({
      recipeId: 'portrait',
      prompt: 'Mara the merchant, warm smile',
      npcId: 'merchant',
    });

    expect(outcome.tag).toBe('portraits:merchant-neutral');
  });

  test('reconciles a WebP-declaring recipe with the PNG bytes that came back', async () => {
    registerWebpProbeRecipe();
    const { workflow } = createDeps();

    // The probe recipe declares .webp; sd-server always returns PNG. The
    // descriptor must describe the bytes, not the recipe's wish.
    const outcome = await workflow.generate({
      recipeId: 'test-client-webp-probe',
      prompt: 'a lantern',
    });

    expect(outcome.ext).toBe('.png');
    expect(outcome.mimeType).toBe('image/png');
  });

  test('sniffs the bytes rather than trusting the engine Content-Type', async () => {
    registerWebpProbeRecipe();
    // The engine declares PNG but hands back genuine WebP bytes. The seam must
    // describe the bytes — the old seam trusted the declared MIME and would
    // have accepted this.
    const { workflow } = createDeps({
      image: {
        blob: new Blob([WEBP_1X1_BYTES], { type: 'image/png' }),
        mimeType: 'image/png',
      },
    });

    const outcome = await workflow.generate({
      recipeId: 'test-client-webp-probe',
      prompt: 'a lantern',
    });

    expect(outcome.mimeType).toBe('image/webp');
    expect(outcome.ext).toBe('.webp');
    expect(outcome.sizeBytes).toBe(WEBP_1X1_BYTES.length);
  });

  test('an undecodable engine payload fails loudly instead of registering bytes', async () => {
    const { workflow } = createDeps({
      image: { blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) },
    });

    await expect(workflow.generate({ recipeId: 'prop', prompt: 'a gate' })).rejects.toThrow(
      /unrecognised|undecodable/i,
    );
  });

  test('an explicit tag override wins', async () => {
    const { workflow } = createDeps();

    const outcome = await workflow.generate({
      recipeId: 'prop',
      prompt: 'gate',
      tag: 'props:the-north-gate',
    });

    expect(outcome.tag).toBe('props:the-north-gate');
  });

  test('replacing a pending tag at capacity preserves every other result', async () => {
    const { workflow } = createDeps();
    const outcomes: GeneratedAssetOutcome[] = [];
    for (let index = 0; index < 8; index += 1) {
      outcomes.push(
        await workflow.generate({
          recipeId: 'prop',
          prompt: `prop ${index}`,
          tag: `props:pending-${index}`,
        }),
      );
    }

    await workflow.generate({
      recipeId: 'prop',
      prompt: 'replacement',
      tag: 'props:pending-3',
    });

    await expect(workflow.save({ tag: outcomes[0]?.tag ?? '' })).resolves.toMatchObject({
      registered: true,
      tag: 'props:pending-0',
    });
  });

  test('an unknown recipe fails loudly', async () => {
    const { workflow } = createDeps();

    await expect(workflow.generate({ recipeId: 'nope', prompt: 'x' })).rejects.toThrow(
      /Unknown asset recipe/,
    );
  });
});

describe('generated_asset_workflow — save (C-512 AC-1 / AC-6)', () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  test('registers the reviewed bytes under the generated tag', async () => {
    const outcome = await deps.workflow.generate({ recipeId: 'prop', prompt: 'Rusty iron gate' });
    const saved = await deps.workflow.save({ tag: outcome.tag });

    expect(saved.registered).toBe(true);
    expect(saved.tag).toBe('props:rusty-iron-gate');
    expect(saved.version).toBe(1);
    expect(deps.registerCalls).toHaveLength(1);
    expect(deps.registerCalls[0]?.asset.tag).toBe('props:rusty-iron-gate');
    expect(deps.registerCalls[0]?.bytes).toHaveLength(PNG_1X1_BYTES.length);
  });

  test('saving without generating fails loudly', async () => {
    await expect(deps.workflow.save({ tag: 'props:never-generated' })).rejects.toThrow(
      /No generated bytes are pending/,
    );
  });

  test('a failed registry write propagates instead of reporting success (AC-6)', async () => {
    const failing = createDeps({
      registerFails: Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }),
    });
    const outcome = await failing.workflow.generate({ recipeId: 'prop', prompt: 'gate' });

    await expect(failing.workflow.save({ tag: outcome.tag })).rejects.toThrow(/QuotaExceeded/);
  });

  test('a save is not repeatable — the pending bytes are dropped once registered', async () => {
    const outcome = await deps.workflow.generate({ recipeId: 'prop', prompt: 'gate' });
    await deps.workflow.save({ tag: outcome.tag });

    await expect(deps.workflow.save({ tag: outcome.tag })).rejects.toThrow(
      /No generated bytes are pending/,
    );
  });

  test('a kill-switch no-op is reported, never as a success', async () => {
    const disabled = createDeps();
    disabled.registerGenerated.mockImplementation(
      async (asset: GeneratedAsset) =>
        ({
          registered: false,
          tag: asset.tag,
          sha256: asset.sha256,
          reason: 'generation_disabled',
        }) as never,
    );

    const outcome = await disabled.workflow.generate({ recipeId: 'prop', prompt: 'gate' });
    const saved = await disabled.workflow.save({ tag: outcome.tag });

    expect(saved.registered).toBe(false);
    expect(saved.reason).toBe('generation_disabled');

    disabled.registerGenerated.mockImplementation(
      async (asset: GeneratedAsset) =>
        ({
          registered: true,
          tag: asset.tag,
          sha256: asset.sha256,
          version: 1,
          unchanged: false,
        }) as never,
    );
    await expect(disabled.workflow.save({ tag: outcome.tag })).resolves.toMatchObject({
      registered: true,
      tag: outcome.tag,
    });
  });
});
