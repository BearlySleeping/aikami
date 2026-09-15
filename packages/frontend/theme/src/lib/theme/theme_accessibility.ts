// packages/frontend/theme/src/lib/theme/theme_accessibility.ts
//
// C-529 AC-5 / Directive 5 / Directive 14 — accessibility overrides that WIN.
//
// Appearance precedence is: baseline → selected variant → explicit personal
// overrides → accessibility policy. This module is the last step. It is applied
// *after* a theme's own declarations and after any personal overrides, so an
// explicit high-contrast or opaque-surfaces choice is never silently defeated by
// a creator's palette.
//
// 🔴 It is also not a silent override of creator intent: it returns exactly the
// declarations it changed, so the UI can show "what changes" instead of quietly
// substituting values.

import { THEME_CONTRAST_HIGH_CONTRAST_MIN, THEME_TOKEN_BY_ID } from '@aikami/constants';
import {
  contrastRatio,
  parseColor,
  type RgbaColor,
  roundContrast,
  serializeColor,
} from './theme_color.ts';
import type { ThemeDeclaration } from './theme_compiler.ts';

/** The explicit accessibility appearance choices a player can make. */
export type ThemeAccessibilityOverrides = {
  /**
   * Force maximum-contrast primary text and focus colors.
   *
   * Guarantees ≥7:1 for body/muted text and the focus ring on the base surface.
   * Accent *content* colors are pushed to the best contrast their own hue
   * allows (at least the 4.5:1 normal-text gate) rather than recoloring the
   * creator's accents — the ≥7:1 promise is a primary-text gate, not a claim
   * that any hue can carry 7:1 text.
   */
  readonly highContrast: boolean;
  /** Force the translucent material surfaces to the opaque base surface. */
  readonly opaqueSurfaces: boolean;
};

/** The documented default: no accessibility appearance override. */
export const DEFAULT_THEME_ACCESSIBILITY_OVERRIDES: ThemeAccessibilityOverrides = {
  highContrast: false,
  opaqueSurfaces: false,
};

const BLACK = { r: 0, g: 0, b: 0, a: 1 } as const;
const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

/** The color with the higher contrast against a background. */
const bestContrastingColor = (background: RgbaColor): RgbaColor =>
  contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;

/** Accent roles that carry their own `-content` text color. */
const CONTENT_PAIRS = [
  'primary',
  'secondary',
  'accent',
  'neutral',
  'info',
  'success',
  'warning',
  'error',
] as const;

/** Text roles on the base surface that the high-contrast override raises. */
const SURFACE_TEXT_ROLES = ['color.base-content', 'color.muted-content'] as const;

/** Material surfaces the opaque override collapses onto the base surface. */
const TRANSLUCENT_SURFACES = ['color.ink', 'color.panel', 'color.elevated'] as const;

const declarationOf = (tokenId: string, value: string): ThemeDeclaration | undefined => {
  const definition = THEME_TOKEN_BY_ID.get(tokenId);
  return definition === undefined
    ? undefined
    : { tokenId, cssVariable: definition.cssVariable, value };
};

/** Reads a resolved color out of the declaration list. */
const readColor = (
  declarations: readonly ThemeDeclaration[],
  tokenId: string,
): RgbaColor | undefined => {
  const entry = declarations.find((declaration) => declaration.tokenId === tokenId);
  return entry === undefined ? undefined : parseColor(entry.value);
};

/**
 * Builds the declarations an accessibility override adds.
 *
 * Returns only what it changed. An empty array means the override had nothing
 * to do (for example, high contrast against a palette that is already maximal).
 */
export const buildAccessibilityDeclarations = (
  declarations: readonly ThemeDeclaration[],
  overrides: ThemeAccessibilityOverrides,
): readonly ThemeDeclaration[] => {
  const changed: ThemeDeclaration[] = [];

  if (overrides.highContrast) {
    const surface = readColor(declarations, 'color.base-100');
    if (surface !== undefined) {
      for (const role of SURFACE_TEXT_ROLES) {
        const current = readColor(declarations, role);
        const target = bestContrastingColor(surface);
        if (
          current === undefined ||
          contrastRatio(current, surface) < THEME_CONTRAST_HIGH_CONTRAST_MIN
        ) {
          const next = declarationOf(role, serializeColor(target));
          if (next !== undefined) {
            changed.push(next);
          }
        }
      }
      const ring = declarationOf('color.focus-ring', serializeColor(bestContrastingColor(surface)));
      if (ring !== undefined) {
        changed.push(ring);
      }
    }

    for (const role of CONTENT_PAIRS) {
      const accent = readColor(declarations, `color.${role}`);
      const contentToken = `color.${role}-content`;
      const current = readColor(declarations, contentToken);
      if (accent === undefined) {
        continue;
      }
      if (
        current !== undefined &&
        contrastRatio(current, accent) >= THEME_CONTRAST_HIGH_CONTRAST_MIN
      ) {
        continue;
      }
      const next = declarationOf(contentToken, serializeColor(bestContrastingColor(accent)));
      if (next !== undefined) {
        changed.push(next);
      }
    }
  }

  if (overrides.opaqueSurfaces) {
    const surfaceEntry = declarations.find(
      (declaration) => declaration.tokenId === 'color.base-100',
    );
    if (surfaceEntry !== undefined) {
      for (const role of TRANSLUCENT_SURFACES) {
        const next = declarationOf(role, surfaceEntry.value);
        if (next !== undefined) {
          changed.push(next);
        }
      }
    }
  }

  return changed;
};

/**
 * Measures whether the overrides actually deliver the promised gate.
 *
 * Used by the validator and the editor so "high contrast is on" is a measured
 * claim rather than a checkbox.
 */
export const measureAccessibilityContrast = (
  declarations: readonly ThemeDeclaration[],
): readonly { readonly id: string; readonly ratio: number; readonly minimum: number }[] => {
  const surface = readColor(declarations, 'color.base-100');
  if (surface === undefined) {
    return [];
  }
  return SURFACE_TEXT_ROLES.flatMap((role) => {
    const color = readColor(declarations, role);
    return color === undefined
      ? []
      : [
          {
            id: role,
            ratio: roundContrast(contrastRatio(color, surface)),
            minimum: THEME_CONTRAST_HIGH_CONTRAST_MIN,
          },
        ];
  });
};

/** True when every high-contrast gate is met by the given declarations. */
export const isHighContrastSatisfied = (declarations: readonly ThemeDeclaration[]): boolean =>
  measureAccessibilityContrast(declarations).every(
    (measurement) => measurement.ratio >= measurement.minimum,
  );
