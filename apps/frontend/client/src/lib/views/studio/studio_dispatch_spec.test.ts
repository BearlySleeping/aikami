// apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.test.ts
//
// C-522 AC-1: the studio's dispatch must name ids the runner can actually
// resolve. It shipped `local-sdcpp` and `image-default`, neither of which is in
// any registry: the runner's `profileForItem` resolved nothing, raised
// `provider_unavailable`, and the Hub then reported the blocked plan as
// `queued` with its lease still held — a dispatch that could never be claimed
// and never explained itself.

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import { getRecipe } from '@aikami/local-ai';
import { buildStudioDispatch, studioHostedDisclosure } from './studio_dispatch_spec.ts';

const REQUEST = { prompt: 'a hero portrait' } as const;

describe('C-522 AC-1: the studio dispatch names only registered ids', () => {
  test('the provider profile it dispatches is a key of the registry', async () => {
    const { spec } = await buildStudioDispatch(REQUEST);
    const profile = GENERATION_PROVIDER_PROFILES[spec.providerProfileId];
    expect(profile).toBeDefined();
    expect(profile?.mode).toBe('local');
    // A hosted profile here would be the Hub spending on the creator's behalf.
    expect(profile?.modality).toBe(spec.modality);
  });

  test('the resolved profile serves the recipe engine the runner will dial', async () => {
    const { spec } = await buildStudioDispatch(REQUEST);
    const profile = GENERATION_PROVIDER_PROFILES[spec.providerProfileId];
    // The runner builds the engine from the *profile*, ignoring the recipe, so
    // these two must agree or the recipe is decoration.
    expect(profile?.engineId).toBe(getRecipe(spec.recipeId)?.engine);
  });

  test('the preparation profile is the brief-namespace key, not a workflow id', async () => {
    const { spec } = await buildStudioDispatch(REQUEST);
    // `preparationProfile` on a plan item is a key the brief declares; the C-520
    // `PREPARATION_PROFILE_IDS` (`portrait-original`) are a different vocabulary
    // that the CLI selects with its own flag.
    expect(spec.preparationProfile).toBe('portrait');
  });

  test('an explicit identity is threaded through spec, hash and job id', async () => {
    const first = await buildStudioDispatch(REQUEST, { attempt: 2, seed: 11 });
    const second = await buildStudioDispatch(REQUEST, { attempt: 2, seed: 11 });
    expect(first.spec.seed).toBe(11);
    expect(second.effectiveSpecHash).toBe(first.effectiveSpecHash);
    expect(second.jobId).toBe(first.jobId);
    expect(second.requestKey).toBe(first.requestKey);
  });

  test('repeated requests with the same prompt are distinct dispatches', async () => {
    // A re-roll must not collapse onto the prior dispatch: the Hub enqueues
    // idempotently on `(owner, jobId, attempt)`, so identical identity would
    // silently drop the new request.
    const first = await buildStudioDispatch(REQUEST);
    const second = await buildStudioDispatch(REQUEST);
    expect(second.spec.seed).not.toBe(first.spec.seed);
    expect(second.effectiveSpecHash).not.toBe(first.effectiveSpecHash);
    expect(second.jobId).not.toBe(first.jobId);
  });

  test('a negative prompt changes the hash and nothing else', async () => {
    const plain = await buildStudioDispatch(REQUEST);
    const withNegative = await buildStudioDispatch({ ...REQUEST, negativePrompt: 'blurry' });
    expect(withNegative.effectiveSpecHash).not.toBe(plain.effectiveSpecHash);
    expect(withNegative.spec.providerProfileId).toBe(plain.spec.providerProfileId);
    expect(withNegative.spec.negativePrompt).toBe('blurry');
    expect(plain.spec.negativePrompt).toBeUndefined();
  });

  test('the studio never dispatches a profile it cannot name', async () => {
    // The two fictional ids, stated as a guard rather than a comment.
    const { spec } = await buildStudioDispatch(REQUEST);
    expect(spec.providerProfileId).not.toBe('local-sdcpp');
    expect(spec.preparationProfile).not.toBe('image-default');
    expect(GENERATION_PROVIDER_PROFILES[spec.providerProfileId]).not.toBeUndefined();
  });
});

describe('C-524: an explicit hosted provider choice', () => {
  const Hosted = {
    kind: 'hosted',
    providerProfileId: 'hosted_image_profile',
    hostedBudgetUsd: 0.25,
  } as const;

  test('the default is the local profile with a zero hosted ceiling', async () => {
    const { spec } = await buildStudioDispatch(REQUEST);
    expect(spec.providerMode).toBe('local');
    // 🔴 Zero is what refuses every hosted provider: nothing is dialled paid
    // without an explicit choice.
    expect(spec.budget.hostedBudgetUsd).toBe(0);
  });

  test('an explicit hosted selection resolves from the registry, not from a literal', async () => {
    const { spec } = await buildStudioDispatch({ ...REQUEST, provider: Hosted });
    expect(spec.providerProfileId).toBe('hosted_image_profile');
    expect(spec.providerMode).toBe('hosted');
    expect(GENERATION_PROVIDER_PROFILES[spec.providerProfileId]?.mode).toBe('hosted');
    expect(GENERATION_PROVIDER_PROFILES[spec.providerProfileId]?.modality).toBe('image');
    // The creator's ceiling travels with the dispatch; it is never defaulted.
    expect(spec.budget.hostedBudgetUsd).toBe(0.25);
  });

  test('the hosted hash differs from the local hash for the same prompt', async () => {
    const local = await buildStudioDispatch(REQUEST, { attempt: 1, seed: 5 });
    const hosted = await buildStudioDispatch(
      { ...REQUEST, provider: Hosted },
      { attempt: 1, seed: 5 },
    );
    expect(hosted.effectiveSpecHash).not.toBe(local.effectiveSpecHash);
  });

  test('a hosted selection without a positive ceiling is refused, never downgraded', async () => {
    await expect(
      buildStudioDispatch({
        ...REQUEST,
        provider: { kind: 'hosted', providerProfileId: 'hosted_image_profile', hostedBudgetUsd: 0 },
      }),
    ).rejects.toThrow(/explicit positive hostedBudgetUsd ceiling/);
  });

  test('an undeclared or non-hosted profile id is refused', async () => {
    await expect(
      buildStudioDispatch({
        ...REQUEST,
        provider: { kind: 'hosted', providerProfileId: 'local-sdcpp', hostedBudgetUsd: 1 },
      }),
    ).rejects.toThrow(/not declared in the provider registry/);
    await expect(
      buildStudioDispatch({
        ...REQUEST,
        provider: {
          kind: 'hosted',
          providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
          hostedBudgetUsd: 1,
        },
      }),
    ).rejects.toThrow(/is not a hosted profile/);
  });

  test('the disclosure carries the recorded terms and the standalone-distribution decision', () => {
    const disclosure = studioHostedDisclosure({
      providerProfileId: 'hosted_image_profile',
      hostedBudgetUsd: 0.25,
    });
    expect(disclosure.transport).toBe('pixellab');
    expect(disclosure.modelId).toBe('pixflux');
    expect(disclosure.apiVersion).toBe('v1');
    expect(disclosure.accountScope.length).toBeGreaterThan(0);
    expect(disclosure.termsDate).toBe('2026-09-13');
    // Game inclusion does not imply standalone redistribution.
    expect(disclosure.standaloneDistribution).toBe(false);
    expect(disclosure.limitation).toContain('not a redistribution licence');
    expect(disclosure.estimatedMaxUsd).toBe(0.04);
  });
});
