// apps/frontend/client/src/lib/views/settings/interface/settings_interface_view_model.svelte.ts
//
// C-528 AC-1/AC-3/AC-6/AC-8 — the Interface settings section.
//
// Settings are immediate-save (every control applies and persists as it
// changes), so this section talks to the SAME authority the in-game editor and
// the legacy toggles use — one resolver, one store, no dual write (Directive 11).
//
// It also owns the two recovery affordances the contract requires to work even
// when the stored layout is unreadable: "Restore default interface" and the
// preset exchange controls.

import { HUD_LAYOUT_PRESETS, HUD_WIDGET_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { type HudLayoutPreset, isHudLayoutJsonWithinSizeLimit } from '@aikami/schemas';
import type {
  HudDensity,
  HudSlot,
  HudUserPreferences,
  HudVisibility,
  HudWidgetId,
} from '@aikami/types';
import { mergeHudPreferences } from '$lib/utils/hud/hud_layout_policy.ts';
import {
  allowedHudAnchors,
  type HudEditorCommand,
  type HudPresetImportFailure,
} from '$lib/utils/hud/hud_layout_state.ts';
import type { HudPreviewContext } from '$views/game/ui/hud/hud_layout_editor_view_model.svelte';

/** The HUD authority, as the settings page sees it. */
export type SettingsInterfaceHudCapabilities = {
  readonly preferences: HudUserPreferences;
  readonly isEditorEnabled: boolean;
  readonly recoveryNotice: string | undefined;
  readonly dormantWidgetIds: readonly string[];
  readonly isHudTemporarilyHidden: boolean;
  selectPreset(presetId: string): void;
  applyNow(command: HudEditorCommand): void;
  resetWidget(widgetId: string): void;
  restoreDefaults(): void;
  setHudTemporarilyHidden(hidden: boolean): void;
  exportPreset(name: string): HudLayoutPreset;
  importPreset(preset: unknown): HudPresetImportFailure | undefined;
};

/** A row the settings page renders for one registered widget. */
export type SettingsInterfaceWidgetRow = {
  readonly widgetId: HudWidgetId;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly dormant: boolean;
  readonly visibility: HudVisibility;
  readonly anchor: HudSlot;
  readonly density: HudDensity;
  readonly scale: number;
  readonly allowedAnchors: readonly HudSlot[];
  readonly visibilityOptions: readonly { id: HudVisibility; label: string }[];
  readonly densityOptions: readonly { id: HudDensity; label: string }[];
};

export type SettingsInterfaceViewModelOptions = BaseViewModelOptions & {
  readonly hud: SettingsInterfaceHudCapabilities;
  /** Capability keys available this session (drives the dormant badge). */
  readonly capabilities: readonly string[];
};

export type SettingsInterfaceViewModelInterface = BaseViewModelInterface & {
  readonly isEditorEnabled: boolean;
  readonly recoveryNotice: string | undefined;
  readonly isHudTemporarilyHidden: boolean;
  readonly selectedPresetId: string;
  readonly presetOptions: readonly { id: string; label: string; description: string }[];
  readonly widgetRows: readonly SettingsInterfaceWidgetRow[];
  readonly dormantWidgetIds: readonly string[];
  readonly statusMessage: string | undefined;
  readonly importErrorMessage: string | undefined;
  readonly exportedPresetJson: string | undefined;
  readonly importDraft: string;

  selectPreset(presetId: string): void;
  setVisibility(widgetId: HudWidgetId, visibility: HudVisibility): void;
  setAnchor(widgetId: HudWidgetId, anchor: HudSlot): void;
  setDensity(widgetId: HudWidgetId, density: HudDensity): void;
  setScale(widgetId: HudWidgetId, scale: number): void;
  resetWidget(widgetId: HudWidgetId): void;
  restoreDefaults(): void;
  setHudTemporarilyHidden(hidden: boolean): void;
  exportPreset(): void;
  importPresetJson(raw: string): void;
  handleImportInput(event: Event): void;
  dismissStatus(): void;
  /** C-528: the contexts the in-game editor can preview (linked from here). */
  readonly previewContexts: readonly HudPreviewContext[];
};

const VISIBILITY_OPTIONS: readonly { id: HudVisibility; label: string }[] = [
  { id: 'always', label: 'Always' },
  { id: 'contextual', label: 'When relevant' },
  { id: 'hidden', label: 'Hidden' },
];

const DENSITY_OPTIONS: readonly { id: HudDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
];

class SettingsInterfaceViewModel
  extends BaseViewModel<SettingsInterfaceViewModelOptions>
  implements SettingsInterfaceViewModelInterface
{
  private readonly _hud: SettingsInterfaceHudCapabilities;
  private readonly _capabilities: readonly string[];

  statusMessage = $state<string | undefined>(undefined);
  importErrorMessage = $state<string | undefined>(undefined);
  exportedPresetJson = $state<string | undefined>(undefined);
  importDraft = $state('');

  constructor(options: SettingsInterfaceViewModelOptions) {
    super(options);
    this._hud = options.hud;
    this._capabilities = options.capabilities;
  }

  /** @inheritdoc */
  get isEditorEnabled(): boolean {
    return this._hud.isEditorEnabled;
  }

  /** @inheritdoc */
  get recoveryNotice(): string | undefined {
    return this._hud.recoveryNotice;
  }

  /** @inheritdoc */
  get isHudTemporarilyHidden(): boolean {
    return this._hud.isHudTemporarilyHidden;
  }

  /** @inheritdoc */
  get selectedPresetId(): string {
    return this._hud.preferences.selectedPresetId;
  }

  /** @inheritdoc */
  get presetOptions(): readonly { id: string; label: string; description: string }[] {
    return HUD_LAYOUT_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.name,
      description: preset.description,
    }));
  }

  /** @inheritdoc */
  get previewContexts(): readonly HudPreviewContext[] {
    return ['explore', 'dialogue', 'combat'];
  }

  /** @inheritdoc */
  get widgetRows(): readonly SettingsInterfaceWidgetRow[] {
    const { merged } = mergeHudPreferences(this._hud.preferences);
    const capabilitySet = new Set(this._capabilities);
    return merged.map((widget) => {
      const definition = HUD_WIDGET_REGISTRY.find((entry) => entry.id === widget.widgetId);
      const dormant =
        definition === undefined ||
        (definition.capability !== undefined && !capabilitySet.has(definition.capability));
      return {
        widgetId: widget.widgetId as HudWidgetId,
        label: definition?.label ?? widget.widgetId,
        description: definition?.description ?? '',
        required: definition?.required ?? false,
        dormant,
        visibility: widget.visibility,
        anchor: widget.anchor,
        density: widget.density,
        scale: widget.scale,
        allowedAnchors: allowedHudAnchors(widget.widgetId as HudWidgetId),
        visibilityOptions: VISIBILITY_OPTIONS,
        densityOptions: DENSITY_OPTIONS,
      };
    });
  }

  /** @inheritdoc */
  get dormantWidgetIds(): readonly string[] {
    return this._hud.dormantWidgetIds;
  }

  // ── Actions ──

  /** @inheritdoc */
  selectPreset(presetId: string): void {
    this._hud.selectPreset(presetId);
    this.statusMessage = 'Preset applied';
  }

  /** @inheritdoc */
  setVisibility(widgetId: HudWidgetId, visibility: HudVisibility): void {
    this._hud.applyNow({ kind: 'set-visibility', widgetId, visibility });
  }

  /** @inheritdoc */
  setAnchor(widgetId: HudWidgetId, anchor: HudSlot): void {
    this._hud.applyNow({ kind: 'set-anchor', widgetId, anchor });
  }

  /** @inheritdoc */
  setDensity(widgetId: HudWidgetId, density: HudDensity): void {
    this._hud.applyNow({ kind: 'set-density', widgetId, density });
  }

  /** @inheritdoc */
  setScale(widgetId: HudWidgetId, scale: number): void {
    this._hud.applyNow({ kind: 'set-scale', widgetId, scale });
  }

  /** @inheritdoc */
  resetWidget(widgetId: HudWidgetId): void {
    this._hud.resetWidget(widgetId);
    this.statusMessage = 'Widget reset';
  }

  /** @inheritdoc */
  restoreDefaults(): void {
    this._hud.restoreDefaults();
    this.statusMessage = 'Default interface restored';
  }

  /** @inheritdoc */
  setHudTemporarilyHidden(hidden: boolean): void {
    this._hud.setHudTemporarilyHidden(hidden);
  }

  /** @inheritdoc */
  exportPreset(): void {
    this.exportedPresetJson = JSON.stringify(this._hud.exportPreset('Shared layout'), undefined, 2);
    this.statusMessage = 'Preset exported — copy the JSON to share it';
  }

  /** @inheritdoc */
  importPresetJson(raw: string): void {
    this.importErrorMessage = undefined;
    if (!isHudLayoutJsonWithinSizeLimit(raw)) {
      this.importErrorMessage = 'That preset is too large.';
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.importErrorMessage = 'That is not valid JSON.';
      return;
    }
    const failure = this._hud.importPreset(parsed);
    if (failure) {
      this.importErrorMessage =
        failure.reason === 'missing-required-widget'
          ? 'That preset is missing a required HUD surface (Menu or system notices) and cannot be used.'
          : 'That preset could not be read.';
      return;
    }
    this.statusMessage = 'Preset imported';
  }

  /** @inheritdoc */
  handleImportInput(event: Event): void {
    if (!(event.currentTarget instanceof HTMLTextAreaElement)) {
      return;
    }
    this.importDraft = event.currentTarget.value;
  }

  /** @inheritdoc */
  dismissStatus(): void {
    this.statusMessage = undefined;
    this.importErrorMessage = undefined;
  }
}

/**
 * Builds the interface settings ViewModel from explicit capabilities.
 *
 * Production wiring lives in `./settings_interface_composition.ts`.
 */
export const createSettingsInterfaceViewModel = (
  options: SettingsInterfaceViewModelOptions,
): SettingsInterfaceViewModelInterface => SettingsInterfaceViewModel.create(options);
