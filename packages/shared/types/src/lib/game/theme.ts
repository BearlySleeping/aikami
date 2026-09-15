// packages/shared/types/src/lib/game/theme.ts
//
// C-529 — theme types.
//
// Exchanged shapes are DERIVED from the TypeBox schemas in @aikami/schemas so
// the runtime validator and the static type can never drift. Registry metadata
// is derived from the constant registry itself for the same reason.
//
// Contract: C-529 Declarative theme runtime and creator tools.

import type { APPEARANCE_MODES, THEME_TOKEN_REGISTRY, THEME_VARIANTS } from '@aikami/constants';

export type {
  AppearanceMode,
  ThemeAccessibilityOverrides,
  ThemeAsset,
  ThemeAuthor,
  ThemeInstallation,
  ThemePackageManifest,
  ThemeSelection,
  ThemeTokenFile,
  ThemeTokenTypeValue,
  ThemeTokenValue,
  ThemeVariant,
} from '@aikami/schemas';

/** One allowlisted token definition, derived from the registry constant. */
export type ThemeTokenDefinition = (typeof THEME_TOKEN_REGISTRY)[number];

/** Stable allowlisted token id. */
export type ThemeTokenId = ThemeTokenDefinition['id'];

/** Value kind a token may declare. */
export type ThemeTokenKind = ThemeTokenDefinition['type'];

/** Creator-UI grouping for a token. */
export type ThemeTokenGroupId = ThemeTokenDefinition['group'];

/** Player-selectable appearance mode, derived from the mode constant. */
export type AppearanceModeValue = (typeof APPEARANCE_MODES)[number];

/** Declarable variant, derived from the variant constant. */
export type ThemeVariantId = (typeof THEME_VARIANTS)[number];

/**
 * A theme the client can actually resolve: either a shipped built-in or a
 * locally installed package. `isBuiltIn` is what decides whether the runtime
 * has to inject bytes or whether the generated stylesheet already covers it.
 */
export type ResolvedThemeDescriptor = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly isBuiltIn: boolean;
  /** Variants this theme can render. */
  readonly variants: readonly ThemeVariantId[];
};

/** Outcome of validating a token file against the allowlist and the limits. */
export type ThemeValidationIssue = {
  /** Stable machine-readable code — never a free-form string. */
  readonly code: string;
  /** Human-readable message naming the affected role. */
  readonly message: string;
  /** Token id or package path the issue belongs to, when there is one. */
  readonly subject?: string;
};
