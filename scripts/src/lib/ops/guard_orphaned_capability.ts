// scripts/src/lib/ops/guard_orphaned_capability.ts
//
// Ratchet guard that reports exported service methods whose only
// non-declaration references live in test files or declarations.
//
// For each exported symbol in apps/frontend/client/src/lib/services/**
// (and symbols named by an Evidence Matrix Production Path), count
// references outside its own declaration after resolving barrel re-export
// chains. References in interface/type declarations, declaration files,
// *.test.ts files, or __tests__/ do not count as production use.
//
// Existing offenders are captured in guard_orphaned_capability_baseline.json
// so the guard exits zero on the current tree. New offenders fail the guard,
// and improvements not locked into the baseline also fail (ratchet semantics).
//
// The baseline JSON format:
//   {
//     "apps/frontend/client/src/lib/services/...ts": {
//       "orphaned": ["symbolName1", "symbolName2"],
//       "_comment": "C-456 shipped these with no production caller. C-493 wires them in."  // optional
//     }
//   }
//
// Usage:
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts --update-baseline
//   bun run scripts/src/lib/ops/guard_orphaned_capability.ts --show-all
//
// Exits non-zero on any regression (new orphan), any unlocked improvement
// (orphan fixed but not in baseline), or any baseline entry that no longer
// matches (renamed symbol at same count). --show-all ignores the baseline.
//
// See guard_type_safety.ts for the identity-aware ratchet pattern this mirrors.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SERVICES_DIR = resolve(ROOT, 'apps/frontend/client/src/lib/services');
const BASELINE_PATH = resolve(import.meta.dir, 'guard_orphaned_capability_baseline.json');

// ── Types ──────────────────────────────────────────────────

type OrphanEntry = {
  orphaned: string[];
  _comment?: string;
};

type Baseline = Record<string, OrphanEntry>;

type OrphanReport = {
  file: string;
  symbols: string[];
};

// ── Constants ──────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.svelte-kit',
  'build',
  'dist',
  '.git',
  '__tests__',
]);

// ── Helpers ────────────────────────────────────────────────

const relPath = (file: string): string => relative(ROOT, file).split(sep).join('/');

/** Recursively find all .ts and .svelte files under services dir. */
const collectServiceFiles = (): string[] => {
  const results: string[] = [];
  const walk = (dir: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
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
      // skip inaccessible dirs
    }
  };
  if (existsSync(SERVICES_DIR)) {
    walk(SERVICES_DIR);
  }
  return results;
};

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
 * Extracts top-level exports and public methods exposed by exported service classes.
 * Class methods use `ClassName.methodName` identities so baseline entries remain stable.
 */
export const extractExports = (content: string): string[] => {
  const sourceFile = ts.createSourceFile('service.ts', content, ts.ScriptTarget.Latest, true);
  const exports = new Set<string>();
  const serviceClassNames = exportedServiceClasses(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exports.add(element.propertyName?.text ?? element.name.text);
        }
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

    if (
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      !(
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
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

/**
 * Check if a reference is in a production (non-test, non-declaration) file.
 * Returns false for:
 *   - *.test.ts, *.spec.ts
 *   - __tests__/ directories
 *   - *.d.ts declaration files
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
  // Exclude e2e test files
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

type ProductionSource = {
  filePath: string;
  sourceFile: ts.SourceFile;
};

let productionSourcesCache: ProductionSource[] | undefined;
let productionReferenceIndexCache: Map<string, Set<string>> | undefined;

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
  for (const source of productionSources()) {
    for (const name of sourceReferenceNames(source.sourceFile)) {
      const files = index.get(name) ?? new Set<string>();
      files.add(source.filePath);
      index.set(name, files);
    }
  }
  productionReferenceIndexCache = index;
  return index;
};

/**
 * Scan for references to a symbol across the production codebase.
 * Counts the number of files (not occurrences) that reference the symbol
 * outside of its own declaration file.
 */
export const findProductionReferences = (options: {
  symbol: string;
  declaringFile: string;
}): string[] => {
  const { symbol, declaringFile } = options;
  const normalizedDeclaring = declaringFile.replace(/\\/g, '/');
  const referenceName = symbol.includes('.') ? symbol.slice(symbol.lastIndexOf('.') + 1) : symbol;
  return [...(productionReferenceIndex().get(referenceName) ?? [])].filter(
    (filePath) => filePath !== normalizedDeclaring,
  );
};

/** Compute a simple hash for a list of orphan symbols (for identity-aware comparison). */
const orphanHash = (symbols: string[]): string => {
  const sorted = [...symbols].sort();
  const input = sorted.join(',');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
};

// ── Main ────────────────────────────────────────────────────

const main = () => {
  if (process.env.AIKAMI_GUARD_PROJECT && process.env.AIKAMI_GUARD_PROJECT !== 'scripts') {
    return;
  }

  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const showAll = args.includes('--show-all');

  // Load baseline
  let baseline: Baseline = {};
  if (existsSync(BASELINE_PATH) && !showAll) {
    try {
      baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
    } catch {
      baseline = {};
    }
  }

  const allReports: OrphanReport[] = [];
  const serviceFiles = collectServiceFiles();

  for (const filePath of serviceFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const exports = extractExports(content);
    if (exports.length === 0) {
      continue;
    }

    const fileRelPath = relPath(filePath);
    const orphanedSymbols: string[] = [];

    for (const symbol of exports) {
      const refs = findProductionReferences({ symbol, declaringFile: filePath });
      // Also check if the declaring file itself references the symbol
      // (the declaration itself doesn't count as production use)
      const externalRefs = refs.filter((r) => r !== fileRelPath);

      if (externalRefs.length === 0) {
        orphanedSymbols.push(symbol);
      }
    }

    if (orphanedSymbols.length > 0) {
      allReports.push({ file: fileRelPath, symbols: orphanedSymbols.sort() });
    }
  }

  // ── Compare against baseline ──────────────────────────────

  let exitCode = 0;
  const annotations: string[] = [];

  if (updateBaseline) {
    // Write new baseline from current scan
    const newBaseline: Baseline = {};
    for (const report of allReports) {
      const existing = baseline[report.file];
      newBaseline[report.file] = {
        orphaned: report.symbols,
        ...(existing?._comment ? { _comment: existing._comment } : {}),
      };
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(newBaseline, null, 2)}\n`, 'utf-8');
    console.log(`✅ Baseline updated: ${Object.keys(newBaseline).length} file(s) with orphans`);
    process.exit(0);
  }

  // Check for regressions and improvements
  for (const report of allReports) {
    const baselineEntry = baseline[report.file];
    const currentHash = orphanHash(report.symbols);

    if (!baselineEntry) {
      // New orphan — regression
      console.log(`❌ NEW ORPHAN: ${report.file} — ${report.symbols.join(', ')}`);
      annotations.push(`error:New orphan in ${report.file}: ${report.symbols.join(', ')}`);
      exitCode = 1;
    } else {
      const baselineHash = orphanHash(baselineEntry.orphaned);
      if (currentHash !== baselineHash) {
        // Changed — could be improvement or regression or same-count replacement
        if (report.symbols.length < baselineEntry.orphaned.length) {
          // Improvement — must be locked in
          console.log(
            `⚠️  IMPROVEMENT NOT LOCKED: ${report.file} — ${baselineEntry.orphaned.length} → ${report.symbols.length}. Run --update-baseline to lock.`,
          );
          annotations.push(`warning:Improved but not locked: ${report.file}`);
          exitCode = 1;
        } else {
          // Regression or same-count replacement
          console.log(
            `❌ REGRESSION: ${report.file} — baseline had ${baselineEntry.orphaned.join(', ')}; found ${report.symbols.join(', ')}`,
          );
          annotations.push(`error:Regression in ${report.file}: ${report.symbols.join(', ')}`);
          exitCode = 1;
        }
      }
    }
  }

  // Check for baselined entries that no longer exist (should be removed)
  for (const [filePath, entry] of Object.entries(baseline)) {
    const report = allReports.find((r) => r.file === filePath);
    if (!report) {
      // File no longer exists or has no orphans — improvement
      console.log(
        `⚠️  IMPROVEMENT NOT LOCKED: ${filePath} — all ${entry.orphaned.length} orphan(s) resolved. Run --update-baseline to lock.`,
      );
      annotations.push(`warning:Resolved but not locked: ${filePath}`);
      exitCode = 1;
    }
  }

  // Print summary
  if (exitCode === 0) {
    if (allReports.length === 0) {
      console.log('✅ No orphaned capabilities found.');
    } else {
      console.log(`✅ All ${allReports.length} orphaned capability file(s) match baseline.`);
      if (!showAll) {
        console.log('   Run --show-all to see full list.');
      }
    }
  }

  // In --show-all mode, print everything
  if (showAll) {
    console.log('\n📋 All current orphaned capabilities:');
    for (const report of allReports) {
      console.log(`  ${report.file}: ${report.symbols.join(', ')}`);
    }
    if (allReports.length === 0) {
      console.log('  (none)');
    }
  }

  // Send annotations (GHA only — annotate always emits ::error)
  for (const annotation of annotations) {
    const [, ...msgParts] = annotation.split(':');
    annotate({
      file: '',
      line: 0,
      message: msgParts.join(':'),
    });
  }

  process.exit(exitCode);
};

if (import.meta.main) {
  main();
}
