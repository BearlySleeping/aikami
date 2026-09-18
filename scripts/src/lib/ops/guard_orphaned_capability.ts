// scripts/src/lib/ops/guard_orphaned_capability.ts
//
// Ratchet guard for RUNTIME capabilities that no production code consumes.
//
// A capability that is exported, wired into the services barrel, and never
// called is dead surface: it costs a public API promise, a test to keep green,
// and a reader's attention. This guard finds those.
//
// ── What it checks ───────────────────────────────────────────────────────
//
// Exported RUNTIME bindings in apps/frontend/client/src/lib/services/**:
//
//   • exported classes and functions;
//   • exported `const` bindings (a singleton, a factory, a schema object);
//   • public methods of exported service classes, keyed `ClassName.method`.
//
// A binding is orphaned when no PRODUCTION file references it — references in
// *.test.ts, __tests__/, *.spec.ts, apps/e2e/ and *.d.ts do not count. Test-only
// use is exactly the case this guard exists to catch: it looks like usage and
// is not.
//
// ── What it deliberately does NOT check ──────────────────────────────────
//
// Type-only exports. `export type Foo = …`, `export interface Foo`, and
// `export type { Foo }` are erased at compile time — they are not runtime
// capabilities and they have no runtime consumer to have. Before this was
// narrowed, `FooServiceInterface` and `FooServiceOptions` were reported as
// orphaned capabilities, which pushed real service modules into deleting or
// relocating legitimate public types to satisfy the guard. That is the guard
// creating architecture work out of a category error.
//
// 🔴 Runtime identity is what matters. A symbol may not be moved from a runtime
// export into a type-only export to silence this guard — if it was a runtime
// capability, it still is one.
//
// ── Ratchet ──────────────────────────────────────────────────────────────
//
// Existing offenders live in guard_orphaned_capability_baseline.json and may
// only shrink (shared framework: scripts/src/lib/ops/guards/ratchet.ts).
// `--update-baseline` is REDUCTION-ONLY — a new orphan can never be blessed by
// running it. The baseline records the orphan SYMBOL NAMES as identities, so
// swapping one orphan for a different one at the same count is detected too.
//
// ── Evidence Matrix ingestion (deliberate, visible seam) ─────────────────
//
// A symbol named by a contract's Evidence Matrix "Production Path" counts as
// in-use. This exists because a contract can legitimately land the wiring in a
// later PR, and deleting the capability in the meantime would be wrong.
//
// 🔴 It is a documentation-driven seam and therefore weaker than a code
// reference: editing a markdown table can silence an orphan. It is kept
// deliberately (removing it today would ADD recorded debt, which is a policy
// change requiring human review) and it is reported explicitly in --show-all
// so a reviewer can see exactly which symbols are being held open by a
// contract rather than by code. Follow-up: replace it with an explicit,
// reviewed baseline entry per rescued symbol.
//
// Usage:
//   bun run src/lib/ops/guard_orphaned_capability.ts
//   bun run src/lib/ops/guard_orphaned_capability.ts --update-baseline  # reductions only
//   bun run src/lib/ops/guard_orphaned_capability.ts --show-all
//   bun run src/lib/ops/guard_orphaned_capability.ts --base-ref=origin/main
//
// Exits non-zero on any new orphan, any resolved orphan not yet locked in, or
// any growth relative to an explicitly configured base revision.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { evidenceMatrixSymbols } from './guards/evidence_matrix.ts';
import type { RatchetRuleSpec, RatchetViolation } from './guards/ratchet.ts';
import { relativeToRoot } from './guards/ratchet_io.ts';
import { runRatchet } from './guards/ratchet_runner.ts';

// Root, service directory and baseline are overridable so tests can run the
// guard against an isolated fixture tree without touching the repository's real
// baseline or reading the real service layer.
const ROOT = resolve(process.env.AIKAMI_GUARD_ROOT ?? resolve(import.meta.dir, '../../../..'));
const SERVICES_DIR = resolve(
  process.env.AIKAMI_GUARD_SERVICES ?? resolve(ROOT, 'apps/frontend/client/src/lib/services'),
);
const BASELINE_PATH = resolve(
  process.env.AIKAMI_GUARD_BASELINE ??
    resolve(import.meta.dir, 'guard_orphaned_capability_baseline.json'),
);
const BASELINE_REL_PATH =
  relativeToRoot(ROOT, BASELINE_PATH) ??
  'scripts/src/lib/ops/guard_orphaned_capability_baseline.json';
const CONTRACTS_DIR_PATH = resolve(
  process.env.AIKAMI_GUARD_CONTRACTS ?? resolve(ROOT, 'docs/contracts'),
);

/** The single ratcheted rule: one orphaned runtime capability. */
export const RULE_SPECS: readonly RatchetRuleSpec[] = [
  {
    id: 'orphans',
    label: 'orphaned runtime capability',
    remediation:
      'Wire it into production, or delete it. A capability used only by its own tests is not used. Do not move it into a type-only export to hide it, and do not raise the orphan baseline.',
  },
];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.svelte-kit',
  'build',
  'dist',
  '.git',
  '__tests__',
]);

// ── File discovery ───────────────────────────────────────────────────────

const relPath = (file: string): string => relative(ROOT, file).split(sep).join('/');

/** Recursively find all .ts and .svelte files under the services dir. */
const collectServiceFiles = (): string[] => {
  const results: string[] = [];
  const walk = (dir: string): void => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath);
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))
        ) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories.
    }
  };
  if (existsSync(SERVICES_DIR)) {
    walk(SERVICES_DIR);
  }
  return results;
};

// ── Export extraction (runtime only) ─────────────────────────────────────

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  Boolean(
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind),
  );

const declarationName = (node: ts.DeclarationStatement): string | undefined =>
  node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

/** Classes reachable from an exported `XService.create(...)` singleton. */
const exportedServiceClasses = (sourceFile: ts.SourceFile): Set<string> => {
  const classNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      classNames.add(statement.name.text);
      continue;
    }
    if (
      !ts.isVariableStatement(statement) ||
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : undefined;
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isPropertyAccessExpression(initializer.expression) &&
        initializer.expression.name.text === 'create' &&
        ts.isIdentifier(initializer.expression.expression)
      ) {
        classNames.add(initializer.expression.expression.text);
      }
    }
  }
  return classNames;
};

/**
 * Extracts the RUNTIME exports of a service module, plus the public methods of
 * every exported service class (keyed `ClassName.methodName` so baseline
 * entries stay stable across line moves).
 *
 * 🔴 Type-only declarations are excluded on purpose. `export type` and
 * `export interface` produce no runtime binding, so there is no runtime
 * consumer for them to lack. `export enum` is NOT type-only — it emits a real
 * object — and is included.
 *
 * 🔴 `export { a } from '…'` (a forward) is also excluded: ownership lives at
 * the declaration, and the declaring file is scanned separately.
 */
export const extractExports = (content: string): string[] => {
  const sourceFile = ts.createSourceFile('service.ts', content, ts.ScriptTarget.Latest, true);
  const exports = new Set<string>();
  const serviceClassNames = exportedServiceClasses(sourceFile);

  for (const statement of sourceFile.statements) {
    // `export { a, b }` — a LOCAL re-export of bindings declared in this file.
    // Those bindings are already collected by the const/function/class scan, so
    // this only matters for a renamed local export.
    //
    // 🔴 `export { a, b } from '…'` is deliberately NOT collected. Forwarding a
    // symbol declared elsewhere is not owning a capability: the declaring file
    // is scanned on its own, so including the forward would double-report it and
    // would attribute foreign symbols (a re-exported constant from
    // `@aikami/constants`, say) to a service barrel that does not own them.
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (statement.moduleSpecifier || !ts.isNamedExports(statement.exportClause)) {
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly || statement.isTypeOnly) {
          continue;
        }
        exports.add(element.propertyName?.text ?? element.name.text);
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.add(declaration.name.text);
        }
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    // Type-only declarations have no runtime binding — see the header.
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      continue;
    }
    if (
      !(
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      )
    ) {
      continue;
    }
    const name = declarationName(statement);
    if (name) {
      exports.add(name);
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isClassDeclaration(statement) ||
      !statement.name ||
      !serviceClassNames.has(statement.name.text)
    ) {
      continue;
    }
    for (const member of statement.members) {
      if (
        !ts.isMethodDeclaration(member) ||
        !member.name ||
        hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
        hasModifier(member, ts.SyntaxKind.ProtectedKeyword) ||
        ts.isPrivateIdentifier(member.name)
      ) {
        continue;
      }
      const methodName =
        ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
          ? member.name.text
          : undefined;
      if (methodName && !methodName.startsWith('_')) {
        exports.add(`${statement.name.text}.${methodName}`);
      }
    }
  }

  return [...exports].filter((symbol) => !symbol.startsWith('_')).sort();
};

// ── Production reference index ───────────────────────────────────────────

/**
 * Check if a reference is in a production (non-test, non-declaration) file.
 * Returns false for:
 *   - *.test.ts, *.spec.ts
 *   - __tests__/ directories
 *   - *.d.ts declaration files
 *   - apps/e2e/
 */
export const isProductionFile = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/__tests__/')) {
    return false;
  }
  if (/\.(test|spec)\.(ts|svelte)$/.test(normalized)) {
    return false;
  }
  if (normalized.endsWith('.d.ts')) {
    return false;
  }
  if (normalized.includes('/apps/e2e/')) {
    return false;
  }
  return true;
};

const isTypeOnlyNode = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isTypeNode(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isExportDeclaration(current)
    ) {
      return true;
    }
    if (ts.isStatement(current) || ts.isSourceFile(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
};

const isDeclarationIdentifier = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    ts.isShorthandPropertyAssignment(parent)
  ) {
    return false;
  }
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
      parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node)
  );
};

const sourceReferenceNames = (sourceFile: ts.SourceFile): Set<string> => {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isTypeOnlyNode(node) && !isDeclarationIdentifier(node)) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
};

/**
 * Extract property access expressions (e.g. `MyService.initialize()`) from a
 * source file, keyed `object.method`. Only captures patterns where the object
 * is a simple identifier — not a computed or chained expression.
 */
const extractPropertyAccessReferences = (sourceFile: ts.SourceFile): Set<string> => {
  const refs = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ts.isIdentifier(node.name)
    ) {
      const propertyName = node.name.text;
      if (
        propertyName !== 'constructor' &&
        !propertyName.startsWith('_') &&
        !isTypeOnlyNode(node) &&
        !isDeclarationIdentifier(node.name)
      ) {
        refs.add(`${node.expression.text}.${propertyName}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return refs;
};

type ProductionSource = { filePath: string; sourceFile: ts.SourceFile };

let productionSourcesCache: ProductionSource[] | undefined;
let productionReferenceIndexCache: Map<string, Set<string>> | undefined;
let propertyAccessIndexCache: Map<string, Set<string>> | undefined;

/** Extracts executable script and template-expression code from a Svelte component. */
export const extractSvelteCode = (content: string): string => {
  const chunks: string[] = [];
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const template = withoutComments
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, script: string) => {
      chunks.push(script);
      return ' '.repeat(match.length);
    })
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => ' '.repeat(match.length));

  for (let index = 0; index < template.length; index++) {
    if (template[index] !== '{') {
      continue;
    }
    const expressionStart = index + 1;
    let depth = 1;
    let quote: '"' | "'" | '`' | undefined;
    let escaped = false;
    for (index = expressionStart; index < template.length; index++) {
      const character = template[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{') {
        depth++;
      } else if (character === '}') {
        depth--;
        if (depth === 0) {
          chunks.push(template.slice(expressionStart, index));
          break;
        }
      }
    }
  }

  return chunks.join('\n');
};

const productionSources = (): ProductionSource[] => {
  if (productionSourcesCache) {
    return productionSourcesCache;
  }

  const results: ProductionSource[] = [];
  const scanDirs = [
    resolve(ROOT, 'apps/frontend/client/src'),
    resolve(ROOT, 'apps/frontend/hub/src'),
    resolve(ROOT, 'packages/frontend'),
  ];
  const walk = (directory: string): void => {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath);
          }
          continue;
        }
        if (
          !entry.isFile() ||
          (!entry.name.endsWith('.ts') && !entry.name.endsWith('.svelte')) ||
          !isProductionFile(fullPath)
        ) {
          continue;
        }
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const analyzableContent = fullPath.endsWith('.svelte')
            ? extractSvelteCode(content)
            : content;
          results.push({
            filePath: fullPath.replace(/\\/g, '/'),
            sourceFile: ts.createSourceFile(
              fullPath,
              analyzableContent,
              ts.ScriptTarget.Latest,
              true,
              fullPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
            ),
          });
        } catch {
          // Skip unreadable source files.
        }
      }
    } catch {
      // Skip inaccessible directories.
    }
  };

  for (const scanDir of scanDirs) {
    if (existsSync(scanDir)) {
      walk(scanDir);
    }
  }
  productionSourcesCache = results;
  return results;
};

const productionReferenceIndex = (): Map<string, Set<string>> => {
  if (productionReferenceIndexCache) {
    return productionReferenceIndexCache;
  }

  const index = new Map<string, Set<string>>();
  const propIndex = new Map<string, Set<string>>();

  for (const source of productionSources()) {
    for (const name of sourceReferenceNames(source.sourceFile)) {
      const files = index.get(name) ?? new Set<string>();
      files.add(source.filePath);
      index.set(name, files);
    }
    for (const propRef of extractPropertyAccessReferences(source.sourceFile)) {
      const files = propIndex.get(propRef) ?? new Set<string>();
      files.add(source.filePath);
      propIndex.set(propRef, files);
    }
  }

  productionReferenceIndexCache = index;
  propertyAccessIndexCache = propIndex;
  return index;
};

/**
 * Resolve production references to a symbol with import-ownership awareness.
 *
 * For bare symbols (no dot), uses the bare-identifier index.
 *
 * For `ClassName.methodName` symbols, first checks the property-access index
 * for exact `ClassName.methodName` matches, so `OtherService.initialize()` does
 * not count as a reference to `MyService.initialize()`. As a secondary
 * fallback, checks the bare method-name index to catch a differently-named
 * variable holding the instance. Both indices must be empty before a method is
 * declared orphaned.
 *
 * References in the declaring file do not count: the declaration is not a
 * consumer, and an export that only its own module calls is not a public
 * capability.
 */
export const findProductionReferences = (options: {
  symbol: string;
  declaringFile: string;
}): string[] => {
  const { symbol, declaringFile } = options;
  const normalizedDeclaring = declaringFile.replace(/\\/g, '/');

  productionReferenceIndex();

  if (!symbol.includes('.')) {
    return [...(productionReferenceIndexCache?.get(symbol) ?? [])].filter(
      (filePath) => filePath !== normalizedDeclaring,
    );
  }

  const methodName = symbol.slice(symbol.lastIndexOf('.') + 1);
  const exactFiles = [...(propertyAccessIndexCache?.get(symbol) ?? [])].filter(
    (filePath) => filePath !== normalizedDeclaring,
  );
  if (exactFiles.length > 0) {
    return exactFiles;
  }
  return [...(productionReferenceIndexCache?.get(methodName) ?? [])].filter(
    (filePath) => filePath !== normalizedDeclaring,
  );
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const serviceFiles = collectServiceFiles();
  // The Evidence Matrix seam lives in guards/evidence_matrix.ts — see that
  // module's header for why it exists and why it is reported, not hidden.
  const evidenceSymbols = evidenceMatrixSymbols({
    contractsDir: CONTRACTS_DIR_PATH,
    servicesDir: SERVICES_DIR,
    root: ROOT,
    excludedDirs: EXCLUDED_DIRS,
    serviceFiles,
    exportedServiceClasses,
  });
  const violations: RatchetViolation[] = [];
  const rescued: string[] = [];

  for (const filePath of serviceFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const exports = extractExports(content);
    if (exports.length === 0) {
      continue;
    }

    const fileRelPath = relPath(filePath);
    for (const symbol of exports) {
      const externalRefs = findProductionReferences({ symbol, declaringFile: filePath }).filter(
        (ref) => ref !== fileRelPath,
      );
      if (externalRefs.length > 0) {
        continue;
      }
      // A symbol named by a contract Evidence Matrix Production Path counts as
      // in-use — see the header for why this seam exists and why it is visible.
      if (evidenceSymbols.get(symbol)?.has(filePath)) {
        rescued.push(`${fileRelPath}: ${symbol}`);
        continue;
      }
      violations.push({
        file: fileRelPath,
        rule: 'orphans',
        line: 1,
        message: `exported runtime capability \`${symbol}\` has no production consumer (test-only or unused)`,
        identity: symbol,
      });
    }
  }

  if (args.includes('--show-all')) {
    console.log(`ℹ️  ${violations.length} orphaned capability symbol(s) found (baseline ignored)`);
    if (rescued.length > 0) {
      console.log(
        `\n⚠️  ${rescued.length} symbol(s) held open by a contract Evidence Matrix Production Path, not by code:`,
      );
      for (const entry of rescued.sort()) {
        console.log(`      ${entry}`);
      }
      console.log(
        '   These are NOT code references. If the contract is stale, the symbol is orphaned.',
      );
    }
  }

  runRatchet({
    name: 'orphaned-capability',
    root: ROOT,
    baselinePath: BASELINE_PATH,
    baselineRelPath: BASELINE_REL_PATH,
    rules: RULE_SPECS,
    violations,
    hardFailures: 0,
    identityAware: true,
    args,
    summary: `${new Set(violations.map((violation) => violation.file)).size} file(s) with orphans`,
  });
};

if (import.meta.main) {
  main();
}
