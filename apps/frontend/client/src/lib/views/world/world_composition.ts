// apps/frontend/client/src/lib/views/world/world_composition.ts
//
// Production wiring for the World ViewModel. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities. Reads use accessors so the ViewModel tracks the
// services' `$state` rather than a snapshot.

import {
  galleryService,
  gameOverlayService,
  narrativeEventService,
  relationshipService,
  worldStateService,
} from '$services';
import {
  createWorldViewModel,
  type WorldViewModelInterface,
  type WorldViewModelOptions,
} from './world_view_model.svelte';

/**
 * Builds the World ViewModel wired to the production services: relationships
 * (people + factions), committed narrative events (lore), world state (places),
 * and the shared gallery collection.
 */
export const getWorldViewModel = (
  options: Omit<
    WorldViewModelOptions,
    'relationships' | 'lore' | 'places' | 'gallery' | 'overlays'
  >,
): WorldViewModelInterface =>
  createWorldViewModel({
    ...options,
    relationships: relationshipService,
    lore: {
      get events() {
        return narrativeEventService.events;
      },
    },
    places: {
      get locations() {
        return worldStateService.currentWorld?.locations ?? [];
      },
    },
    gallery: {
      get images() {
        return galleryService.getAllImages();
      },
    },
    overlays: {
      closeWorld: () => gameOverlayService.closeWorld(),
    },
  });
