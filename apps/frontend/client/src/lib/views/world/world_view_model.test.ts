// apps/frontend/client/src/lib/views/world/world_view_model.test.ts
//
// Unit tests for WorldViewModel — the Codex projections (people, places,
// factions, lore, gallery), local search, and overlay delegation. Fixtures are
// injected capabilities; no `$services` barrel mock.
//
// Contract: docs/design/game_ui_hud_overhaul.md §6 (World management section)

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createGalleryCapability,
  createLoreCapability,
  createPlaceCapability,
  createRelationshipCapability,
  worldFixtures,
} from './testing/world_fixtures';
import { createWorldViewModel, type WorldViewModelOptions } from './world_view_model.svelte';

const createViewModel = (
  overrides: Partial<
    Pick<WorldViewModelOptions, 'relationships' | 'lore' | 'places' | 'gallery'>
  > = {},
) =>
  createWorldViewModel({
    className: 'WorldViewModelTest',
    relationships: overrides.relationships ?? createRelationshipCapability(),
    lore: overrides.lore ?? createLoreCapability(),
    places: overrides.places ?? createPlaceCapability(),
    gallery: overrides.gallery ?? createGalleryCapability(),
    overlays: { closeWorld: () => {} },
  } satisfies WorldViewModelOptions);

const fullViewModel = () =>
  createViewModel({
    relationships: createRelationshipCapability(worldFixtures.relationships),
    lore: createLoreCapability(worldFixtures.lore),
    places: createPlaceCapability(worldFixtures.places),
    gallery: createGalleryCapability(worldFixtures.gallery),
  });

// ── Projections ─────────────────────────────────────────────────────────

describe('WorldViewModel — people', () => {
  test('projects character relationships, highest trust first', () => {
    const viewModel = fullViewModel();

    expect(viewModel.people.map((entry) => entry.id)).toEqual(['mira', 'garrick']);
    expect(viewModel.people[0]).toMatchObject({
      kind: 'person',
      name: 'Mira',
      detail: 'Trust 12 · Affinity 8',
      provenance: 'Friend',
      score: 12,
    });
  });

  test('an empty relationship record yields no people', () => {
    expect(createViewModel().people).toHaveLength(0);
  });
});

describe('WorldViewModel — factions', () => {
  test('projects standings, highest first, with readable tiers', () => {
    const viewModel = fullViewModel();

    expect(viewModel.factions.map((entry) => entry.id)).toEqual(['town_guard', 'thieves_guild']);
    expect(viewModel.factions[0]).toMatchObject({
      kind: 'faction',
      name: 'Town Guard',
      provenance: 'Friendly',
      score: 45,
    });
  });
});

describe('WorldViewModel — places', () => {
  test('projects locations alphabetically with visited provenance', () => {
    const viewModel = fullViewModel();

    expect(viewModel.places.map((entry) => entry.name)).toEqual(['Market Square', 'Old Docks']);
    expect(viewModel.places[0]?.provenance).toContain('Last visited');
    expect(viewModel.places[1]?.provenance).toBe('Known location');
  });
});

describe('WorldViewModel — lore', () => {
  test('projects committed events newest first with information provenance', () => {
    const viewModel = fullViewModel();

    expect(viewModel.lore.map((entry) => entry.id)).toEqual(['event-2', 'event-1']);
    expect(viewModel.lore[0]?.provenance).toContain('Claim');
    expect(viewModel.lore[0]?.provenance).toContain('2 witnesses');
    expect(viewModel.lore[1]?.provenance).toContain('World fact');
    expect(viewModel.lore[1]?.provenance).toContain('1 witness');
  });
});

describe('WorldViewModel — gallery', () => {
  test('projects the shared collection newest first with media urls', () => {
    const viewModel = fullViewModel();

    expect(viewModel.gallery.map((entry) => entry.id)).toEqual(['img-2', 'img-1']);
    expect(viewModel.gallery[0]).toMatchObject({
      kind: 'gallery',
      detail: 'character',
      url: 'https://example.test/two.png',
    });
  });
});

// ── Tabs and search ─────────────────────────────────────────────────────

describe('WorldViewModel — tabs', () => {
  test('visible entries follow the active tab', () => {
    const viewModel = fullViewModel();

    expect(viewModel.visibleEntries.length).toBe(viewModel.people.length);
    viewModel.setActiveTab('gallery');
    expect(viewModel.visibleEntries[0]?.kind).toBe('gallery');
  });

  test('activeTabEmpty reflects an unpopulated tab', () => {
    expect(createViewModel().activeTabEmpty).toBe(true);
    expect(fullViewModel().activeTabEmpty).toBe(false);
  });
});

describe('WorldViewModel — search', () => {
  test('filters the active tab case-insensitively', () => {
    const viewModel = fullViewModel();
    viewModel.setActiveTab('people');

    viewModel.setSearchQuery('RIVAL');

    expect(viewModel.hasSearchQuery).toBe(true);
    expect(viewModel.visibleEntries.map((entry) => entry.id)).toEqual(['garrick']);
  });

  test('a blank query restores every entry', () => {
    const viewModel = fullViewModel();

    viewModel.setSearchQuery('   ');

    expect(viewModel.hasSearchQuery).toBe(false);
    expect(viewModel.visibleEntries).toHaveLength(viewModel.people.length);
  });

  test('an unmatched query yields no visible entries', () => {
    const viewModel = fullViewModel();

    viewModel.setSearchQuery('does-not-exist');

    expect(viewModel.visibleEntries).toHaveLength(0);
    expect(viewModel.activeTabEmpty).toBe(false);
  });
});

// ── Overlay + base class ────────────────────────────────────────────────

describe('WorldViewModel — overlay navigation', () => {
  test('close delegates to the overlay capability', () => {
    const closeWorld = mock(() => {});
    const viewModel = createWorldViewModel({
      className: 'WorldViewModelTest',
      relationships: createRelationshipCapability(),
      lore: createLoreCapability(),
      places: createPlaceCapability(),
      gallery: createGalleryCapability(),
      overlays: { closeWorld },
    } satisfies WorldViewModelOptions);

    viewModel.close();

    expect(closeWorld).toHaveBeenCalledTimes(1);
  });
});

describe('WorldViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
