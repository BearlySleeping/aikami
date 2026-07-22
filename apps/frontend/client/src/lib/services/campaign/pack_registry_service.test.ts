// apps/frontend/client/src/lib/services/campaign/pack_registry_service.test.ts
//
// Tests for PackRegistryService — content pack index discovery, validation,
// and error handling for the pack browser (C-345).
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { PackRegistryServiceInterface } from './pack_registry_service.svelte';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

let _mockResponse: FetchResponse | undefined;
let _mockError: Error | undefined;

const originalFetch = globalThis.fetch;

mock.module('globalThis', () => ({
  // No-op — we mock fetch directly in beforeEach
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PackRegistryService', () => {
  let packRegistryService: PackRegistryServiceInterface;

  beforeAll(async () => {
    const { packRegistryService: service } = await import('./pack_registry_service.svelte.ts');
    packRegistryService = service;
  });

  beforeEach(() => {
    _mockResponse = undefined;
    _mockError = undefined;

    // Reset service state
    packRegistryService.availablePacks = [];
    packRegistryService.isLoading = false;
    packRegistryService.lastError = undefined;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  /** Helper to queue the next fetch() response. */
  function mockFetch(response: FetchResponse | Error): void {
    if (response instanceof Error) {
      _mockError = response;
      globalThis.fetch = mock(async () => {
        throw _mockError;
      }) as typeof globalThis.fetch;
    } else {
      _mockResponse = response;
      globalThis.fetch = mock(async () => _mockResponse) as typeof globalThis.fetch;
    }
  }

  // -----------------------------------------------------------------------
  // refresh()
  // -----------------------------------------------------------------------

  describe('refresh()', () => {
    test('fetches and exposes available packs from index.json', async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          packs: [
            {
              id: 'emberwatch',
              name: 'Emberwatch',
              version: '2.1.0',
              updatedAt: '2026-07-13T00:00:00.000Z',
              description: 'The wardstone is failing.',
            },
            {
              id: 'whispering-caves',
              name: 'Whispering Caves',
              version: '1.0.0',
              updatedAt: '2026-07-20T00:00:00.000Z',
              description: 'Caves with crystals.',
            },
          ],
        }),
      });

      await packRegistryService.refresh();

      expect(packRegistryService.availablePacks.length).toBe(2);
      expect(packRegistryService.availablePacks[0].id).toBe('emberwatch');
      expect(packRegistryService.availablePacks[1].id).toBe('whispering-caves');
      expect(packRegistryService.isLoading).toBe(false);
      expect(packRegistryService.lastError).toBeUndefined();
    });

    test('sets availablePacks to empty array when fetch fails with HTTP error', async () => {
      mockFetch({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      await packRegistryService.refresh();

      expect(packRegistryService.availablePacks).toEqual([]);
      expect(packRegistryService.lastError).toContain('HTTP 404');
      expect(packRegistryService.isLoading).toBe(false);
    });

    test('sets error when fetch throws a network error', async () => {
      mockFetch(new Error('Network failure'));

      await packRegistryService.refresh();

      expect(packRegistryService.availablePacks).toEqual([]);
      expect(packRegistryService.lastError).toContain('Network failure');
      expect(packRegistryService.isLoading).toBe(false);
    });

    test('sets error when index JSON fails TypeBox validation', async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 99, // wrong — must be literal 1
          packs: [],
        }),
      });

      await packRegistryService.refresh();

      expect(packRegistryService.availablePacks).toEqual([]);
      expect(packRegistryService.lastError).toBeTruthy();
      expect(packRegistryService.isLoading).toBe(false);
    });

    test('is idempotent — does not re-fetch while already loading', async () => {
      let fetchCount = 0;
      let resolveFetch: () => void;
      const fetchPromise = new Promise<FetchResponse>((resolve) => {
        resolveFetch = () => {
          resolve({
            ok: true,
            status: 200,
            json: async () => ({
              schemaVersion: 1,
              packs: [
                {
                  id: 'emberwatch',
                  name: 'Test',
                  version: '1.0.0',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            }),
          });
        };
      });

      globalThis.fetch = mock(async () => {
        fetchCount++;
        return fetchPromise;
      }) as typeof globalThis.fetch;

      // Start multiple concurrent refresh calls
      const promise1 = packRegistryService.refresh();
      const promise2 = packRegistryService.refresh();
      const promise3 = packRegistryService.refresh();

      // Resolve the fetch
      resolveFetch?.();

      // Wait for all promises to complete
      await Promise.all([promise1, promise2, promise3]);

      // Should have fetched only once
      expect(fetchCount).toBe(1);
      expect(packRegistryService.availablePacks.length).toBe(1);
      expect(packRegistryService.availablePacks[0].id).toBe('emberwatch');
    });
  });

  // -----------------------------------------------------------------------
  // getPack()
  // -----------------------------------------------------------------------

  describe('getPack()', () => {
    test('returns a pack entry by ID', () => {
      packRegistryService.availablePacks = [
        {
          id: 'emberwatch',
          name: 'Emberwatch: The Fading Ward',
          version: '2.1.0',
          updatedAt: '2026-07-13T00:00:00.000Z',
          description: 'The wardstone that protects Emberwatch Village is failing.',
        },
      ];

      const found = packRegistryService.getPack('emberwatch');
      expect(found).toBeDefined();
      expect(found?.id).toBe('emberwatch');
      expect(found?.name).toBe('Emberwatch: The Fading Ward');
    });

    test('returns undefined for unknown pack ID', () => {
      packRegistryService.availablePacks = [
        {
          id: 'emberwatch',
          name: 'Emberwatch',
          version: '2.1.0',
          updatedAt: '2026-07-13T00:00:00.000Z',
        },
      ];

      const found = packRegistryService.getPack('nonexistent');
      expect(found).toBeUndefined();
    });
  });
});
