// apps/frontend/client/src/lib/services/image/engine/image_engine_capabilities.test.ts
//
// Image engine capabilities — C-388 AC-5 (capabilities gate the UI).
//
// Contract: C-388 Image Engine Provider Abstraction

import { describe, expect, test } from 'bun:test';

import { ComfyUiEngine } from './comfyui_engine.svelte.ts';
import { SdCppEngine } from './sdcpp_engine.svelte.ts';

describe('image engine capabilities (AC-5)', () => {
  test('ComfyUI does not declare mask/referenceImages/controlNet/lora', () => {
    const engine = new ComfyUiEngine('http://localhost:8188');
    expect(engine.capabilities.mask).toBe(false);
    expect(engine.capabilities.referenceImages).toBe(false);
    expect(engine.capabilities.controlNet).toBe(false);
    expect(engine.capabilities.lora).toBe(false);
  });

  test('ComfyUI declares the controls its graph actually supports', () => {
    const engine = new ComfyUiEngine('http://localhost:8188');
    expect(engine.capabilities.negativePrompt).toBe(true);
    expect(engine.capabilities.seed).toBe(true);
    expect(engine.capabilities.sampler).toBe(true);
    expect(engine.capabilities.initImage).toBe(true);
    expect(engine.capabilities.cancel).toBe(true);
    expect(engine.capabilities.progress).toBe(true);
  });

  test('sd-server declares the full capability set', () => {
    const engine = new SdCppEngine('http://localhost:8188');
    expect(engine.capabilities.mask).toBe(true);
    expect(engine.capabilities.referenceImages).toBe(true);
    expect(engine.capabilities.controlNet).toBe(true);
    expect(engine.capabilities.lora).toBe(true);
    expect(engine.capabilities.negativePrompt).toBe(true);
    expect(engine.capabilities.initImage).toBe(true);
    expect(engine.capabilities.cancel).toBe(true);
    expect(engine.capabilities.progress).toBe(true);
  });

  test('the capability surface matches the ImageEngineCapabilities shape', () => {
    const comfy = new ComfyUiEngine('http://localhost:8188');
    const keys = Object.keys(comfy.capabilities).sort();
    expect(keys).toEqual(
      [
        'cancel',
        'controlNet',
        'initImage',
        'lora',
        'mask',
        'negativePrompt',
        'progress',
        'referenceImages',
        'sampler',
        'seed',
      ].sort(),
    );
  });
});
