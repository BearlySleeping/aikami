// apps/frontend/client/src/lib/services/settings/appearance_preference_service.svelte.ts
//
// AppearancePreferenceService — the ONE owner of the player's appearance
// selection and of the installed community theme (C-529 Directive 4, 5, 7, 12).
//
// Before this service nothing in the client ever wrote `data-theme`: the only
// appearance that resolved was the OS media query, so "system / light / dark"
// was not a choice a player could make and a theme had nowhere to live.
//
// This service owns:
//   - the versioned, atomic device-local selection (`aikami:theme:selection`)
//   - the installed theme bytes (`aikami:theme:last-good`) — validated token
//     data, never a stylesheet string
//   - the game-scope `<style>` element that repaints ONLY
//     `[data-aikami-theme-scope]`
//   - the recovery path: a corrupt or unsupported installation boots the
//     built-in palette with a repair notice and leaves the bytes intact
//
// It owns NO accessibility selection: motion stays in MotionPreferenceService
// and HUD layout stays in HudPreferenceService. Appearance, HUD and
// accessibility remain independent (Directive 5).
//
// 🔴 Nothing here writes `--color-*` or any selector other than the trusted
// scope selector; a theme cannot choose where its values land.
//
// Contract: C-529 AC-2, AC-5, AC-6, AC-9.

import {
  THEME_ACCESSIBILITY_STORAGE_KEY,
  THEME_INJECTED_STYLE_ID,
  THEME_LAST_GOOD_STORAGE_KEY,
  THEME_SELECTION_STORAGE_KEY,
} from '@aikami/constants';
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services/base';
import {
  type AppearanceMode,
  parseThemeAccessibilityOverridesJson,
  parseThemeInstallationJson,
  parseThemeSelectionJson,
  type ThemeAccessibilityOverrides,
  type ThemeInstallation,
  type ThemeSelection,
} from '@aikami/schemas';
import {
  BUILTIN_THEME_OPTION,
  compileScopeStyle,
  defaultThemeSelection,
  installationVariants,
  isBuiltInSelection,
  isSelectionResolvable,
  type ResolvedThemeVariant,
  resolveThemeVariant,
} from '$lib/utils/theme/theme_runtime.ts';
import type { AppearancePreferenceServiceOptions, AppearanceThemeOption } from '$types';

export type AppearancePreferenceServiceInterface = BaseFrontendClassInterface & {
  /** The committed selection the runtime reads. */
  readonly selection: ThemeSelection;
  /** The variant actually rendered right now. */
  readonly resolvedVariant: ResolvedThemeVariant;
  /** Whether the OS currently prefers dark (drives `system`). */
  readonly osPrefersDark: boolean;
  /** The installed community theme, when one is installed. */
  readonly installedTheme: ThemeInstallation | undefined;
  /** Every selectable theme: the built-ins plus the installed one. */
  readonly themeOptions: readonly AppearanceThemeOption[];
  /** Human-readable notice when stored data could not be used. */
  readonly recoveryNotice: string | undefined;
  /** True when the installed theme lacked the resolved variant. */
  readonly isUsingBuiltinFallbackVariant: boolean;
  /** The explicit accessibility appearance overrides (always win). */
  readonly accessibility: ThemeAccessibilityOverrides;
  /** Token ids the accessibility overrides currently change — shown, not hidden. */
  readonly accessibilityChanges: readonly string[];

  setHighContrast(enabled: boolean): void;
  setOpaqueSurfaces(enabled: boolean): void;

  setMode(mode: AppearanceMode): void;
  selectTheme(themeId: string): void;
  /** Installs validated theme bytes and selects them in one atomic step. */
  installTheme(installation: ThemeInstallation): boolean;
  /** Removes the installed theme and returns to the shipped default. */
  uninstallTheme(): void;
  /** Restore default appearance — always available in trusted Settings. */
  restoreDefaults(): void;
  /** Re-reads storage and re-applies (idempotent). */
  initialize(): Promise<void>;
};

class AppearancePreferenceService
  extends BaseFrontendClass<AppearancePreferenceServiceOptions>
  implements AppearancePreferenceServiceInterface
{
  selection = $state<ThemeSelection>(defaultThemeSelection());
  osPrefersDark = $state<boolean>(false);
  installedTheme = $state<ThemeInstallation | undefined>(undefined);
  recoveryNotice = $state<string | undefined>(undefined);
  accessibility = $state<ThemeAccessibilityOverrides>({
    schemaVersion: 1,
    highContrast: false,
    opaqueSurfaces: false,
  });
  accessibilityChanges = $state<readonly string[]>([]);

  private _osQuery: MediaQueryList | undefined;
  private _osListener: ((event: MediaQueryListEvent) => void) | undefined;

  constructor(options: AppearancePreferenceServiceOptions) {
    super(options);
    // 🔴 Restore at construction, NOT only in an explicit `initialize()`.
    // Three independent entry points read this selection — game boot, the
    // settings page and the appearance preview — and a restore that lives only
    // in `initialize()` is one forgotten call site away from showing the player
    // a default they never chose.
    this._restore();
    this._watchOsPreference();
    this._apply();
  }

  /** @inheritdoc */
  get resolvedVariant(): ResolvedThemeVariant {
    return resolveThemeVariant(this.selection.mode, this.osPrefersDark);
  }

  /** @inheritdoc */
  get themeOptions(): readonly AppearanceThemeOption[] {
    const options: AppearanceThemeOption[] = [
      {
        id: BUILTIN_THEME_OPTION.id,
        name: BUILTIN_THEME_OPTION.name,
        version: BUILTIN_THEME_OPTION.version,
        isBuiltIn: true,
        variants: ['light', 'dark'],
      },
    ];
    const installed = this.installedTheme;
    if (installed !== undefined) {
      options.push({
        id: installed.manifest.id,
        name: installed.manifest.name,
        version: installed.manifest.version,
        isBuiltIn: false,
        variants: installationVariants(installed),
      });
    }
    return options;
  }

  /** @inheritdoc */
  get isUsingBuiltinFallbackVariant(): boolean {
    const installed = this.installedTheme;
    if (installed === undefined || isBuiltInSelection(this.selection)) {
      return false;
    }
    return installed.variants[this.resolvedVariant] === undefined;
  }

  // ── Accessibility appearance overrides (applied last, always win) ──

  /** @inheritdoc */
  setHighContrast(enabled: boolean): void {
    this.accessibility = { ...this.accessibility, highContrast: enabled };
    this._commit();
  }

  /** @inheritdoc */
  setOpaqueSurfaces(enabled: boolean): void {
    this.accessibility = { ...this.accessibility, opaqueSurfaces: enabled };
    this._commit();
  }

  // ── Selection ──

  /** @inheritdoc */
  setMode(mode: AppearanceMode): void {
    this.selection = { ...this.selection, mode };
    this._commit();
  }

  /** @inheritdoc */
  selectTheme(themeId: string): void {
    const option = this.themeOptions.find((entry) => entry.id === themeId);
    if (option === undefined) {
      // An unknown id is not selectable. The stored bytes are untouched, so a
      // later compatible client can still use them.
      this.warn('selectTheme:unknown', { themeId });
      return;
    }
    this.selection = { ...this.selection, themeId: option.id, version: option.version };
    this.recoveryNotice = undefined;
    this._commit();
  }

  // ── Install lifecycle ──

  /**
   * Installs validated theme bytes and selects them atomically.
   *
   * The selection is only committed after the installation record itself is
   * valid, so an interrupted or rejected install cannot activate a partial
   * theme (Directive 12).
   */
  installTheme(installation: ThemeInstallation): boolean {
    if (installation.variants.light === undefined && installation.variants.dark === undefined) {
      this.warn('installTheme:no-variant');
      return false;
    }
    const previous = this.installedTheme;
    this.installedTheme = installation;
    try {
      localStorage.setItem(THEME_LAST_GOOD_STORAGE_KEY, JSON.stringify(installation));
    } catch {
      // Storage unavailable — the installation applies for this session only.
      this.warn('installTheme:storage-unavailable');
    }
    this.selection = {
      ...this.selection,
      themeId: installation.manifest.id,
      version: installation.manifest.version,
    };
    this.recoveryNotice = undefined;
    this._commit();
    this.debug('installTheme', {
      id: installation.manifest.id,
      replaced: previous?.manifest.id,
    });
    return true;
  }

  /** @inheritdoc */
  uninstallTheme(): void {
    if (this.installedTheme === undefined) {
      return;
    }
    const removedId = this.installedTheme.manifest.id;
    this.installedTheme = undefined;
    try {
      localStorage.removeItem(THEME_LAST_GOOD_STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing to remove.
    }
    if (this.selection.themeId === removedId) {
      const defaultSelection = defaultThemeSelection();
      this.selection = {
        ...this.selection,
        themeId: defaultSelection.themeId,
        version: defaultSelection.version,
      };
    }
    this.recoveryNotice = undefined;
    this._commit();
    this.debug('uninstallTheme', { id: removedId });
  }

  // ── Recovery ──

  /** @inheritdoc */
  restoreDefaults(): void {
    this.selection = defaultThemeSelection();
    this.recoveryNotice = undefined;
    this._commit();
  }

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this._restore();
    this._watchOsPreference();
    this._apply();
  }

  // ── Private ──

  /** Writes the selection. The only place the selection key is mutated. */
  private _commit(): void {
    try {
      localStorage.setItem(THEME_SELECTION_STORAGE_KEY, JSON.stringify(this.selection));
      localStorage.setItem(THEME_ACCESSIBILITY_STORAGE_KEY, JSON.stringify(this.accessibility));
    } catch {
      // localStorage unavailable (SSR/privacy mode) — in-memory only.
      this.warn('persist:unavailable');
    }
    this._apply();
  }

  /** Reads the installation, then the selection, then applies. */
  private _restore(): void {
    const rawInstallation = this._readKey(THEME_LAST_GOOD_STORAGE_KEY);
    if (rawInstallation !== undefined) {
      const installation = parseThemeInstallationJson(rawInstallation);
      if (installation !== undefined) {
        this.installedTheme = installation;
      } else {
        // Unusable. Keep the bytes; never rewrite them destructively.
        this.recoveryNotice =
          'Your installed theme could not be read. The built-in appearance is in use; your theme files are untouched.';
        this.warn('restore:installation-unreadable');
      }
    }

    const rawAccessibility = this._readKey(THEME_ACCESSIBILITY_STORAGE_KEY);
    if (rawAccessibility !== undefined) {
      const overrides = parseThemeAccessibilityOverridesJson(rawAccessibility);
      if (overrides !== undefined) {
        this.accessibility = overrides;
      } else {
        // An unreadable accessibility record must never silently disable an
        // accessibility choice, so it is reported and the safe default applies.
        this.recoveryNotice =
          this.recoveryNotice ??
          'Your accessibility appearance settings could not be read. The default appearance is in use.';
        this.warn('restore:accessibility-unreadable');
      }
    }

    const rawSelection = this._readKey(THEME_SELECTION_STORAGE_KEY);
    if (rawSelection === undefined) {
      // No stored appearance selection — the documented default.
      this.selection = defaultThemeSelection();
      return;
    }
    const selection = parseThemeSelectionJson(rawSelection);
    if (selection === undefined) {
      this.selection = defaultThemeSelection();
      this.recoveryNotice =
        this.recoveryNotice ??
        'Your appearance setting could not be read. The default appearance is in use.';
      this.warn('restore:selection-unreadable');
      return;
    }
    if (!isSelectionResolvable(selection, this.installedTheme?.manifest.id)) {
      // The selected theme is not installed (uninstalled, or saved by a newer
      // client). Boot the default; the stored bytes stay for a later client.
      const defaultSelection = defaultThemeSelection();
      this.selection = {
        ...selection,
        themeId: defaultSelection.themeId,
        version: defaultSelection.version,
      };
      this.recoveryNotice =
        'Your selected theme is not installed on this device. The default appearance is in use.';
      this.warn('restore:selection-unresolvable', { themeId: selection.themeId });
      return;
    }
    this.selection = selection;
  }

  private _readKey(key: string): string | undefined {
    try {
      const value = localStorage.getItem(key);
      return value === null ? undefined : value;
    } catch {
      return undefined;
    }
  }

  /**
   * Applies the resolved appearance to the DOM.
   *
   * Two surfaces are written and nothing else:
   *   1. `<html data-theme>` — the trusted app chrome, including the Hub-style
   *      global selectors the generated stylesheet already defines.
   *   2. the game scope — `[data-aikami-theme-scope]` carries the variant, and a
   *      single trusted `<style>` element contributes the installed theme's
   *      `--ui-*` values beneath that selector.
   */
  private _apply(): void {
    const variant = this.resolvedVariant;
    this._applyRootAttribute(variant);
    this._applyScopeStyle(variant);
  }

  private _applyRootAttribute(variant: ResolvedThemeVariant): void {
    if (typeof document === 'undefined') {
      return;
    }
    // The trusted app chrome keeps the pre-existing `data-theme` contract.
    // Custom theme values never land here — only the scope below.
    document.documentElement.setAttribute('data-theme', variant);
  }

  /**
   * Writes the installed theme's scoped CSS.
   *
   * The built-in selection removes the element entirely: its values are already
   * in the generated stylesheet, so injecting a copy would only add a second
   * source of truth.
   */
  private _applyScopeStyle(variant: ResolvedThemeVariant): void {
    if (typeof document === 'undefined') {
      return;
    }
    const existing = document.getElementById(THEME_INJECTED_STYLE_ID);
    const { css, accessibilityChanges } = compileScopeStyle({
      installation: this.installedTheme,
      isBuiltInSelected: isBuiltInSelection(this.selection),
      variant,
      accessibility: this.accessibility,
    });
    this.accessibilityChanges = accessibilityChanges;
    if (css.length === 0) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
    style.id = THEME_INJECTED_STYLE_ID;
    // Only ever the trusted scope selector — the theme cannot influence it.
    style.textContent = css;
    if (existing === null) {
      document.head.append(style);
    }
    this.debug('applyScopeStyle', { variant, bytes: css.length });
  }

  /** Tracks the OS preference so `system` mode re-resolves live. */
  private _watchOsPreference(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    if (this._osQuery === undefined) {
      this._osQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
    this.osPrefersDark = this._osQuery.matches;
    if (this._osListener === undefined) {
      this._osListener = (event) => {
        this.osPrefersDark = event.matches;
        this._apply();
      };
      this._osQuery.addEventListener('change', this._osListener);
    }
  }
}

export const appearancePreferenceService: AppearancePreferenceServiceInterface =
  AppearancePreferenceService.create({ className: 'AppearancePreferenceService' });
