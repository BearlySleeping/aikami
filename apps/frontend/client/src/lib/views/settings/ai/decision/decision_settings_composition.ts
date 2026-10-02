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
    config: {
      getProviders: () => configService.getProviders(),
      getAiConnections: () => configService.getAiConnections(),
      addProvider: (fields) => configService.addProvider(fields),
      updateProvider: (id, patch) => configService.updateProvider(id, patch),
      deleteAiConnection: (id) => configService.deleteAiConnection(id),
      addAiConnection: (connection) => configService.addAiConnection(connection),
      setRoleAssignment: (role, connectionId) =>
        configService.setRoleAssignment(role, connectionId),
      clearRoleAssignment: (role) => configService.clearRoleAssignment(role),
      save: () => configService.save(),
    },
  });
