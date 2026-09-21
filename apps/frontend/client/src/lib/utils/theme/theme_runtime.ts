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
  buildAccessibilityDeclarations,
  compileThemeTokenFile,
  DEFAULT_THEME_ACCESSIBILITY_OVERRIDES,
  OBSIDIAN_CHRONICLE_DARK,
  OBSIDIAN_CHRONICLE_LIGHT,
  serializeScopeRule,
  type ThemeAccessibilityOverrides,
  type ThemeDeclaration,
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

/**
 * The full scoped stylesheet contribution for one variant.
 *
 * Order is the contract's appearance precedence (Directive 5): the selected
 * variant first, then explicit personal accessibility overrides LAST so they
 * win. `:root` and the game scope are written separately because they can hold
 * different palettes — `:root` always carries the built-in variant, while the
 * scope may carry an installed theme — and an override computed from the wrong
 * palette would be nonsense.
 */
export type ScopeStyle = {
  readonly css: string;
  /** `theme` when the installation declared this variant; `builtin` otherwise. */
  readonly source: 'theme' | 'builtin';
  /** Token ids the accessibility overrides actually changed (empty when none). */
  readonly accessibilityChanges: readonly string[];
};

/** Compiles one variant of a built-in theme into declarations. */
const builtinDeclarations = (variant: ResolvedThemeVariant): readonly ThemeDeclaration[] => {
  const file = variant === 'dark' ? OBSIDIAN_CHRONICLE_DARK : OBSIDIAN_CHRONICLE_LIGHT;
  const compilation = compileThemeTokenFile(file);
  // Unreachable: the built-in source is validated at build time. Returning no
  // declarations keeps the scope on the inherited `:root` values rather than
  // half-applying a broken palette.
  return compilation.ok ? compilation.declarations : [];
};

const declarationsFor = (
  installation: ThemeInstallation | undefined,
  isBuiltInSelected: boolean,
  variant: ResolvedThemeVariant,
): { declarations: readonly ThemeDeclaration[]; source: 'theme' | 'builtin' } => {
  if (installation === undefined || isBuiltInSelected) {
    return { declarations: builtinDeclarations(variant), source: 'builtin' };
  }
  const file = installation.variants[variant];
  if (file === undefined) {
    return { declarations: builtinDeclarations(variant), source: 'builtin' };
  }
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    return { declarations: builtinDeclarations(variant), source: 'builtin' };
  }
  return { declarations: compilation.declarations, source: 'theme' };
};

/**
 * Builds the complete stylesheet the runtime injects.
 *
 * Returns an empty `css` when there is nothing to inject (built-in theme and no
 * accessibility override) so the caller removes the element entirely instead of
 * keeping a second source of truth for the built-in palette.
 */
export const compileScopeStyle = (options: {
  readonly installation: ThemeInstallation | undefined;
  readonly isBuiltInSelected: boolean;
  readonly variant: ResolvedThemeVariant;
  readonly accessibility?: ThemeAccessibilityOverrides;
}): ScopeStyle => {
  const accessibility = options.accessibility ?? DEFAULT_THEME_ACCESSIBILITY_OVERRIDES;
  const { declarations, source } = declarationsFor(
    options.installation,
    options.isBuiltInSelected,
    options.variant,
  );

  const parts: string[] = [];
  if (source === 'theme') {
    parts.push(serializeScopeRule(themeScopeSelector, declarations));
  }

  // Accessibility policy is applied last, on both surfaces, from the palette
  // each surface actually holds.
  const rootChanges = buildAccessibilityDeclarations(
    builtinDeclarations(options.variant),
    accessibility,
  );
  const scopeChanges = buildAccessibilityDeclarations(declarations, accessibility);
  if (rootChanges.length > 0) {
    parts.push(serializeScopeRule(':root', rootChanges));
  }
  if (scopeChanges.length > 0) {
    parts.push(serializeScopeRule(themeScopeSelector, scopeChanges));
  }

  return {
    css: parts.join(''),
    source,
    accessibilityChanges: scopeChanges.map((entry) => entry.tokenId),
  };
};

/**
 * Compiles the CSS an installation contributes to the game scope for a variant.
 *
 * Kept as the installation-only view of {@link compileScopeStyle} for callers
 * that do not deal with accessibility overrides.
 */
export const compileInstallationScopeCss = (
  installation: ThemeInstallation,
  variant: ResolvedThemeVariant,
): ScopeStyle => compileScopeStyle({ installation, isBuiltInSelected: false, variant });

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
