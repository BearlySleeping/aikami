// packages/shared/schemas/src/lib/media/image_engine.test.ts
//
// C-511 AC-5 — the persisted image-engine preference survives the engine-id
// widening.
//
// `ImageEngineIdSchema` is the PERSISTED per-install preference. C-511 adds
// `ace-step` to it because `GenerationEngineId` is derived from the same union
// (never a second hand-written union). The change must be additive: an
// existing stored value still validates, `ace-step` validates as a stored
// value too, and the audio id remains distinguishable from the image engines.
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

  test('ace-step validates as an engine id (the union is shared with GenerationEngineId)', () => {
    expect(Value.Check(ImageEngineIdSchema, 'ace-step')).toBe(true);
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

  test('an ace-step preference validates as a stored value', () => {
    expect(Value.Check(ImageEnginePreferenceSchema, { engine: 'ace-step' })).toBe(true);
  });

  test('a malformed persisted preference is still rejected', () => {
    expect(Value.Check(ImageEnginePreferenceSchema, { engine: 'midjourney' })).toBe(false);
    expect(Value.Check(ImageEnginePreferenceSchema, {})).toBe(false);
  });
});
