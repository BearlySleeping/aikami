// scripts/src/lib/ops/guard_view_model_composition.ts
//
// ViewModel composition-boundary guard.
//
// The explicit-dependency migration keeps `*_view_model.svelte.ts` modules free
// of the application graph: a ViewModel receives its collaborators as typed
// capability options, and production singletons are wired only in a sibling
// `*_composition.ts`. A ViewModel that imports the `$services` barrel (or the
// aggregate `@aikami/frontend/services` package root, which pulls router/dialog/
// R2/preference aggregation as a side effect) reintroduces exactly the hidden
// dependency the migration removes — even when the import looks harmless.
//
//   C1  No runtime `$services` import (bare, subpath, or direct `$lib/services`
//       path). Type-only imports are allowed (they are erased). Literal
//       dynamic `import('$services')` counts the same as a static import.
//   C2  No runtime import from the aggregate `@aikami/frontend/services` root.
//       Base classes and capability types must come from the narrow
//       `@aikami/frontend/services/base` entrypoint (or its own subpaths).
//       Type-only root imports are allowed.
//   C3  Section metadata registries (`*_sections.ts`, but not
//       `*_sections_composition.ts`) must stay inert — no runtime imports of
//       ViewModels, composition wrappers, or service singletons. Factory
//       lookup lives in the sibling composition module.
//
// All rules are RATCHETS: the not-yet-migrated ViewModels are captured in
// guard_view_model_composition_baseline.json and may only go DOWN.
// `--update-baseline` is REDUCTION-ONLY (like guard_source_file_size.ts): it
// locks in improvements but refuses to add a new offender or raise a count, so
// an empty baseline cannot be silently repopulated. Each migration that removes
// an offender must lock the improvement in with --update-baseline.
//
// Usage:
//   bun scripts/src/lib/ops/guard_view_model_composition.ts
//   bun scripts/src/lib/ops/guard_view_model_composition.ts --update-baseline
//   bun scripts/src/lib/ops/guard_view_model_composition.ts --show-all
// Exits non-zero on any new violation or any improvement not yet locked in.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const VIEWS_ROOT = resolve(ROOT, 'apps/frontend/client/src/lib/views');
const BASELINE_PATH = resolve(import.meta.dir, 'guard_view_model_composition_baseline.json');

/** The aggregate package root that loads the whole application service graph. */
const AGGREGATE_SERVICES_SPECIFIER = '@aikami/frontend/services';

export type CompositionRule = 'c1' | 'c2' | 'c3';
export type CompositionCounts = Record<CompositionRule, number>;
export type CompositionViolation = {
  file: string;
  rule: CompositionRule;
  line: number;
  message: string;
};

const RULES: CompositionRule[] = ['c1', 'c2', 'c3'];
const emptyCounts = (): CompositionCounts => ({ c1: 0, c2: 0, c3: 0 });

/** True when the module specifier targets the `$services` barrel. */
export const isServicesBarrelSpecifier = (specifier: string): boolean =>
  specifier === '$services' || specifier.startsWith('$services/');

/** True when a module bypasses the services barrel through its `$lib` path. */
const isDirectServicesSpecifier = (specifier: string): boolean =>
  specifier === '$lib/services' || specifier.startsWith('$lib/services/');

/** True when the module specifier targets the aggregate services package root. */
export const isAggregateServicesSpecifier = (specifier: string): boolean =>
  specifier === AGGREGATE_SERVICES_SPECIFIER;

/**
 * Whether an import/export declaration contributes a runtime dependency.
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

/**
 * Classifies a runtime module specifier into a composition rule, if it violates
 * one. `$services` and direct `$lib/services` paths are C1; the aggregate
 * package root is C2.
 */
const classifySpecifier = (specifier: string): CompositionRule | undefined => {
  if (isServicesBarrelSpecifier(specifier) || isDirectServicesSpecifier(specifier)) {
    return 'c1';
  }
  if (isAggregateServicesSpecifier(specifier)) {
    return 'c2';
  }
  return undefined;
};

const messageForRule = (rule: CompositionRule, specifier: string): string => {
  if (rule === 'c1') {
    return `imports \`${specifier}\` at runtime — inject a typed capability instead (see *_composition.ts)`;
  }
  if (rule === 'c2') {
    return 'imports the aggregate `@aikami/frontend/services` root at runtime — import base classes from `@aikami/frontend/services/base`';
  }
  return `imports \`${specifier}\` at runtime — keep section metadata inert and move factory wiring to *_sections_composition.ts`;
};

/** True for a literal `import('…')` call, static or nested. */
const isDynamicImport = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

/**
 * Collects composition-boundary violations for a single ViewModel module.
 *
 * Covers static `import`/`export … from`, re-export (`export * from`), and
 * literal dynamic `import('…')`, so none of the three shapes can smuggle the
 * service graph back in. Import/export type-only semantics are respected.
 *
 * @param options.file - Path used for the violation label (repo-relative).
 * @param options.source - The module source text.
 */
export const collectCompositionViolations = (options: {
  file: string;
  source: string;
}): CompositionViolation[] => {
  const { file, source } = options;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: CompositionViolation[] = [];

  const record = (rule: CompositionRule, specifier: string, node: ts.Node): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push({ file, rule, line, message: messageForRule(rule, specifier) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isRuntimeDependency(node)
      ) {
        const rule = classifySpecifier(node.moduleSpecifier.text);
        if (rule) {
          record(rule, node.moduleSpecifier.text, node);
        }
      }
    } else if (isDynamicImport(node)) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) {
        const rule = classifySpecifier(argument.text);
        if (rule) {
          record(rule, argument.text, node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations;
};

/**
 * C3: a metadata registry (`*_sections.ts`, but not `*_sections_composition.ts`)
 * must stay inert — labels, groups, and filtering only. Importing a ViewModel
 * factory, a composition wrapper, or a service singleton turns "read the
 * registry" into "load the application graph", so a ViewModel that only needs
 * metadata still constructs production dependencies. Factory lookup belongs in
 * the sibling composition module.
 */
const isInertRegistryName = (name: string): boolean =>
  name.endsWith('_sections.ts') && !name.endsWith('_sections_composition.ts');

const isViewModelOrCompositionSpecifier = (specifier: string): boolean => {
  const base = specifier.split(/[?#]/)[0].split('/').pop() ?? '';
  return /_view_model\.svelte(\.ts)?$/.test(base) || /_composition(\.ts)?$/.test(base);
};

/** Collects registry-purity violations for one metadata module. */
export const collectRegistryPurityViolations = (options: {
  file: string;
  source: string;
}): CompositionViolation[] => {
  const { file, source } = options;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: CompositionViolation[] = [];

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
    const impure =
      isViewModelOrCompositionSpecifier(specifier) ||
      isServicesBarrelSpecifier(specifier) ||
      isDirectServicesSpecifier(specifier) ||
      isAggregateServicesSpecifier(specifier);
    if (!impure) {
      continue;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    violations.push({
      file,
      rule: 'c3',
      line,
      message: `imports \`${specifier}\` at runtime — keep section metadata inert and move factory wiring to *_sections_composition.ts`,
    });
  }

  return violations;
};

const walk = (dir: string, matches: (name: string) => boolean): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.svelte-kit' || entry === 'build') {
      continue;
    }
    const full = resolve(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      out.push(...walk(full, matches));
    } else if (matches(entry)) {
      out.push(full);
    }
  }
  return out;
};

const relPath = (file: string): string => relative(ROOT, file).split(sep).join('/');

// ── Ratchet baseline I/O ─────────────────────────────────────────────────

type Baseline = Record<string, CompositionCounts>;

const loadBaseline = (): Baseline => {
  if (!existsSync(BASELINE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
};

const violations: CompositionViolation[] = [];

const countsOf = (file: string): CompositionCounts => {
  const counts = emptyCounts();
  for (const violation of violations) {
    if (violation.file === file) {
      counts[violation.rule]++;
    }
  }
  return counts;
};

const runGuard = (): void => {
  // Dev sandboxes under `views/dev/` deliberately reach into the service graph
  // to stand up experimental environments; C1/C2 police production ViewModels.
  const isProductionViewModel = (file: string): boolean => {
    const rel = relPath(file);
    return rel.endsWith('_view_model.svelte.ts') && !rel.includes('/views/dev/');
  };

  for (const file of walk(VIEWS_ROOT, (name) => name.endsWith('_view_model.svelte.ts'))) {
    if (!isProductionViewModel(file)) {
      continue;
    }
    violations.push(
      ...collectCompositionViolations({ file: relPath(file), source: readFileSync(file, 'utf8') }),
    );
  }
  for (const file of walk(VIEWS_ROOT, isInertRegistryName)) {
    violations.push(
      ...collectRegistryPurityViolations({
        file: relPath(file),
        source: readFileSync(file, 'utf8'),
      }),
    );
  }

  const updateBaseline = Bun.argv.includes('--update-baseline');
  const showAll = Bun.argv.includes('--show-all');
  const violatingFiles = [...new Set(violations.map((v) => v.file))].sort();

  if (updateBaseline) {
    const previous = loadBaseline();
    const next: Baseline = {};
    for (const file of violatingFiles) {
      next[file] = countsOf(file);
    }
    // Reduction-only, mirroring guard_source_file_size.ts: an empty or small
    // baseline must not be silently repopulated with new offenders.
    const expansions: string[] = [];
    for (const [file, counts] of Object.entries(next)) {
      const before = previous[file] ?? emptyCounts();
      for (const rule of RULES) {
        if (counts[rule] > before[rule]) {
          expansions.push(`${file} [${rule.toUpperCase()}]: ${before[rule]} → ${counts[rule]}`);
        }
      }
    }
    if (expansions.length > 0) {
      console.error('🔴 refusing to update the baseline — it may only shrink or remove entries:');
      for (const expansion of expansions) {
        console.error(`      ${expansion}`);
      }
      console.error(
        '   Fix the new hidden dependency instead. Adding it as an allowance is not a migration.',
      );
      process.exit(1);
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `✅ Baseline updated: ${Object.keys(next).length} ViewModel file(s) pending migration`,
    );
    return;
  }

  const baseline = showAll ? {} : loadBaseline();
  const allPaths = new Set([...violatingFiles, ...Object.keys(baseline)]);

  let failed = false;
  for (const file of [...allPaths].sort()) {
    const current = countsOf(file);
    const expected = { ...emptyCounts(), ...(baseline[file] ?? {}) };
    const lines: string[] = [];

    for (const rule of RULES) {
      if (current[rule] > expected[rule]) {
        failed = true;
        lines.push(
          `[${rule.toUpperCase()}] ${current[rule]} found, baseline allows ${expected[rule]}`,
        );
      } else if (current[rule] < expected[rule]) {
        failed = true;
        lines.push(
          `[${rule.toUpperCase()}] improved to ${current[rule]} (baseline ${expected[rule]}) — run --update-baseline to lock this in`,
        );
      }
    }

    if (lines.length > 0) {
      console.error(`❌ ${file}`);
      for (const line of lines) {
        console.error(`      ${line}`);
      }
      for (const violation of violations.filter((v) => v.file === file)) {
        console.error(
          `        ${file}:${violation.line} [${violation.rule.toUpperCase()}] ${violation.message}`,
        );
        annotate({
          file,
          line: violation.line,
          message: `[${violation.rule.toUpperCase()}] ${violation.message}`,
          title: 'view-model-composition guard',
        });
      }
    }
  }

  if (failed) {
    console.error('\n🔴 view-model-composition guard failed — see violations above');
    process.exit(1);
  }

  console.log(
    '✅ view-model-composition guard passed — ViewModels take no hidden service dependencies',
  );
};

if (import.meta.main) {
  runGuard();
}
