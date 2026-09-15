// scripts/src/lib/theme/__tests__/theme_cli.test.ts
//
// C-529 AC-1 / AC-4 / AC-7 — the declared validator command is the creator's
// documented entry point, so what it reports is part of the contract: it must
// find the drift between the committed stylesheet and the generated output, and
// it must name the exact problem for a hostile package instead of "invalid".

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
