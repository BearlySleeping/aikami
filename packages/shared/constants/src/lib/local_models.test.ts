// packages/shared/constants/src/lib/local_models.test.ts
//
// The Kokoro cache keys are load-bearing: the worker asks transformers.js for
// the exact URL stored here, and Cache Storage serves the bytes offline. A
// relative key (`/models/...`) is answered with `index.html` by every static
// SPA host, which surfaced as `Unexpected token '<'` during model load.

import { describe, expect, test } from 'bun:test';
import { KOKORO_BUNDLE, KOKORO_REVISION } from './local_models.ts';

describe('KOKORO_BUNDLE cache keys', () => {
  test('every asset is keyed by an absolute HuggingFace URL', () => {
    for (const asset of KOKORO_BUNDLE.assets) {
      expect(asset.key.startsWith('https://huggingface.co/')).toBe(true);
      expect(() => new URL(asset.key)).not.toThrow();
    }
  });

  test('model weights are keyed at the pinned revision, never main', () => {
    const modelAsset = KOKORO_BUNDLE.assets.find((a) => a.path.endsWith('.onnx'));
    expect(modelAsset).toBeDefined();
    expect(modelAsset?.key).toContain(`/resolve/${KOKORO_REVISION}/`);
    expect(modelAsset?.key).not.toContain('/resolve/main/');
  });

  test('each key ends with the asset path it describes', () => {
    for (const asset of KOKORO_BUNDLE.assets) {
      expect(asset.key.endsWith(`/${asset.path}`)).toBe(true);
    }
  });
});
