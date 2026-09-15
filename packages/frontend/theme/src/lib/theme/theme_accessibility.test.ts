// packages/frontend/theme/src/lib/theme/theme_accessibility.test.ts
//
// C-529 AC-5 / Directive 5 — accessibility policy is the LAST step and it wins.
//
// The overrides are asserted to be measured, not declared: after applying them
// the high-contrast gates are re-measured, and the module is asserted to report
// exactly what it changed rather than silently rewriting a creator's palette.

import { describe, expect, test } from 'bun:test';
import {
  THEME_CONTRAST_HIGH_CONTRAST_MIN,
  THEME_CONTRAST_NORMAL_TEXT_MIN,
} from '@aikami/constants';
import { OBSIDIAN_CHRONICLE_DARK, OBSIDIAN_CHRONICLE_LIGHT } from './builtin_theme.ts';
import {
  buildAccessibilityDeclarations,
  DEFAULT_THEME_ACCESSIBILITY_OVERRIDES,
  isHighContrastSatisfied,
  measureAccessibilityContrast,
} from './theme_accessibility.ts';
import { contrastRatio, parseColor, roundContrast } from './theme_color.ts';
import { compileThemeTokenFile, type ThemeDeclaration } from './theme_compiler.ts';

const declarationsOf = (file: typeof OBSIDIAN_CHRONICLE_LIGHT): readonly ThemeDeclaration[] => {
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    throw new Error('built-in failed to compile');
  }
  return compilation.declarations;
};

/** Applies an override on top of a declaration list, replacing by token id. */
const apply = (
  base: readonly ThemeDeclaration[],
  added: readonly ThemeDeclaration[],
): readonly ThemeDeclaration[] => {
  const byId = new Map(base.map((entry) => [entry.tokenId, entry]));
  for (const entry of added) {
    byId.set(entry.tokenId, entry);
  }
  return [...byId.values()];
};

const ratioOf = (
  declarations: readonly ThemeDeclaration[],
  foreground: string,
  background: string,
): number => {
  const fg = declarations.find((entry) => entry.tokenId === foreground);
  const bg = declarations.find((entry) => entry.tokenId === background);
  if (fg === undefined || bg === undefined) {
    throw new Error(`missing ${foreground}/${background}`);
  }
  const parsedFg = parseColor(fg.value);
  const parsedBg = parseColor(bg.value);
  if (parsedFg === undefined || parsedBg === undefined) {
    throw new Error('unparsable');
  }
  return roundContrast(contrastRatio(parsedFg, parsedBg));
};

describe('C-529 AC-5 accessibility overrides', () => {
  test('the default is no override', () => {
    expect(DEFAULT_THEME_ACCESSIBILITY_OVERRIDES).toEqual({
      highContrast: false,
      opaqueSurfaces: false,
    });
  });

  test('no override changes nothing', () => {
    expect(
      buildAccessibilityDeclarations(declarationsOf(OBSIDIAN_CHRONICLE_LIGHT), {
        highContrast: false,
        opaqueSurfaces: false,
      }),
    ).toEqual([]);
  });

  test('high contrast raises every essential pair to the 7:1 gate, in both variants', () => {
    for (const file of [OBSIDIAN_CHRONICLE_LIGHT, OBSIDIAN_CHRONICLE_DARK]) {
      const base = declarationsOf(file);
      const added = buildAccessibilityDeclarations(base, {
        highContrast: true,
        opaqueSurfaces: false,
      });
      const effective = apply(base, added);
      expect(isHighContrastSatisfied(effective)).toBe(true);
      for (const measurement of measureAccessibilityContrast(effective)) {
        expect(measurement.ratio).toBeGreaterThanOrEqual(THEME_CONTRAST_HIGH_CONTRAST_MIN);
      }
      // Accent content gets the best contrast the accent's OWN luminance allows
      // — the 7:1 gate is a *primary text on the base surface* gate (Directive
      // 14), not a promise that any hue a creator picks can carry 7:1 text.
      for (const role of ['primary', 'secondary', 'accent', 'neutral', 'error']) {
        expect(ratioOf(effective, `color.${role}-content`, `color.${role}`)).toBeGreaterThanOrEqual(
          THEME_CONTRAST_NORMAL_TEXT_MIN,
        );
      }
    }
  });

  test('the override is applied AFTER the theme, so it beats a low-contrast creator palette', () => {
    // A theme whose body text is deliberately unreadable on its own surface.
    const hostile = compileThemeTokenFile({
      profileVersion: 1,
      variant: 'light',
      tokens: {
        'color.base-100': { $type: 'color', $value: '#ffffff' },
        'color.base-content': { $type: 'color', $value: '#f6f6f6' },
      },
    });
    expect(hostile.ok).toBe(true);
    if (!hostile.ok) {
      return;
    }
    const before = ratioOf(hostile.declarations, 'color.base-content', 'color.base-100');
    expect(before).toBeLessThan(THEME_CONTRAST_HIGH_CONTRAST_MIN);

    const effective = apply(
      hostile.declarations,
      buildAccessibilityDeclarations(hostile.declarations, {
        highContrast: true,
        opaqueSurfaces: false,
      }),
    );
    expect(ratioOf(effective, 'color.base-content', 'color.base-100')).toBeGreaterThanOrEqual(
      THEME_CONTRAST_HIGH_CONTRAST_MIN,
    );
  });

  test('opaque surfaces collapse the translucent materials onto the base surface', () => {
    const base = declarationsOf(OBSIDIAN_CHRONICLE_DARK);
    const added = buildAccessibilityDeclarations(base, {
      highContrast: false,
      opaqueSurfaces: true,
    });
    expect(added.map((entry) => entry.tokenId).sort()).toEqual([
      'color.elevated',
      'color.ink',
      'color.panel',
    ]);
    const effective = apply(base, added);
    const surface = effective.find((entry) => entry.tokenId === 'color.base-100')?.value;
    for (const role of ['color.ink', 'color.panel', 'color.elevated']) {
      expect(effective.find((entry) => entry.tokenId === role)?.value).toBe(surface);
    }
  });

  test('it reports what it changed instead of rewriting silently', () => {
    const base = declarationsOf(OBSIDIAN_CHRONICLE_LIGHT);
    const added = buildAccessibilityDeclarations(base, {
      highContrast: true,
      opaqueSurfaces: true,
    });
    expect(added.length).toBeGreaterThan(0);
    // Only allowlisted `--ui-*` custom properties, never a selector.
    for (const entry of added) {
      expect(entry.cssVariable.startsWith('--ui-')).toBe(true);
      expect(entry.value).not.toContain('{');
      expect(entry.value).not.toContain(';');
    }
  });

  test('replaces a non-maximal focus ring even when it already exceeds 7:1', () => {
    const base = compileThemeTokenFile({
      profileVersion: 1,
      variant: 'light',
      tokens: {
        'color.base-100': { $type: 'color', $value: '#000000' },
        'color.base-content': { $type: 'color', $value: '#ffffff' },
        'color.muted-content': { $type: 'color', $value: '#ffffff' },
        'color.focus-ring': { $type: 'color', $value: '#eeeeee' },
      },
    });
    expect(base.ok).toBe(true);
    if (!base.ok) {
      return;
    }
    const added = buildAccessibilityDeclarations(base.declarations, {
      highContrast: true,
      opaqueSurfaces: false,
    });
    expect(added.find((entry) => entry.tokenId === 'color.focus-ring')?.value).toBe('#ffffff');
  });

  test('an already-maximal palette is left alone', () => {
    const maximal = compileThemeTokenFile({
      profileVersion: 1,
      variant: 'light',
      tokens: {
        'color.base-100': { $type: 'color', $value: '#000000' },
        'color.base-content': { $type: 'color', $value: '#ffffff' },
        'color.muted-content': { $type: 'color', $value: '#ffffff' },
        'color.focus-ring': { $type: 'color', $value: '#ffffff' },
      },
    });
    expect(maximal.ok).toBe(true);
    if (!maximal.ok) {
      return;
    }
    const added = buildAccessibilityDeclarations(maximal.declarations, {
      highContrast: true,
      opaqueSurfaces: false,
    });
    expect(added.map((entry) => entry.tokenId)).not.toContain('color.base-content');
    expect(added.map((entry) => entry.tokenId)).not.toContain('color.muted-content');
    expect(added.map((entry) => entry.tokenId)).not.toContain('color.focus-ring');
  });

  test('high-contrast satisfaction requires every surface-text measurement', () => {
    expect(isHighContrastSatisfied([])).toBe(false);
    expect(
      isHighContrastSatisfied([
        { tokenId: 'color.base-100', cssVariable: '--ui-base-100', value: '#000000' },
        {
          tokenId: 'color.base-content',
          cssVariable: '--ui-base-content',
          value: '#ffffff',
        },
      ]),
    ).toBe(false);
  });
});
