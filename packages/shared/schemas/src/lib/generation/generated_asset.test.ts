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
});
