// packages/shared/constants/src/lib/providers.test.ts

import { describe, expect, test } from 'bun:test';
import { findProviderDescriptor } from './providers.ts';

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
