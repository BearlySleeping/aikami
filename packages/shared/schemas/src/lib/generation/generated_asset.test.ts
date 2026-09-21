// packages/shared/schemas/src/lib/generation/generated_asset.test.ts

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { GeneratedAssetSchema } from './generated_asset.ts';

const descriptor = {
  recipeId: 'prop',
  category: 'props',
  tag: 'props:gate',
  sha256: 'a'.repeat(64),
  sizeBytes: 1,
  ext: '.png',
  mimeType: 'image/png',
  provenance: { source: 'generated:sdcpp' },
  engine: 'sdcpp',
  prompt: 'gate',
};

describe('GeneratedAssetSchema', () => {
  test('requires generated descriptors to describe non-empty bytes', () => {
    expect(Value.Check(GeneratedAssetSchema, descriptor)).toBe(true);
    expect(Value.Check(GeneratedAssetSchema, { ...descriptor, sizeBytes: 0 })).toBe(false);
  });

  test('C-511: records the producing model id when the engine reports one', () => {
    expect(
      Value.Check(GeneratedAssetSchema, { ...descriptor, model: 'audio-ace-step-v1-3.5b' }),
    ).toBe(true);
    // The model id is the preflight's only handle on the licence that gates
    // publication — an empty string is not a usable handle.
    expect(Value.Check(GeneratedAssetSchema, { ...descriptor, model: '' })).toBe(false);
  });

  test('C-511: accepts the ace-step engine id and its provenance source', () => {
    expect(
      Value.Check(GeneratedAssetSchema, {
        ...descriptor,
        category: 'music',
        tag: 'music:exploration:calm-forest-loop',
        ext: '.wav',
        mimeType: 'audio/wav',
        engine: 'ace-step',
        provenance: { source: 'generated:ace-step' },
      }),
    ).toBe(true);
  });
});
