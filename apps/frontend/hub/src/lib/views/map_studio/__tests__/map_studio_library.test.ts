// apps/frontend/hub/src/lib/views/map_studio/__tests__/map_studio_library.test.ts

import { describe, expect, mock, test } from 'bun:test';
import type { MapStudioClientInterface } from '$lib/client/services/map_studio_client.ts';
import { MapStudioLibrary } from '../map_studio_library.svelte.ts';

const createClient = (): MapStudioClientInterface => ({
  listDrafts: mock(async () => []),
  createDraft: mock(async () => ({
    id: 'created',
    name: 'Created',
    document: '{}',
    createdAt: '',
    updatedAt: '',
  })),
  getDraft: mock(async (id) => ({
    id,
    name: 'Loaded draft',
    document: '{"loaded":true}',
    createdAt: '',
    updatedAt: '',
  })),
  updateDraft: mock(async (id) => ({
    id,
    name: 'Updated',
    document: '{}',
    createdAt: '',
    updatedAt: '',
  })),
  deleteDraft: mock(async () => undefined),
  publish: mock(async () => ({ slug: 'map', revision: 1, documentHash: 'hash', url: '/map' })),
  listCommunityMaps: mock(async () => ({ items: [] })),
  getCommunityMap: mock(async () => ({
    slug: 'map',
    title: 'Map',
    revision: 1,
    documentHash: 'hash',
    sizeBytes: 2,
    createdAt: '',
    updatedAt: '',
    document: '{}',
  })),
});

describe('MapStudioLibrary draft identity', () => {
  test('assigns the draft id after document replacement clears old identity', async () => {
    let library: MapStudioLibrary;
    library = new MapStudioLibrary({
      getDocument: () => '{}',
      getMapId: () => undefined,
      loadDocument: () => library.clearSelectedDraft(),
      getTerrains: () => [],
      onError: () => undefined,
      setEditorError: () => undefined,
      client: createClient(),
    });

    await library.loadDraft('draft-1');

    expect(library.selectedDraftId).toBe('draft-1');
    expect(library.draftName).toBe('Loaded draft');
  });

  test('clears draft identity for an external document replacement', () => {
    const library = new MapStudioLibrary({
      getDocument: () => '{}',
      getMapId: () => undefined,
      loadDocument: () => undefined,
      getTerrains: () => [],
      onError: () => undefined,
      setEditorError: () => undefined,
      client: createClient(),
    });
    library.selectedDraftId = 'draft-1';
    library.clearSelectedDraft();
    expect(library.selectedDraftId).toBeUndefined();
  });
});
