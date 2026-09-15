// apps/frontend/client/src/lib/services/settings/appearance_preference_service.test.ts
//
// C-529 AC-5/AC-6/AC-9 — the appearance authority.
//
// 🔴 Why the imports below are DYNAMIC with a distinct specifier.
//
// Every regression this guards is about what happens at CONSTRUCTION: a
// selection restored from storage, an installation restored from storage, and a
// corrupt/unknown one that must boot the built-in without destroying the bytes.
// Bun isolates each test FILE, so a static import would be evaluated before any
// `localStorage.setItem` and every assertion would be vacuous. Each scenario
// therefore imports the module through a fresh specifier, which is a genuine
// first evaluation of that module instance.
//
// (Do not add a static import of the service here.)

import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  DEFAULT_APPEARANCE_MODE,
  THEME_LAST_GOOD_STORAGE_KEY,
  THEME_SELECTION_STORAGE_KEY,
} from '@aikami/constants';
import type { ThemeInstallation } from '@aikami/schemas';
import type { AppearancePreferenceServiceInterface } from './appearance_preference_service.svelte.ts';

const loadService = async (scenario: string): Promise<AppearancePreferenceServiceInterface> => {
  const module = await import(`./appearance_preference_service.svelte.ts?scenario=${scenario}`);
  return (module as { appearancePreferenceService: AppearancePreferenceServiceInterface })
    .appearancePreferenceService;
};

const resetStorage = (): void => {
  localStorage.clear();
  sessionStorage.clear();
};

const selection = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  themeId: BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  version: '1.0.0',
  mode: 'system',
  ...overrides,
});

const installation = (id = 'community-theme'): ThemeInstallation =>
  ({
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      kind: 'aikami-theme',
      id,
      version: '2.0.0',
      themeApiRange: '>=1.0 <2.0',
      name: 'Community Theme',
      author: { displayName: 'Creator' },
      license: 'MIT',
      variants: {},
      assets: [],
    },
    variants: {
      light: {
        profileVersion: 1,
        variant: 'light',
        tokens: { 'color.primary': { $type: 'color', $value: '#123456' } },
      },
    },
  }) as ThemeInstallation;

describe('C-529 AC-9 construction-time restore', () => {
  test('with no stored selection the documented default applies', async () => {
    resetStorage();
    const service = await loadService('no-selection');
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(service.selection.mode).toBe(DEFAULT_APPEARANCE_MODE);
    expect(service.recoveryNotice).toBeUndefined();
  });

  test('a valid stored selection is adopted', async () => {
    resetStorage();
    localStorage.setItem(THEME_SELECTION_STORAGE_KEY, JSON.stringify(selection({ mode: 'dark' })));
    const service = await loadService('valid-selection');
    expect(service.selection.mode).toBe('dark');
    expect(service.resolvedVariant).toBe('dark');
  });

  test('a corrupt stored selection falls back with a repair notice', async () => {
    resetStorage();
    localStorage.setItem(THEME_SELECTION_STORAGE_KEY, '{ not json');
    const service = await loadService('corrupt-selection');
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(service.recoveryNotice).toBeDefined();
  });

  test('a selection naming an uninstalled theme boots the default and keeps the bytes', async () => {
    resetStorage();
    localStorage.setItem(
      THEME_SELECTION_STORAGE_KEY,
      JSON.stringify(selection({ themeId: 'someone-elses-theme' })),
    );
    const service = await loadService('unresolvable-selection');
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(service.recoveryNotice).toBeDefined();
    // The stored selection is NOT destructively rewritten.
    expect(localStorage.getItem(THEME_SELECTION_STORAGE_KEY)).toContain('someone-elses-theme');
  });

  test('a corrupt installation is inert and does not block boot', async () => {
    resetStorage();
    localStorage.setItem(THEME_LAST_GOOD_STORAGE_KEY, '{"schemaVersion":99}');
    const service = await loadService('corrupt-installation');
    expect(service.installedTheme).toBeUndefined();
    expect(service.recoveryNotice).toBeDefined();
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
  });

  test('a stored installation is adopted and offered in the picker', async () => {
    resetStorage();
    localStorage.setItem(THEME_LAST_GOOD_STORAGE_KEY, JSON.stringify(installation()));
    localStorage.setItem(
      THEME_SELECTION_STORAGE_KEY,
      JSON.stringify(selection({ themeId: 'community-theme', version: '2.0.0' })),
    );
    const service = await loadService('installed-theme');
    expect(service.installedTheme?.manifest.id).toBe('community-theme');
    expect(service.themeOptions.map((option) => option.id)).toEqual([
      BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
      'community-theme',
    ]);
  });
});

describe('C-529 AC-5 mode selection', () => {
  test('an explicit mode is persisted and resolved over the OS preference', async () => {
    resetStorage();
    const service = await loadService('set-mode');
    service.setMode('dark');
    expect(service.selection.mode).toBe('dark');
    expect(service.resolvedVariant).toBe('dark');
    expect(JSON.parse(localStorage.getItem(THEME_SELECTION_STORAGE_KEY) ?? '{}').mode).toBe('dark');
    service.setMode('light');
    expect(service.resolvedVariant).toBe('light');
  });

  test('system mode follows the reported OS preference', async () => {
    resetStorage();
    const service = await loadService('system-mode');
    service.osPrefersDark = true;
    expect(service.resolvedVariant).toBe('dark');
    service.osPrefersDark = false;
    expect(service.resolvedVariant).toBe('light');
  });

  test('an unknown theme id is not selectable', async () => {
    resetStorage();
    const service = await loadService('unknown-theme');
    service.selectTheme('does-not-exist');
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
  });
});

describe('C-529 AC-6 atomic install and recovery', () => {
  test('installing selects the theme and persists both records', async () => {
    resetStorage();
    const service = await loadService('install');
    expect(service.installTheme(installation())).toBe(true);
    expect(service.selection.themeId).toBe('community-theme');
    expect(service.selection.version).toBe('2.0.0');
    expect(localStorage.getItem(THEME_LAST_GOOD_STORAGE_KEY)).toContain('community-theme');
  });

  test('an installation with no variant is refused, so no partial theme activates', async () => {
    resetStorage();
    const service = await loadService('install-no-variant');
    const empty = { ...installation(), variants: {} } as ThemeInstallation;
    expect(service.installTheme(empty)).toBe(false);
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(service.installedTheme).toBeUndefined();
  });

  test('a theme missing the resolved variant reports the built-in fallback', async () => {
    resetStorage();
    const service = await loadService('variant-fallback');
    service.installTheme(installation());
    service.setMode('dark');
    expect(service.isUsingBuiltinFallbackVariant).toBe(true);
    service.setMode('light');
    expect(service.isUsingBuiltinFallbackVariant).toBe(false);
  });

  test('uninstalling reverts safely to the shipped default', async () => {
    resetStorage();
    const service = await loadService('uninstall');
    service.installTheme(installation());
    service.uninstallTheme();
    expect(service.installedTheme).toBeUndefined();
    expect(service.selection.themeId).toBe(BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE);
    expect(localStorage.getItem(THEME_LAST_GOOD_STORAGE_KEY)).toBeNull();
  });

  test('restore defaults is always available and clears the notice', async () => {
    resetStorage();
    localStorage.setItem(THEME_SELECTION_STORAGE_KEY, 'broken');
    const service = await loadService('restore-defaults');
    expect(service.recoveryNotice).toBeDefined();
    service.restoreDefaults();
    expect(service.recoveryNotice).toBeUndefined();
    expect(service.selection.mode).toBe(DEFAULT_APPEARANCE_MODE);
  });

  test('appearance selection never touches HUD or motion keys', async () => {
    resetStorage();
    localStorage.setItem('aikami:hud:preferences', '{"schemaVersion":1}');
    localStorage.setItem('aikami:motion:preference', 'reduce');
    const service = await loadService('independent-keys');
    service.setMode('dark');
    service.installTheme(installation());
    expect(localStorage.getItem('aikami:hud:preferences')).toBe('{"schemaVersion":1}');
    expect(localStorage.getItem('aikami:motion:preference')).toBe('reduce');
  });
});
