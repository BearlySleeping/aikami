// packages/frontend/theme/src/lib/theme/theme_compiler.ts
//
// C-529 — the declarative theme compiler.
//
// This is the ONE implementation of "what is a valid theme and what CSS does it
// produce". The client editor, the client runtime, the Hub and the CLI validator
// all call into it, so a theme that the editor accepts cannot be rejected by the
// installer and vice versa.
//
// 🔴 Nothing here evaluates author code. A token value is a typed literal or an
// alias; it is parsed, re-serialized canonically and only then written into a
// stylesheet. There is no path from an untrusted value to a CSS selector, a
// `url()`, an `@import`, a `var()` or a declaration terminator.

import {
  THEME_MAX_ALIAS_DEPTH,
  THEME_MAX_RESOLVED_TOKENS,
  THEME_TOKEN_BY_ID,
  THEME_TOKEN_REGISTRY,
  THEME_TOKEN_TYPES,
} from '@aikami/constants';
import type { ThemeTokenFile, ThemeTokenValue } from '@aikami/schemas';
import { parseThemeTokenFile } from '@aikami/schemas';
import type { ThemeTokenId, ThemeValidationIssue } from '@aikami/types';
import { contrastRatio, parseColor, roundContrast } from './theme_color.ts';

/**
 * Canonicalizes a *validated* color literal.
 *
 * The literal has already survived {@link parseColor}, which proves its body
 * contains only digits, separators, a percent sign and one allowlisted function
 * name — so no `;`, `{`, `}`, `url(`, `var(` or `@` can survive. Emitting the
 * normalized literal (rather than an 8-bit hex round trip) keeps OKLCH color
 * reproduction byte-identical to the authored palette.
 */
const normalizeColorLiteral = (raw: string): string => {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const match = /^([a-z]+)\(/.exec(trimmed);
  return match?.[1] === undefined ? trimmed : trimmed.replace(match[1], match[1].toLowerCase());
};

/** One resolved token, ready to be written as a custom property. */
export type ThemeDeclaration = {
  readonly tokenId: string;
  readonly cssVariable: string;
  readonly value: string;
};

/** Successful compilation. `css` is the scope-agnostic declaration body. */
export type ThemeCompilation =
  | {
      readonly ok: true;
      readonly variant: ThemeTokenFile['variant'];
      readonly declarations: readonly ThemeDeclaration[];
      /** `--ui-x: value;` lines, newline separated and deterministically ordered. */
      readonly css: string;
    }
  | { readonly ok: false; readonly issues: readonly ThemeValidationIssue[] };

/** Trusted local font stacks. A font role can never name a remote resource. */
export const FONT_ROLE_STACKS = {
  sans: '"Inter", system-ui, sans-serif',
  serif: '"Source Serif 4", "Iowan Old Style", Palatino, Georgia, serif',
  display: '"Source Serif 4", "Iowan Old Style", Palatino, Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  system: 'system-ui, sans-serif',
} as const;

export type FontRole = keyof typeof FONT_ROLE_STACKS;

/** Font roles a theme may select. Anything else is rejected. */
export const FONT_ROLES = Object.keys(FONT_ROLE_STACKS) as readonly FontRole[];

const isFontRole = (value: string): value is FontRole => Object.hasOwn(FONT_ROLE_STACKS, value);

/** Bounded dimension: number + unit, magnitude capped at 512. */
const DIMENSION_PATTERN = /^(\d{1,4}(?:\.\d{1,4})?|\.\d{1,4})(px|rem|em|ch|ex|%)$/;

/** Bounded duration: number + ms|s, magnitude capped at 10000. */
const DURATION_PATTERN = /^(\d{1,5}(?:\.\d{1,3})?|\.\d{1,3})(ms|s)$/;

const MAX_DIMENSION = 512;
const MAX_DURATION_MS = 10_000;

const issue = (code: string, message: string, subject?: string): ThemeValidationIssue =>
  subject === undefined ? { code, message } : { code, message, subject };

/** Matches a whole-value alias reference: `{color.base-100}`. */
const ALIAS_PATTERN = /^\{([a-z]+(?:\.[a-z0-9-]+)+)\}$/;

/** True when a string is an alias reference (even if it names an unknown token). */
export const isAliasReference = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('{') && value.endsWith('}');

/** Validates and canonicalizes a literal value for a declared type. */
const canonicalizeLiteral = (
  tokenId: string,
  declaredType: string,
  value: ThemeTokenValue['$value'],
): { readonly value: string } | { readonly issue: ThemeValidationIssue } => {
  if (declaredType === 'color') {
    if (typeof value !== 'string') {
      return { issue: issue('token.type-mismatch', `${tokenId} must be a color string.`, tokenId) };
    }
    const parsed = parseColor(value);
    if (parsed === undefined) {
      return {
        issue: issue(
          'token.unsupported-color',
          `${tokenId} is not a supported color literal (hex, rgb(), hsl() or oklch() only).`,
          tokenId,
        ),
      };
    }
    return { value: normalizeColorLiteral(value) };
  }

  if (declaredType === 'dimension') {
    if (typeof value !== 'string') {
      return {
        issue: issue('token.type-mismatch', `${tokenId} must be a dimension string.`, tokenId),
      };
    }
    const match = DIMENSION_PATTERN.exec(value);
    const magnitude = match === null ? Number.NaN : Number.parseFloat(match[1] ?? '');
    if (match === null || !Number.isFinite(magnitude) || magnitude > MAX_DIMENSION) {
      return {
        issue: issue(
          'token.invalid-dimension',
          `${tokenId} must be a dimension with a px/rem/em/ch/ex/% unit no larger than ${MAX_DIMENSION}.`,
          tokenId,
        ),
      };
    }
    return { value };
  }

  if (declaredType === 'duration') {
    if (typeof value !== 'string') {
      return {
        issue: issue('token.type-mismatch', `${tokenId} must be a duration string.`, tokenId),
      };
    }
    const match = DURATION_PATTERN.exec(value);
    if (match === null) {
      return {
        issue: issue(
          'token.invalid-duration',
          `${tokenId} must be a duration in ms or s (for example "160ms").`,
          tokenId,
        ),
      };
    }
    const magnitude = Number.parseFloat(match[1] ?? '');
    const milliseconds = match[2] === 's' ? magnitude * 1000 : magnitude;
    if (!Number.isFinite(milliseconds) || milliseconds > MAX_DURATION_MS) {
      return {
        issue: issue(
          'token.duration-out-of-range',
          `${tokenId} must not exceed ${MAX_DURATION_MS}ms.`,
          tokenId,
        ),
      };
    }
    return { value };
  }

  if (declaredType === 'fontFamily') {
    // 🔴 A font *role*, never a family string: an arbitrary family is exactly
    // how a remote font URL would be smuggled into a theme.
    if (typeof value !== 'string' || !isFontRole(value)) {
      return {
        issue: issue(
          'token.unsupported-font-role',
          `${tokenId} must be one of: ${FONT_ROLES.join(', ')}.`,
          tokenId,
        ),
      };
    }
    return { value: FONT_ROLE_STACKS[value] };
  }

  if (declaredType === 'fontWeight') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 900) {
      return {
        issue: issue(
          'token.invalid-font-weight',
          `${tokenId} must be a whole weight between 100 and 900.`,
          tokenId,
        ),
      };
    }
    if (value % 100 !== 0) {
      return {
        issue: issue(
          'token.invalid-font-weight',
          `${tokenId} must be a multiple of 100 between 100 and 900.`,
          tokenId,
        ),
      };
    }
    return { value: String(value) };
  }

  return {
    issue: issue(
      'token.unknown-type',
      `${tokenId} declares an unsupported value kind "${declaredType}".`,
      tokenId,
    ),
  };
};

/**
 * Compiles a validated token file into ordered declarations.
 *
 * Alias resolution is depth- and cycle-checked: a theme cannot make the client
 * walk a reference loop, and a chain deeper than {@link THEME_MAX_ALIAS_DEPTH}
 * is rejected instead of followed.
 */
export const compileThemeTokenFile = (file: ThemeTokenFile): ThemeCompilation => {
  const issues: ThemeValidationIssue[] = [];
  const tokenIds = Object.keys(file.tokens);

  if (tokenIds.length > THEME_MAX_RESOLVED_TOKENS) {
    return {
      ok: false,
      issues: [
        issue(
          'tokens.too-many',
          `A theme variant may define at most ${THEME_MAX_RESOLVED_TOKENS} tokens.`,
        ),
      ],
    };
  }

  // The allowlist is the security boundary: a token that is not named here
  // cannot be assigned, so it cannot affect any surface.
  const allowed: string[] = [];
  for (const tokenId of tokenIds) {
    const definition = THEME_TOKEN_BY_ID.get(tokenId);
    if (definition === undefined) {
      issues.push(
        issue(
          'token.not-allowlisted',
          `"${tokenId}" is not a themeable token. Themeable roles are: ${THEME_TOKEN_REGISTRY.map((token) => token.id).join(', ')}.`,
          tokenId,
        ),
      );
      continue;
    }
    const declared = file.tokens[tokenId];
    if (declared === undefined) {
      continue;
    }
    if (!THEME_TOKEN_TYPES.includes(declared.$type)) {
      issues.push(
        issue('token.unknown-type', `"${tokenId}" declares an unknown value kind.`, tokenId),
      );
      continue;
    }
    if (declared.$type !== definition.type) {
      issues.push(
        issue(
          'token.type-mismatch',
          `"${tokenId}" must be a ${definition.type} token, not ${declared.$type}.`,
          tokenId,
        ),
      );
      continue;
    }
    allowed.push(tokenId);
  }

  const resolved = new Map<string, string>();

  const resolve = (
    tokenId: string,
    depth: number,
    trail: readonly string[],
  ): string | undefined => {
    const cached = resolved.get(tokenId);
    if (cached !== undefined) {
      return cached;
    }
    if (depth > THEME_MAX_ALIAS_DEPTH) {
      issues.push(
        issue(
          'token.alias-too-deep',
          `"${tokenId}" resolves through more than ${THEME_MAX_ALIAS_DEPTH} aliases.`,
          tokenId,
        ),
      );
      return undefined;
    }
    if (trail.includes(tokenId)) {
      issues.push(
        issue(
          'token.alias-cycle',
          `"${tokenId}" resolves in a cycle: ${[...trail, tokenId].join(' → ')}.`,
          tokenId,
        ),
      );
      return undefined;
    }
    const definition = THEME_TOKEN_BY_ID.get(tokenId);
    const declared = file.tokens[tokenId];
    if (definition === undefined) {
      return undefined;
    }
    if (declared === undefined) {
      issues.push(
        issue(
          'token.alias-unresolved-target',
          `"${trail.at(-1) ?? tokenId}" aliases "${tokenId}", but that token is not declared.`,
          trail.at(-1) ?? tokenId,
        ),
      );
      return undefined;
    }

    let canonical: string | undefined;
    if (isAliasReference(declared.$value)) {
      const target = ALIAS_PATTERN.exec(declared.$value as string)?.[1];
      if (target === undefined) {
        issues.push(
          issue(
            'token.invalid-alias',
            `"${tokenId}" has a malformed alias. Use {group.token} with a lowercase token id.`,
            tokenId,
          ),
        );
        return undefined;
      }
      const targetDefinition = THEME_TOKEN_BY_ID.get(target);
      if (targetDefinition === undefined) {
        issues.push(
          issue(
            'token.alias-unknown-target',
            `"${tokenId}" aliases "${target}", which is not a themeable token.`,
            tokenId,
          ),
        );
        return undefined;
      }
      if (targetDefinition.type !== definition.type) {
        issues.push(
          issue(
            'token.alias-type-mismatch',
            `"${tokenId}" (${definition.type}) cannot alias "${target}" (${targetDefinition.type}).`,
            tokenId,
          ),
        );
        return undefined;
      }
      canonical = resolve(target, depth + 1, [...trail, tokenId]);
      if (canonical === undefined) {
        return undefined;
      }
    } else {
      const result = canonicalizeLiteral(tokenId, definition.type, declared.$value);
      if ('issue' in result) {
        issues.push(result.issue);
        return undefined;
      }
      canonical = result.value;
    }

    resolved.set(tokenId, canonical);
    return canonical;
  };

  for (const tokenId of allowed) {
    resolve(tokenId, 0, []);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // Deterministic output order: the registry order, not the file's key order,
  // so two files with the same values generate byte-identical CSS.
  const declarations: ThemeDeclaration[] = [];
  for (const definition of THEME_TOKEN_REGISTRY) {
    const value = resolved.get(definition.id);
    if (value === undefined) {
      continue;
    }
    declarations.push({
      tokenId: definition.id,
      cssVariable: definition.cssVariable,
      value,
    });
  }

  return {
    ok: true,
    variant: file.variant,
    declarations,
    css: declarations.map((entry) => `  ${entry.cssVariable}: ${entry.value};`).join('\n'),
  };
};

/** Parses untrusted JSON and compiles it in one step. Never throws. */
export const compileThemeTokenFileJson = (raw: string): ThemeCompilation => {
  const file = parseThemeTokenFile(raw === '' ? undefined : safeJsonParse(raw));
  if (file === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          'theme.invalid-shape',
          'That theme file is not a valid Aikami token file (profileVersion, variant and bounded typed tokens are required).',
        ),
      ],
    };
  }
  return compileThemeTokenFile(file);
};

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/**
 * Wraps declarations in a scoped rule.
 *
 * The selector is produced by the caller from trusted constants — never from
 * theme data — so a theme cannot choose where its values land.
 */
export const serializeScopeRule = (
  selector: string,
  declarations: readonly ThemeDeclaration[],
): string =>
  `${selector} {\n${declarations.map((entry) => `  ${entry.cssVariable}: ${entry.value};`).join('\n')}\n}\n`;

/** Reads a resolved color declaration as parsed channels. */
const readColor = (
  declarations: readonly ThemeDeclaration[],
  tokenId: string,
): ReturnType<typeof parseColor> => {
  const entry = declarations.find((declaration) => declaration.tokenId === tokenId);
  return entry === undefined ? undefined : parseColor(entry.value);
};

/** One contrast gate: a foreground/background role pair and its floor. */
export type ContrastGate = {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly label: string;
};

/**
 * The product contrast gates (Directive 14).
 *
 * These are product gates, not a claim of full WCAG certification: essential
 * normal text at 4.5:1, large/disabled text and control boundaries at 3:1.
 */
export const CONTRAST_GATES: readonly ContrastGate[] = [
  {
    id: 'text-on-surface',
    foreground: 'color.base-content',
    background: 'color.base-100',
    minimum: 4.5,
    label: 'Body text on the base surface',
  },
  {
    id: 'text-on-raised',
    foreground: 'color.base-content',
    background: 'color.base-200',
    minimum: 4.5,
    label: 'Body text on a raised surface',
  },
  {
    id: 'text-on-panel',
    foreground: 'color.base-content',
    background: 'color.panel',
    minimum: 4.5,
    label: 'Body text on a panel',
  },
  {
    id: 'text-on-elevated',
    foreground: 'color.base-content',
    background: 'color.elevated',
    minimum: 4.5,
    label: 'Body text on an elevated panel',
  },
  {
    id: 'muted-on-surface',
    foreground: 'color.muted-content',
    background: 'color.base-100',
    minimum: 3,
    label: 'Disabled/explanatory text on the base surface',
  },
  {
    id: 'primary-on-primary',
    foreground: 'color.primary-content',
    background: 'color.primary',
    minimum: 4.5,
    label: 'Text on the primary accent',
  },
  {
    id: 'secondary-on-secondary',
    foreground: 'color.secondary-content',
    background: 'color.secondary',
    minimum: 4.5,
    label: 'Text on the secondary accent',
  },
  {
    id: 'accent-on-accent',
    foreground: 'color.accent-content',
    background: 'color.accent',
    minimum: 4.5,
    label: 'Text on the highlight accent',
  },
  {
    id: 'neutral-on-neutral',
    foreground: 'color.neutral-content',
    background: 'color.neutral',
    minimum: 4.5,
    label: 'Text on the neutral accent',
  },
  {
    id: 'info-on-info',
    foreground: 'color.info-content',
    background: 'color.info',
    minimum: 4.5,
    label: 'Text on the info surface',
  },
  {
    id: 'success-on-success',
    foreground: 'color.success-content',
    background: 'color.success',
    minimum: 4.5,
    label: 'Text on the success surface',
  },
  {
    id: 'warning-on-warning',
    foreground: 'color.warning-content',
    background: 'color.warning',
    minimum: 4.5,
    label: 'Text on the warning surface',
  },
  {
    id: 'error-on-error',
    foreground: 'color.error-content',
    background: 'color.error',
    minimum: 4.5,
    label: 'Text on the danger surface',
  },
  {
    id: 'focus-on-surface',
    foreground: 'color.focus-ring',
    background: 'color.base-100',
    minimum: 3,
    label: 'Focus ring against the base surface',
  },
];

/** The high-contrast override gate: primary text must reach 7:1. */
export const HIGH_CONTRAST_GATE: ContrastGate = {
  id: 'high-contrast-text-on-surface',
  foreground: 'color.base-content',
  background: 'color.base-100',
  minimum: 7,
  label: 'Body text on the base surface under the high-contrast override',
};

/** Evaluates every gate and reports the ones that fail. */
export const checkThemeContrast = (
  declarations: readonly ThemeDeclaration[],
  gates: readonly ContrastGate[] = CONTRAST_GATES,
): readonly ThemeValidationIssue[] => {
  const issues: ThemeValidationIssue[] = [];
  for (const gate of gates) {
    const foreground = readColor(declarations, gate.foreground);
    const background = readColor(declarations, gate.background);
    if (foreground === undefined || background === undefined) {
      continue;
    }
    const ratio = roundContrast(contrastRatio(foreground, background));
    if (ratio < gate.minimum) {
      issues.push(
        issue(
          'contrast.below-gate',
          `${gate.label} is ${ratio}:1, below the ${gate.minimum}:1 gate.`,
          `${gate.foreground} on ${gate.background}`,
        ),
      );
    }
  }
  return issues;
};

/** Reports the measured contrast for every gate — used by the validator output. */
export const measureThemeContrast = (
  declarations: readonly ThemeDeclaration[],
  gates: readonly ContrastGate[] = CONTRAST_GATES,
): readonly {
  readonly id: string;
  readonly label: string;
  readonly ratio: number;
  readonly minimum: number;
  readonly passes: boolean;
}[] =>
  gates.flatMap((gate) => {
    const foreground = readColor(declarations, gate.foreground);
    const background = readColor(declarations, gate.background);
    if (foreground === undefined || background === undefined) {
      return [];
    }
    const ratio = roundContrast(contrastRatio(foreground, background));
    return [
      {
        id: gate.id,
        label: gate.label,
        ratio,
        minimum: gate.minimum,
        passes: ratio >= gate.minimum,
      },
    ];
  });

/** Convenience: does a token id exist in the allowlist? */
export const isThemeableToken = (tokenId: string): tokenId is ThemeTokenId =>
  THEME_TOKEN_BY_ID.has(tokenId);
