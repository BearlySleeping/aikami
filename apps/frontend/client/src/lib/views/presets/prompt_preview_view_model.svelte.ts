// apps/frontend/client/src/lib/views/presets/prompt_preview_view_model.svelte.ts
//
// ViewModel for the prompt preview modal (C-237).
// Assembles all preset sections, resolves macros, and displays
// the fully resolved prompt with character count.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { MacroContext } from '@aikami/parser';
import { macroPresetStore } from '$services';

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

export type PromptPreviewViewModelOptions = BaseViewModelOptions & {};

class PromptPreviewViewModel
  extends BaseViewModel<PromptPreviewViewModelOptions>
  implements PromptPreviewViewModelInterface
{
  isOpen = $state(false);
  presetId = $state<string | null>(null);
  resolvedPrompt = $state('');
  characterCount = $state(0);

  /** Context data for macro resolution. */
  private _context: MacroContext = {};

  override async initialize(): Promise<void> {
    await super.initialize();
    macroPresetStore.loadPresets();
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
    import('@aikami/parser').then(({ resolveMacros }) => {
      const template = macroPresetStore.assemblePreset(this.presetId ?? '');
      if (template === undefined) {
        this.resolvedPrompt = '';
        this.characterCount = 0;
        return;
      }

      const resolved = resolveMacros({ template, context: this._context });
      this.resolvedPrompt = resolved;
      this.characterCount = resolved.length;
    });
  }
}

export const getPromptPreviewViewModel = (
  options: PromptPreviewViewModelOptions,
): PromptPreviewViewModelInterface => PromptPreviewViewModel.create(options);
