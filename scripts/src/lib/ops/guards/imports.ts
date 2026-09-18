// scripts/src/lib/ops/guards/imports.ts
//
// AST-based module-import collection, shared by the conventions guards.
//
// Several rules are of the form "this module must not import that specifier":
// a View must not import a service (V3), a ViewModel must not import another
// ViewModel (M8), a service must not import upward (S11), nothing may import
// `$logger` (M6/S7). Those were implemented with regular expressions over the
// raw source, which is wrong in both directions:
//
//   • FALSE POSITIVE — the pattern matches inside a comment or a string, so a
//     doc comment that mentions `from '$services'` trips the guard. A guard
//     that fires on its own documentation teaches people to stop writing it.
//   • FALSE NEGATIVE — `import '$logger'` (a side-effect import) has no `from`
//     clause, and `import {\n  x\n} from '$services'` is not matched by
//     `from ['"]…` because the quote is not on the same line.
//
// The TypeScript parser already answers this question exactly, so the guards
// ask it instead of guessing. Cosmetic rules (a `<style>` block, a `function`
// declaration) still use the local text helpers — this module is only for
// import/dependency questions, where being wrong has architectural consequences.
//
// Pure module: no filesystem access, no `process`.

import ts from 'typescript';

export type ModuleImport = {
  /** The raw module specifier. */
  specifier: string;
  /** 1-indexed line of the declaration. */
  line: number;
  /** True when the binding is erased at compile time (`import type`, `type` clauses). */
  typeOnly: boolean;
  /** `static` for `import`/`export … from`, `dynamic` for `import('…')`. */
  kind: 'static' | 'dynamic';
};

/**
 * Whether an import/export declaration contributes a RUNTIME dependency.
 *
 * A declaration is type-only when the clause is `import type` / `export type`,
 * or when every named binding is individually `type` (e.g.
 * `import { type Options } from …`), which TypeScript erases entirely.
 */
export const isRuntimeDependency = (node: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) {
      return false;
    }
    const clause = node.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      return clause.elements.some((element) => !element.isTypeOnly);
    }
    return true;
  }

  const clause = node.importClause;
  if (!clause) {
    // `import 'side-effect';`
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  if (clause.name) {
    // Default import — a value.
    return true;
  }
  const bindings = clause.namedBindings;
  if (!bindings) {
    return true;
  }
  if (ts.isNamespaceImport(bindings)) {
    return true;
  }
  return bindings.elements.some((element) => !element.isTypeOnly);
};

/** True for a literal `import('…')` call, static or nested. */
export const isDynamicImport = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

/**
 * Every module specifier a source file imports, statically or dynamically.
 *
 * Includes `export … from` re-exports (they load the module) and literal
 * dynamic `import('…')` calls. Non-literal dynamic specifiers are reported with
 * an empty `specifier` so a caller can tell "cannot be checked statically" from
 * "not an import".
 */
export const collectModuleImports = (options: {
  source: string;
  fileName?: string;
  scriptKind?: ts.ScriptKind;
}): ModuleImport[] => {
  const fileName = options.fileName ?? 'module.ts';
  const sourceFile = ts.createSourceFile(
    fileName,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    options.scriptKind ?? ts.ScriptKind.TS,
  );

  const imports: ModuleImport[] = [];
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          line: lineOf(node),
          typeOnly: !isRuntimeDependency(node),
          kind: 'static',
        });
      }
    } else if (isDynamicImport(node)) {
      const [argument] = node.arguments;
      imports.push({
        specifier: argument && ts.isStringLiteral(argument) ? argument.text : '',
        line: lineOf(node),
        typeOnly: false,
        kind: 'dynamic',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return imports;
};

/** Options for {@link findImport}. */
export type FindImportOptions = {
  /** True when the specifier matches the rule. */
  matches: (specifier: string) => boolean;
  /** Restrict to runtime (value) imports. Defaults to true. */
  runtimeOnly?: boolean;
  /** Restrict to statically-analysable imports. Defaults to true. */
  staticOnly?: boolean;
};

/**
 * The first import matching a rule, or `undefined`.
 *
 * Defaults are the ones every current rule wants: a RUNTIME, STATIC import.
 * A type-only import is erased and a non-literal dynamic import cannot be
 * checked, so neither should be reported as a dependency.
 */
export const findImport = (
  imports: readonly ModuleImport[],
  options: FindImportOptions,
): ModuleImport | undefined =>
  imports.find(
    (entry) =>
      ((options.runtimeOnly ?? true) ? !entry.typeOnly : true) &&
      ((options.staticOnly ?? true) ? entry.kind === 'static' : true) &&
      entry.specifier.length > 0 &&
      options.matches(entry.specifier),
  );

/** Every import matching a rule. Same defaults as {@link findImport}. */
export const findImports = (
  imports: readonly ModuleImport[],
  options: FindImportOptions,
): ModuleImport[] =>
  imports.filter(
    (entry) =>
      ((options.runtimeOnly ?? true) ? !entry.typeOnly : true) &&
      ((options.staticOnly ?? true) ? entry.kind === 'static' : true) &&
      entry.specifier.length > 0 &&
      options.matches(entry.specifier),
  );
