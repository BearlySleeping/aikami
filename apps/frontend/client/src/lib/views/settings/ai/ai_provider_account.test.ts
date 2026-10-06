// apps/frontend/client/src/lib/views/settings/ai/ai_provider_account.test.ts
//
// Provider-account identity for the connection editor: which stored provider a
// draft continues. The regression these guard is two unrelated custom
// endpoints sharing one account, where saving the second silently repoints
// the first.

import { describe, expect, test } from 'bun:test';
import type { AiProvider } from '@aikami/types';
import {
  hasMovedAccount,
  matchProviderAccount,
  normalizeEndpoint,
  planProviderAccount,
} from './ai_provider_account';

const provider = (
  overrides: Partial<AiProvider> & Pick<AiProvider, 'id' | 'registryId'>,
): AiProvider =>
  ({
    label: overrides.registryId,
    source: 'stored',
    ...overrides,
  }) as AiProvider;

describe('normalizeEndpoint', () => {
  test('treats a bare host and its /v1 spelling as one endpoint', () => {
    expect(normalizeEndpoint('https://api.example.test/v1')).toBe(
      normalizeEndpoint('https://api.example.test'),
    );
  });

  test('ignores trailing slashes and surrounding whitespace', () => {
    expect(normalizeEndpoint('  https://api.example.test/v1///  ')).toBe(
      'https://api.example.test',
    );
  });

  test('is empty for a missing endpoint', () => {
    expect(normalizeEndpoint(undefined)).toBe('');
    expect(normalizeEndpoint('   ')).toBe('');
  });

  test('keeps distinct endpoints distinct', () => {
    expect(normalizeEndpoint('https://a.example.test/v1')).not.toBe(
      normalizeEndpoint('https://b.example.test/v1'),
    );
  });
});

describe('matchProviderAccount', () => {
  const customA = provider({
    id: 'p-a',
    registryId: 'custom',
    baseUrl: 'https://a.example.test/v1',
  });
  const customB = provider({
    id: 'p-b',
    registryId: 'custom',
    baseUrl: 'https://b.example.test/v1',
  });
  const openrouter = provider({ id: 'p-or', registryId: 'openrouter' });
  const providers = [customA, customB, openrouter];

  const match = (registryId: string, baseUrl: string | undefined, endpointScoped: boolean) =>
    matchProviderAccount({ providers, registryId, baseUrl, endpointScoped })?.id;

  test('a fixed-origin provider is matched by registry id alone', () => {
    expect(match('openrouter', undefined, false)).toBe('p-or');
  });

  test('an endpoint-scoped provider is matched by registry id AND endpoint', () => {
    expect(match('custom', 'https://b.example.test', true)).toBe('p-b');
  });

  test('a new endpoint does not claim another custom account', () => {
    expect(match('custom', 'https://c.example.test', true)).toBeUndefined();
  });

  test('an empty endpoint claims nothing on an endpoint-scoped provider', () => {
    expect(match('custom', '  ', true)).toBeUndefined();
  });
});

describe('hasMovedAccount', () => {
  const custom = provider({
    id: 'p-a',
    registryId: 'custom',
    baseUrl: 'https://a.example.test/v1',
  });

  test('a retargeted endpoint has moved off the current account', () => {
    expect(
      hasMovedAccount({
        current: custom,
        registryId: 'custom',
        baseUrl: 'https://b.example.test',
        endpointScoped: true,
      }),
    ).toBe(true);
  });

  test('the same endpoint, respelled, has not moved', () => {
    expect(
      hasMovedAccount({
        current: custom,
        registryId: 'custom',
        baseUrl: 'https://a.example.test',
        endpointScoped: true,
      }),
    ).toBe(false);
  });

  test('a fixed-origin provider does not move on an endpoint edit', () => {
    const openrouter = provider({ id: 'p-or', registryId: 'openrouter' });
    expect(
      hasMovedAccount({
        current: openrouter,
        registryId: 'openrouter',
        baseUrl: 'http://localhost:11434',
        endpointScoped: false,
      }),
    ).toBe(false);
  });

  test('a changed provider type has moved', () => {
    expect(
      hasMovedAccount({
        current: custom,
        registryId: 'openrouter',
        baseUrl: undefined,
        endpointScoped: false,
      }),
    ).toBe(true);
  });

  test('no current account counts as moved', () => {
    expect(
      hasMovedAccount({
        current: undefined,
        registryId: 'openrouter',
        baseUrl: undefined,
        endpointScoped: false,
      }),
    ).toBe(true);
  });
});

describe('planProviderAccount', () => {
  const custom = provider({
    id: 'p-a',
    registryId: 'custom',
    credential: 'key-a',
    baseUrl: 'https://a.example.test/v1',
  });

  test('continues the stored account when the endpoint matches', () => {
    const plan = planProviderAccount({
      providers: [custom],
      registryId: 'custom',
      baseUrl: 'https://a.example.test/v1',
      apiKey: 'key-a',
      endpointScoped: true,
    });
    expect(plan.existing?.id).toBe('p-a');
  });

  test('plans a new account when the endpoint is new', () => {
    const plan = planProviderAccount({
      providers: [custom],
      registryId: 'custom',
      baseUrl: 'https://b.example.test/v1',
      apiKey: 'key-b',
      endpointScoped: true,
    });
    expect(plan.existing).toBeUndefined();
    expect(plan.create).toMatchObject({
      registryId: 'custom',
      credential: 'key-b',
      baseUrl: 'https://b.example.test/v1',
    });
  });

  test('a forced separate account never continues the stored one', () => {
    const plan = planProviderAccount({
      providers: [custom],
      registryId: 'custom',
      baseUrl: 'https://a.example.test/v1',
      apiKey: 'key-b',
      endpointScoped: true,
      forceSeparate: true,
    });
    expect(plan.existing).toBeUndefined();
    expect(plan.create.credential).toBe('key-b');
  });

  test('an empty key plans an account with no credential', () => {
    const plan = planProviderAccount({
      providers: [],
      registryId: 'custom',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: '   ',
      endpointScoped: true,
    });
    expect(plan.create.credential).toBeUndefined();
  });
});
