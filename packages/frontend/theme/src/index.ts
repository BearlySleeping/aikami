// packages/frontend/theme/src/index.ts
//
// Aikami brand palette + UI component layer (C-418 Feature A, daisyUI removal).
//
// The CSS source of truth lives in this package:
//   - src/lib/brand_tokens.css   — plain custom properties (site, docs)
//   - src/lib/aikami_theme.css   — semantic UI palette + Tailwind `@theme`
//                                  registration (client, hub). GENERATED from
//                                  src/lib/theme/builtin/*.json.
//   - src/lib/aikami_ui.css      — Aikami-owned component classes (client, hub)
//
// 🔴 There are still intentionally NO hand-synchronized TS palette constants
// here: the palette is declared as validated token *data*
// (`src/lib/theme/builtin/*.json`) and compiled to CSS. A hand-synced TS copy
// would drift (it already did once — M6). Consumers that need a palette value in
// TS should read the CSS custom property at runtime (getComputedStyle) or use
// the compiler in `src/lib/theme/`, which derives everything from that one
// source.
//
// C-529: this package now also owns the declarative theme compiler — the one
// implementation of "what is a valid theme and what CSS does it produce" — so
// the client runtime, the editor, the Hub and the CLI validator cannot disagree.

export {
  BUILTIN_THEME_VARIANTS,
  isBuiltInThemeId,
  OBSIDIAN_CHRONICLE_DARK,
  OBSIDIAN_CHRONICLE_LIGHT,
} from './lib/theme/builtin_theme.ts';
export {
  buildAccessibilityDeclarations,
  DEFAULT_THEME_ACCESSIBILITY_OVERRIDES,
  isHighContrastSatisfied,
  measureAccessibilityContrast,
  type ThemeAccessibilityOverrides,
} from './lib/theme/theme_accessibility.ts';
export {
  buildThemePackage,
  checkThemeArchiveContainer,
  parseArchiveManifest,
  THEME_ARCHIVE_MANIFEST_ENTRY,
  THEME_COMPRESSION_RATIO_FLOOR_BYTES,
  THEME_MAX_COMPRESSION_RATIO,
  type ThemeArchiveEntry,
  type ThemePackageAssetInput,
  type ThemePackageBuild,
  type ThemePackageBuildInput,
  type ThemePackageFile,
  type ThemePackageHasher,
  toArchiveEntries,
  validateThemeArchive,
} from './lib/theme/theme_archive.ts';
export { contrastRatio, parseColor, serializeColor } from './lib/theme/theme_color.ts';
export {
  CONTRAST_GATES,
  type ContrastGate,
  checkThemeContrast,
  compileThemeTokenFile,
  compileThemeTokenFileJson,
  FONT_ROLE_STACKS,
  FONT_ROLES,
  type FontRole,
  HIGH_CONTRAST_GATE,
  isAliasReference,
  isThemeableToken,
  measureThemeContrast,
  serializeScopeRule,
  type ThemeCompilation,
  type ThemeDeclaration,
} from './lib/theme/theme_compiler.ts';
export {
  BUILTIN_THEME_RENDERABLE_VARIANTS,
  GENERATED_FILE_MARKER,
  generateAikamiThemeCss,
} from './lib/theme/theme_css_generator.ts';
export { isSupportedRasterMediaType, readImageDimensions } from './lib/theme/theme_image.ts';
export {
  isCanonicalPackagePath,
  isThemeApiRangeSupported,
  THEME_IMPLEMENTED_API_MAJOR,
  type ThemePackageReader,
  type ThemePackageValidation,
  validateThemePackage,
} from './lib/theme/theme_package_validation.ts';
