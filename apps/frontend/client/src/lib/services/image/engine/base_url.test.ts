// apps/frontend/client/src/lib/services/image/engine/base_url.test.ts
//
// Base URL resolution — C-389 AC-1/AC-2. The image engine URL comes from the
// runtime config chain, never a baked-in localhost literal. Unconfigured →
// undefined (engines report unavailable); configured → trailing slash
// stripped; dev proxy relative path accepted; non-http(s) rejected.
//
// Contract: C-388 Image Engine Provider Abstraction / C-389 AC-1, AC-2

// Mock the runtime config service BEFORE importing base_url so
// resolveImageBaseUrl reads a controllable URL.
let mockImageUrl: string | undefined;
mock.module('../../config/runtime_config_service.svelte.ts', () => ({
  runtimeConfigService: {
    getImageUrl: () => mockImageUrl,
  },
}));

import { describe, expect, test } from 'bun:test';
import { resolveImageBaseUrl } from './base_url.ts';

describe('resolveImageBaseUrl (C-389 runtime config)', () => {
  test('unconfigured image engine resolves to undefined — no baked-in URL', () => {
    mockImageUrl = undefined;
    expect(resolveImageBaseUrl('comfyui')).toBeUndefined();
    expect(resolveImageBaseUrl('sdcpp')).toBeUndefined();
  });

  test('configured URL is returned trailing-slash-stripped', () => {
    mockImageUrl = 'http://localhost:8188/';
    expect(resolveImageBaseUrl('comfyui')).toBe('http://localhost:8188');
  });

  test('dev-server proxy relative path is accepted', () => {
    mockImageUrl = '/api/image';
    expect(resolveImageBaseUrl('comfyui')).toBe('/api/image');
  });

  test('non-http(s) configured URL is rejected', () => {
    mockImageUrl = 'file:///etc/passwd';
    expect(() => resolveImageBaseUrl('comfyui')).toThrow(/only http\(s\)/);
  });
});
