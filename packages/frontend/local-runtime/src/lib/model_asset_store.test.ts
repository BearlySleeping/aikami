// packages/frontend/local-runtime/src/lib/model_asset_store.test.ts
//
// Subscriber isolation coverage for ModelAssetStore state transitions.

import { expect, mock, test } from 'bun:test';
import type { LocalModelBundle } from '@aikami/constants';
import { ModelAssetStore } from './model_asset_store.ts';

const TEST_BUNDLE: LocalModelBundle = {
  id: 'test-model',
  label: 'Test Model',
  license: 'Apache-2.0',
  modality: 'voice',
  repo: 'test-org/test-repo',
  revision: 'main',
  manifestVersion: 1,
  manifestKey: 'test-model-manifest',
  assets: [
    {
      path: 'model.bin',
      bytes: 100,
      sha256: 'ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae',
      cache: 'test-cache',
      key: 'test-model-model.bin',
    },
  ],
};

test('subscriber failures do not escape or prevent later notifications', async () => {
  const store = new ModelAssetStore({ bundles: { [TEST_BUNDLE.id]: TEST_BUNDLE } });
  const healthyListener = mock(() => {});
  store.subscribe(TEST_BUNDLE.id, () => {
    throw new Error('subscriber failed');
  });
  store.subscribe(TEST_BUNDLE.id, healthyListener);

  const state = await store.status(TEST_BUNDLE.id);

  expect(state.status).toBe('not-downloaded');
  expect(healthyListener).toHaveBeenCalledTimes(1);
});
