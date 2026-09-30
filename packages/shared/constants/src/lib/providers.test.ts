// packages/shared/constants/src/lib/providers.test.ts

import { describe, expect, test } from 'bun:test';
import {
  findProviderDescriptor,
  getTextReasoningControl,
  providerAcceptsKey,
  providerNeedsKey,
} from './providers.ts';

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

describe('getTextReasoningControl', () => {
  test('Ollama declares the native `think` control, which is the one measured to work', () => {
    expect(getTextReasoningControl('ollama')).toBe('ollama-native-think');
  });

  test('a provider that has not been measured declares nothing', () => {
    // Not "false" and not a guessed spelling: absent, so the adapter omits the
    // field and the request is byte-identical to the pre-change one.
    expect(getTextReasoningControl('llamacpp')).toBeUndefined();
    expect(getTextReasoningControl('ooba')).toBeUndefined();
    expect(getTextReasoningControl('openrouter')).toBeUndefined();
  });

  test('an unknown provider id declares nothing rather than throwing', () => {
    expect(getTextReasoningControl('definitely-not-a-provider')).toBeUndefined();
  });
});
