// apps/frontend/client/src/lib/views/character/npc/list/npc_list_composition.ts
//
// Production wiring for the NPC list ViewModel. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { authService, chatStorage, npcService, routerService } from '$services';
import {
  createNpcListViewModel,
  type NpcListViewModelInterface,
} from './npc_list_view_model.svelte';

/**
 * Builds the NPC list ViewModel wired to the production identity, NPC, chat
 * storage, and router singletons.
 */
export const getNpcListViewModel = (options: BaseViewModelOptions): NpcListViewModelInterface =>
  createNpcListViewModel({
    ...options,
    auth: authService,
    npcs: npcService,
    chats: chatStorage,
    router: routerService,
  });
