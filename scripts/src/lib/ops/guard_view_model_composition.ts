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
//   C1  No runtime `$services` import (bare or subpath). Type-only imports are
//       allowed (they are erased).
//   C2  No runtime import from the aggregate `@aikami/frontend/services` root.
//       Base classes and capability types must come from the narrow
//       `@aikami/frontend/services/base` entrypoint (or its own subpaths).
//       Type-only root imports are allowed.
//
// Both rules are RATCHETS: the not-yet-migrated ViewModels are captured in
// guard_view_model_composition_baseline.json and may only go DOWN. Each
// migration that removes an offender must lock the improvement in with
// --update-baseline (same mechanism as guard_type_safety.ts /
// guard_mvvm_conventions.ts).
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

export type CompositionRule = 'c1' | 'c2';
export type CompositionCounts = Record<CompositionRule, number>;
export type CompositionViolation = {
  file: string;
  rule: CompositionRule;
  line: number;
  message: string;
};

const RULES: CompositionRule[] = ['c1', 'c2'];
const emptyCounts = (): CompositionCounts => ({ c1: 0, c2: 0 });

/** True when the module specifier targets the `$services` barrel. */
export const isServicesBarrelSpecifier = (specifier: string): boolean =>
  specifier === '$services' || specifier.startsWith('$services/');

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
const isRuntimeDependency = (node: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
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
 * Collects composition-boundary violations for a single ViewModel module.
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

  const inspect = (node: ts.ImportDeclaration | ts.ExportDeclaration): void => {
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }
    const specifier = node.moduleSpecifier.text;
    if (!isRuntimeDependency(node)) {
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    if (isServicesBarrelSpecifier(specifier)) {
      violations.push({
        file,
        rule: 'c1',
        line,
        message: `imports \`${specifier}\` at runtime — inject a typed capability instead (see *_composition.ts)`,
      });
    } else if (isAggregateServicesSpecifier(specifier)) {
      violations.push({
        file,
        rule: 'c2',
        line,
        message:
          'imports the aggregate `@aikami/frontend/services` root at runtime — import base classes from `@aikami/frontend/services/base`',
      });
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      inspect(statement);
    }
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
  for (const file of walk(VIEWS_ROOT, (name) => name.endsWith('_view_model.svelte.ts'))) {
    violations.push(
      ...collectCompositionViolations({ file: relPath(file), source: readFileSync(file, 'utf8') }),
    );
  }

  const updateBaseline = Bun.argv.includes('--update-baseline');
  const showAll = Bun.argv.includes('--show-all');
  const violatingFiles = [...new Set(violations.map((v) => v.file))].sort();

  if (updateBaseline) {
    const baseline: Baseline = {};
    for (const file of violatingFiles) {
      baseline[file] = countsOf(file);
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `✅ Baseline updated: ${violatingFiles.length} ViewModel file(s) pending migration`,
    );
    return;
  }

  const baseline = showAll ? {} : loadBaseline();
  const allPaths = new Set([...violatingFiles, ...Object.keys(baseline)]);

  let failed = false;
  for (const file of [...allPaths].sort()) {
    const current = countsOf(file);
    const expected = baseline[file] ?? emptyCounts();
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
