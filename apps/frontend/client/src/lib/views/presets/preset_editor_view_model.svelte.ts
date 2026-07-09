// apps/frontend/client/src/lib/views/presets/preset_editor_view_model.svelte.ts
//
// ViewModel for the prompt preset editor (C-237).
// Manages section list, drag-to-reorder state, section content editing,
// and save/delete/duplicate actions.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  macroPresetStore,
  type PromptPreset,
  type PromptSection,
} from '$lib/services/config/macro_preset_store.svelte';

export type PresetEditorViewModelInterface = BaseViewModelInterface & {
  /** All available presets (built-in + user-defined). */
  readonly presets: PromptPreset[];
  /** The currently selected preset ID, or null. */
  readonly selectedPresetId: string | null;
  /** Sections of the selected preset. */
  readonly sections: PromptSection[];
  /** New section name being typed. */
  readonly newSectionName: string;
  /** Whether the editor is in "create new" mode (no preset selected yet). */
  readonly isNewPreset: boolean;
  /** Name for a new preset. */
  readonly newPresetName: string;

  /** Selects a preset for editing. */
  selectPreset: (options: { id: string }) => void;
  /** Creates a new empty preset. */
  createNewPreset: () => void;
  /** Adds a new section to the current preset. */
  addSection: () => void;
  /** Removes a section by ID. */
  removeSection: (options: { id: string }) => void;
  /** Updates a section's content. */
  updateSectionContent: (options: { id: string; content: string }) => void;
  /** Updates a section's name. */
  updateSectionName: (options: { id: string; name: string }) => void;
  /** Toggles a section's enabled state. */
  toggleSection: (options: { id: string }) => void;
  /** Moves a section up in order. */
  moveSectionUp: (options: { id: string }) => void;
  /** Moves a section down in order. */
  moveSectionDown: (options: { id: string }) => void;
  /** Saves the current preset. */
  savePreset: () => string | undefined;
  /** Deletes the selected preset. */
  deletePreset: () => void;
  /** Duplicates the selected preset. */
  duplicatePreset: () => string | undefined;
  /** Discards changes and reloads. */
  discardChanges: () => void;
};

export type PresetEditorViewModelOptions = BaseViewModelOptions & {};

class PresetEditorViewModel
  extends BaseViewModel<PresetEditorViewModelOptions>
  implements PresetEditorViewModelInterface
{
  presets = $state<PromptPreset[]>(macroPresetStore.presets);
  selectedPresetId = $state<string | null>(null);
  newSectionName = $state('');
  newPresetName = $state('');

  /** Sections of the selected preset, or empty array. */
  get sections(): PromptSection[] {
    if (this.isNewPreset) {
      return [...this._tempSections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    const preset = this._selectedPreset;
    if (!preset) {
      return [];
    }
    return [...preset.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get isNewPreset(): boolean {
    return this.selectedPresetId === 'new';
  }

  /** Returns the selected preset object, or null. */
  private get _selectedPreset(): PromptPreset | undefined {
    if (!this.selectedPresetId || this.selectedPresetId === 'new') {
      return undefined;
    }
    return this.presets.find((p) => p.id === this.selectedPresetId);
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    macroPresetStore.loadPresets();
    this.presets = macroPresetStore.presets;
  }

  selectPreset(options: { id: string }): void {
    const { id } = options;
    this.selectedPresetId = id;
    this.newPresetName = '';
    this.newSectionName = '';
  }

  createNewPreset(): void {
    this.selectedPresetId = 'new';
    this.newPresetName = '';
    this.newSectionName = '';
  }

  addSection(): void {
    const name = this.newSectionName.trim() || `Section ${this.sections.length + 1}`;
    const newSection: PromptSection = {
      id: crypto.randomUUID(),
      name,
      content: '',
      enabled: true,
      order: this.sections.length,
    };

    if (this.isNewPreset) {
      // In new-preset mode, sections are held in a temporary state array
      // managed by the ViewModel. We use a derived approach: store raw sections.
      this._tempSections = [...this._tempSections, newSection];
    } else {
      const preset = this._selectedPreset;
      if (!preset) {
        return;
      }
      const updated: PromptPreset = {
        ...preset,
        sections: [...preset.sections, newSection],
        updatedAt: new Date().toISOString(),
      };
      this._updatePreset(updated);
    }

    this.newSectionName = '';
  }

  removeSection(options: { id: string }): void {
    const { id } = options;
    const preset = this._selectedPreset;
    if (!preset) {
      return;
    }
    const updated: PromptPreset = {
      ...preset,
      sections: preset.sections.filter((s) => s.id !== id),
      updatedAt: new Date().toISOString(),
    };
    this._updatePreset(updated);
  }

  updateSectionContent(options: { id: string; content: string }): void {
    const { id, content } = options;
    this._patchSection(id, { content });
  }

  updateSectionName(options: { id: string; name: string }): void {
    const { id, name } = options;
    this._patchSection(id, { name });
  }

  toggleSection(options: { id: string }): void {
    const { id } = options;
    const preset = this._selectedPreset;
    if (!preset) {
      return;
    }
    const section = preset.sections.find((s) => s.id === id);
    if (!section) {
      return;
    }
    this._patchSection(id, { enabled: !section.enabled });
  }

  moveSectionUp(options: { id: string }): void {
    this._moveSection(options.id, -1);
  }

  moveSectionDown(options: { id: string }): void {
    this._moveSection(options.id, 1);
  }

  savePreset(): string | undefined {
    const name = this.newPresetName.trim();
    if (!name) {
      this.warn('savePreset: name required');
      return undefined;
    }

    const id = macroPresetStore.savePreset({
      name,
      sections: this._tempSections,
    });
    this.selectedPresetId = id;
    this.presets = macroPresetStore.presets;
    this.newPresetName = '';
    this._tempSections = [];
    return id;
  }

  deletePreset(): void {
    const preset = this._selectedPreset;
    if (!preset) {
      return;
    }
    macroPresetStore.deletePreset(preset.id);
    this.presets = macroPresetStore.presets;
    this.selectedPresetId = null;
  }

  duplicatePreset(): string | undefined {
    const preset = this._selectedPreset;
    if (!preset) {
      return undefined;
    }
    const newId = macroPresetStore.duplicatePreset(preset.id);
    if (newId) {
      this.presets = macroPresetStore.presets;
      this.selectedPresetId = newId;
    }
    return newId;
  }

  discardChanges(): void {
    macroPresetStore.loadPresets();
    this.presets = macroPresetStore.presets;
    this.selectedPresetId = null;
    this.newPresetName = '';
    this.newSectionName = '';
    this._tempSections = [];
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /** Temporary sections for "new preset" flow. */
  private _tempSections: PromptSection[] = [];

  /** Updates a section in the selected preset (partial merge). */
  private _patchSection(id: string, patch: Partial<PromptSection>): void {
    if (this.isNewPreset) {
      this._tempSections = this._tempSections.map((s) => (s.id === id ? { ...s, ...patch } : s));
      return;
    }
    const preset = this._selectedPreset;
    if (!preset) {
      return;
    }
    const updated: PromptPreset = {
      ...preset,
      sections: preset.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      updatedAt: new Date().toISOString(),
    };
    this._updatePreset(updated);
  }

  /** Replace a preset in the local list. */
  private _updatePreset(updated: PromptPreset): void {
    this.presets = this.presets.map((p) => (p.id === updated.id ? updated : p));
  }

  /** Moves a section by delta positions. */
  private _moveSection(id: string, delta: number): void {
    const preset = this._selectedPreset;
    if (!preset) {
      return;
    }
    const sorted = [...preset.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sorted.findIndex((s) => s.id === id);
    if (idx < 0) {
      return;
    }
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= sorted.length) {
      return;
    }

    // Swap orders
    const tempOrder = sorted[idx].order ?? idx;
    sorted[idx] = { ...sorted[idx], order: sorted[newIdx].order ?? newIdx };
    sorted[newIdx] = { ...sorted[newIdx], order: tempOrder };

    const updated: PromptPreset = {
      ...preset,
      sections: sorted,
      updatedAt: new Date().toISOString(),
    };
    this._updatePreset(updated);
  }
}

export const getPresetEditorViewModel = (
  options: PresetEditorViewModelOptions,
): PresetEditorViewModelInterface => PresetEditorViewModel.create(options);
