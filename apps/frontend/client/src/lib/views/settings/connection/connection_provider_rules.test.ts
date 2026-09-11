// apps/frontend/client/src/lib/views/settings/connection/connection_provider_rules.test.ts
import { describe, expect, test } from 'bun:test';
import {
  capabilityProviderNeedsUrl,
  DEFAULT_PROVIDER_BY_CAPABILITY,
  LOCAL_GUIDE_PROVIDERS,
  providerOptionsForCapability,
} from './connection_provider_rules.ts';

describe('connection provider rules', () => {
  test('projects the text registry with the editor field rules', () => {
    const options = providerOptionsForCapability('text');
    const openrouter = options.find((option) => option.id === 'openrouter');
    expect(openrouter?.needsKey).toBe(true);
    expect(openrouter?.isLocal).toBe(false);
    expect(options.find((option) => option.id === 'ollama')?.isLocal).toBe(true);
  });

  test('image openai-compat requires a key (deliberate editor rule)', () => {
    const options = providerOptionsForCapability('image');
    const compat = options.find((option) => option.id === 'openai-compat');
    expect(compat?.needsKey).toBe(true);
    expect(compat?.needsUrl).toBe(true);
    expect(compat?.isLocal).toBe(false);
  });

  test('voice local providers need a URL and no key', () => {
    const options = providerOptionsForCapability('voice');
    const kokoro = options.find((option) => option.id === 'kokoro');
    expect(kokoro?.needsKey).toBe(false);
    expect(kokoro?.needsUrl).toBe(true);
    expect(kokoro?.isLocal).toBe(true);
  });

  test('capabilityProviderNeedsUrl is capability-scoped', () => {
    expect(capabilityProviderNeedsUrl('image', 'comfyui')).toBe(true);
    expect(capabilityProviderNeedsUrl('voice', 'kokoro')).toBe(true);
    expect(capabilityProviderNeedsUrl('text', 'custom')).toBe(true);
    expect(capabilityProviderNeedsUrl('text', 'openrouter')).toBe(false);
    expect(capabilityProviderNeedsUrl('voice', 'openai')).toBe(false);
  });

  test('default provider and local guide maps are correct', () => {
    expect(DEFAULT_PROVIDER_BY_CAPABILITY).toEqual({
      text: 'openrouter',
      image: 'comfyui',
      voice: 'kokoro',
    });
    expect(LOCAL_GUIDE_PROVIDERS.has('ollama')).toBe(true);
  });
});
