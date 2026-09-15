// apps/frontend/client/src/lib/utils/theme/theme_runtime.test.ts
//
// C-529 AC-5 (explicit mode + accessibility precedence) and AC-9 (upgrade
// continuity) — the appearance runtime is pure, so the precedence rules are
// asserted directly: an explicit mode always beats the OS, a theme with one
// variant still renders both without pretending to have shipped them, and a
// selection naming a theme this device does not have is not resolvable.

import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_VERSION,
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_THEME_ID,
} from '@aikami/constants';
import { parseThemeInstallation } from '@aikami/schemas';
import {
  compileInstallationScopeCss,
  defaultThemeSelection,
  installationVariants,
  isBuiltInSelection,
  isSelectionResolvable,
  resolveThemeVariant,
  themeScopeSelector,
} from './theme_runtime.ts';

const installation = (variants: { light?: unknown; dark?: unknown }, id = 'my-theme') =>
  parseThemeInstallation({
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      kind: 'aikami-theme',
      id,
      version: '1.0.0',
      themeApiRange: '>=1.0 <2.0',
      name: 'My theme',
      author: { displayName: 'Creator' },
      license: 'MIT',
      variants: {},
      assets: [],
    },
    variants,
  });

const lightTokens = {
  profileVersion: 1,
  variant: 'light',
  tokens: { 'color.primary': { $type: 'color', $value: 'oklch(0.52 0.22 285)' } },
};

const darkTokens = {
  profileVersion: 1,
  variant: 'dark',
  tokens: { 'color.primary': { $type: 'color', $value: 'oklch(0.65 0.22 285)' } },
};

describe('C-529 AC-5 explicit mode precedence', () => {
  test('system follows the OS in both directions', () => {
    expect(resolveThemeVariant('system', false)).toBe('light');
    expect(resolveThemeVariant('system', true)).toBe('dark');
  });

  test('an explicit mode wins over a conflicting OS preference', () => {
    expect(resolveThemeVariant('light', true)).toBe('light');
    expect(resolveThemeVariant('dark', false)).toBe('dark');
  });
});

describe('C-529 AC-9 upgrade continuity defaults', () => {
  test('the default is refined Obsidian Chronicle with OS mode', () => {
    const selection = defaultThemeSelection();
    expect(selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(selection.themeId).toBe(DEFAULT_THEME_ID);
    expect(selection.version).toBe(BUILTIN_THEME_VERSION);
    expect(selection.mode).toBe(DEFAULT_APPEARANCE_MODE);
  });

  test('the built-in selection needs no installation', () => {
    expect(isBuiltInSelection(defaultThemeSelection())).toBe(true);
    expect(isSelectionResolvable(defaultThemeSelection(), undefined)).toBe(true);
  });

  test('a selection naming an uninstalled theme is not resolvable', () => {
    const selection = { ...defaultThemeSelection(), themeId: 'someone-elses-theme' };
    expect(isSelectionResolvable(selection, undefined)).toBe(false);
    expect(isSelectionResolvable(selection, 'someone-elses-theme')).toBe(true);
  });
});

describe('C-529 scoped application', () => {
  test('the scope selector is the trusted attribute, never a theme value', () => {
    expect(themeScopeSelector).toBe('[data-aikami-theme-scope]');
  });

  test('a declared variant compiles to a scoped rule', () => {
    const parsed = installation({ light: lightTokens });
    expect(parsed).toBeDefined();
    if (parsed === undefined) {
      return;
    }
    const scoped = compileInstallationScopeCss(parsed, 'light');
    expect(scoped.source).toBe('theme');
    expect(scoped.css.startsWith(`${themeScopeSelector} {`)).toBe(true);
    expect(scoped.css).toContain('--ui-primary: oklch(0.52 0.22 285);');
  });

  test('a missing variant falls back to the built-in variant while the theme stays selected', () => {
    const parsed = installation({ light: lightTokens });
    if (parsed === undefined) {
      return;
    }
    const scoped = compileInstallationScopeCss(parsed, 'dark');
    expect(scoped.source).toBe('builtin');
    // The built-in dark palette, not the theme's light one.
    expect(scoped.css).toContain('--ui-primary: oklch(0.65 0.22 285);');
    expect(installationVariants(parsed)).toEqual(['light']);
  });

  test('a theme declaring both variants uses its own for each', () => {
    const parsed = installation({ light: lightTokens, dark: darkTokens });
    if (parsed === undefined) {
      return;
    }
    expect(installationVariants(parsed)).toEqual(['light', 'dark']);
    expect(compileInstallationScopeCss(parsed, 'light').source).toBe('theme');
    expect(compileInstallationScopeCss(parsed, 'dark').source).toBe('theme');
    expect(compileInstallationScopeCss(parsed, 'dark').css).toContain(
      '--ui-primary: oklch(0.65 0.22 285);',
    );
  });

  test('a theme cannot inject a selector — every rule is the trusted scope', () => {
    const hostile = installation({
      light: {
        profileVersion: 1,
        variant: 'light',
        tokens: { 'color.primary': { $type: 'color', $value: '#ff0000' } },
      },
    });
    if (hostile === undefined) {
      return;
    }
    const css = compileInstallationScopeCss(hostile, 'light').css;
    expect(css.split('{').length).toBe(2);
    expect(css).not.toContain('html');
    expect(css).not.toContain('@');
  });
});
