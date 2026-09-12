// apps/frontend/client/src/lib/services/ai/text_provider_mode.test.ts
//
// Unit tests for the pure text-provider mode classification.

import { describe, expect, test } from 'bun:test';
import { LOCAL_TEXT_PROVIDERS, resolveTextProviderMode } from './text_provider_mode.ts';

describe('resolveTextProviderMode', () => {
  test('local provider with an endpoint uses the HTTP (byok) transport', () => {
    expect(
      resolveTextProviderMode({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
    ).toBe('byok');
    expect(
      resolveTextProviderMode({ provider: 'llamacpp', endpoint: 'http://127.0.0.1:11434/v1' }),
    ).toBe('byok');
  });

  test('local provider without an endpoint falls back to the on-device pool', () => {
    expect(resolveTextProviderMode({ provider: 'ollama', endpoint: '' })).toBe('offline');
    expect(resolveTextProviderMode({ provider: 'llamacpp', endpoint: '   ' })).toBe('offline');
  });

  test('cloud providers always use byok', () => {
    expect(resolveTextProviderMode({ provider: 'openrouter', endpoint: '' })).toBe('byok');
    expect(resolveTextProviderMode({ provider: 'custom', endpoint: '' })).toBe('byok');
  });

  test('classifies exactly the known local providers', () => {
    expect([...LOCAL_TEXT_PROVIDERS].sort()).toEqual(['llamacpp', 'ollama', 'ooba']);
  });
});
