// apps/frontend/client/src/lib/utils/theme/theme_editor_state.ts
//
// C-529 AC-2 — the no-code creator editor's draft model.
//
// The editor is a *draft* over the same validated token data a package uses:
// every edit is applied to a `ThemeTokenFile`, compiled with the SAME compiler
// the CLI validator and the runtime call, and refused with the same diagnostic
// when it is invalid. There is no second validation implementation, and the
// friendly editor and the advanced JSON editor cannot disagree — the JSON editor
// is just another way to reach the same draft.
//
// Pure by design: no DOM, no services, no storage.

import { THEME_API_VERSION, THEME_TOKEN_REGISTRY } from '@aikami/constants';
import {
  compileThemeTokenFile,
  FONT_ROLES,
  OBSIDIAN_CHRONICLE_DARK,
  OBSIDIAN_CHRONICLE_LIGHT,
  type ThemeCompilation,
  type ThemePackageBuildInput,
} from '@aikami/frontend/theme';
import type { ThemeTokenFile, ThemeTokenValue } from '@aikami/schemas';
import type { ThemeTokenId, ThemeValidationIssue } from '@aikami/types';

/** A theme under construction. */
export type ThemeEditorDraft = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly authorDisplayName: string;
  readonly license: string;
  readonly themeApiRange: string;
  readonly variants: Partial<Record<'light' | 'dark', ThemeTokenFile>>;
};

/** One starter preset: a named set of role values applied to the draft. */
export type ThemeStarterPreset = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tokens: Readonly<Record<string, ThemeTokenValue['$value']>>;
};

/**
 * Starter presets.
 *
 * Deliberately small and role-level: they move surface/accent/ornament roles
 * only, so a creator starts from something coherent instead of from a blank
 * palette, and every preset is still validated by the compiler afterwards.
 */
export const THEME_STARTER_PRESETS: readonly ThemeStarterPreset[] = [
  {
    id: 'warm-parchment',
    label: 'Warm parchment',
    description: 'Brass ornament on a warm reading surface.',
    tokens: {
      'color.base-100': 'oklch(0.97 0.02 85)',
      'color.base-200': 'oklch(0.93 0.03 85)',
      'color.base-300': 'oklch(0.86 0.04 85)',
      'color.accent': 'oklch(0.58 0.09 74)',
      'color.brass': 'oklch(0.62 0.11 78)',
    },
  },
  {
    id: 'cool-slate',
    label: 'Cool slate',
    description: 'Blue-grey surfaces with a cool rune accent.',
    tokens: {
      'color.base-100': 'oklch(0.96 0.01 240)',
      'color.base-200': 'oklch(0.92 0.015 240)',
      'color.base-300': 'oklch(0.85 0.02 240)',
      'color.primary': 'oklch(0.5 0.16 250)',
      'color.accent': 'oklch(0.6 0.14 200)',
    },
  },
  {
    id: 'max-contrast',
    label: 'Maximum contrast',
    description: 'Near-black ink on near-white paper for readability.',
    tokens: {
      'color.base-100': 'oklch(1 0 0)',
      'color.base-content': 'oklch(0.1 0 0)',
      'color.muted-content': 'oklch(0.32 0 0)',
      'color.primary': 'oklch(0.35 0.18 285)',
    },
  },
];

/** The editor's view of one role. */
export type ThemeEditorRoleRow = {
  readonly tokenId: ThemeTokenId;
  readonly label: string;
  readonly group: string;
  readonly type: string;
  /** The raw value currently in the draft for the edited variant. */
  readonly rawValue: string;
  /** Options for enum-like roles (font roles, weights). */
  readonly options?: readonly string[];
};

/** Which variant the editor is editing. */
export type ThemeEditorVariant = 'light' | 'dark';

/** Duplicates a built-in theme into an editable draft. */
export const duplicateBuiltInTheme = (
  overrides: Partial<Pick<ThemeEditorDraft, 'id' | 'name'>> = {},
): ThemeEditorDraft => ({
  id: overrides.id ?? 'my-theme',
  name: overrides.name ?? 'My theme',
  version: '1.0.0',
  authorDisplayName: 'You',
  license: 'MIT',
  themeApiRange: `>=${THEME_API_VERSION} <2.0`,
  variants: {
    light: structuredClone(OBSIDIAN_CHRONICLE_LIGHT) as ThemeTokenFile,
    dark: structuredClone(OBSIDIAN_CHRONICLE_DARK) as ThemeTokenFile,
  },
});

/** Reads the raw (possibly alias) value of one role. */
export const draftRawValue = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
  tokenId: string,
): string => {
  const value = draft.variants[variant]?.tokens[tokenId]?.$value;
  return value === undefined ? '' : String(value);
};

/** Every allowlisted role, with its current draft value, grouped for display. */
export const draftRoleRows = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
): readonly ThemeEditorRoleRow[] =>
  THEME_TOKEN_REGISTRY.map((token) => {
    const raw = draftRawValue(draft, variant, token.id);
    if (token.type === 'fontFamily') {
      return {
        tokenId: token.id,
        label: token.label,
        group: token.group,
        type: token.type,
        rawValue: raw,
        options: [...FONT_ROLES],
      };
    }
    if (token.type === 'fontWeight') {
      return {
        tokenId: token.id,
        label: token.label,
        group: token.group,
        type: token.type,
        rawValue: raw,
        options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
      };
    }
    return {
      tokenId: token.id,
      label: token.label,
      group: token.group,
      type: token.type,
      rawValue: raw,
    };
  });

/** Parses a raw editor string into a typed token value. */
const toTokenValue = (type: string, raw: string): ThemeTokenValue['$value'] => {
  if (type === 'fontWeight') {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
};

/** The result of one edit: the new draft, plus any validation issues it has. */
export type ThemeEditResult = {
  readonly draft: ThemeEditorDraft;
  readonly issues: readonly ThemeValidationIssue[];
};

/**
 * Sets one role's value and re-validates the whole variant.
 *
 * The value is stored even when it is invalid, so the creator sees their own
 * input and the exact reason it was refused — an editor that silently discards a
 * keystroke is worse than one that explains.
 */
export const setDraftToken = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
  tokenId: string,
  raw: string,
): ThemeEditResult => {
  const file = draft.variants[variant];
  if (file === undefined) {
    return { draft, issues: [] };
  }
  const definition = THEME_TOKEN_REGISTRY.find((token) => token.id === tokenId);
  if (definition === undefined) {
    return { draft, issues: [] };
  }
  const next: ThemeEditorDraft = {
    ...draft,
    variants: {
      ...draft.variants,
      [variant]: {
        ...file,
        tokens: {
          ...file.tokens,
          [tokenId]: { $type: definition.type, $value: toTokenValue(definition.type, raw) },
        },
      },
    },
  };
  const compilation = compileDraftVariant(next, variant);
  return { draft: next, issues: compilation.ok ? [] : compilation.issues };
};

/** Applies a starter preset's roles to one variant. */
export const applyStarterPreset = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
  presetId: string,
): ThemeEditResult => {
  const preset = THEME_STARTER_PRESETS.find((entry) => entry.id === presetId);
  if (preset === undefined) {
    return { draft, issues: [] };
  }
  let next = draft;
  let issues: readonly ThemeValidationIssue[] = [];
  for (const [tokenId, value] of Object.entries(preset.tokens)) {
    const result = setDraftToken(next, variant, tokenId, String(value));
    next = result.draft;
    issues = result.issues;
  }
  return { draft: next, issues };
};

/** Compiles one variant of the draft with the shared compiler. */
export const compileDraftVariant = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
): ThemeCompilation => {
  const file = draft.variants[variant];
  if (file === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: 'editor.missing-variant',
          message: `The draft declares no ${variant} variant.`,
          subject: variant,
        },
      ],
    };
  }
  return compileThemeTokenFile(file);
};

/** Serializes one variant for the advanced JSON editor. */
export const draftVariantJson = (draft: ThemeEditorDraft, variant: ThemeEditorVariant): string =>
  `${JSON.stringify(draft.variants[variant] ?? {}, undefined, 2)}\n`;

const isThemeTokenFileShape = (value: unknown): value is ThemeTokenFile => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.profileVersion === 1 &&
    (candidate.variant === 'light' || candidate.variant === 'dark') &&
    candidate.tokens !== null &&
    typeof candidate.tokens === 'object' &&
    !Array.isArray(candidate.tokens)
  );
};

/**
 * Replaces one variant from advanced JSON text.
 *
 * The JSON goes through the same compiler as the friendly editor, so the two
 * cannot disagree about what is valid.
 */
export const setDraftVariantFromJson = (
  draft: ThemeEditorDraft,
  variant: ThemeEditorVariant,
  json: string,
): ThemeEditResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      draft,
      issues: [
        { code: 'editor.invalid-json', message: 'That is not valid JSON.', subject: variant },
      ],
    };
  }
  if (!isThemeTokenFileShape(parsed)) {
    return {
      draft,
      issues: [
        {
          code: 'editor.invalid-shape',
          message: 'A variant needs `profileVersion`, `variant` and a `tokens` object.',
          subject: variant,
        },
      ],
    };
  }
  const file = parsed;
  const next: ThemeEditorDraft = {
    ...draft,
    variants: { ...draft.variants, [variant]: { ...file, variant } },
  };
  const compilation = compileDraftVariant(next, variant);
  return { draft: next, issues: compilation.ok ? [] : compilation.issues };
};

/** The build input for exporting the draft as a package. */
export const draftToExportInput = (draft: ThemeEditorDraft): ThemePackageBuildInput => ({
  id: draft.id,
  version: draft.version,
  name: draft.name,
  authorDisplayName: draft.authorDisplayName,
  license: draft.license,
  themeApiRange: draft.themeApiRange,
  variants: draft.variants,
});

/** True when every declared variant compiles. */
export const draftIsValid = (draft: ThemeEditorDraft): boolean =>
  (['light', 'dark'] as const)
    .filter((variant) => draft.variants[variant] !== undefined)
    .every((variant) => compileDraftVariant(draft, variant).ok);
