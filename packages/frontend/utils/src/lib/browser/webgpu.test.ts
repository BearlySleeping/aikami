// packages/frontend/utils/src/lib/browser/webgpu.test.ts
//
// Guards the contract every WebGPU consumer depends on: "supported" means an
// adapter was actually handed out, and the probe can never hang.

import { afterEach, describe, expect, test } from 'bun:test';
import { isWebGPUSupported } from './webgpu.ts';

/** The only part of `navigator.gpu` the probe touches. */
type FakeGpu = { requestAdapter?: () => Promise<unknown> };

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** Installs a fake `navigator.gpu` (or removes it entirely). */
const setNavigator = (gpu: FakeGpu | undefined): void => {
  // `value` is untyped, so no cast is needed (and none is wanted: the real
  // `Navigator` carries a dozen properties this stub deliberately omits).
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { gpu },
  });
};

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalDescriptor);
  }
});

describe('isWebGPUSupported', () => {
  test('true when an adapter is returned', async () => {
    setNavigator({ requestAdapter: async () => ({ features: new Set() }) });

    expect(await isWebGPUSupported()).toBe(true);
  });

  test('false when the browser has no WebGPU at all', async () => {
    setNavigator(undefined);

    expect(await isWebGPUSupported()).toBe(false);
  });

  test('false when requestAdapter is missing', async () => {
    setNavigator({});

    expect(await isWebGPUSupported()).toBe(false);
  });

  test('false when the driver hands out no adapter', async () => {
    setNavigator({ requestAdapter: async () => null });

    expect(await isWebGPUSupported()).toBe(false);
  });

  test('false when the adapter request throws', async () => {
    setNavigator({
      requestAdapter: async () => {
        throw new Error('blocklisted driver');
      },
    });

    expect(await isWebGPUSupported()).toBe(false);
  });

  test('false — never hanging — when the adapter request never settles', async () => {
    setNavigator({ requestAdapter: () => new Promise<never>(() => {}) });

    const startedAt = Date.now();
    expect(await isWebGPUSupported()).toBe(false);
    // The probe budget is 3s; allow generous slack for a loaded CI box while
    // still failing if the race was removed entirely.
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });
});
