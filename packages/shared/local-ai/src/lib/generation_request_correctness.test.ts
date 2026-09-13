// packages/shared/local-ai/src/lib/generation_request_correctness.test.ts
// biome-ignore-all lint/style/useNamingConvention: the ACE-Step API uses snake_case fields
//
// C-517 AC-1 + AC-3 — what the engine is actually asked to do.
//
// AC-1: the compiled prompt reaches transport. Every shipped audio recipe
// carries generic `defaults.tags`; before this contract the adapter submitted
// `tags ?? positivePrompt`, so the author's subject never left the process.
// These tests assert the recorded HTTP payload, not the intermediate value.
//
// AC-3: BPM/key are requested hints carried in the prompt text — not native
// hard controls and not measured output facts — and the run reports them as
// `requested*`/`effective*` with no bare `bpm`/`key` and no invented
// `measured*`.
//
// These run in CI (`local-ai:test`); the image app's own task does not.
//
// Contract: C-517 Generation request and format correctness

import { afterEach, describe, expect, test } from 'bun:test';
import { GenerationRequestAuditSchema } from '@aikami/schemas';
import type { GenerationRequest } from '@aikami/types';
import { Value } from 'typebox/value';
import { wavBytes } from './__fixtures__/media_bytes.ts';
import { runAssetGeneration } from './asset_generation.ts';
import { AceStepGenerationEngine } from './engines/ace_step_engine.ts';
import { compileRecipeRequest, requireRecipe } from './recipes/recipe_registry.ts';

const BASE_URL = 'http://127.0.0.1:8094';
const WAV_BYTES = wavBytes({ frames: 44_100 });
const REAL_FETCH = globalThis.fetch;

/** Records every `/generate` body the adapter submits. */
const recordGenerateBodies = (): { bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return Promise.resolve(Response.json({ status: 'healthy' }));
    }
    if (url.endsWith('/generate')) {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(
        Response.json({
          status: 'success',
          output_path: '/models/audio/output/aikami-test.wav',
          message: 'ok',
        }),
      );
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  }) as typeof fetch;
  return { bodies };
};

const makeEngine = (): AceStepGenerationEngine =>
  new AceStepGenerationEngine({
    baseUrl: BASE_URL,
    readArtifact: async () => WAV_BYTES,
  });

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

const SHIPPED_AUDIO_RECIPES = ['music', 'sfx', 'ambient'] as const;

describe('C-517 AC-1: the subject and the style tags both reach transport', () => {
  for (const recipeId of SHIPPED_AUDIO_RECIPES) {
    test(`the ${recipeId} recipe submits the subject AND its tags to /generate`, async () => {
      const { bodies } = recordGenerateBodies();
      const recipe = requireRecipe(recipeId);
      const request = compileRecipeRequest(recipe, 'metal gate slam');

      await makeEngine().generate(request);

      expect(bodies).toHaveLength(1);
      const body = bodies[0] as Record<string, unknown>;
      const prompt = String(body.prompt);
      const compiled = recipe.promptTemplate.replaceAll('{{prompt}}', 'metal gate slam');

      // The author's subject — the value the pre-C-517 either/or discarded.
      expect(prompt).toContain('metal gate slam');
      // The compiled template is the base of the submitted prompt…
      expect(prompt.startsWith(compiled)).toBe(true);
      // …and the recipe's generic style tags are appended, not substituted.
      expect(recipe.defaults?.tags).toBeDefined();
      expect(prompt).toContain(String(recipe.defaults?.tags));
    });
  }

  test('an explicit tags override adds to the subject instead of erasing it', async () => {
    const { bodies } = recordGenerateBodies();
    const request = compileRecipeRequest(requireRecipe('sfx'), 'metal gate slam', {
      tags: 'impact, low thud',
    });

    await makeEngine().generate(request);

    const prompt = String((bodies[0] as Record<string, unknown>).prompt);
    expect(prompt).toContain('metal gate slam');
    expect(prompt).toContain('impact, low thud');
    // The recipe default tags are replaced by the override, not merged twice.
    expect(prompt).not.toContain('foley');
  });

  test('a blank or whitespace tags override falls back to the compiled template', async () => {
    for (const tags of ['', '   ']) {
      const { bodies } = recordGenerateBodies();
      const request = compileRecipeRequest(requireRecipe('music'), 'calm forest loop', { tags });

      await makeEngine().generate(request);

      const prompt = String((bodies[0] as Record<string, unknown>).prompt);
      expect(prompt).toContain('calm forest loop');
      expect(prompt).toContain('game background music, loopable, instrumental, high quality');
      expect(prompt.trim()).toBe(prompt);
      expect(prompt.endsWith(' BPM')).toBe(true); // the music recipe's own bpm hint
    }
  });

  test('instrumental requests still submit [inst] and vocal requests still submit lyrics', async () => {
    const instrumental = recordGenerateBodies();
    await makeEngine().generate(compileRecipeRequest(requireRecipe('sfx'), 'gate slam'));
    expect((instrumental.bodies[0] as Record<string, unknown>).lyrics).toBe('[inst]');

    const vocal = recordGenerateBodies();
    const request: GenerationRequest = {
      ...compileRecipeRequest(requireRecipe('music'), 'hold the line'),
      instrumental: false,
      lyrics: 'hold the line',
    };
    await makeEngine().generate(request);
    expect((vocal.bodies[0] as Record<string, unknown>).lyrics).toBe('hold the line');
  });

  test('a vocal request with no lyrics still fails loudly before dispatch', async () => {
    const { bodies } = recordGenerateBodies();
    const request: GenerationRequest = {
      ...compileRecipeRequest(requireRecipe('music'), 'hold the line'),
      instrumental: false,
      lyrics: '   ',
    };

    await expect(makeEngine().generate(request)).rejects.toThrow(/lyrics/i);
    expect(bodies).toHaveLength(0);
  });
});

describe('C-517 AC-3: the run audit keeps requested/effective/measured apart', () => {
  const runMusic = async (overrides: { bpm?: number; key?: string } = {}) => {
    const { bodies } = recordGenerateBodies();
    const staging = await runAssetGeneration({
      recipeId: 'music',
      prompt: 'metal gate slam',
      baseUrl: BASE_URL,
      overrides,
      engineOptions: {
        aceStep: {
          checkpointPath: '/models/audio/ace-step-v1-3.5b',
          outputDir: '/models/audio/output',
          readArtifact: async () => WAV_BYTES,
        },
      },
    });
    return { staging, bodies };
  };

  test('the audit is schema-valid and carries the compiled subject and tags', async () => {
    const { staging } = await runMusic();

    expect(Value.Check(GenerationRequestAuditSchema, staging.audit)).toBe(true);
    expect(staging.audit.engine).toBe('ace-step');
    expect(staging.audit.modality).toBe('audio');
    expect(staging.audit.subject).toBe(
      requireRecipe('music').promptTemplate.replaceAll('{{prompt}}', 'metal gate slam'),
    );
    expect(staging.audit.tags).toBe(requireRecipe('music').defaults?.tags);
    expect(staging.audit.effectivePrompt).toContain('metal gate slam');
    // The subject is the base; the tags and tempo hints follow it.
    expect(staging.audit.effectivePrompt?.startsWith('metal gate slam,')).toBe(true);
    expect(staging.audit.effectivePrompt).toContain('90 BPM');
  });

  test('BPM/key are labelled requested*/effective*, with no bare bpm/key field', async () => {
    const { staging, bodies } = await runMusic({ bpm: 120, key: 'D minor' });

    expect(staging.audit.requestedBpm).toBe(120);
    expect(staging.audit.effectiveBpm).toBe(120);
    expect(staging.audit.requestedKey).toBe('D minor');
    expect(staging.audit.effectiveKey).toBe('D minor');
    expect('bpm' in staging.audit).toBe(false);
    expect('key' in staging.audit).toBe(false);
    // Effective means it actually reached the engine.
    const prompt = String((bodies[0] as Record<string, unknown>).prompt);
    expect(prompt).toContain('120 BPM');
    expect(prompt).toContain('key: D minor');
  });

  test('no measured* field is invented when the engine reports no measurement', async () => {
    const { staging } = await runMusic({ bpm: 120, key: 'D minor' });

    for (const key of Object.keys(staging.audit)) {
      expect(key.startsWith('measured')).toBe(false);
    }
  });

  test('a measured value is carried through only when the engine reports one', async () => {
    // A fake engine that genuinely measures its own output.
    const staging = await runAssetGeneration({
      recipeId: 'music',
      prompt: 'calm forest loop',
      engine: {
        id: 'ace-step',
        modality: 'audio',
        capabilities: {
          negativePrompt: false,
          seed: true,
          sampler: false,
          initImage: false,
          mask: false,
          referenceImages: false,
          controlNet: false,
          lora: false,
          cancel: false,
          progress: false,
        },
        healthCheck: () => Promise.resolve(true),
        listModels: () => Promise.resolve([]),
        generate: () =>
          Promise.resolve({
            bytes: WAV_BYTES,
            mimeType: 'audio/wav',
            engine: 'ace-step' as const,
            metadata: {
              format: 'wav',
              prompt: 'calm forest loop',
              requestedBpm: 90,
              effectiveBpm: 90,
              measuredBpm: 88.4,
              measuredDurationSeconds: 59.8,
            },
          }),
      },
    });

    expect(staging.audit.measuredBpm).toBe(88.4);
    expect(staging.audit.measuredDurationSeconds).toBe(59.8);
    expect(Value.Check(GenerationRequestAuditSchema, staging.audit)).toBe(true);
  });

  test('an unsupported hard control fails before dispatch and names the field and engine', async () => {
    const { bodies } = recordGenerateBodies();

    await expect(
      runAssetGeneration({
        recipeId: 'music',
        prompt: 'calm forest loop',
        baseUrl: BASE_URL,
        overrides: { width: 512 },
        engineOptions: { aceStep: { readArtifact: async () => WAV_BYTES } },
      }),
    ).rejects.toThrow(/ACE-Step.*"width"|"width".*ACE-Step/i);

    expect(bodies).toHaveLength(0);
  });
});
