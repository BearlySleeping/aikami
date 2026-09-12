// apps/frontend/hub/src/lib/client/services/__tests__/map_studio_client.test.ts
//
// C-508 — the map-studio client's URL construction and error mapping.

import { afterEach, describe, expect, test } from 'bun:test';
import { createMapStudioClient } from '../map_studio_client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockFetch = (handler: (url: string, init?: RequestInit) => Response): string[] => {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return calls;
};

describe('createMapStudioClient', () => {
  test('lists drafts against /api/maps/drafts with credentials', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    await createMapStudioClient('/api').listDrafts();
    expect(calls).toEqual(['/api/maps/drafts']);
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
    expect(calls).toEqual(['/api/maps/community']);
    expect(result.slug).toBe('x');
  });

  test('throws the server error code on a non-ok response', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'invalid-document' }), { status: 422 }));
    await expect(
      createMapStudioClient('/api').publish({ title: 'X', document: '{}' }),
    ).rejects.toThrow(/invalid-document/);
  });
});
