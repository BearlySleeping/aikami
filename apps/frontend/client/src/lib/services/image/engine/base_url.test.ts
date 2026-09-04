// apps/frontend/client/src/lib/services/image/engine/base_url.test.ts
//
// Base URL resolution — C-389 AC-1/AC-2. The image engine URL comes from the
// runtime config chain, never a baked-in localhost literal. Unconfigured →
// undefined (engines report unavailable); configured → trailing slash
// stripped; dev proxy relative path accepted; non-http(s) rejected.
//
// Contract: C-388 Image Engine Provider Abstraction / C-389 AC-1, AC-2

// Mock the runtime config service and configService BEFORE importing
// base_url so resolveImageBaseUrl reads controllable values.
let mockImageUrl: string | undefined;
mock.module('../../config/runtime_config_service.svelte.ts', () => ({
  runtimeConfigService: {
    getImageUrl: () => mockImageUrl,
  },
}));

let mockPortraitResolution: { endpoint?: string } | undefined;
mock.module('../../config/config_service.svelte.ts', () => ({
  configService: {
    resolveRole: (role: string) => (role === 'portrait' ? mockPortraitResolution : undefined),
  },
}));

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { resolveImageBaseUrl as ResolveImageBaseUrl } from './base_url.ts';

let resolveImageBaseUrl: typeof ResolveImageBaseUrl;

describe('resolveImageBaseUrl (C-389 runtime config)', () => {
  beforeEach(async () => {
    ({ resolveImageBaseUrl } = await import('./base_url.ts'));
  });

  test('unconfigured image engine resolves to undefined — no baked-in URL', () => {
    mockImageUrl = undefined;
    mockPortraitResolution = undefined;
    expect(resolveImageBaseUrl('comfyui')).toBeUndefined();
    expect(resolveImageBaseUrl('sdcpp')).toBeUndefined();
  });

  test('configured URL is returned trailing-slash-stripped', () => {
    mockImageUrl = 'http://localhost:8188/';
    mockPortraitResolution = undefined;
    expect(resolveImageBaseUrl('comfyui')).toBe('http://localhost:8188');
  });

  test('dev-server proxy relative path is accepted', () => {
    mockImageUrl = '/api/image';
    mockPortraitResolution = undefined;
    expect(resolveImageBaseUrl('comfyui')).toBe('/api/image');
  });

  test('non-http(s) configured URL is rejected', () => {
    mockImageUrl = 'file:///etc/passwd';
    mockPortraitResolution = undefined;
    expect(() => resolveImageBaseUrl('comfyui')).toThrow(/only http\(s\)/);
  });

  // C-463 PR: prefer the portrait role's connection provider.
  test('prefers the portrait role connection endpoint over runtimeConfigService', () => {
    mockImageUrl = 'http://localhost:8188/';
    mockPortraitResolution = { endpoint: 'http://10.0.0.4:9000/' };
    expect(resolveImageBaseUrl('comfyui')).toBe('http://10.0.0.4:9000');
  });

  test('falls back to runtimeConfigService cleanly when no portrait role resolves', () => {
    mockImageUrl = 'http://localhost:8188/';
    mockPortraitResolution = undefined;
    expect(resolveImageBaseUrl('comfyui')).toBe('http://localhost:8188');
  });
});
