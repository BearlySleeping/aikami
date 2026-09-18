// scripts/src/lib/ops/guard_source_file_size_helpers.ts
//
// Pure logic for guard_source_file_size.ts: thresholds, line counting, file
// classification, and the per-file assessment. Kept separate from the CLI so
// the thresholds and classification can be unit-tested without touching the
// repository's real source tree or its baseline/waiver files.
//
// This is a size guard, not an architecture proof. A small file can still be
// badly designed, and a large declarative table can be perfectly cohesive.
// File size is only a proxy for "one cohesive responsibility"; the guard is
// deliberately a ratchet on existing debt plus a hard stop on brand-new
// oversized modules — not a mandate to split files cosmetically.
//
// The exemption/waiver policy (what a file is allowed to be, and who decided)
// lives in guards/source_size_policy.ts. This module owns measurement.

import ts from 'typescript';
import type { FileStructure } from './guards/source_size_policy.ts';

export type SourceKind = 'production' | 'test';

export type SizeBudget = {
  /** Advisory threshold; exceeding it prints a non-failing warning. */
  warn: number;
  /** Hard limit; a new file above it fails unless explicitly excepted. */
  hard: number;
};

/**
 * Starting policy. Production modules warning at 500 physical lines keeps
 * single-responsibility pressure on long before a file becomes unmaintainable;
 * the hard limit at 800 is where a new module must be justified. Tests carry a
 * higher budget because table-driven cases and fixtures are legitimately long.
 *
 * 🔴 The limit is deliberately NOT the fix for a module that owns too much.
 * See the measured distribution in `--report` mode and the threshold
 * recommendation in .pi/skills/aikami-conventions/SKILL.md before changing it:
 * raising the number moves the problem, it does not remove it.
 */
export const PRODUCTION_BUDGET: SizeBudget = { warn: 500, hard: 800 };
export const TEST_BUDGET: SizeBudget = { warn: 800, hard: 1500 };

export const budgetFor = (kind: SourceKind): SizeBudget =>
  kind === 'test' ? TEST_BUDGET : PRODUCTION_BUDGET;

/** A classified source file with its measured physical line count. */
export type ScannedFile = { path: string; lines: number; kind: SourceKind };

/** Source formats this guard covers — handwritten TS/JS and Svelte components. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'];

export const isSourceFile = (name: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));

/**
 * Counts physical lines: comments and blank lines included. CRLF/CR are
 * normalized to LF, and a single trailing newline does not create a phantom
 * final line (so `"a\n"` is one line, not two), matching how editors and
 * `git diff` present a file.
 */
export const countPhysicalLines = (content: string): number => {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) {
    return 0;
  }
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutTrailingNewline.split('\n').length;
};

/**
 * Documented generated-artifact conventions. These are the repository's actual
 * markers — a SvelteKit/Vite declaration file, the vendored agent skills tree,
 * the generated static asset tree, an explicit `generated/` or `paraglide/`
 * directory, or a `_generated` / `.generated` filename suffix. A handwritten
 * file cannot casually claim one of these without renaming itself to look
 * generated (and the suffix is itself the documented contract).
 */
export const isGeneratedFile = (relPath: string): boolean =>
  relPath.endsWith('.d.ts') ||
  relPath.startsWith('.pi/generated-skills/') ||
  relPath.startsWith('apps/frontend/client/static/') ||
  /(^|\/)(generated|paraglide)\//.test(relPath) ||
  /(^|\/)[^/]*_generated\.[cm]?[jt]sx?$/.test(relPath) ||
  /(^|\/)[^/]*\.generated\.[cm]?[jt]sx?$/.test(relPath);

/** Test classification: unit/spec files, test directories, and the e2e suite. */
export const isTestFile = (relPath: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath) ||
  /(^|\/)(__tests__|tests)\//.test(relPath) ||
  relPath.startsWith('apps/e2e/') ||
  /(^|\/)test_preload\.[cm]?[jt]s$/.test(relPath);

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.svelte-kit',
  '.git',
  'generated-skills',
  'coverage',
  '.turbo',
  '.moon',
  '.vercel',
  '.wrangler',
  '.netlify',
  '.chromium-profile',
]);

const GENERATED_OUTPUT_DIR_NAMES = new Set([
  'build',
  // The local-stack's client build output (`apps/backend/local-stack/.build/`)
  // is gitignored generated output, same as `build`. Without it the guard
  // scanned bundled Worker chunks and reported a multi-thousand-line "new
  // oversized module" that no checkout contains — the failure was
  // environment-dependent (present locally, absent in CI).
  '.build',
  'dist',
  'target',
  'temp',
  'tmp',
  'vendor',
]);

const isProjectRoot = (relPath: string): boolean => {
  if (relPath === 'scripts') {
    return true;
  }
  const segments = relPath.split('/');
  return (
    (segments[0] === 'apps' &&
      ((segments.length === 2 && segments[1] === 'e2e') ||
        (segments.length === 3 && (segments[1] === 'backend' || segments[1] === 'frontend')))) ||
    (segments[0] === 'packages' &&
      segments.length === 3 &&
      (segments[1] === 'backend' || segments[1] === 'frontend' || segments[1] === 'shared'))
  );
};

const isGeneratedOutputRoot = (options: { name: string; relPath: string }): boolean => {
  if (!GENERATED_OUTPUT_DIR_NAMES.has(options.name)) {
    return false;
  }
  const parentPath = options.relPath.slice(0, -(options.name.length + 1));
  return (
    isProjectRoot(parentPath) ||
    (options.name === 'target' && parentPath === 'apps/frontend/client/src-tauri')
  );
};

/**
 * Dependency, build, cache, and vendored directories that are never project
 * source. `.pi/git` and `.pi/workspaces` are vendored/agent-local copies.
 */
export const isExcludedDir = (options: { name: string; relPath: string }): boolean => {
  const { name, relPath } = options;
  return (
    EXCLUDED_DIR_NAMES.has(name) ||
    isGeneratedOutputRoot(options) ||
    name.includes('.cache') ||
    relPath === '.pi/git' ||
    relPath === '.pi/workspaces' ||
    relPath.startsWith('.pi/workspaces/')
  );
};

// ── Structure analysis (for exemption classification) ────────────────────

/**
 * Counts the logic-bearing top-level declarations in a file.
 *
 * Used to verify a `declarative` exemption claim: a data table, a schema or a
 * lookup map contains none, while a service kernel contains many. Without this
 * check, "it is declarative" would be a label an agent could attach to any
 * module to escape the limit.
 *
 * Counted as logic:
 *   • `function` declarations;
 *   • `class` declarations;
 *   • arrow/function expressions bound to a top-level `const`.
 *
 * Not counted: object/array/string literals, `Type.Object({...})` schema
 * calls, `sqliteTable(...)` calls, `as const` maps.
 */
export const analyseFileStructure = (content: string, fileName = 'file.ts'): FileStructure => {
  const sourceFile = parseSourceFile(content, fileName);
  if (sourceFile === undefined) {
    // A file that cannot be parsed — or that parses with errors — cannot be
    // shown to be declarative, so it may not claim a declarative exemption.
    return { logicDeclarations: 1, exportedDeclarations: 1 };
  }

  let logicDeclarations = 0;
  let exportedDeclarations = 0;

  for (const statement of sourceFile.statements) {
    const exported = isExported(statement);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      logicDeclarations++;
      if (exported) {
        exportedDeclarations++;
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!isFunctionLike(declaration.initializer)) {
        continue;
      }
      logicDeclarations++;
      if (exported) {
        exportedDeclarations++;
      }
    }
  }

  return { logicDeclarations, exportedDeclarations };
};

/**
 * Parses a file, or returns `undefined` when it cannot be parsed cleanly.
 *
 * `createSourceFile` is error-tolerant: it returns a tree with error nodes
 * rather than throwing. A file with parse diagnostics is treated the same as a
 * throw, because neither can be proven declarative.
 */
const parseSourceFile = (content: string, fileName: string): ts.SourceFile | undefined => {
  try {
    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.svelte') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
    );
    const diagnostics = (sourceFile as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
    if (diagnostics !== undefined && diagnostics.length > 0) {
      return undefined;
    }
    return sourceFile;
  } catch {
    return undefined;
  }
};

const isExported = (node: ts.Node): boolean =>
  Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );

/** True when an expression is a function or arrow function, unwrapping casts. */
const isFunctionLike = (expression: ts.Expression | undefined): boolean => {
  if (!expression) {
    return false;
  }
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current);
};
