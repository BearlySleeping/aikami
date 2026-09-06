// apps/frontend/client/src/lib/services/config/provider_endpoints.test.ts
//
// Transport-policy coverage for credentialed model discovery.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ModelFetchConfig } from './provider_endpoints.ts';
import { fetchModelsFromProvider } from './provider_endpoints.ts';

const originalFetch = globalThis.fetch;

const configFor = (url: string): ModelFetchConfig => ({
  url,
  auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
  parseResponse: (json) => (json as { data: Array<{ id: string; name: string }> }).data,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchModelsFromProvider transport policy', () => {
  test('does not send credentials over HTTP', async () => {
    const fetchMock = mock(async () => Response.json({ data: [] }));
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('http://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('permits keyless model discovery over HTTP', async () => {
    const fetchMock = mock(async () =>
      Response.json({ data: [{ id: 'local-model', name: 'Local model' }] }),
    );
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('http://localhost:11434/v1/models'),
    });

    expect(models).toEqual([{ id: 'local-model', name: 'Local model' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not forward credentials to an unapproved redirect origin', async () => {
    const fetchMock = mock(
      async () =>
        new Response(undefined, {
          status: 302,
          headers: { location: 'https://other.example.test/v1/models' },
        }),
    );
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('allows credential forwarding across approved HTTPS hops', async () => {
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/models')) {
        return new Response(undefined, {
          status: 302,
          headers: { location: '/v2/models' },
        });
      }
      return Response.json({ data: [{ id: 'secure-model', name: 'Secure model' }] });
    });
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://models.example.test/v1/models'),
      apiKey: 'secret-key',
    });

    expect(models).toEqual([{ id: 'secure-model', name: 'Secure model' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects URL user-info credentials before sending a request', async () => {
    const fetchMock = mock(async () => Response.json({ data: [] }));
    globalThis.fetch = fetchMock;

    const models = await fetchModelsFromProvider({
      config: configFor('https://user:password@models.example.test/v1/models'),
    });

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
