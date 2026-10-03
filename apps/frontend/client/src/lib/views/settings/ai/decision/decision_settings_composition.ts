// apps/frontend/client/src/lib/views/settings/ai/decision/decision_settings_composition.ts
//
// Production wiring for Settings → Decisions / System One (issue #381).
//
// This is the only module in the section that imports the service graph. The
// ViewModel receives configuration and the decision backend service as typed
// capabilities, so a unit test of the section never touches the vault, the
// config store or a socket.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService, decisionBackendService } from '$services';
// Imported directly rather than through the `$services` barrel: the barrel does
// not export the gameplay services, and adding one would widen the public
// surface far past what this section needs.
import { npcActionDecisionService } from '../../../../services/game/npc_action_decision_service.svelte.ts';
import {
  createDecisionSettingsViewModel,
  type DecisionSettingsViewModelInterface,
} from './decision_settings_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type DecisionSettingsCompositionOptions = BaseViewModelOptions;

/**
 * Builds the section ViewModel against the real configuration and backend.
 *
 * The service instance is passed in rather than imported here so a settings
 * session shares one readiness store with everything else that may test a
 * backend, and so a test can pass its own.
 */
export const getDecisionSettingsViewModel = (
  options: DecisionSettingsCompositionOptions,
  decisions = decisionBackendService,
): DecisionSettingsViewModelInterface =>
  createDecisionSettingsViewModel({
    ...options,
    decisions,
    // The gameplay service owns the mode and persists it itself; the section is
    // a control surface, not a second writer.
    gameplayMode: { setMode: async (mode) => npcActionDecisionService.setMode(mode) },
    config: {
      getProviders: () => configService.getProviders(),
      getAiConnections: () => configService.getAiConnections(),
      addProvider: (fields) => configService.addProvider(fields),
      updateProvider: (id, patch) => configService.updateProvider(id, patch),
      deleteAiConnection: (id) => configService.deleteAiConnection(id),
      addAiConnection: (connection) => configService.addAiConnection(connection),
      updateAiConnection: (id, patch) => configService.updateAiConnection(id, patch),
      setRoleAssignment: (role, connectionId) =>
        configService.setRoleAssignment(role, connectionId),
      clearRoleAssignment: (role) => configService.clearRoleAssignment(role),
      save: () => configService.save(),
    },
  });
