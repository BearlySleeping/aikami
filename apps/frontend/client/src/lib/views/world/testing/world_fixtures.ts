// apps/frontend/client/src/lib/views/world/testing/world_fixtures.ts
/** biome-ignore-all lint/style/useNamingConvention: snake_case keys mirror persisted domain ids */
//
// Typed capability fixtures for the World ViewModel tests. Feature-local, so
// tests never reach for the production `$services` singletons.

import type {
  WorldGalleryCapabilities,
  WorldGalleryImage,
  WorldLoreCapabilities,
  WorldLoreEvent,
  WorldPlace,
  WorldPlaceCapabilities,
  WorldRelationshipCapabilities,
  WorldRelationshipSnapshot,
} from '../world_view_model.svelte';

export const createRelationshipCapability = (
  snapshot: Partial<WorldRelationshipSnapshot> = {},
): WorldRelationshipCapabilities => ({
  serialize: () => ({
    factionStandings: {},
    characterRelationships: {},
    ...snapshot,
  }),
});

export const createLoreCapability = (
  events: readonly WorldLoreEvent[] = [],
): WorldLoreCapabilities => ({ events });

export const createPlaceCapability = (
  locations: readonly WorldPlace[] = [],
): WorldPlaceCapabilities => ({ locations });

export const createGalleryCapability = (
  images: readonly WorldGalleryImage[] = [],
): WorldGalleryCapabilities => ({ images });

export const worldFixtures = {
  relationships: {
    factionStandings: {
      thieves_guild: { standing: -30, tier: 'unfriendly' },
      town_guard: { standing: 45, tier: 'friendly' },
    },
    characterRelationships: {
      mira: { trust: 12, affinity: 8, relationshipType: 'friend' },
      garrick: { trust: -5, affinity: 2, relationshipType: 'rival' },
    },
  },
  lore: [
    {
      id: 'event-1',
      summary: 'The river gate was sealed before dawn',
      informationKind: 'world_fact',
      kind: 'WorldFlagChanged',
      recordedAt: '2026-01-02T10:00:00.000Z',
      witnesses: ['mira'],
    },
    {
      id: 'event-2',
      summary: 'Mira admitted she recognised the crest',
      informationKind: 'dialogue_claim',
      kind: 'EvidencePresented',
      recordedAt: '2026-01-03T10:00:00.000Z',
      witnesses: ['mira', 'garrick'],
    },
  ],
  places: [
    {
      id: 'loc-market',
      name: 'Market Square',
      description: 'Stalls crowd the fountain.',
      lastVisited: '2026-01-01T09:00:00.000Z',
    },
    { id: 'loc-docks', name: 'Old Docks', description: 'Fog rolls off the water.' },
  ],
  gallery: [
    {
      id: 'img-1',
      url: 'https://example.test/one.png',
      prompt: 'A rain-slick market at dusk',
      imageType: 'scene',
      generatedAt: '2026-01-01T12:00:00.000Z',
      chatId: 'mira',
    },
    {
      id: 'img-2',
      url: 'https://example.test/two.png',
      prompt: 'Mira at the river gate',
      imageType: 'character',
      generatedAt: '2026-01-02T12:00:00.000Z',
      chatId: 'mira',
    },
  ],
} satisfies {
  relationships: WorldRelationshipSnapshot;
  lore: readonly WorldLoreEvent[];
  places: readonly WorldPlace[];
  gallery: readonly WorldGalleryImage[];
};
