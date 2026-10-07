// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_composition.ts
//
// Production wiring for the world-generation wizard. This is one of the only
// modules in the feature that imports the `$services` barrel; the ViewModel and
// the draft service both receive their dependencies as typed capabilities, so
// unit tests never touch the global service registry.
//
// Note what is NOT wired here, and why it is not even a type: there is no
// `campaign`, no `worldState` and no `worldGenSeeding`. An earlier revision of
// this file passed `worldStateService.setWorldGenOutput` in as a "preview"
// capability and accepted drafts published their narrative text into the LIVE
// world-state context that `assembleGmPrompt` reads — so accepting a private
// draft silently rewrote the running game's GM prompt. G01 accepts into the
// draft ROW and nothing else.

import { createWorldGenDraftRepository, getLocalDatabase } from '@aikami/frontend/storage';
import { routerService, textGenerationService } from '$services';
import {
  createWorldGenDraftService,
  type WorldGenDraftServiceInterface,
} from '../../services/worldgen/world_gen_draft_service.svelte.ts';
import {
  createWorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
  type WorldGenWizardViewModelOptions,
} from './world_gen_wizard_view_model.svelte.ts';

/** Wizard options with the wired capabilities removed. */
export type WorldGenWizardPublicOptions = Omit<WorldGenWizardViewModelOptions, 'router' | 'drafts'>;

/**
 * Builds the real draft service: the production text provider and device-local
 * persistence over the shared local database. There is no third capability.
 */
export const getWorldGenDraftService = (): WorldGenDraftServiceInterface =>
  createWorldGenDraftService({
    className: 'WorldGenDraftService',
    text: textGenerationService,
    // Drafts are device-local and must be writable with no sign-in and no
    // active campaign. If the local database is unavailable the service
    // degrades to an in-memory draft and says so via `persistence`.
    resolveStore: async () => createWorldGenDraftRepository(await getLocalDatabase()),
  });

/** Builds the world-generation wizard wired to production singletons. */
export const getWorldGenWizardViewModel = (
  options: WorldGenWizardPublicOptions,
): WorldGenWizardViewModelInterface =>
  createWorldGenWizardViewModel({
    ...options,
    router: routerService,
    drafts: getWorldGenDraftService(),
  });
