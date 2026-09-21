// packages/frontend/theme/src/lib/theme/builtin_theme.ts
//
// C-529 — the shipped built-in theme, authored as validated token data.
//
// 🔴 These JSON files are the ONLY authoritative palette source. The CSS that
// ships to the browser (`../aikami_theme.css`) is generated from them by
// `generateAikamiThemeCss()` and a drift test regenerates it in CI — there is no
// hand-maintained copy to fall out of sync.
//
// The built-ins are validated through the same schema and the same compiler a
// community package goes through, so "the shipped theme is valid" is a
// consequence of the pipeline rather than a promise.

import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_VERSION,
} from '@aikami/constants';
import type { ThemeTokenFile } from '@aikami/schemas';
import { parseThemeTokenFile } from '@aikami/schemas';
import type { ResolvedThemeDescriptor } from '@aikami/types';
import obsidianChronicleDark from './builtin/obsidian_chronicle.dark.json';
import obsidianChronicleLight from './builtin/obsidian_chronicle.light.json';

const requireValid = (raw: unknown, label: string): ThemeTokenFile => {
  const parsed = parseThemeTokenFile(raw);
  if (parsed === undefined) {
    throw new Error(`Built-in theme token source "${label}" does not satisfy the theme schema.`);
  }
  return parsed;
};

/** The light variant of the shipped default theme. */
export const OBSIDIAN_CHRONICLE_LIGHT: ThemeTokenFile = requireValid(
  obsidianChronicleLight,
  'obsidian_chronicle.light.json',
);

/** The dark variant of the shipped default theme. */
export const OBSIDIAN_CHRONICLE_DARK: ThemeTokenFile = requireValid(
  obsidianChronicleDark,
  'obsidian_chronicle.dark.json',
);

/** Every built-in theme, keyed by id. */
export const BUILTIN_THEME_VARIANTS: Readonly<Record<string, readonly ThemeTokenFile[]>> = {
  [BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE]: [OBSIDIAN_CHRONICLE_LIGHT, OBSIDIAN_CHRONICLE_DARK],
};

/** Every built-in theme as the runtime descriptor shape. */
export const BUILTIN_THEME_DESCRIPTORS: readonly ResolvedThemeDescriptor[] = [
  {
    id: BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
    version: BUILTIN_THEME_VERSION,
    name: BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
    isBuiltIn: true,
    variants: ['light', 'dark'],
  },
];

/** True when the id names a theme this build ships. */
export const isBuiltInThemeId = (themeId: string): boolean =>
  Object.hasOwn(BUILTIN_THEME_VARIANTS, themeId);
