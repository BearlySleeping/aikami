// apps/frontend/client/src/lib/views/presets/prompt_preview_view_model.svelte.ts
//
// ViewModel for the prompt preview modal (C-237).
// Assembles all preset sections, resolves macros, and displays
// the fully resolved prompt with character count.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or the parser at runtime, so its tests can
// inject fresh feature fixtures (see ./testing/prompt_preview_fixtures.ts).
// Production wiring lives in ./prompt_preview_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { MacroContext } from '@aikami/parser';

// ── Capability contracts ────────────────────────────────────────────────

/** The preset assembly and macro resolution operations the preview performs. */
export type PromptPreviewMacroCapabilities = {
  loadPresets(): void;
  assemblePreset(presetId: string): string | undefined;
  resolveMacros(options: { template: string; context: MacroContext }): string;
};

// ── Types ───────────────────────────────────────────────────────────────

export type PromptPreviewViewModelOptions = BaseViewModelOptions & {
  /** Preset/macro capability. */
  macro: PromptPreviewMacroCapabilities;
};

export type PromptPreviewViewModelInterface = BaseViewModelInterface & {
  /** The fully resolved prompt text. */
  readonly resolvedPrompt: string;
  /** Character count of the resolved prompt. */
  readonly characterCount: number;
  /** Whether the modal is open. */
  readonly isOpen: boolean;
  /** Current preset ID being previewed. */
  readonly presetId: string | null;

  /** Opens the preview modal for a given preset. */
  openPreview: (options: { presetId: string; context: MacroContext }) => void;
  /** Closes the preview modal. */
  closePreview: () => void;
  /** Refreshes the preview with updated context. */
  refreshPreview: () => void;
};

// ── Implementation ──────────────────────────────────────────────────────

class PromptPreviewViewModel
  extends BaseViewModel<PromptPreviewViewModelOptions>
  implements PromptPreviewViewModelInterface
{
  private readonly _macro: PromptPreviewMacroCapabilities;

  isOpen = $state(false);
  presetId = $state<string | null>(null);
  resolvedPrompt = $state('');
  characterCount = $state(0);

  /** Context data for macro resolution. */
  private _context: MacroContext = {};

  constructor(options: PromptPreviewViewModelOptions) {
    super(options);
    this._macro = options.macro;
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this._macro.loadPresets();
  }

  openPreview(options: { presetId: string; context: MacroContext }): void {
    const { presetId, context } = options;
    this.presetId = presetId;
    this._context = { ...context };
    this._resolve();
    this.isOpen = true;
  }

  closePreview(): void {
    this.isOpen = false;
    this.presetId = null;
    this.resolvedPrompt = '';
    this.characterCount = 0;
    this._context = {};
  }

  refreshPreview(): void {
    this._resolve();
  }

  /** Assembles and resolves the preset. */
  private _resolve(): void {
    const template = this._macro.assemblePreset(this.presetId ?? '');
    if (template === undefined) {
      this.resolvedPrompt = '';
      this.characterCount = 0;
      return;
    }

    const resolved = this._macro.resolveMacros({ template, context: this._context });
    this.resolvedPrompt = resolved;
    this.characterCount = resolved.length;
  }
}

/**
 * Builds a prompt-preview ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getPromptPreviewViewModel` in
 * ./prompt_preview_composition.ts.
 */
export const createPromptPreviewViewModel = (
  options: PromptPreviewViewModelOptions,
): PromptPreviewViewModelInterface => PromptPreviewViewModel.create(options);
