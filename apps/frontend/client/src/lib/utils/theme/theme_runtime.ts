// apps/frontend/client/src/lib/utils/theme/theme_runtime.ts
//
// C-529 — pure appearance-runtime helpers.
//
// Everything here is a pure function of its arguments: which variant an
// appearance mode resolves to, and what CSS an installation contributes to the
// game scope. The DOM work (writing attributes, injecting a `<style>`) lives in
// the service so this module stays testable without a browser.
//
// Contract: C-529 AC-5 (explicit mode + accessibility precedence), AC-6 (atomic
// apply and recovery), AC-9 (upgrade continuity).

import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_VERSION,
  DEFAULT_APPEARANCE_MODE,
  THEME_SCOPE_ATTRIBUTE,
  THEME_SCOPE_VARIANT_ATTRIBUTE,
  THEME_SELECTION_SCHEMA_VERSION,
} from '@aikami/constants';
import {
  compileThemeTokenFile,
  OBSIDIAN_CHRONICLE_DARK,
  OBSIDIAN_CHRONICLE_LIGHT,
  serializeScopeRule,
} from '@aikami/frontend/theme';
import type {
  AppearanceMode,
  ThemeInstallation,
  ThemeSelection,
  ThemeVariant,
} from '@aikami/schemas';

/** The resolved variant actually rendered for the trusted app chrome. */
export type ResolvedThemeVariant = ThemeVariant;

/**
 * Turns an appearance mode into a concrete variant.
 *
 * `system` follows the OS; `light`/`dark` are explicit and therefore win over
 * the OS preference. A custom theme id is never an appearance mode.
 */
export const resolveThemeVariant = (
  mode: AppearanceMode,
  osPrefersDark: boolean,
): ResolvedThemeVariant => {
  if (mode === 'system') {
    return osPrefersDark ? 'dark' : 'light';
  }
  return mode;
};

/** The documented default selection: refined Obsidian Chronicle + OS mode. */
export const defaultThemeSelection = (): ThemeSelection => ({
  schemaVersion: THEME_SELECTION_SCHEMA_VERSION,
  themeId: BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  version: BUILTIN_THEME_VERSION,
  mode: DEFAULT_APPEARANCE_MODE,
});

/** The built-in theme, described for the picker. */
export const BUILTIN_THEME_OPTION = {
  id: BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  name: BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
  version: BUILTIN_THEME_VERSION,
} as const;

/** True when the selection points at a shipped theme. */
export const isBuiltInSelection = (selection: ThemeSelection): boolean =>
  selection.themeId === BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE;

/** Selector for the game shell / preview root a theme may repaint. */
export const themeScopeSelector = `[${THEME_SCOPE_ATTRIBUTE}]`;

/** The two scope attributes the runtime writes on the game shell. */
export const scopeAttributes = (variant: ResolvedThemeVariant): Record<string, string> => ({
  [THEME_SCOPE_ATTRIBUTE]: '',
  [THEME_SCOPE_VARIANT_ATTRIBUTE]: variant,
});

/** One compiled scope contribution. */
export type ScopeCss = {
  readonly css: string;
  /**
   * `theme` when the installation declared this variant; `builtin` when it did
   * not and the documented built-in variant was used instead while the selected
   * theme identity is retained.
   */
  readonly source: 'theme' | 'builtin';
};

/** Compiles a built-in variant into a scoped rule (the fallback path). */
const builtinScopeCss = (variant: ResolvedThemeVariant): ScopeCss => {
  const file = variant === 'dark' ? OBSIDIAN_CHRONICLE_DARK : OBSIDIAN_CHRONICLE_LIGHT;
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    // Unreachable: the built-in source is validated at build time. Returning an
    // empty contribution keeps the scope on the inherited `:root` values rather
    // than half-applying a broken palette.
    return { css: '', source: 'builtin' };
  }
  return {
    css: serializeScopeRule(themeScopeSelector, compilation.declarations),
    source: 'builtin',
  };
};

/**
 * Compiles the CSS an installation contributes to the game scope for a variant.
 *
 * A theme that declares only one variant still renders both: the missing one
 * falls back to the built-in variant of the same appearance while the theme
 * identity is retained (Directive 4). The caller is told which path was taken so
 * the UI can say so instead of silently pretending the creator shipped both.
 */
export const compileInstallationScopeCss = (
  installation: ThemeInstallation,
  variant: ResolvedThemeVariant,
): ScopeCss => {
  const file = installation.variants[variant];
  if (file === undefined) {
    return builtinScopeCss(variant);
  }
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    return builtinScopeCss(variant);
  }
  return {
    css: serializeScopeRule(themeScopeSelector, compilation.declarations),
    source: 'theme',
  };
};

/** The variants an installation can render from its own bytes. */
export const installationVariants = (installation: ThemeInstallation): readonly ThemeVariant[] =>
  (['light', 'dark'] as const).filter((variant) => installation.variants[variant] !== undefined);

/**
 * Whether a stored selection is usable by this build.
 *
 * A theme id this build does not ship and has no installation for is *not*
 * usable — the caller falls back to the built-in and keeps the bytes intact for
 * a later compatible client.
 */
export const isSelectionResolvable = (
  selection: ThemeSelection,
  installedThemeId: string | undefined,
): boolean => isBuiltInSelection(selection) || selection.themeId === installedThemeId;
