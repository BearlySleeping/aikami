// scripts/src/lib/ops/view_model_dependency_rules.ts
//
// Pure AST dependency rules shared by guard_mvvm_conventions.ts (M8/M10) and
// its regression tests. Kept in a separate module so tests can import the
// rules without executing the guard, whose main body runs at import time.
//
// M8 used to strip strings before searching for quoted import paths, which
// erased the very specifiers it was meant to find. Detection here is AST-based
// and shares `isRuntimeDependency` with guard_view_model_composition.ts, so
// type-only contracts stay allowed and aliases/extensions/re-exports are
// handled uniformly.

import ts from 'typescript';
import { isRuntimeDependency } from './guard_view_model_composition.ts';

const specifierBasename = (specifier: string): string =>
  specifier.split(/[?#]/)[0].split('/').pop() ?? '';

/**
 * True when a module specifier targets another ViewModel module
 * (`*_view_model.svelte` / `.svelte.ts`) or a composition wrapper
 * (`*_composition.ts`) that vends production dependencies.
 */
export const isViewModelDependencySpecifier = (specifier: string): boolean => {
  const base = specifierBasename(specifier);
  return /_view_model\.svelte(\.ts)?$/.test(base) || /_composition(\.ts)?$/.test(base);
};

export type ViewModelImportViolation = { line: number; specifier: string };

/** Collects runtime imports of sibling ViewModels / composition wrappers. */
export const collectViewModelImportViolations = (options: {
  file: string;
  source: string;
}): ViewModelImportViolation[] => {
  const sourceFile = ts.createSourceFile(
    options.file,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: ViewModelImportViolation[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
      continue;
    }
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isRuntimeDependency(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!isViewModelDependencySpecifier(specifier)) {
      continue;
    }
    violations.push({
      line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1,
      specifier,
    });
  }
  return violations;
};

/**
 * M10: application ViewModels must not write `__mounted`. That flag is
 * lifecycle-ownership infrastructure (BaseViewModelContainer / the base
 * class), and letting arbitrary parents set it produced the duplicate-create
 * and stale-cache races documented in the settings architecture review.
 */
export const collectMountedWrites = (sourceFile: ts.SourceFile): number[] => {
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const { left } = node;
      const isMountedProperty =
        (ts.isPropertyAccessExpression(left) && left.name.text === '__mounted') ||
        (ts.isElementAccessExpression(left) &&
          ts.isStringLiteral(left.argumentExpression) &&
          left.argumentExpression.text === '__mounted');
      if (isMountedProperty) {
        lines.push(sourceFile.getLineAndCharacterOfPosition(left.getStart(sourceFile)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lines;
};
