// scripts/src/lib/theme/__tests__/theme_cli.test.ts
//
// C-529 AC-1 / AC-4 / AC-7 — the declared validator command is the creator's
// documented entry point, so what it reports is part of the contract: it must
// find the drift between the committed stylesheet and the generated output, and
// it must name the exact problem for a hostile package instead of "invalid".

import { describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkGeneratedCssDrift,
  createDirectoryReader,
  EXIT_INVALID,
  EXIT_OK,
  main,
  runValidate,
  validateBuiltinSource,
  WORKSPACE_ROOT,
} from '../theme_cli.ts';

const writePackage = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-theme-'));
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return root;
};

const validTokenFile = JSON.stringify({
  profileVersion: 1,
  variant: 'light',
  tokens: { 'color.primary': { $type: 'color', $value: 'oklch(0.52 0.22 285)' } },
});

const validManifest = JSON.stringify({
  schemaVersion: 1,
  kind: 'aikami-theme',
  id: 'my-theme',
  version: '1.0.0',
  themeApiRange: '>=1.0 <2.0',
  name: 'My theme',
  author: { displayName: 'Creator' },
  license: 'MIT',
  variants: { light: 'tokens/light.json' },
  assets: [],
});

describe('C-529 theme CLI — built-in source and drift gate', () => {
  test('the shipped built-in source validates cleanly', () => {
    const result = validateBuiltinSource();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('the committed stylesheet matches the generated output', () => {
    expect(checkGeneratedCssDrift().matches).toBe(true);
  });

  test('`validate` with no arguments validates the built-in and reports no drift', () => {
    const result = runValidate([]);
    expect(result.ok).toBe(true);
    expect(result.drift?.matches).toBe(true);
    expect(result.summary.failed).toBe(0);
  });

  test('the process exit code is 0 for a clean run', () => {
    expect(main(['validate'])).toBe(EXIT_OK);
  });
});

describe('C-529 theme CLI — creator-visible diagnostics', () => {
  test('validates a well-formed package directory', () => {
    const root = writePackage({ 'theme.json': validManifest, 'tokens/light.json': validTokenFile });
    try {
      const result = runValidate([root]);
      expect(result.ok).toBe(true);
      expect(result.targets[0]?.kind).toBe('package');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('names the exact bad role for a forbidden value', () => {
    const root = writePackage({
      'theme.json': validManifest,
      'tokens/light.json': JSON.stringify({
        profileVersion: 1,
        variant: 'light',
        tokens: { 'color.primary': { $type: 'color', $value: 'url(https://evil.example/x.png)' } },
      }),
    });
    try {
      const result = runValidate([root]);
      expect(result.ok).toBe(false);
      const codes = result.targets.flatMap((target) => target.errors.map((entry) => entry.code));
      expect(codes).toContain('token.unsupported-color');
      expect(result.targets.flatMap((target) => target.errors.map((e) => e.subject))).toContain(
        'color.primary',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses an unsupported major API', () => {
    const root = writePackage({
      'theme.json': JSON.stringify({ ...JSON.parse(validManifest), themeApiRange: '>=2.0 <3.0' }),
      'tokens/light.json': validTokenFile,
    });
    try {
      const result = runValidate([root]);
      expect(result.ok).toBe(false);
      expect(
        result.targets.flatMap((target) => target.errors.map((entry) => entry.code)),
      ).toContain('package.unsupported-api');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects an undeclared file in the package', () => {
    const root = writePackage({
      'theme.json': validManifest,
      'tokens/light.json': validTokenFile,
      'payload.js': 'alert(1)',
    });
    try {
      const result = runValidate([root]);
      expect(result.ok).toBe(false);
      expect(
        result.targets.flatMap((target) => target.errors.map((entry) => entry.code)),
      ).toContain('package.undeclared-entry');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports a missing target rather than throwing', () => {
    const result = runValidate([join(tmpdir(), 'definitely-not-a-theme-9f3a')]);
    expect(result.ok).toBe(false);
    expect(result.targets[0]?.errors[0]?.code).toBe('target.missing');
  });

  test('a usage error exits 2', () => {
    expect(main(['nonsense'])).toBe(2);
    expect(main(['validate', join(tmpdir(), 'missing-theme-8b21')])).toBe(EXIT_INVALID);
  });
});

describe('C-529 theme CLI — directory reader', () => {
  test('reads a package directory and refuses to escape its root', () => {
    const root = writePackage({ 'theme.json': validManifest, 'tokens/light.json': validTokenFile });
    try {
      const { reader } = createDirectoryReader(root);
      expect([...reader.entries].sort()).toEqual(['theme.json', 'tokens/light.json']);
      expect(reader.readText('tokens/light.json')).toContain('profileVersion');
      expect(reader.readText('../etc/passwd')).toBeUndefined();
      expect(reader.readBytes('/etc/passwd')).toBeUndefined();
      expect(reader.sha256('../escape')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── C-529 AC-7 — the documented creator walkthrough ────────────────────────
//
// "A developer follows the shipped theme guide. When they validate the included
// starter, intentionally break a role and export. Then the documented command
// works, diagnostics identify the problem and the corrected package imports into
// production." This is that walkthrough, executed.

describe('C-529 AC-7 creator walkthrough (shipped starter)', () => {
  const starterPath = join(WORKSPACE_ROOT, 'docs/themes/obsidian-chronicle-starter');

  test('the shipped starter package exists and validates cleanly', () => {
    const result = runValidate([starterPath]);
    expect(result.ok).toBe(true);
    expect(result.targets[0]?.kind).toBe('package');
    expect(result.targets[0]?.errors).toEqual([]);
  });

  test('breaking one role produces a diagnostic that names that exact role', () => {
    const copy = mkdtempSync(join(tmpdir(), 'aikami-starter-'));
    try {
      cpSync(starterPath, copy, { recursive: true });
      const lightPath = join(copy, 'tokens/light.json');
      const tokens = JSON.parse(readFileSync(lightPath, 'utf8'));
      tokens.tokens['color.primary'] = { $type: 'color', $value: 'url(https://evil.example/x)' };
      writeFileSync(lightPath, JSON.stringify(tokens, undefined, 2), 'utf8');

      const broken = runValidate([copy]);
      expect(broken.ok).toBe(false);
      const errors = broken.targets.flatMap((target) => target.errors);
      expect(errors.map((entry) => entry.code)).toContain('token.unsupported-color');
      expect(errors.map((entry) => entry.subject)).toContain('color.primary');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  test('the corrected package imports through the production archive path', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'aikami-starter-fixed-'));
    try {
      cpSync(starterPath, copy, { recursive: true });
      const lightPath = join(copy, 'tokens/light.json');
      const tokens = JSON.parse(readFileSync(lightPath, 'utf8'));
      tokens.tokens['color.primary'] = { $type: 'color', $value: '#6d28d9' };
      writeFileSync(lightPath, JSON.stringify(tokens, undefined, 2), 'utf8');

      const corrected = runValidate([copy]);
      expect(corrected.ok).toBe(true);

      // Import it the way the client does: build the envelope, then read it back
      // through the archive validator the import path uses.
      const { reader } = createDirectoryReader(copy);
      const entries = await Promise.all(
        reader.entries
          .filter((path) => path !== 'theme.json')
          .map(async (path) => {
            const data = reader.readBytes(path);
            return {
              path,
              compressedBytes: data?.byteLength ?? 0,
              expandedBytes: data?.byteLength ?? 0,
              data,
              sha256: reader.sha256(path),
            };
          }),
      );
      const manifestEntry = {
        path: 'theme.json',
        compressedBytes: (reader.manifestJson ?? '').length,
        expandedBytes: (reader.manifestJson ?? '').length,
        data: new TextEncoder().encode(reader.manifestJson ?? ''),
        sha256: reader.sha256('theme.json'),
      };
      const { validateThemeArchive } = await import('@aikami/frontend/theme');
      const imported = validateThemeArchive([...entries, manifestEntry]);
      expect(imported.ok).toBe(true);
      expect(imported.manifest?.id).toBe('obsidian-chronicle-starter');
      expect(Object.keys(imported.variants).sort()).toEqual(['dark', 'light']);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
