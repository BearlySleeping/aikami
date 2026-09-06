// packages/shared/local-ai/src/lib/host_detect.test.ts
import { describe, expect, test } from 'bun:test';
import { hasNativeCapability, isBrowserHost, isTauriHost } from './host_detect.ts';

const GLOBAL_THIS = globalThis as unknown as Record<string, unknown>;

describe('isTauriHost', () => {
  test('returns false when __TAURI_INTERNALS__ is not present', () => {
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
    expect(isTauriHost()).toBe(false);
  });

  test('returns true when __TAURI_INTERNALS__ is present', () => {
    GLOBAL_THIS.__TAURI_INTERNALS__ = {};
    expect(isTauriHost()).toBe(true);
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
  });
});

describe('isBrowserHost', () => {
  test('returns false when window is not defined', () => {
    const hadWindow = 'window' in GLOBAL_THIS;
    const prev = GLOBAL_THIS.window;
    delete GLOBAL_THIS.window;
    expect(isBrowserHost()).toBe(false);
    if (hadWindow) {
      GLOBAL_THIS.window = prev;
    }
  });

  test('returns true when window is defined and not in Tauri', () => {
    GLOBAL_THIS.window = {} as Window & typeof globalThis;
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
    expect(isBrowserHost()).toBe(true);
    delete GLOBAL_THIS.window;
  });

  test('returns false when in Tauri', () => {
    // biome-ignore lint/style/useNamingConvention: Tauri API constant
    GLOBAL_THIS.window = { __TAURI_INTERNALS__: {} } as Window & typeof globalThis;
    GLOBAL_THIS.__TAURI_INTERNALS__ = {};
    expect(isBrowserHost()).toBe(false);
    delete GLOBAL_THIS.window;
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
  });
});

describe('hasNativeCapability', () => {
  test('returns false when not in Tauri', () => {
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
    expect(hasNativeCapability('shell')).toBe(false);
    expect(hasNativeCapability('filesystem')).toBe(false);
    expect(hasNativeCapability('download')).toBe(false);
  });

  test('returns true for all capabilities when in Tauri', () => {
    GLOBAL_THIS.__TAURI_INTERNALS__ = {};
    expect(hasNativeCapability('shell')).toBe(true);
    expect(hasNativeCapability('filesystem')).toBe(true);
    expect(hasNativeCapability('download')).toBe(true);
    delete GLOBAL_THIS.__TAURI_INTERNALS__;
  });
});
