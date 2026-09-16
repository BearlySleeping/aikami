// apps/frontend/client/src/lib/views/settings/interface/settings_interface_view_model_types.ts
//
// Capability contracts for the Interface settings ViewModel. Kept in a separate
// module so the ViewModel stays within its size budget — the same split
// `game_ui_view_model_types.ts` uses for the game UI overlay router.
//
// These describe what the section needs from each authority it is handed. The
// ViewModel's own interface and options stay with the ViewModel; only the
// per-authority contracts live here.
//
// Contract: C-528 AC-1/AC-3/AC-6/AC-8, C-529 AC-2/AC-3/AC-5/AC-6.

import type {
  AppearanceMode,
  HudLayoutPreset,
  ThemeAccessibilityOverrides,
  ThemeInstallation,
  ThemeSelection,
} from '@aikami/schemas';
import type {
  HudDensity,
  HudSlot,
  HudUserPreferences,
  HudVisibility,
  HudWidgetId,
  ThemeInstallIntent,
} from '@aikami/types';
import type { ThemeHubDownloadOptions } from '$lib/services/theme/theme_package_service_types.ts';
import type { HudEditorCommand, HudPresetImportFailure } from '$lib/utils/hud/hud_layout_state.ts';
import type { AppearanceThemeOption, StagedTheme, ThemeImportFailure } from '$types';

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
  /**
   * C-530 AC-5: downloads one immutable version from the *configured* trusted
   * Hub and stages it. Never installs, never applies.
   */
  stageHubDownload(intent: ThemeInstallIntent, options?: ThemeHubDownloadOptions): Promise<boolean>;
  cancelStaged(): void;
  takeStagedForCommit(): ThemeInstallation | undefined;
  dismissMessages(): void;
};
