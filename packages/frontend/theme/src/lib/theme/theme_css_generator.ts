// packages/frontend/theme/src/lib/theme/theme_css_generator.ts
//
// C-529 — the deterministic CSS generator.
//
// `aikami_theme.css` is a build artifact of the validated built-in token source.
// This module is the only thing allowed to produce it, and it is a pure
// function of the token data plus the allowlist registry — running it twice on
// the same input produces byte-identical output.
//
// The generated output keeps the four existing package imports working
// unchanged: client and hub import `aikami_theme.css` / `aikami_ui.css`, and
// site/docs keep their own `brand_tokens.css` vocabulary. The global `:root`,
// `:root[data-theme="dark"]` and `prefers-color-scheme` selectors are preserved
// exactly, because the Hub (and the client chrome outside the game scope) still
// depend on them.

import { THEME_SCOPE_ATTRIBUTE, THEME_TOKEN_REGISTRY, THEME_VARIANTS } from '@aikami/constants';
import { OBSIDIAN_CHRONICLE_DARK, OBSIDIAN_CHRONICLE_LIGHT } from './builtin_theme.ts';
import {
  checkThemeContrast,
  compileThemeTokenFile,
  type ThemeDeclaration,
} from './theme_compiler.ts';

/** Marker the drift test looks for. A file without it is not generated output. */
export const GENERATED_FILE_MARKER = '🔴 GENERATED FILE — do not edit by hand';

const HEADER = `/* biome-ignore-all lint/suspicious/noUnknownAtRules: Tailwind v4 directives */
/* packages/frontend/theme/src/lib/aikami_theme.css
 *
 * ${GENERATED_FILE_MARKER}.
 *
 * Source of truth: packages/frontend/theme/src/lib/theme/builtin/*.json,
 * compiled by packages/frontend/theme/src/lib/theme/theme_css_generator.ts.
 * Regenerate with:  bun moon run scripts:theme-build
 * Verify (no writes): bun moon run scripts:theme-validate
 *
 * Aikami UI design tokens — the single source of truth for the client + hub
 * semantic palette, radii, and control metrics.
 *
 * The raw palette lives in \`:root\` / the dark \`@media\` block as \`--ui-*\`
 * custom properties; the \`@theme\` block then registers the semantic tokens with
 * Tailwind v4 so utilities (\`bg-base-100\`, \`text-primary\`, \`border-base-300\`,
 * \`bg-primary/50\`, ...) are generated exactly as before.
 *
 * Component classes that consume these tokens live in \`./aikami_ui.css\`.
 *
 * C-529 Directive 7: \`${THEME_SCOPE_ATTRIBUTE}\` marks the game shell and the
 * appearance preview root. Those selectors inherit the built-in variants from
 * \`:root\`; an installed community theme injects its own \`--ui-*\` declarations
 * beneath that attribute only, so recovery controls and the trusted host chrome
 * keep their styles.
 */`;

/** Custom properties the Aikami-owned component layer still consumes directly. */
const LEGACY_ALIASES: readonly { readonly from: string; readonly to: string }[] = [
  { from: '--border', to: '--ui-border' },
  { from: '--size-selector', to: '--ui-size-selector' },
  { from: '--size-field', to: '--ui-size-field' },
];

const declarationLines = (declarations: readonly ThemeDeclaration[], indent: string): string =>
  declarations.map((entry) => `${indent}${entry.cssVariable}: ${entry.value};`).join('\n');

const legacyLines = (indent: string): string =>
  LEGACY_ALIASES.map((alias) => `${indent}${alias.from}: var(${alias.to});`).join('\n');

/** Compiles one built-in variant, throwing if it does not satisfy the profile. */
const compileVariant = (file: typeof OBSIDIAN_CHRONICLE_LIGHT): readonly ThemeDeclaration[] => {
  const compilation = compileThemeTokenFile(file);
  if (!compilation.ok) {
    const detail = compilation.issues
      .map((entry) => `${entry.code}: ${entry.message}`)
      .join('\n  ');
    throw new Error(`Built-in theme variant "${file.variant}" failed validation:\n  ${detail}`);
  }
  const contrastIssues = checkThemeContrast(compilation.declarations);
  if (contrastIssues.length > 0) {
    const detail = contrastIssues.map((entry) => `${entry.code}: ${entry.message}`).join('\n  ');
    throw new Error(`Built-in theme variant "${file.variant}" fails a contrast gate:\n  ${detail}`);
  }
  return compilation.declarations;
};

/** Tailwind \`@theme\` registrations derived from the allowlist registry. */
const themeBlock = (): string => {
  const lines: string[] = [];
  lines.push('  /* Semantic colors — a theme switch only redefines the `--ui-*` values. */');
  for (const token of THEME_TOKEN_REGISTRY) {
    if (token.type !== 'color') {
      continue;
    }
    const name = token.id.slice('color.'.length);
    lines.push(`  --color-${name}: var(${token.cssVariable});`);
  }
  lines.push('');
  lines.push('  /* Radii — registered so Tailwind generates the `rounded-box`,');
  lines.push('   * `rounded-field`, and `rounded-selector` utilities the UI uses. */');
  for (const token of THEME_TOKEN_REGISTRY) {
    if (!token.id.startsWith('radius.')) {
      continue;
    }
    const name = token.id.slice('radius.'.length);
    lines.push(`  --radius-${name}: var(${token.cssVariable});`);
  }
  return lines.join('\n');
};

/**
 * Generates the complete `aikami_theme.css` contents.
 *
 * Pure: same input → byte-identical output, with no timestamps, no randomness
 * and no environment reads.
 */
export const generateAikamiThemeCss = (): string => {
  const light = compileVariant(OBSIDIAN_CHRONICLE_LIGHT);
  const dark = compileVariant(OBSIDIAN_CHRONICLE_DARK);

  return `${HEADER}

/* ── Light theme (parchment / warm slate) ── */
:root {
  color-scheme: light;

${declarationLines(light, '  ')}

  /* Legacy aliases consumed by aikami_ui.css. They point at the themeable
   * \`--ui-*\` tokens, so a theme switch moves them too. */
${legacyLines('  ')}
}

/* ── Dark theme (obsidian / rune-glow) ── */
/* Explicit dark selection lives OUTSIDE the OS media query so a user-selected
 * dark theme applies even under a light OS preference. The media-query block
 * below only handles the "no explicit choice" default. The token list is
 * intentionally repeated because CSS has no way to share declarations between a
 * media query and a plain rule. */
:root[data-theme="dark"] {
  color-scheme: dark;

${declarationLines(dark, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;

${declarationLines(dark, '    ')}
  }
}

/* Register the semantic palette with Tailwind v4. Values intentionally
 * reference the \`--ui-*\` custom properties above so a theme switch only has to
 * redefine those — the generated utilities track dark mode automatically. */
@theme {
${themeBlock()}
}
`;
};

/** The variant ids the shipped built-in theme can render. */
export const BUILTIN_THEME_RENDERABLE_VARIANTS = THEME_VARIANTS;
