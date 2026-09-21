// apps/frontend/client/src/lib/views/character/persona/create/persona_create_composition.ts
//
// Production wiring for the persona-create feature. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import {
  authService,
  equipmentService,
  imageGenerationService,
  inventoryService,
  personaCreationService,
  personaService,
  playerStateService,
  routerService,
  storageService,
  textGenerationService,
  worldStateService,
} from '$services';
import {
  createPersonaCreateViewModel,
  type PersonaCreateViewModelInterface,
  type PersonaCreateViewModelOptions,
} from './persona_create_view_model.svelte';

type PersonaCreateCompositionOptions = Omit<
  PersonaCreateViewModelOptions,
  | 'personaCreation'
  | 'imageGeneration'
  | 'textGeneration'
  | 'auth'
  | 'storage'
  | 'inventory'
  | 'equipment'
  | 'worldState'
  | 'playerState'
  | 'personas'
  | 'router'
>;

/**
 * Builds the persona-create ViewModel wired to the production persona, AI,
 * storage, and world-transition singletons.
 */
export const getPersonaCreateViewModel = (
  options: PersonaCreateCompositionOptions,
): PersonaCreateViewModelInterface =>
  createPersonaCreateViewModel({
    ...options,
    personaCreation: personaCreationService,
    imageGeneration: imageGenerationService,
    textGeneration: textGenerationService,
    auth: authService,
    storage: storageService,
    inventory: inventoryService,
    equipment: equipmentService,
    worldState: worldStateService,
    playerState: playerStateService,
    personas: personaService,
    router: routerService,
  });
