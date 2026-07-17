// packages/shared/constants/src/lib/degradation.test.ts
//
// Unit tests for the per-feature degradation policy.
// Contract: C-318 AC-5, amended C-324

import { describe, expect, test } from 'bun:test';
import { DEGRADATION_POLICY, degradationBehavior, type FeatureId } from './degradation';

describe('degradationBehavior', () => {
  test('AC-5 / C-324: text AI unavailable returns correct onFailure fallback modes', () => {
    const profile = { textProvider: false, imageProvider: false, voiceProvider: false };

    expect(degradationBehavior({ feature: 'dialogue', capabilityProfile: profile })).toBe(
      'authored_fallback',
    );
    expect(degradationBehavior({ feature: 'combatNarration', capabilityProfile: profile })).toBe(
      'template_fallback',
    );
    expect(degradationBehavior({ feature: 'questDescriptions', capabilityProfile: profile })).toBe(
      'authored_fallback',
    );
    expect(degradationBehavior({ feature: 'npcExpressions', capabilityProfile: profile })).toBe(
      'static',
    );
    expect(degradationBehavior({ feature: 'ttsVoice', capabilityProfile: profile })).toBe(
      'disabled',
    );
    expect(degradationBehavior({ feature: 'imageGeneration', capabilityProfile: profile })).toBe(
      'disabled',
    );
    expect(degradationBehavior({ feature: 'sessionRecap', capabilityProfile: profile })).toBe(
      'static',
    );
    expect(degradationBehavior({ feature: 'aiGm', capabilityProfile: profile })).toBe('disabled');
  });

  test('text AI available → all features default to full_ai', () => {
    const profile = { textProvider: true, imageProvider: true, voiceProvider: true };
    const features: FeatureId[] = [
      'dialogue',
      'combatNarration',
      'questDescriptions',
      'npcExpressions',
      'sessionRecap',
      'aiGm',
      'ttsVoice',
      'imageGeneration',
    ];

    for (const feature of features) {
      expect(degradationBehavior({ feature, capabilityProfile: profile })).toBe('full_ai');
    }
  });

  test('image generation requires imageProvider', () => {
    expect(
      degradationBehavior({
        feature: 'imageGeneration',
        capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: true },
      }),
    ).toBe('disabled');

    expect(
      degradationBehavior({
        feature: 'imageGeneration',
        capabilityProfile: { textProvider: true, imageProvider: true, voiceProvider: true },
      }),
    ).toBe('full_ai');
  });

  test('TTS voice requires voiceProvider', () => {
    expect(
      degradationBehavior({
        feature: 'ttsVoice',
        capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
      }),
    ).toBe('disabled');

    expect(
      degradationBehavior({
        feature: 'ttsVoice',
        capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: true },
      }),
    ).toBe('full_ai');
  });

  test('lpcSprites always returns full_ai (offline-capable)', () => {
    expect(
      degradationBehavior({
        feature: 'lpcSprites',
        capabilityProfile: { textProvider: false, imageProvider: false, voiceProvider: false },
      }),
    ).toBe('full_ai');
  });

  test('DEGRADATION_POLICY is readonly and exhaustive', () => {
    // All feature IDs must have an entry
    const features: FeatureId[] = [
      'dialogue',
      'combatNarration',
      'questDescriptions',
      'npcExpressions',
      'lpcSprites',
      'ttsVoice',
      'imageGeneration',
      'sessionRecap',
      'aiGm',
    ];

    for (const feature of features) {
      const entry = DEGRADATION_POLICY[feature];
      expect(entry).toBeDefined();
      // Must have a fallback mode for onFailure (textProvider: false / transient failure)
      expect(entry.onFailure).toBeDefined();
      // Must have a fallback mode for online (textProvider: true)
      expect(entry.online).toBeDefined();
    }
  });
});
