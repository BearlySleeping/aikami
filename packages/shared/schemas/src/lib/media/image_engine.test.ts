// packages/shared/schemas/src/lib/media/image_engine.test.ts
//
// C-511 AC-5 — the persisted image-engine preference remains image-only as
// modality-generic engine ids expand.
//
// Contract: C-511 Local Audio Generation Modality

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { ImageEngineIdSchema, ImageEnginePreferenceSchema } from './image_engine.ts';

describe('ImageEngineIdSchema (C-511)', () => {
  test('every pre-contract engine id still validates', () => {
    for (const id of ['auto', 'sdcpp', 'comfyui']) {
      expect(Value.Check(ImageEngineIdSchema, id)).toBe(true);
    }
  });

  test('generation-only engine ids are rejected', () => {
    expect(Value.Check(ImageEngineIdSchema, 'ace-step')).toBe(false);
  });

  test('an unknown engine id is still rejected', () => {
    expect(Value.Check(ImageEngineIdSchema, 'midjourney')).toBe(false);
    expect(Value.Check(ImageEngineIdSchema, '')).toBe(false);
  });
});

describe('ImageEnginePreferenceSchema (C-511)', () => {
  test('a pre-contract persisted preference still validates', () => {
    expect(Value.Check(ImageEnginePreferenceSchema, { engine: 'sdcpp' })).toBe(true);
    expect(
      Value.Check(ImageEnginePreferenceSchema, { engine: 'comfyui', checkpoint: 'sd_xl_base' }),
    ).toBe(true);
  });

  test('an audio-engine preference is rejected', () => {
    expect(Value.Check(ImageEnginePreferenceSchema, { engine: 'ace-step' })).toBe(false);
  });

  test('a malformed persisted preference is still rejected', () => {
    expect(Value.Check(ImageEnginePreferenceSchema, { engine: 'midjourney' })).toBe(false);
    expect(Value.Check(ImageEnginePreferenceSchema, {})).toBe(false);
  });
});
