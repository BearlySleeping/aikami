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

import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  HUD_LAYOUT_PRESETS,
  HUD_WIDGET_REGISTRY,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import {
  type AppearanceMode,
  type HudLayoutPreset,
  isHudLayoutJsonWithinSizeLimit,
  type ThemeAccessibilityOverrides,
  type ThemeInstallation,
  type ThemeSelection,
} from '@aikami/schemas';
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
import {
  applyStarterPreset,
  compileDraftVariant,
  draftIsValid,
  draftRoleRows,
  draftToExportInput,
  draftVariantJson,
  duplicateBuiltInTheme,
  setDraftToken,
  setDraftVariantFromJson,
  THEME_STARTER_PRESETS,
  type ThemeEditorDraft,
  type ThemeEditorRoleRow,
  type ThemeEditorVariant,
} from '$lib/utils/theme/theme_editor_state.ts';
import type { AppearanceThemeOption, StagedTheme, ThemeImportFailure } from '$services';
import type { HudPreviewContext } from '$views/game/ui/hud/hud_layout_editor_view_model.svelte';
import {
  previewBadgeClass,
  THEME_PREVIEW_CONTEXTS,
  type ThemePreviewContext,
} from './theme_preview_fixtures.ts';

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

/**
 * C-529 — the appearance authority, as the settings page sees it.
 *
 * Appearance is a sub-view of this section (not a new `SETTINGS_SECTIONS` id),
 * so the existing `?section=interface` deep link stays the single entry point.
 */
export type SettingsInterfaceAppearanceCapabilities = {
  readonly selection: ThemeSelection;
  readonly resolvedVariant: 'light' | 'dark';
  readonly recoveryNotice: string | undefined;
  readonly themeOptions: readonly AppearanceThemeOption[];
  readonly isUsingBuiltinFallbackVariant: boolean;
  readonly accessibility: ThemeAccessibilityOverrides;
  readonly accessibilityChanges: readonly string[];
  setMode(mode: AppearanceMode): void;
  selectTheme(themeId: string): void;
  restoreDefaults(): void;
  setHighContrast(enabled: boolean): void;
  setOpaqueSurfaces(enabled: boolean): void;
  /** Atomically installs validated theme bytes and selects them. */
  installTheme(installation: ThemeInstallation): boolean;
  uninstallTheme(): void;
};

/**
 * C-529 AC-3/AC-6 — the local package lifecycle, as the settings page sees it.
 *
 * Staging is separate from committing on purpose: the editor can preview a
 * package and still walk away, and an import that is no longer the newest one
 * cannot replace a newer selection.
 */
export type SettingsInterfaceThemePackageCapabilities = {
  readonly staged: StagedTheme | undefined;
  readonly isBusy: boolean;
  readonly importFailures: readonly ThemeImportFailure[];
  readonly exportMessage: string | undefined;
  exportBuiltInTheme(themeId: string): Promise<void>;
  stageImport(file: File): Promise<boolean>;
  cancelStaged(): void;
  takeStagedForCommit(): ThemeInstallation | undefined;
  dismissMessages(): void;
};

export type SettingsInterfaceViewModelOptions = BaseViewModelOptions & {
  readonly hud: SettingsInterfaceHudCapabilities;
  /** C-529 appearance authority. */
  readonly appearance: SettingsInterfaceAppearanceCapabilities;
  /** C-529 local theme package lifecycle. */
  readonly themePackages: SettingsInterfaceThemePackageCapabilities;
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

  // ── C-529 appearance (sub-view) ──
  readonly appearanceMode: AppearanceMode;
  readonly appearanceThemeId: string;
  readonly appearanceVariant: 'light' | 'dark';
  readonly appearanceRecoveryNotice: string | undefined;
  readonly appearanceModeOptions: readonly { id: AppearanceMode; label: string }[];
  readonly appearanceThemeOptions: readonly AppearanceThemeOption[];
  readonly isUsingBuiltinFallbackVariant: boolean;
  setAppearanceMode(mode: AppearanceMode): void;
  selectAppearanceTheme(themeId: string): void;
  restoreDefaultAppearance(): void;

  // ── C-529 accessibility overrides (applied last, always win) ──
  readonly isHighContrast: boolean;
  readonly hasOpaqueSurfaces: boolean;
  /** Human-readable list of the tokens the overrides currently change. */
  readonly accessibilityChangeSummary: readonly string[];
  setHighContrast(enabled: boolean): void;
  setOpaqueSurfaces(enabled: boolean): void;

  // ── C-529 package exchange (AC-3) ──
  readonly isPackageBusy: boolean;
  readonly stagedPackage: StagedTheme | undefined;
  readonly packageFailures: readonly ThemeImportFailure[];
  readonly packageMessage: string | undefined;
  readonly canExportTheme: boolean;
  readonly isThemeExportDisabled: boolean;
  readonly canUninstallTheme: boolean;
  exportThemePackage(): Promise<void>;
  handleThemePackageFile(event: Event): Promise<void>;
  applyStagedPackage(): void;
  cancelStagedPackage(): void;
  dismissPackageMessages(): void;
  uninstallTheme(): void;

  // ── C-529 creator editor (AC-2) ──
  readonly isEditorOpen: boolean;
  readonly editorVariant: ThemeEditorVariant;
  readonly editorName: string;
  readonly editorRoleGroups: readonly {
    readonly id: string;
    readonly rows: readonly ThemeEditorRoleRow[];
  }[];
  readonly editorIssues: readonly { readonly code: string; readonly message: string }[];
  readonly editorIsValid: boolean;
  readonly editorJson: string;
  readonly editorJsonIssues: readonly { readonly code: string; readonly message: string }[];
  readonly starterPresets: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
  }[];
  readonly editorPreviewContexts: readonly ThemePreviewContext[];
  /** Tailwind badge class for a preview context's status tone. */
  previewStatusBadgeClass(context: ThemePreviewContext): string;
  /** Inline custom properties that repaint ONLY the preview root. */
  readonly editorPreviewStyle: string;
  openEditor(): void;
  closeEditor(): void;
  selectEditorVariant(variant: ThemeEditorVariant): void;
  applyEditorPreset(presetId: string): void;
  setEditorRoleValue(tokenId: string, raw: string): void;
  resetEditorToBuiltIn(): void;
  handleEditorJsonInput(event: Event): void;
  applyEditorJson(): void;
  applyEditorDraft(): void;
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

/** Appearance modes. `system` follows the OS; the other two are explicit. */
const APPEARANCE_MODE_OPTIONS: readonly { id: AppearanceMode; label: string }[] = [
  { id: 'system', label: 'Match system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

class SettingsInterfaceViewModel
  extends BaseViewModel<SettingsInterfaceViewModelOptions>
  implements SettingsInterfaceViewModelInterface
{
  private readonly _hud: SettingsInterfaceHudCapabilities;
  private readonly _appearance: SettingsInterfaceAppearanceCapabilities;
  private readonly _themePackages: SettingsInterfaceThemePackageCapabilities;
  private readonly _capabilities: readonly string[];

  // ── C-529 editor state (UI state only — never persisted here) ──
  isEditorOpen = $state<boolean>(false);
  editorVariant = $state<ThemeEditorVariant>('light');
  editorJson = $state<string>('');
  editorJsonIssues = $state<readonly { code: string; message: string }[]>([]);
  private _editorDraft = $state<ThemeEditorDraft>(duplicateBuiltInTheme());
  private _editorIssues = $state<readonly { code: string; message: string }[]>([]);

  statusMessage = $state<string | undefined>(undefined);
  importErrorMessage = $state<string | undefined>(undefined);
  exportedPresetJson = $state<string | undefined>(undefined);
  importDraft = $state('');

  constructor(options: SettingsInterfaceViewModelOptions) {
    super(options);
    this._hud = options.hud;
    this._appearance = options.appearance;
    this._themePackages = options.themePackages;
    this._capabilities = options.capabilities;
    this.editorJson = draftVariantJson(this._editorDraft, this.editorVariant);
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

  // ── C-529 appearance ──

  /** @inheritdoc */
  get appearanceMode(): AppearanceMode {
    return this._appearance.selection.mode;
  }

  /** @inheritdoc */
  get appearanceThemeId(): string {
    return this._appearance.selection.themeId;
  }

  /** @inheritdoc */
  get appearanceVariant(): 'light' | 'dark' {
    return this._appearance.resolvedVariant;
  }

  /** @inheritdoc */
  get appearanceRecoveryNotice(): string | undefined {
    return this._appearance.recoveryNotice;
  }

  /** @inheritdoc */
  get appearanceModeOptions(): readonly { id: AppearanceMode; label: string }[] {
    return APPEARANCE_MODE_OPTIONS;
  }

  /** @inheritdoc */
  get appearanceThemeOptions(): readonly AppearanceThemeOption[] {
    return this._appearance.themeOptions;
  }

  /** @inheritdoc */
  get isUsingBuiltinFallbackVariant(): boolean {
    return this._appearance.isUsingBuiltinFallbackVariant;
  }

  /** @inheritdoc */
  setAppearanceMode(mode: AppearanceMode): void {
    this._appearance.setMode(mode);
    this.statusMessage = 'Appearance updated';
  }

  /** @inheritdoc */
  selectAppearanceTheme(themeId: string): void {
    this._appearance.selectTheme(themeId);
    this.statusMessage = 'Theme selected';
  }

  /** @inheritdoc */
  restoreDefaultAppearance(): void {
    this._appearance.restoreDefaults();
    this.statusMessage = 'Default appearance restored';
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

  // ── C-529 accessibility overrides ──

  /** @inheritdoc */
  get isHighContrast(): boolean {
    return this._appearance.accessibility.highContrast;
  }

  /** @inheritdoc */
  get hasOpaqueSurfaces(): boolean {
    return this._appearance.accessibility.opaqueSurfaces;
  }

  /** @inheritdoc */
  get accessibilityChangeSummary(): readonly string[] {
    return this._appearance.accessibilityChanges;
  }

  /** @inheritdoc */
  setHighContrast(enabled: boolean): void {
    this._appearance.setHighContrast(enabled);
    this.statusMessage = enabled ? 'High contrast on' : 'High contrast off';
  }

  /** @inheritdoc */
  setOpaqueSurfaces(enabled: boolean): void {
    this._appearance.setOpaqueSurfaces(enabled);
    this.statusMessage = enabled ? 'Opaque surfaces on' : 'Opaque surfaces off';
  }

  // ── C-529 package exchange (AC-3 / AC-6) ──

  /** @inheritdoc */
  get isPackageBusy(): boolean {
    return this._themePackages.isBusy;
  }

  /** @inheritdoc */
  get stagedPackage(): StagedTheme | undefined {
    return this._themePackages.staged;
  }

  /** @inheritdoc */
  get packageFailures(): readonly ThemeImportFailure[] {
    return this._themePackages.importFailures;
  }

  /** @inheritdoc */
  get packageMessage(): string | undefined {
    return this._themePackages.exportMessage;
  }

  /** @inheritdoc */
  get canExportTheme(): boolean {
    return this._appearance.selection.themeId === BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE;
  }

  /** @inheritdoc */
  get isThemeExportDisabled(): boolean {
    return this._themePackages.isBusy || !this.canExportTheme;
  }

  /** @inheritdoc */
  get canUninstallTheme(): boolean {
    return this._appearance.selection.themeId !== BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE;
  }

  /** @inheritdoc */
  async exportThemePackage(): Promise<void> {
    if (!this.canExportTheme) {
      return;
    }
    await this._themePackages.exportBuiltInTheme(this._appearance.selection.themeId);
  }

  /** @inheritdoc */
  async handleThemePackageFile(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    await this._themePackages.stageImport(file);
    // A picked file must not linger, so re-picking the same name re-imports.
    input.value = '';
  }

  /**
   * Commits the staged package.
   *
   * 🔴 `takeStagedForCommit()` is what makes this atomic: the staging area is
   * consumed in the same synchronous step that installs, so a second click
   * cannot install the same package twice and an abandoned staging area cannot
   * be activated later.
   */
  applyStagedPackage(): void {
    const installation = this._themePackages.takeStagedForCommit();
    if (installation === undefined) {
      return;
    }
    if (this._appearance.installTheme(installation)) {
      this.statusMessage = `Installed ${installation.manifest.name}`;
      this._themePackages.dismissMessages();
      return;
    }
    this.statusMessage = undefined;
    this.importErrorMessage = 'That theme could not be applied.';
  }

  /** @inheritdoc */
  cancelStagedPackage(): void {
    this._themePackages.cancelStaged();
  }

  /** @inheritdoc */
  dismissPackageMessages(): void {
    this._themePackages.dismissMessages();
  }

  /** @inheritdoc */
  uninstallTheme(): void {
    this._appearance.uninstallTheme();
    this.statusMessage = 'Theme uninstalled — default appearance restored';
  }

  // ── C-529 creator editor (AC-2) ──

  /** @inheritdoc */
  get editorName(): string {
    return this._editorDraft.name;
  }

  /** @inheritdoc */
  get editorRoleGroups(): readonly { id: string; rows: readonly ThemeEditorRoleRow[] }[] {
    const rows = draftRoleRows(this._editorDraft, this.editorVariant);
    const groups = new Map<string, ThemeEditorRoleRow[]>();
    for (const row of rows) {
      const bucket = groups.get(row.group);
      if (bucket === undefined) {
        groups.set(row.group, [row]);
      } else {
        bucket.push(row);
      }
    }
    return [...groups.entries()].map(([id, groupRows]) => ({ id, rows: groupRows }));
  }

  /** @inheritdoc */
  get editorIssues(): readonly { code: string; message: string }[] {
    return this._editorIssues;
  }

  /** @inheritdoc */
  get editorIsValid(): boolean {
    return draftIsValid(this._editorDraft);
  }

  /** @inheritdoc */
  get starterPresets(): readonly { id: string; label: string; description: string }[] {
    return THEME_STARTER_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
    }));
  }

  /** @inheritdoc */
  get editorPreviewContexts(): readonly ThemePreviewContext[] {
    return THEME_PREVIEW_CONTEXTS;
  }

  /** @inheritdoc */
  previewStatusBadgeClass(context: ThemePreviewContext): string {
    return previewBadgeClass(context.status.tone);
  }

  /**
   * Inline custom properties that repaint ONLY the preview root.
   *
   * Inline custom properties are inherited by every descendant of the preview
   * root and beat any stylesheet rule for that element, so the draft is visible
   * without a second global stylesheet, without a selector a theme could
   * influence, and without leaving the preview. The values are already validated
   * and canonically serialized by the shared compiler.
   */
  get editorPreviewStyle(): string {
    const compilation = compileDraftVariant(this._editorDraft, this.editorVariant);
    if (!compilation.ok) {
      return '';
    }
    return compilation.declarations
      .map((entry) => `${entry.cssVariable}: ${entry.value}`)
      .join('; ');
  }

  /** @inheritdoc */
  openEditor(): void {
    this.isEditorOpen = true;
    this.editorJson = draftVariantJson(this._editorDraft, this.editorVariant);
    this._refreshEditorIssues();
  }

  /** @inheritdoc */
  closeEditor(): void {
    this.isEditorOpen = false;
  }

  /** @inheritdoc */
  selectEditorVariant(variant: ThemeEditorVariant): void {
    this.editorVariant = variant;
    this.editorJson = draftVariantJson(this._editorDraft, variant);
    this.editorJsonIssues = [];
    this._refreshEditorIssues();
  }

  /** @inheritdoc */
  applyEditorPreset(presetId: string): void {
    const result = applyStarterPreset(this._editorDraft, this.editorVariant, presetId);
    this._editorDraft = result.draft;
    this.editorJson = draftVariantJson(this._editorDraft, this.editorVariant);
    this._refreshEditorIssues();
  }

  /** @inheritdoc */
  setEditorRoleValue(tokenId: string, raw: string): void {
    const result = setDraftToken(this._editorDraft, this.editorVariant, tokenId, raw);
    this._editorDraft = result.draft;
    this.editorJson = draftVariantJson(this._editorDraft, this.editorVariant);
    this._refreshEditorIssues();
  }

  /** @inheritdoc */
  resetEditorToBuiltIn(): void {
    this._editorDraft = duplicateBuiltInTheme();
    this.editorJson = draftVariantJson(this._editorDraft, this.editorVariant);
    this.editorJsonIssues = [];
    this._refreshEditorIssues();
    this.statusMessage = 'Editor reset to the built-in theme';
  }

  /** @inheritdoc */
  handleEditorJsonInput(event: Event): void {
    if (!(event.currentTarget instanceof HTMLTextAreaElement)) {
      return;
    }
    this.editorJson = event.currentTarget.value;
  }

  /** @inheritdoc */
  applyEditorJson(): void {
    const result = setDraftVariantFromJson(this._editorDraft, this.editorVariant, this.editorJson);
    this._editorDraft = result.draft;
    this.editorJsonIssues = result.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
    }));
    this._refreshEditorIssues();
  }

  /**
   * Applies the draft locally as an installed theme.
   *
   * The draft is exported through the same envelope a package uses and installed
   * through the same atomic path, so "Apply" in the editor and "Import" of an
   * exported package cannot diverge.
   */
  applyEditorDraft(): void {
    if (!draftIsValid(this._editorDraft)) {
      this.importErrorMessage = 'This theme still has an invalid role. Fix it before applying.';
      return;
    }
    const input = draftToExportInput(this._editorDraft);
    const installation: ThemeInstallation = {
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        kind: 'aikami-theme',
        id: input.id,
        version: input.version,
        themeApiRange: input.themeApiRange,
        name: input.name,
        author: { displayName: input.authorDisplayName },
        license: input.license,
        variants: {},
        assets: [],
      },
      variants: input.variants,
    };
    if (this._appearance.installTheme(installation)) {
      this.statusMessage = `Applied ${input.name}`;
      this.isEditorOpen = false;
      return;
    }
    this.importErrorMessage = 'That theme could not be applied.';
  }

  private _refreshEditorIssues(): void {
    const compilation = compileDraftVariant(this._editorDraft, this.editorVariant);
    this._editorIssues = compilation.ok
      ? []
      : compilation.issues.map((issue) => ({ code: issue.code, message: issue.message }));
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
