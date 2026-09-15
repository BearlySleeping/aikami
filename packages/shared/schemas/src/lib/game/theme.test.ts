// packages/shared/schemas/src/lib/game/theme.test.ts
//
// C-529 — the theme manifest, token file and selection are untrusted input, so
// the parsers are asserted to *reject* rather than coerce: oversized payloads,
// traversal paths, duplicate/case-colliding assets, unknown token kinds, a
// package with no variant at all, and an appearance mode smuggled into a theme
// id.

import { describe, expect, test } from 'bun:test';
import { APPEARANCE_MODES, THEME_TOKEN_TYPES, THEME_VARIANTS } from '@aikami/constants';
import { Value } from 'typebox/value';
import {
  AppearanceModeSchema,
  hasDuplicateAssetPaths,
  isThemeManifestJsonWithinSizeLimit,
  isThemeTokensJsonWithinSizeLimit,
  parseThemePackageManifest,
  parseThemePackageManifestJson,
  parseThemeSelection,
  parseThemeSelectionJson,
  parseThemeTokenFile,
  parseThemeTokenFileJson,
  THEME_MANIFEST_JSON_MAX_LENGTH,
  THEME_TOKENS_JSON_MAX_LENGTH,
  ThemeTokenTypeSchema,
  ThemeVariantSchema,
} from './theme.ts';

const SHA = 'a'.repeat(64);

const validManifest = () => ({
  schemaVersion: 1,
  kind: 'aikami-theme',
  id: 'obsidian-chronicle',
  version: '1.0.0',
  themeApiRange: '>=1.0 <2.0',
  name: 'Obsidian Chronicle',
  author: { displayName: 'Aikami' },
  license: 'MIT',
  variants: { light: 'tokens/light.json', dark: 'tokens/dark.json' },
  assets: [],
});

const validTokenFile = () => ({
  profileVersion: 1,
  variant: 'light',
  tokens: {
    'color.base-100': { $type: 'color', $value: 'oklch(0.985 0.006 270)' },
    'color.primary': { $type: 'color', $value: '{color.base-100}' },
    'radius.box': { $type: 'dimension', $value: '0.5rem' },
    'weight.strong': { $type: 'fontWeight', $value: 700 },
    'font.body': { $type: 'fontFamily', $value: 'sans' },
    'duration.enter': { $type: 'duration', $value: '160ms' },
  },
});

describe('C-529 theme schema/constant alignment', () => {
  // The TypeBox literal tuples are declared explicitly (a `readonly string[]`
  // cannot infer a union), so this is the guard that stops them drifting from
  // the shared constants the compiler and the editor both read.
  test('every declared token kind is accepted by the schema', () => {
    for (const tokenType of THEME_TOKEN_TYPES) {
      expect(Value.Check(ThemeTokenTypeSchema, tokenType)).toBe(true);
    }
    expect(Value.Check(ThemeTokenTypeSchema, 'expression')).toBe(false);
  });

  test('every declared variant is accepted by the schema', () => {
    for (const variant of THEME_VARIANTS) {
      expect(Value.Check(ThemeVariantSchema, variant)).toBe(true);
    }
    expect(Value.Check(ThemeVariantSchema, 'sepia')).toBe(false);
  });

  test('every appearance mode is accepted by the schema', () => {
    for (const mode of APPEARANCE_MODES) {
      expect(Value.Check(AppearanceModeSchema, mode)).toBe(true);
    }
    expect(Value.Check(AppearanceModeSchema, 'auto')).toBe(false);
  });
});

describe('C-529 theme package manifest', () => {
  test('accepts the documented envelope', () => {
    const parsed = parseThemePackageManifest(validManifest());
    expect(parsed?.id).toBe('obsidian-chronicle');
    expect(parsed?.variants.light).toBe('tokens/light.json');
  });

  test('rejects a manifest with no variant at all', () => {
    expect(parseThemePackageManifest({ ...validManifest(), variants: {} })).toBeUndefined();
  });

  test('rejects an unknown kind', () => {
    expect(parseThemePackageManifest({ ...validManifest(), kind: 'aikami-mod' })).toBeUndefined();
  });

  test('rejects traversal and absolute asset paths', () => {
    for (const path of ['../secrets.json', '/etc/passwd', 'tokens\\light.json']) {
      expect(
        parseThemePackageManifest({
          ...validManifest(),
          assets: [{ path, mediaType: 'image/png', bytes: 10, sha256: SHA }],
        }),
      ).toBeUndefined();
    }
  });

  test('rejects non-canonical paths in every manifest path field', () => {
    for (const path of [
      '../escape.json',
      'tokens/../escape.json',
      'tokens//light.json',
      'tokens/',
    ]) {
      expect(
        parseThemePackageManifest({ ...validManifest(), variants: { light: path } }),
      ).toBeUndefined();
      expect(parseThemePackageManifest({ ...validManifest(), preview: path })).toBeUndefined();
      expect(parseThemePackageManifest({ ...validManifest(), hudPreset: path })).toBeUndefined();
    }
  });

  test('rejects a duplicate or case-colliding asset path', () => {
    const asset = { path: 'assets/ornament.png', mediaType: 'image/png', bytes: 10, sha256: SHA };
    expect(
      parseThemePackageManifest({ ...validManifest(), assets: [asset, { ...asset }] }),
    ).toBeUndefined();
    expect(
      parseThemePackageManifest({
        ...validManifest(),
        assets: [asset, { ...asset, path: 'ASSETS/Ornament.PNG' }],
      }),
    ).toBeUndefined();
  });

  test('rejects a non-hex sha256 and a zero-byte asset', () => {
    expect(
      parseThemePackageManifest({
        ...validManifest(),
        assets: [{ path: 'a.png', mediaType: 'image/png', bytes: 10, sha256: 'nope' }],
      }),
    ).toBeUndefined();
    expect(
      parseThemePackageManifest({
        ...validManifest(),
        assets: [{ path: 'a.png', mediaType: 'image/png', bytes: 0, sha256: SHA }],
      }),
    ).toBeUndefined();
  });

  test('rejects an id that looks like an appearance mode', () => {
    for (const id of ['Dark', 'dark theme', '../dark', '']) {
      expect(parseThemePackageManifest({ ...validManifest(), id })).toBeUndefined();
    }
  });

  test('rejects a version that is not semver', () => {
    for (const version of ['1.0', 'latest', '1.0.0-beta']) {
      expect(parseThemePackageManifest({ ...validManifest(), version })).toBeUndefined();
    }
  });

  test('rejects unknown envelope fields', () => {
    expect(parseThemePackageManifest({ ...validManifest(), script: 'alert(1)' })).toBeUndefined();
  });

  test('bounds manifest text before parsing', () => {
    expect(isThemeManifestJsonWithinSizeLimit('a'.repeat(THEME_MANIFEST_JSON_MAX_LENGTH))).toBe(
      true,
    );
    expect(isThemeManifestJsonWithinSizeLimit('a'.repeat(THEME_MANIFEST_JSON_MAX_LENGTH + 1))).toBe(
      false,
    );
    expect(
      parseThemePackageManifestJson('a'.repeat(THEME_MANIFEST_JSON_MAX_LENGTH + 1)),
    ).toBeUndefined();
  });

  test('parses valid manifest JSON and rejects malformed JSON without throwing', () => {
    expect(parseThemePackageManifestJson(JSON.stringify(validManifest()))?.name).toBe(
      'Obsidian Chronicle',
    );
    expect(parseThemePackageManifestJson('{ not json')).toBeUndefined();
  });

  test('duplicate detection is case-insensitive', () => {
    expect(hasDuplicateAssetPaths([{ path: 'A/b.png' }, { path: 'a/B.PNG' }])).toBe(true);
    expect(hasDuplicateAssetPaths([{ path: 'a.png' }, { path: 'b.png' }])).toBe(false);
  });
});

describe('C-529 theme token file', () => {
  test('accepts the documented typed values', () => {
    const parsed = parseThemeTokenFile(validTokenFile());
    expect(parsed?.variant).toBe('light');
    expect(parsed?.tokens['weight.strong']?.$value).toBe(700);
  });

  test('rejects an unknown value kind', () => {
    expect(
      parseThemeTokenFile({
        ...validTokenFile(),
        tokens: { 'color.primary': { $type: 'expression', $value: 'calc(1px + 1px)' } },
      }),
    ).toBeUndefined();
  });

  test('rejects an unknown variant', () => {
    expect(parseThemeTokenFile({ ...validTokenFile(), variant: 'sepia' })).toBeUndefined();
  });

  test('rejects unknown fields on a token value', () => {
    expect(
      parseThemeTokenFile({
        ...validTokenFile(),
        tokens: { 'color.primary': { $type: 'color', $value: '#fff', url: 'https://x' } },
      }),
    ).toBeUndefined();
  });

  test('rejects an empty token value', () => {
    expect(
      parseThemeTokenFile({
        ...validTokenFile(),
        tokens: { 'color.primary': { $type: 'color', $value: '' } },
      }),
    ).toBeUndefined();
  });

  test('bounds token JSON before parsing', () => {
    expect(parseThemeTokenFileJson('a'.repeat(THEME_TOKENS_JSON_MAX_LENGTH + 1))).toBeUndefined();
    expect(isThemeTokensJsonWithinSizeLimit(JSON.stringify(validTokenFile()))).toBe(true);
  });

  test('parses valid token JSON and rejects malformed JSON without throwing', () => {
    expect(parseThemeTokenFileJson(JSON.stringify(validTokenFile()))?.variant).toBe('light');
    expect(parseThemeTokenFileJson('[]')).toBeUndefined();
  });
});

describe('C-529 appearance selection', () => {
  test('accepts the documented selection', () => {
    const parsed = parseThemeSelection({
      schemaVersion: 1,
      themeId: 'obsidian-chronicle',
      version: '1.0.0',
      mode: 'system',
    });
    expect(parsed?.mode).toBe('system');
  });

  test('rejects an appearance mode used as a theme id', () => {
    expect(
      parseThemeSelection({
        schemaVersion: 1,
        themeId: 'dark',
        version: '1.0.0',
        mode: 'dark',
      })?.themeId,
    ).toBe('dark');
  });

  test('rejects an unknown mode', () => {
    expect(
      parseThemeSelection({
        schemaVersion: 1,
        themeId: 'obsidian-chronicle',
        version: '1.0.0',
        mode: 'sepia',
      }),
    ).toBeUndefined();
  });

  test('rejects a future schema version', () => {
    expect(
      parseThemeSelection({
        schemaVersion: 2,
        themeId: 'obsidian-chronicle',
        version: '1.0.0',
        mode: 'system',
      }),
    ).toBeUndefined();
  });

  test('never carries private preferences', () => {
    const parsed = parseThemeSelection({
      schemaVersion: 1,
      themeId: 'obsidian-chronicle',
      version: '1.0.0',
      mode: 'system',
      accessibility: { highContrast: true },
    });
    expect(parsed).toBeUndefined();
  });

  test('parses selection JSON and rejects malformed JSON without throwing', () => {
    expect(
      parseThemeSelectionJson(
        JSON.stringify({
          schemaVersion: 1,
          themeId: 'obsidian-chronicle',
          version: '1.0.0',
          mode: 'dark',
        }),
      )?.mode,
    ).toBe('dark');
    expect(parseThemeSelectionJson('nope')).toBeUndefined();
  });
});
