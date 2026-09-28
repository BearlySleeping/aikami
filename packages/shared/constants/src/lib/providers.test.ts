// packages/shared/constants/src/lib/providers.test.ts

import { describe, expect, test } from 'bun:test';
import { findProviderDescriptor, providerAcceptsKey, providerNeedsKey } from './providers.ts';

describe('findProviderDescriptor', () => {
  test('resolves duplicate OpenAI metadata by capability', () => {
    expect(findProviderDescriptor('openai', 'text')?.label).toBe('OpenAI');
    expect(findProviderDescriptor('openai', 'image')?.label).toBe('OpenAI');
    expect(findProviderDescriptor('openai', 'voice')).toMatchObject({
      label: 'OpenAI TTS',
      supportsModelDiscovery: false,
      capabilities: ['voice'],
    });
  });
});

describe('NanoGPT', () => {
  test('is registered as a key-required, model-discovering text provider', () => {
    expect(findProviderDescriptor('nanogpt', 'text')).toMatchObject({
      label: 'NanoGPT',
      needsKey: true,
      isLocal: false,
      apiBaseUrl: 'https://api.nano-gpt.com',
      verificationStrategy: 'cloud_header_auth',
      supportsModelDiscovery: true,
    });
  });

  test('requires a key, so the editor always shows the field', () => {
    expect(providerNeedsKey('nanogpt')).toBe(true);
    expect(providerAcceptsKey('nanogpt', 'text')).toBe(true);
  });
});

describe('providerAcceptsKey', () => {
  test('a user-supplied endpoint accepts a key without requiring one', () => {
    expect(providerAcceptsKey('custom', 'text')).toBe(true);
    expect(providerNeedsKey('custom')).toBe(false);
    expect(providerAcceptsKey('openai-compat', 'image')).toBe(true);
    expect(providerNeedsKey('openai-compat')).toBe(false);
  });

  test('a keyless local server accepts no key at all', () => {
    expect(providerAcceptsKey('ollama')).toBe(false);
    expect(providerAcceptsKey('llamacpp')).toBe(false);
  });

  test('an unknown provider id claims nothing', () => {
    expect(providerAcceptsKey('nope')).toBe(false);
  });
});
