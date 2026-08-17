// packages/frontend/theme/src/index.test.ts
//
// Source-of-truth smoke test for the shared brand palette (C-418 Feature A).
//
// The palette is declared exactly twice — brand_daisy.css (daisyUI tokens)
// and brand_tokens.css (plain CSS custom properties) — and both files are
// the source of truth (M6: a hand-synced TS copy drifted once and was
// deleted). These tests read the files directly and assert:
//   1. Every required token is present in both light and dark variants.
//   2. The two files share the same brand family (rune purple, hue 285)
//      while keeping their intentional role mapping: daisyUI's
//      `--color-primary` is the brand accent; tokens' `--primary` is the
//      shadcn-style text-adjacent primary (dark slate).
//   3. Light and dark selectors are distinct so neither mode falls back to
//      the other.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const readCss = (name: string): string =>
  readFileSync(join(import.meta.dir, 'lib', name), 'utf-8');

const daisyCss = readCss('brand_daisy.css');
const tokensCss = readCss('brand_tokens.css');

describe('brand_daisy.css — daisyUI token roles', () => {
  test('defines the light-theme daisy tokens', () => {
    for (const token of [
      '--color-base-100',
      '--color-base-content',
      '--color-primary',
      '--color-primary-content',
      '--color-secondary',
      '--color-accent',
      '--color-neutral',
      '--color-info',
      '--color-success',
      '--color-warning',
      '--color-error',
    ]) {
      expect(daisyCss).toContain(`${token}:`);
    }
  });

  test('defines the dark-theme variant under prefers-color-scheme + data-theme', () => {
    expect(daisyCss).toContain('@media (prefers-color-scheme: dark)');
    // L3: explicit [data-theme='dark'] must also resolve to the dark palette.
    expect(daisyCss).toMatch(/:root:not\(\[data-theme\]\),\s*\n?\s*:root\[data-theme="dark"\]/);
  });

  test('daisy primary is the brand accent (rune purple, hue 285)', () => {
    expect(daisyCss).toMatch(/--color-primary:\s*oklch\([^)]*\s285\)/);
  });
});

describe('brand_tokens.css — plain custom properties', () => {
  test('defines the light-theme tokens', () => {
    for (const token of [
      '--brand',
      '--brand-soft',
      '--background',
      '--foreground',
      '--card',
      '--primary',
      '--primary-foreground',
      '--muted',
      '--muted-foreground',
      '--border',
      '--ring',
    ]) {
      expect(tokensCss).toContain(`${token}:`);
    }
  });

  test('defines the dark-theme variant', () => {
    expect(tokensCss).toMatch(/\.dark,\s*\n?\[data-theme="dark"\]/);
  });

  test('brand hue is rune purple in both themes (285)', () => {
    expect(tokensCss).toMatch(/--brand:\s*oklch\([^)]*\s285\)/g);
  });
});

describe('palette family alignment (M6 drift guard)', () => {
  test('both files carry the same rune-purple hue for the brand accent', () => {
    // tokens: --brand (light) = oklch(0.52 0.22 285); daisy: --color-primary
    // (light) = oklch(0.52 0.22 285). Assert hue equality without pinning
    // the lightness/chroma so intentional tonal tweaks stay unblocked.
    const tokenHue = /--brand:\s*oklch\([^)]*\s(285)\)/.exec(tokensCss)?.[1];
    const daisyHue = /--color-primary:\s*oklch\([^)]*\s(285)\)/.exec(daisyCss)?.[1];
    expect(daisyHue).toBe('285');
    expect(tokenHue).toBe('285');
  });

  test('tokens --primary (text-adjacent) is NOT the brand hue — role mapping is intentional', () => {
    // daisy --color-primary = brand accent (285); tokens --primary = dark
    // slate text primary (270). L1 documents this as intentional.
    expect(tokensCss).toMatch(/--primary:\s*oklch\([^)]*\s270\)/);
    expect(daisyCss).toMatch(/--color-primary:\s*oklch\([^)]*\s285\)/);
  });
});
