// apps/frontend/client/src/lib/views/presets/testing/prompt_preview_fixtures.ts
//
// Feature-owned test doubles for the prompt-preview ViewModel. Operations are
// not defaulted to success: an unconfigured call throws, so a test cannot pass
// by accident on a silent no-op.

import type { PromptPreviewMacroCapabilities } from '../prompt_preview_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Macro capability whose operations throw until overridden. */
export const createPromptPreviewMacro = (
  overrides: Partial<PromptPreviewMacroCapabilities> = {},
): PromptPreviewMacroCapabilities => ({
  loadPresets: () => unconfigured('loadPresets'),
  assemblePreset: () => unconfigured('assemblePreset'),
  resolveMacros: () => unconfigured('resolveMacros'),
  ...overrides,
});
