// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.dev.svelte.ts
//
// Dev sandbox ViewModel for the setup subflow — extends the production
// ViewModel with mock data for isolated testing.
// Contract: C-483

import {
  getSetupSubflowViewModel,
  type SetupSubflowViewModelInterface,
  type SetupSubflowViewModelOptions,
} from './setup_subflow_view_model.svelte';

/**
 * Creates a dev ViewModel for the setup subflow. In the sandbox, we use
 * the production ViewModel directly since its mock-friendly constructor
 * accepts injected services via the global mock system.
 */
export const getDevSetupSubflowViewModel = (
  options: SetupSubflowViewModelOptions,
): SetupSubflowViewModelInterface => getSetupSubflowViewModel(options);
