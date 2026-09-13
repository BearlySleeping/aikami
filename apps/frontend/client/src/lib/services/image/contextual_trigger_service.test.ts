// apps/frontend/client/src/lib/services/image/contextual_trigger_service.test.ts
//
// C-512 AC-2 / AC-5: contextual generation is opt-in, non-blocking, queued, and
// deduped only after a *successful* registration.
//
// The production workflow and the style-profile singleton are mocked so the
// trigger can be driven with a deterministic fixture.

import { describe, expect, mock, test } from 'bun:test';
import type { ImageStyleProfile } from '@aikami/types';
import type { GeneratedAssetOutcome, GeneratedAssetSaveOutcome } from '$types';

const profile: ImageStyleProfile = {
  id: 'test-profile',
  name: 'Test Profile',
  isBuiltIn: false,
  promptGrammar: { separator: ', ', prefix: '', suffix: '' },
  positiveTags: 'painterly',
  negativeTags: 'blurry',
  perImageTags: {
    portrait: { positive: 'dialogue portrait', negative: 'full body' },
    background: { positive: 'environment', negative: '' },
    illustration: { positive: 'illustration', negative: '' },
  },
};

mock.module('./style_profile_service.svelte', () => ({
  styleProfileService: { activeProfile: profile },
}));
mock.module('./generated_asset_workflow.ts', () => ({
  generatedAssetWorkflow: {
    generate: async () => {
      throw new Error('the production workflow must be replaced in tests');
    },
    save: async () => {
      throw new Error('the production workflow must be replaced in tests');
    },
    discard: () => {},
    dispose: () => {},
  },
}));

const { ContextualTriggerService } = await import('./contextual_trigger_service.svelte.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const generatedOutcome = (
  overrides: Partial<GeneratedAssetOutcome> = {},
): GeneratedAssetOutcome => ({
  tag: 'portraits:merchant-neutral',
  sha256: 'a'.repeat(64),
  engine: 'sdcpp',
  sizeBytes: 4096,
  ext: '.png',
  mimeType: 'image/png',
  previewUrl: 'blob:preview',
  isDemo: false,
  ...overrides,
});

const createService = (options: {
  generateAsset?: (request: {
    recipeId: string;
    prompt: string;
    negativePrompt?: string;
    npcId?: string;
  }) => Promise<GeneratedAssetOutcome>;
  saveAsset?: (request: { tag: string }) => Promise<GeneratedAssetSaveOutcome>;
  enabled?: boolean;
}) => {
  const generateAsset = mock(options.generateAsset ?? (async () => generatedOutcome()));
  const saveAsset = mock(
    options.saveAsset ??
      (async (request: { tag: string }) =>
        ({
          registered: true,
          tag: request.tag,
          sha256: 'a'.repeat(64),
          version: 1,
        }) as GeneratedAssetSaveOutcome),
  );

  const service = ContextualTriggerService.create({
    className: 'ContextualTriggerService',
    generateAsset,
    saveAsset,
  });
  service.setEnabled(options.enabled ?? true);
  return { service, generateAsset, saveAsset };
};

describe('ContextualTriggerService — opt-in default (C-512 AC-2)', () => {
  test('defaults to off so play never generates without an explicit opt-in', () => {
    const service = ContextualTriggerService.create({
      className: 'ContextualTriggerService',
    });

    expect(service.enabled).toBe(false);
  });

  test('a disabled service compiles nothing', async () => {
    const { service, generateAsset } = createService({ enabled: false });

    const compiled = await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara',
      npcId: 'merchant',
    });

    expect(compiled).toBeUndefined();
    expect(generateAsset).not.toHaveBeenCalled();
  });
});

describe('ContextualTriggerService — non-blocking generation (AC-2)', () => {
  test('fireTrigger resolves while the generator promise is still pending', async () => {
    let releaseGeneration: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });

    const { service, generateAsset, saveAsset } = createService({
      generateAsset: async () => {
        await pending;
        return generatedOutcome();
      },
    });

    const compiled = await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara the merchant',
      characterName: 'Mara',
      npcId: 'merchant',
    });

    // Resolved without awaiting generation — the frame is not blocked.
    expect(compiled).toBeDefined();
    expect(generateAsset).toHaveBeenCalledTimes(1);
    expect(saveAsset).not.toHaveBeenCalled();

    releaseGeneration?.();
    await service.drain();

    expect(saveAsset).toHaveBeenCalledWith({ tag: 'portraits:merchant-neutral' });
  });

  test('registers the portrait under the resolver tag and dedupes afterwards', async () => {
    const { service, generateAsset } = createService({});

    await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara the merchant',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();

    expect(generateAsset).toHaveBeenCalledWith({
      recipeId: 'portrait',
      prompt: expect.stringContaining('Mara the merchant'),
      negativePrompt: expect.any(String),
      npcId: 'merchant',
    });

    // Replaying the same NPC in-session does not regenerate.
    const second = await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara the merchant',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();

    expect(second).toBeUndefined();
    expect(generateAsset).toHaveBeenCalledTimes(1);
  });

  test('a transient failure does not permanently suppress the NPC', async () => {
    let attempt = 0;
    const { service, generateAsset } = createService({
      generateAsset: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('engine died');
        }
        return generatedOutcome();
      },
    });

    await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();

    // The failure is logged, not cached — a later interaction retries.
    await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();

    expect(generateAsset).toHaveBeenCalledTimes(2);
  });

  test('a failed save does not mark the NPC done', async () => {
    const { service, generateAsset } = createService({
      saveAsset: async (request) => ({
        registered: false,
        tag: request.tag,
        sha256: 'a'.repeat(64),
        reason: 'not_initialized',
      }),
    });

    await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();
    await service.fireTrigger({
      event: 'npc_introduced',
      context: 'Mara',
      characterName: 'Mara',
      npcId: 'merchant',
    });
    await service.drain();

    expect(generateAsset).toHaveBeenCalledTimes(2);
  });

  test('a generation failure never rejects the trigger', async () => {
    const { service } = createService({
      generateAsset: async () => {
        throw new Error('engine died');
      },
    });

    await expect(
      service.fireTrigger({
        event: 'npc_introduced',
        context: 'Mara',
        npcId: 'merchant',
      }),
    ).resolves.toBeDefined();
    await expect(service.drain()).resolves.toBeUndefined();
  });

  test('an NPC without an id compiles a prompt but does not generate', async () => {
    const { service, generateAsset } = createService({});

    const compiled = await service.fireTrigger({
      event: 'npc_introduced',
      context: 'a stranger',
      characterName: 'Stranger',
    });
    await service.drain();

    expect(compiled).toBeDefined();
    expect(generateAsset).not.toHaveBeenCalled();
  });

  test('non-NPC events compile a prompt without generating (unchanged behaviour)', async () => {
    const { service, generateAsset } = createService({});

    const compiled = await service.fireTrigger({
      event: 'location_changed',
      context: 'Emberwatch village square',
    });
    await service.drain();

    expect(compiled).toBeDefined();
    expect(generateAsset).not.toHaveBeenCalled();
  });
});
