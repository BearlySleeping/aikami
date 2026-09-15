// packages/frontend/theme/src/lib/theme/theme_compiler.test.ts
//
// C-529 — the compiler is the security boundary, so it is tested against the
// adversarial inputs the contract names: forbidden constructs, alias cycles and
// excessive depth, out-of-range numbers, unallowlisted tokens, MIME mismatch,
// path traversal, missing entries, hash mismatch, unsupported major API and
// decompression bombs.

import { describe, expect, test } from 'bun:test';
import type { ThemeTokenFile } from '@aikami/schemas';
import { OBSIDIAN_CHRONICLE_DARK, OBSIDIAN_CHRONICLE_LIGHT } from './builtin_theme.ts';
import { contrastRatio, parseColor, roundContrast } from './theme_color.ts';
import {
  CONTRAST_GATES,
  checkThemeContrast,
  compileThemeTokenFile,
  compileThemeTokenFileJson,
  FONT_ROLE_STACKS,
  HIGH_CONTRAST_GATE,
  isThemeableToken,
  measureThemeContrast,
  serializeScopeRule,
} from './theme_compiler.ts';
import { BUILTIN_THEME_RENDERABLE_VARIANTS } from './theme_css_generator.ts';
import { readImageDimensions } from './theme_image.ts';
import {
  isCanonicalPackagePath,
  isThemeApiRangeSupported,
  type ThemePackageReader,
  validateThemePackage,
} from './theme_package_validation.ts';

const tokenFile = (tokens: ThemeTokenFile['tokens'], variant: 'light' | 'dark' = 'light') =>
  ({ profileVersion: 1, variant, tokens }) as ThemeTokenFile;

describe('C-529 compiler — typed values', () => {
  test('accepts every documented value kind', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({
        'color.primary': { $type: 'color', $value: 'oklch(0.52 0.22 285)' },
        'radius.box': { $type: 'dimension', $value: '0.5rem' },
        'duration.enter': { $type: 'duration', $value: '160ms' },
        'font.body': { $type: 'fontFamily', $value: 'sans' },
        'weight.strong': { $type: 'fontWeight', $value: 700 },
      }),
    );
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) {
      return;
    }
    expect(compilation.declarations).toHaveLength(5);
    expect(compilation.css).toContain('--ui-primary: oklch(0.52 0.22 285);');
    expect(compilation.css).toContain(`--ui-font-body: ${FONT_ROLE_STACKS.sans};`);
  });

  test('rejects a token that is not on the allowlist', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.not-a-role': { $type: 'color', $value: '#fff' } }),
    );
    expect(compilation.ok).toBe(false);
    if (compilation.ok) {
      return;
    }
    expect(compilation.issues[0]?.code).toBe('token.not-allowlisted');
    expect(isThemeableToken('color.not-a-role')).toBe(false);
  });

  test('rejects a declared kind that contradicts the allowlist', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.primary': { $type: 'dimension', $value: '4px' } }),
    );
    expect(compilation.ok).toBe(false);
  });
});

describe('C-529 compiler — forbidden constructs', () => {
  const forbidden = [
    'var(--evil)',
    'url(https://evil.example/x.png)',
    'calc(1px + 1px)',
    'expression(alert(1))',
    'rgb(1,2,3); background: url(https://evil)',
    'red',
    'color-mix(in oklch, red, blue)',
    'light-dark(#fff, #000)',
  ];

  test('rejects every non-literal color construct', () => {
    for (const value of forbidden) {
      const compilation = compileThemeTokenFile(
        tokenFile({ 'color.primary': { $type: 'color', $value: value } }),
      );
      expect(compilation.ok).toBe(false);
    }
  });

  test('rejects an arbitrary font family string', () => {
    // A family string is exactly how a remote font would be requested.
    for (const value of ['Inter', 'My Font', 'https://evil.example/f.woff2', 'sans-serif']) {
      const compilation = compileThemeTokenFile(
        tokenFile({ 'font.body': { $type: 'fontFamily', $value: value } }),
      );
      expect(compilation.ok).toBe(false);
    }
  });

  test('rejects an out-of-range dimension and duration', () => {
    for (const value of ['9999px', '1vh', '-4px', '4', '4px 4px', 'auto']) {
      expect(
        compileThemeTokenFile(tokenFile({ 'radius.box': { $type: 'dimension', $value: value } }))
          .ok,
      ).toBe(false);
    }
    for (const value of ['99999ms', '4', '40s', '-4ms', '4min']) {
      expect(
        compileThemeTokenFile(tokenFile({ 'duration.enter': { $type: 'duration', $value: value } }))
          .ok,
      ).toBe(false);
    }
  });

  test('rejects an out-of-range or off-grid font weight', () => {
    for (const value of [50, 950, 450, 0, -700]) {
      expect(
        compileThemeTokenFile(tokenFile({ 'weight.body': { $type: 'fontWeight', $value: value } }))
          .ok,
      ).toBe(false);
    }
  });

  test('compiles malformed JSON to a diagnostic instead of throwing', () => {
    const compilation = compileThemeTokenFileJson('{ not json');
    expect(compilation.ok).toBe(false);
  });
});

describe('C-529 compiler — aliases', () => {
  test('resolves a valid alias to the referenced value', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({
        'color.base-100': { $type: 'color', $value: '#ffffff' },
        'color.primary-content': { $type: 'color', $value: '{color.base-100}' },
      }),
    );
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) {
      return;
    }
    expect(compilation.css).toContain('--ui-primary-content: #ffffff;');
  });

  test('rejects a self-referential cycle', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.primary': { $type: 'color', $value: '{color.primary}' } }),
    );
    expect(compilation.ok).toBe(false);
    if (compilation.ok) {
      return;
    }
    expect(compilation.issues.map((entry) => entry.code)).toContain('token.alias-cycle');
  });

  test('rejects a two-token cycle', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({
        'color.primary': { $type: 'color', $value: '{color.secondary}' },
        'color.secondary': { $type: 'color', $value: '{color.primary}' },
      }),
    );
    expect(compilation.ok).toBe(false);
  });

  test('rejects an alias to an unknown token', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.primary': { $type: 'color', $value: '{color.nope}' } }),
    );
    expect(compilation.ok).toBe(false);
  });

  test('rejects an alias to an allowlisted token that is not declared', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.primary': { $type: 'color', $value: '{color.base-100}' } }),
    );
    expect(compilation.ok).toBe(false);
    if (compilation.ok) {
      return;
    }
    expect(compilation.issues.map((entry) => entry.code)).toContain(
      'token.alias-unresolved-target',
    );
  });

  test('rejects an alias that crosses value kinds', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({
        'radius.box': { $type: 'dimension', $value: '0.5rem' },
        'color.primary': { $type: 'color', $value: '{radius.box}' },
      }),
    );
    expect(compilation.ok).toBe(false);
  });

  test('rejects an alias chain deeper than the limit', () => {
    // Ordered deepest-first so the walk is not short-circuited by the resolved
    // cache: the head has to reach the literal through the whole chain.
    const chain = [
      'color.accent',
      'color.secondary',
      'color.primary',
      'color.error-content',
      'color.warning-content',
      'color.success-content',
      'color.info-content',
      'color.neutral-content',
      'color.accent-content',
      'color.secondary-content',
      'color.primary-content',
      'color.muted-content',
      'color.base-content',
      'color.ink',
      'color.elevated',
      'color.panel',
      'color.base-300',
      'color.base-200',
    ];
    const tokens: ThemeTokenFile['tokens'] = {
      'color.base-100': { $type: 'color', $value: '#ffffff' },
    };
    chain.forEach((id, index) => {
      tokens[id] = {
        $type: 'color',
        $value: `{${chain[index + 1] ?? 'color.base-100'}}`,
      };
    });
    const compilation = compileThemeTokenFile(tokenFile(tokens));
    expect(compilation.ok).toBe(false);
    if (compilation.ok) {
      return;
    }
    expect(compilation.issues.map((entry) => entry.code)).toContain('token.alias-too-deep');
  });

  test('is deterministic regardless of the file key order', () => {
    const a = compileThemeTokenFile(
      tokenFile({
        'color.primary': { $type: 'color', $value: '#123456' },
        'color.error': { $type: 'color', $value: '#654321' },
      }),
    );
    const b = compileThemeTokenFile(
      tokenFile({
        'color.error': { $type: 'color', $value: '#654321' },
        'color.primary': { $type: 'color', $value: '#123456' },
      }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.css).toBe(b.css);
  });
});

describe('C-529 compiler — color math', () => {
  test('parses the documented literal forms', () => {
    expect(parseColor('#fff')).toBeDefined();
    expect(parseColor('#ffffff80')).toBeDefined();
    expect(parseColor('rgb(1 2 3 / 50%)')).toBeDefined();
    expect(parseColor('hsl(285 60% 40%)')).toBeDefined();
    expect(parseColor('oklch(0.52 0.22 285)')).toBeDefined();
    expect(parseColor('rgb(1, 2, 3, 0.5)')?.a).toBe(0.5);
  });

  test('emits a validated four-argument color and rejects extra slash segments', () => {
    const compilation = compileThemeTokenFile(
      tokenFile({ 'color.primary': { $type: 'color', $value: 'rgb(1, 2, 3, 0.5)' } }),
    );
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) {
      return;
    }
    expect(compilation.css).toContain('--ui-primary: rgb(1, 2, 3, 0.5);');
    expect(parseColor('rgb(1 2 3 / 50% / 25%)')).toBeUndefined();
  });

  test('rejects anything else', () => {
    for (const value of ['var(--x)', 'url(x)', 'red', 'rgb(1,2)', 'oklch(0.5 0.1)', '']) {
      expect(parseColor(value)).toBeUndefined();
    }
  });

  test('contrast is symmetric and bounded', () => {
    const white = parseColor('#ffffff');
    const black = parseColor('#000000');
    expect(white && black).toBeTruthy();
    if (!white || !black) {
      return;
    }
    expect(roundContrast(contrastRatio(white, black))).toBe(21);
    expect(roundContrast(contrastRatio(black, white))).toBe(21);
    expect(roundContrast(contrastRatio(white, white))).toBe(1);
  });

  test('the high-contrast gate is stricter than the normal gate', () => {
    expect(HIGH_CONTRAST_GATE.minimum).toBeGreaterThan(CONTRAST_GATES[0]?.minimum ?? 0);
  });
});

describe('C-529 built-in theme', () => {
  test('the built-in is a validated, deterministic token source', () => {
    const light = compileThemeTokenFile(OBSIDIAN_CHRONICLE_LIGHT);
    const dark = compileThemeTokenFile(OBSIDIAN_CHRONICLE_DARK);
    expect(light.ok).toBe(true);
    expect(dark.ok).toBe(true);
  });

  test('both variants satisfy every contrast gate', () => {
    for (const file of [OBSIDIAN_CHRONICLE_LIGHT, OBSIDIAN_CHRONICLE_DARK]) {
      const compilation = compileThemeTokenFile(file);
      expect(compilation.ok).toBe(true);
      if (!compilation.ok) {
        continue;
      }
      expect(checkThemeContrast(compilation.declarations)).toEqual([]);
      for (const measurement of measureThemeContrast(compilation.declarations)) {
        expect(measurement.passes).toBe(true);
      }
    }
  });

  test('the built-in meets the high-contrast override gate', () => {
    for (const file of [OBSIDIAN_CHRONICLE_LIGHT, OBSIDIAN_CHRONICLE_DARK]) {
      const compilation = compileThemeTokenFile(file);
      expect(compilation.ok).toBe(true);
      if (!compilation.ok) {
        continue;
      }
      expect(checkThemeContrast(compilation.declarations, [HIGH_CONTRAST_GATE])).toEqual([]);
    }
  });

  test('both variants are renderable', () => {
    expect([...BUILTIN_THEME_RENDERABLE_VARIANTS]).toEqual(['light', 'dark']);
  });
});

describe('C-529 generated stylesheet helpers', () => {
  test('the generated stylesheet declares a scoped rule helper that cannot be theme-controlled', () => {
    const css = serializeScopeRule('[data-aikami-theme-scope]', [
      { tokenId: 'color.primary', cssVariable: '--ui-primary', value: '#123456' },
    ]);
    expect(css).toBe('[data-aikami-theme-scope] {\n  --ui-primary: #123456;\n}\n');
  });
});

describe('C-529 package validation — canonical paths and API ranges', () => {
  test('rejects traversal, absolute and non-canonical paths', () => {
    for (const path of ['../x.json', '/x.json', 'a\\b.json', 'a/./b.json', 'a//b.json', 'a/']) {
      expect(isCanonicalPackagePath(path)).toBe(false);
    }
    expect(isCanonicalPackagePath('tokens/light.json')).toBe(true);
  });

  test('accepts compatible ranges and refuses unsupported majors', () => {
    for (const range of ['*', '1.x', '^1.0', '~1.0', '>=1.0 <2.0', '>=1.0', '1.0.0']) {
      expect(isThemeApiRangeSupported(range)).toBe(true);
    }
    for (const range of ['>=2.0 <3.0', '2.x', '^2.0', '~2.0', '>=1.0 <1.0', 'garbage']) {
      expect(isThemeApiRangeSupported(range)).toBe(false);
    }
  });
});

// ── Package-level adversarial cases ────────────────────────────────────────

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A 1×1 PNG — enough for the header reader, tiny enough to inline. */
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

/** A PNG header declaring 4000×4000 — a decompression bomb at 16M pixels. */
const PNG_BOMB = new Uint8Array(PNG_1X1);
PNG_BOMB[16] = 0x00;
PNG_BOMB[17] = 0x00;
PNG_BOMB[18] = 0x0f;
PNG_BOMB[19] = 0xa0;
PNG_BOMB[20] = 0x00;
PNG_BOMB[21] = 0x00;
PNG_BOMB[22] = 0x0f;
PNG_BOMB[23] = 0xa0;

const lightTokens = JSON.stringify(OBSIDIAN_CHRONICLE_LIGHT);
const darkTokens = JSON.stringify(OBSIDIAN_CHRONICLE_DARK);

const buildPackage = (
  overrides: { manifest?: Record<string, unknown>; extraEntries?: Record<string, Uint8Array> } = {},
): ThemePackageReader => {
  const files = new Map<string, Uint8Array>();
  files.set('tokens/light.json', bytesOf(lightTokens));
  files.set('tokens/dark.json', bytesOf(darkTokens));
  for (const [path, bytes] of Object.entries(overrides.extraEntries ?? {})) {
    files.set(path, bytes);
  }
  const assets = [...files.keys()]
    .filter((path) => path.startsWith('assets/'))
    .map((path) => ({
      path,
      mediaType: path.endsWith('.woff2') ? 'font/woff2' : 'image/png',
      bytes: files.get(path)?.byteLength ?? 0,
      sha256: sha256(files.get(path) ?? new Uint8Array()),
    }));
  const manifest = {
    schemaVersion: 1,
    kind: 'aikami-theme',
    id: 'test-theme',
    version: '1.0.0',
    themeApiRange: '>=1.0 <2.0',
    name: 'Test theme',
    author: { displayName: 'Tester' },
    license: 'MIT',
    variants: { light: 'tokens/light.json', dark: 'tokens/dark.json' },
    assets,
    ...overrides.manifest,
  };
  files.set('theme.json', bytesOf(JSON.stringify(manifest)));
  return {
    manifestJson: new TextDecoder().decode(files.get('theme.json')),
    entries: [...files.keys()],
    readText: (path) => {
      const bytes = files.get(path);
      return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
    },
    readBytes: (path) => files.get(path),
    sha256: (path) => {
      const bytes = files.get(path);
      return bytes === undefined ? undefined : sha256(bytes);
    },
  };
};

describe('C-529 package validation — valid package', () => {
  test('accepts the built-in theme packaged as a package', () => {
    const result = validateThemePackage(buildPackage());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.id).toBe('test-theme');
    expect(Object.keys(result.variants).sort()).toEqual(['dark', 'light']);
  });

  test('a valid raster asset is accepted and measured', () => {
    const result = validateThemePackage(
      buildPackage({ extraEntries: { 'assets/ornament.png': PNG_1X1 } }),
    );
    expect(result.ok).toBe(true);
    expect(result.report.some((line) => line.includes('1×1'))).toBe(true);
  });
});

describe('C-529 package validation — adversarial rejection', () => {
  test('rejects a missing manifest', () => {
    const reader = buildPackage();
    const result = validateThemePackage({ ...reader, manifestJson: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('package.missing-manifest');
  });

  test('rejects an unsupported major API before reading anything', () => {
    const result = validateThemePackage(
      buildPackage({ manifest: { themeApiRange: '>=2.0 <3.0' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.unsupported-api');
  });

  test('rejects a traversal variant path', () => {
    const result = validateThemePackage(
      buildPackage({ manifest: { variants: { light: '../secrets.json' } } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.invalid-manifest');
  });

  test('rejects a declared entry that is not present', () => {
    const result = validateThemePackage(
      buildPackage({ manifest: { variants: { light: 'tokens/missing.json' } } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.missing-entry');
  });

  test('rejects an undeclared entry', () => {
    const result = validateThemePackage(
      buildPackage({ extraEntries: { 'sneaky/payload.js': bytesOf('alert(1)') } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.undeclared-entry');
  });

  test('rejects a media type that contradicts the extension', () => {
    const reader = buildPackage({ extraEntries: { 'assets/ornament.png': PNG_1X1 } });
    const manifest = JSON.parse(reader.manifestJson ?? '{}');
    manifest.assets[0].mediaType = 'font/woff2';
    const result = validateThemePackage({ ...reader, manifestJson: JSON.stringify(manifest) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.media-type-mismatch');
  });

  test('rejects a byte-count mismatch', () => {
    const reader = buildPackage({ extraEntries: { 'assets/ornament.png': PNG_1X1 } });
    const manifest = JSON.parse(reader.manifestJson ?? '{}');
    manifest.assets[0].bytes = 999;
    const result = validateThemePackage({ ...reader, manifestJson: JSON.stringify(manifest) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.asset-size-mismatch');
  });

  test('rejects a hash mismatch (tampered package)', () => {
    const reader = buildPackage({ extraEntries: { 'assets/ornament.png': PNG_1X1 } });
    const manifest = JSON.parse(reader.manifestJson ?? '{}');
    manifest.assets[0].sha256 = 'b'.repeat(64);
    const result = validateThemePackage({ ...reader, manifestJson: JSON.stringify(manifest) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.asset-hash-mismatch');
  });

  test('rejects a decompression bomb before anything decodes it', () => {
    const result = validateThemePackage(
      buildPackage({ extraEntries: { 'assets/bomb.png': PNG_BOMB } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.raster-too-large');
  });

  test('rejects a font that is not a WOFF2 container', () => {
    const result = validateThemePackage(
      buildPackage({ extraEntries: { 'assets/font.woff2': bytesOf('not a font') } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.invalid-font');
  });

  test('applies font validation to WOFF2 paths declared as octet-stream', () => {
    const reader = buildPackage({ extraEntries: { 'assets/font.woff2': bytesOf('not a font') } });
    const manifest = JSON.parse(reader.manifestJson ?? '{}');
    manifest.assets[0].mediaType = 'application/octet-stream';
    const result = validateThemePackage({ ...reader, manifestJson: JSON.stringify(manifest) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.invalid-font');
  });

  test('rejects a token file with a forbidden value before it can render', () => {
    const hostile = JSON.stringify({
      profileVersion: 1,
      variant: 'light',
      tokens: { 'color.primary': { $type: 'color', $value: 'url(https://evil.example/x.png)' } },
    });
    const reader = buildPackage();
    const result = validateThemePackage({
      ...reader,
      readText: (path) => (path === 'tokens/light.json' ? hostile : reader.readText(path)),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('token.unsupported-color');
  });

  test('reports a contrast failure as a warning, not a silent override', () => {
    const lowContrast = JSON.stringify({
      profileVersion: 1,
      variant: 'light',
      tokens: {
        'color.base-100': { $type: 'color', $value: '#ffffff' },
        'color.base-content': { $type: 'color', $value: '#f4f4f4' },
      },
    });
    const reader = buildPackage();
    const result = validateThemePackage({
      ...reader,
      readText: (path) => (path === 'tokens/light.json' ? lowContrast : reader.readText(path)),
    });
    expect(result.warnings.map((entry) => entry.code)).toContain('contrast.below-gate');
  });

  test('rejects a preview that is not declared as an asset', () => {
    const result = validateThemePackage(buildPackage({ manifest: { preview: 'assets/p.png' } }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('package.missing-entry');
  });
});

describe('C-529 image header reading', () => {
  test('reads PNG dimensions without decoding', () => {
    expect(readImageDimensions(PNG_1X1)).toEqual({ width: 1, height: 1 });
  });

  test('rejects a truncated or unknown container', () => {
    expect(readImageDimensions(bytesOf('nope'))).toBeUndefined();
    expect(readImageDimensions(PNG_1X1.slice(0, 10))).toBeUndefined();
  });
});
