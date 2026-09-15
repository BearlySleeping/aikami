// packages/shared/constants/src/lib/game/theme.test.ts
//
// C-529 — the theme token allowlist and the bounded v1 limits are a security
// boundary, so their internal relationships are asserted here rather than
// trusted. The compiler, the client and the CLI all read this registry; a
// duplicated id or a limit that contradicts another limit would silently widen
// what an untrusted package can do.

import { describe, expect, test } from 'bun:test';
import {
  APPEARANCE_MODES,
  BUILTIN_THEME_IDS,
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_THEME_ID,
  THEME_API_MAJOR,
  THEME_API_VERSION,
  THEME_MAX_ALIAS_DEPTH,
  THEME_MAX_ARCHIVE_BYTES,
  THEME_MAX_ASSETS,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
  THEME_MAX_FONT_BYTES,
  THEME_MAX_FONT_FILES,
  THEME_MAX_MANIFEST_BYTES,
  THEME_MAX_RASTER_DIMENSION,
  THEME_MAX_RASTER_PIXELS,
  THEME_MAX_RESOLVED_TOKENS,
  THEME_MAX_TOKENS_JSON_BYTES,
  THEME_PACKAGE_PATH_PATTERN,
  THEME_TOKEN_BY_CSS_VARIABLE,
  THEME_TOKEN_BY_ID,
  THEME_TOKEN_GROUPS,
  THEME_TOKEN_IDS,
  THEME_TOKEN_REGISTRY,
  THEME_TOKEN_TYPES,
  THEME_VARIANTS,
  THEME_VERSION_PATTERN,
} from './theme.ts';

describe('C-529 theme token allowlist', () => {
  test('ships the documented semantic roles', () => {
    for (const id of [
      'color.base-100',
      'color.base-content',
      'color.muted-content',
      'color.primary',
      'color.primary-content',
      'color.error',
      'color.error-content',
      'color.focus-ring',
      'color.brass',
      'font.body',
      'weight.strong',
      'radius.box',
      'border.width',
      'duration.enter',
    ]) {
      expect(THEME_TOKEN_BY_ID.has(id)).toBe(true);
    }
  });

  test('covers every state role the contract names', () => {
    // Normal/hover/active/disabled/focus/error/loading are expressed through
    // these palette roles; a theme cannot invent new ones.
    for (const role of [
      'primary',
      'secondary',
      'accent',
      'neutral',
      'info',
      'success',
      'warning',
    ]) {
      expect(THEME_TOKEN_BY_ID.has(`color.${role}`)).toBe(true);
      expect(THEME_TOKEN_BY_ID.has(`color.${role}-content`)).toBe(true);
    }
  });

  test('every token id is unique', () => {
    expect(new Set(THEME_TOKEN_IDS).size).toBe(THEME_TOKEN_IDS.length);
  });

  test('every css variable is unique', () => {
    const variables = THEME_TOKEN_REGISTRY.map((token) => token.cssVariable);
    expect(new Set(variables).size).toBe(variables.length);
    expect(THEME_TOKEN_BY_CSS_VARIABLE.size).toBe(variables.length);
  });

  test('every entry declares a known type and group', () => {
    for (const token of THEME_TOKEN_REGISTRY) {
      expect(THEME_TOKEN_TYPES).toContain(token.type);
      expect(THEME_TOKEN_GROUPS).toContain(token.group);
      expect(token.label.length).toBeGreaterThan(0);
    }
  });

  test('every css variable is a plain custom property name', () => {
    for (const token of THEME_TOKEN_REGISTRY) {
      expect(token.cssVariable).toMatch(/^--ui-[a-z0-9-]+$/);
    }
  });

  test('token ids are dotted lowercase identifiers', () => {
    for (const id of THEME_TOKEN_IDS) {
      expect(id).toMatch(/^[a-z]+(\.[a-z0-9-]+)+$/);
    }
  });
});

describe('C-529 appearance modes and built-ins', () => {
  test('the three modes are system, light and dark', () => {
    expect([...APPEARANCE_MODES]).toEqual(['system', 'light', 'dark']);
  });

  test('the default mode follows the OS', () => {
    expect(APPEARANCE_MODES).toContain(DEFAULT_APPEARANCE_MODE);
    expect(DEFAULT_APPEARANCE_MODE).toBe('system');
  });

  test('the default theme is a shipped built-in', () => {
    expect(BUILTIN_THEME_IDS).toContain(DEFAULT_THEME_ID);
  });

  test('both variants are declarable', () => {
    expect([...THEME_VARIANTS]).toEqual(['light', 'dark']);
  });

  test('the api version matches the api major', () => {
    expect(THEME_API_VERSION.split('.')[0]).toBe(String(THEME_API_MAJOR));
  });
});

describe('C-529 bounded v1 limits', () => {
  test('the compressed archive fits inside the expanded ceiling', () => {
    expect(THEME_MAX_ARCHIVE_BYTES).toBeLessThan(THEME_MAX_EXPANDED_BYTES);
  });

  test('the manifest fits inside the expanded ceiling', () => {
    expect(THEME_MAX_MANIFEST_BYTES).toBeLessThan(THEME_MAX_EXPANDED_BYTES);
  });

  test('the aggregate token JSON fits inside the expanded ceiling', () => {
    expect(THEME_MAX_TOKENS_JSON_BYTES).toBeLessThan(THEME_MAX_EXPANDED_BYTES);
  });

  test('declared font bytes cannot exceed the expanded ceiling', () => {
    expect(THEME_MAX_FONT_FILES * THEME_MAX_FONT_BYTES).toBeLessThanOrEqual(
      THEME_MAX_EXPANDED_BYTES,
    );
  });

  test('declared raster pixels cannot exceed the expanded ceiling', () => {
    expect(THEME_MAX_RASTER_PIXELS).toBeLessThanOrEqual(THEME_MAX_EXPANDED_BYTES);
  });

  test('the alias depth bound is positive and smaller than the token bound', () => {
    expect(THEME_MAX_ALIAS_DEPTH).toBeGreaterThan(0);
    expect(THEME_MAX_ALIAS_DEPTH).toBeLessThan(THEME_MAX_RESOLVED_TOKENS);
  });

  test('the entry bound bounds the asset bound', () => {
    expect(THEME_MAX_ASSETS).toBeLessThanOrEqual(THEME_MAX_ENTRIES);
  });

  test('the aggregate pixel bound is finite and above one max-sized asset', () => {
    // Directive 10: each raster is ≤2048×2048 and the decoded total is 8M
    // pixels. The total must therefore be at least one max-sized asset and
    // still finite — it is the bound that stops a many-asset package.
    const perAsset = THEME_MAX_RASTER_DIMENSION * THEME_MAX_RASTER_DIMENSION;
    expect(THEME_MAX_RASTER_PIXELS).toBeGreaterThanOrEqual(perAsset);
    expect(Number.isFinite(THEME_MAX_RASTER_PIXELS)).toBe(true);
    expect(THEME_MAX_RASTER_PIXELS).toBeLessThan(THEME_MAX_ASSETS * perAsset);
  });

  test('the resolved-token bound covers the whole allowlist', () => {
    // A shipped built-in must never exceed its own bound.
    expect(THEME_TOKEN_IDS.length).toBeLessThanOrEqual(THEME_MAX_RESOLVED_TOKENS);
  });
});

describe('C-529 untrusted-input patterns', () => {
  test('the path pattern rejects traversal and absolute paths', () => {
    const pattern = new RegExp(THEME_PACKAGE_PATH_PATTERN);
    expect(pattern.test('tokens/light.json')).toBe(true);
    expect(pattern.test('../secrets.json')).toBe(false);
    expect(pattern.test('/etc/passwd')).toBe(false);
    expect(pattern.test('tokens\\light.json')).toBe(false);
    expect(pattern.test('a'.repeat(200))).toBe(false);
  });

  test('the version pattern accepts semver and rejects anything else', () => {
    const pattern = new RegExp(THEME_VERSION_PATTERN);
    expect(pattern.test('1.0.0')).toBe(true);
    expect(pattern.test('12.34.56')).toBe(true);
    expect(pattern.test('1.0')).toBe(false);
    expect(pattern.test('1.0.0-beta')).toBe(false);
    expect(pattern.test('latest')).toBe(false);
  });
});
