// packages/shared/constants/src/lib/local_models.test.ts
//
// The Kokoro cache keys are load-bearing: the worker asks transformers.js for
// the exact URL stored here, and Cache Storage serves the bytes offline. A
// relative key (`/models/...`) is answered with `index.html` by every static
// SPA host, which surfaced as `Unexpected token '<'` during model load.
//
// The same rule applies to the manifest key, for a different reason: a
// relative Cache Storage key resolves against the document base URL, which is
// the `tauri://localhost` custom protocol in a packaged Linux/macOS Tauri
// build. WebKit rejects such a key with `Request url is not HTTP/HTTPS`, so
// the manifest write threw *after* every model byte had already downloaded
// and verified — the download reported failure and speech never initialized.

import { describe, expect, test } from 'bun:test';
import {
  KOKORO_BUNDLE,
  KOKORO_REVISION,
  LOCAL_MODEL_BUNDLES,
  QWEN3_BUNDLE,
} from './local_models.ts';

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

describe('bundle manifest keys', () => {
  test('are absolute https URLs, never document-relative', () => {
    // A relative key resolves against `tauri://localhost` inside a packaged
    // Tauri app, and WebKit refuses to store it (C-427 follow-up).
    for (const bundle of Object.values(LOCAL_MODEL_BUNDLES)) {
      expect(bundle.manifestKey.startsWith('https://')).toBe(true);
      expect(() => new URL(bundle.manifestKey)).not.toThrow();
    }
  });

  test('encode the bundle id and the manifest version they gate', () => {
    for (const bundle of Object.values(LOCAL_MODEL_BUNDLES)) {
      expect(bundle.manifestKey).toContain(`/${bundle.id}/`);
      expect(bundle.manifestKey).toContain(`manifest-v${bundle.manifestVersion}.json`);
    }
  });

  test('are unique per bundle, so bundles cannot clobber each other', () => {
    const keys = Object.values(LOCAL_MODEL_BUNDLES).map((bundle) => bundle.manifestKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('the Kokoro manifest version is bumped past the relative-key era', () => {
    // v1 was document-relative; v3 moved asset keys. Anything <= 3 can be a
    // pre-fix install whose manifest was never actually written on Linux.
    expect(KOKORO_BUNDLE.manifestVersion).toBeGreaterThan(3);
    expect(QWEN3_BUNDLE.manifestVersion).toBeGreaterThan(1);
  });
});
