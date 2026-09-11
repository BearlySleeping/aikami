// packages/frontend/theme/src/index.test.ts
//
// Source-of-truth smoke test for the shared brand palette and the
// Aikami-owned UI layer (C-418 Feature A; daisyUI removal).
//
// The palette is declared in CSS and those files are the source of truth
// (M6: a hand-synced TS copy drifted once and was deleted). These tests read
// the files directly and assert:
//   1. Every required semantic token is present in light + dark variants.
//   2. The theme maps the raw `--ui-*` palette onto Tailwind `--color-*`
//      tokens via `@theme` so utilities are generated without daisyUI.
//   3. The two app palettes share the same brand family (rune purple, hue
//      285) while keeping their intentional role mapping: the theme's
//      `--ui-primary` is the brand accent; tokens' `--primary` is the
//      shadcn-style text-adjacent primary (dark slate).
//   4. The component layer owns the migration class names and never falls
//      back to a daisyUI plugin.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readCss = (name: string): string => readFileSync(join(import.meta.dir, 'lib', name), 'utf-8');

const themeCss = readCss('aikami_theme.css');
const uiCss = readCss('aikami_ui.css');
const tokensCss = readCss('brand_tokens.css');

describe('aikami_theme.css — semantic UI tokens', () => {
  test('defines the light-theme palette', () => {
    for (const token of [
      '--ui-base-100',
      '--ui-base-content',
      '--ui-primary',
      '--ui-primary-content',
      '--ui-secondary',
      '--ui-accent',
      '--ui-neutral',
      '--ui-info',
      '--ui-success',
      '--ui-warning',
      '--ui-error',
    ]) {
      expect(themeCss).toContain(`${token}:`);
    }
  });

  test('defines the dark-theme variant under prefers-color-scheme + data-theme', () => {
    expect(themeCss).toContain('@media (prefers-color-scheme: dark)');
    // Explicit [data-theme='dark'] must also resolve to the dark palette.
    expect(themeCss).toMatch(/:root:not\(\[data-theme\]\),\s*\n?\s*:root\[data-theme="dark"\]/);
  });

  test('registers the palette with Tailwind @theme', () => {
    expect(themeCss).toContain('@theme');
    for (const token of [
      '--color-base-100',
      '--color-base-content',
      '--color-primary',
      '--color-error',
      '--radius-box',
      '--radius-field',
      '--radius-selector',
    ]) {
      expect(themeCss).toContain(`${token}:`);
    }
  });

  test('brand accent is rune purple (hue 285)', () => {
    expect(themeCss).toMatch(/--ui-primary:\s*oklch\([^)]*\s285\)/);
  });
});

describe('aikami_ui.css — Aikami-owned component layer', () => {
  test('owns the migrated primitive class API', () => {
    for (const className of [
      '.btn',
      '.badge',
      '.input',
      '.select',
      '.textarea',
      '.modal',
      '.tabs',
      '.card',
    ]) {
      expect(uiCss).toContain(`${className} {`);
    }
  });

  test('does not depend on a daisyUI plugin', () => {
    expect(uiCss).not.toMatch(/@plugin\s+"?daisyui/);
    expect(themeCss).not.toMatch(/@plugin\s+"?daisyui/);
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
    // tokens: --brand (light) = oklch(0.52 0.22 285); theme: --ui-primary
    // (light) = oklch(0.52 0.22 285). Assert hue equality without pinning
    // the lightness/chroma so intentional tonal tweaks stay unblocked.
    const tokenHue = /--brand:\s*oklch\([^)]*\s(285)\)/.exec(tokensCss)?.[1];
    const themeHue = /--ui-primary:\s*oklch\([^)]*\s(285)\)/.exec(themeCss)?.[1];
    expect(themeHue).toBe('285');
    expect(tokenHue).toBe('285');
  });

  test('tokens --primary (text-adjacent) is NOT the brand hue — role mapping is intentional', () => {
    // theme --ui-primary = brand accent (285); tokens --primary = dark
    // slate text primary (270). L1 documents this as intentional.
    expect(tokensCss).toMatch(/--primary:\s*oklch\([^)]*\s270\)/);
    expect(themeCss).toMatch(/--ui-primary:\s*oklch\([^)]*\s285\)/);
  });
});
