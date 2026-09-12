// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_composition.ts
//
// Production-style wiring for the Obsidian Chronicle sandbox ViewModel. The
// probe has no service dependencies today, so this is intentionally a thin
// forwarder — it exists so the route never instantiates the class directly and
// so services can be injected here without touching the ViewModel module.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { ObsidianSandboxViewModelInterface } from './obsidian_sandbox_contract';
import type { ObsidianPresentationMode } from './obsidian_types';
import { createObsidianSandboxViewModel } from './obsidian_view_model.svelte';

/** Options accepted by the sandbox route. */
export type ObsidianSandboxRouteOptions = BaseViewModelOptions & {
  initialMode?: ObsidianPresentationMode;
};

/**
 * Builds the sandbox ViewModel for the dev route.
 *
 * @param options - Base ViewModel options plus an optional initial surface.
 * @returns A ready-to-render sandbox ViewModel.
 */
export const getObsidianSandboxViewModel = (
  options: ObsidianSandboxRouteOptions,
): ObsidianSandboxViewModelInterface => createObsidianSandboxViewModel({ ...options });
