// apps/frontend/hub/src/lib/client/services/__tests__/map_studio_client.test.ts
//
// C-508 — the map-studio client's URL construction and error mapping.

import { afterEach, describe, expect, test } from 'bun:test';
import { createMapStudioClient } from '../map_studio_client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return calls;
};

describe('createMapStudioClient', () => {
  test('lists drafts against /api/maps/drafts with credentials', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    await createMapStudioClient('/api').listDrafts();
    expect(calls.map((call) => call.url)).toEqual(['/api/maps/drafts']);
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  test('publishes a document to /api/maps/community', async () => {
    const calls = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            slug: 'x',
            revision: 1,
            documentHash: 'h',
            url: '/api/maps/community/x',
          }),
          { status: 201 },
        ),
    );
    const result = await createMapStudioClient('/api').publish({
      title: 'X',
      document: '{}',
    });
    expect(calls.map((call) => call.url)).toEqual(['/api/maps/community']);
    expect(result.slug).toBe('x');
  });

  test('forwards community-map pagination options', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await createMapStudioClient('/api').listCommunityMaps({ cursor: '123.map-id', limit: 25 });
    expect(calls.map((call) => call.url)).toEqual([
      '/api/maps/community?cursor=123.map-id&limit=25',
    ]);
  });

  test('throws the server error code on a non-ok response', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'invalid-document' }), { status: 422 }));
    await expect(
      createMapStudioClient('/api').publish({ title: 'X', document: '{}' }),
    ).rejects.toThrow(/invalid-document/);
  });
});
