// scripts/src/lib/ops/guard_service_conventions.ts
//
// Structural guards for the frontend service conventions documented in
// .pi/skills/svelte-conventions/SKILL.md — mirrors guard_mvvm_conventions.ts
// but for `*_service.svelte.ts` files under apps/frontend/client. Modeled on
// ai_gateway_service.svelte.ts as the reference implementation.
//
//   Service rules (*_service.svelte.ts):
//     S1  Declares or imports a `${Name}ServiceOptions` type.
//     S2  Exports a `${Name}ServiceInterface` type.
//     S3  The class extends BaseFrontendClass.
//     S4  Exported via that declared class's `ClassName.create(options)`
//         factory or singleton initializer — never `new ClassName(`.
//     S5  The singleton is exported typed against its `*ServiceInterface`
//         (`export const xService: XServiceInterface = XService.create(...)`)
//         so the concrete class stays swappable/mockable behind the
//         interface.
//     S6  Service imports come from the `$services` barrel, never
//         `$lib/services/*` direct paths.
//     S7  No `$logger` import — BaseFrontendClass provides this.debug() etc.
//     S8  No arrow-function class-field methods — regular methods only, so
//         `this`/`super` and create()'s auto-logging keep working.
//     S9  No exported constants besides the singleton instance — domain
//         constants belong in @aikami/constants or a local data/ folder.
//     S10 No exported types besides `*ServiceOptions`/`*ServiceInterface`
//         (including re-exports) — domain types belong in @aikami/types|
//         schemas or a local types/ folder.
//     S11 Services may not import from `$lib/views/**` or `$views/**` —
//         services must not depend upward on Views/ViewModels. RATCHET
//         (see below) — 3 violations across 3 files.
//     S12 No `await import()` outside the documented allowlist
//         (svelte-conventions/SKILL.md's dynamic-import table). RATCHET —
//         66 violations across 12 files.
//
// S11 and S12 are RATCHETS, not hard-zero gates — see guard_type_safety.ts
// for the identical mechanism. Per-file counts are captured in
// guard_service_conventions_baseline.json and may only go DOWN. S1–S10 have
// zero pre-existing violations and stay hard gates.
//
// Usage:
//   bun scripts/src/lib/ops/guard_service_conventions.ts
//   bun scripts/src/lib/ops/guard_service_conventions.ts --update-baseline
//   bun scripts/src/lib/ops/guard_service_conventions.ts --show-all
// Exits non-zero on any hard-rule violation, any ratchet growth, any ratchet
// reduction not yet locked in, or any growth relative to an explicitly
// configured base revision. --show-all ignores the baseline entirely so every
// current ratchet violation prints. It never writes the baseline file.
//
// 🔴 `--update-baseline` is REDUCTION-ONLY (shared ratchet framework,
// guards/ratchet.ts): it synchronizes improvements, never the current state. A
// new upward import or a new non-allowlisted dynamic import cannot be blessed
// by running the update command.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { isAllowlistedSpecifier, SHARED_ALLOWLIST } from './guards/allowlist.ts';
import { collectModuleImports, findImport, findImports } from './guards/imports.ts';
import type { RatchetRuleSpec, RatchetViolation } from './guards/ratchet.ts';
import { simpleHash } from './guards/ratchet.ts';
import { printHardViolations, runRatchet } from './guards/ratchet_runner.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src/lib/services'),
  resolve(ROOT, 'apps/frontend/hub/src/lib/client/services'),
];
const BASELINE_PATH = resolve(import.meta.dir, 'guard_service_conventions_baseline.json');
const BASELINE_REL_PATH = 'scripts/src/lib/ops/guard_service_conventions_baseline.json';

export const RULES: readonly RatchetRuleSpec[] = [
  {
    id: 's11',
    label: 'S11 service imports from Views/ViewModels',
    remediation:
      'Services must not depend upward. Remove the import; the ViewModel calls the service, never the reverse.',
  },
  {
    id: 's12',
    label: 'S12 non-allowlisted dynamic import',
    remediation:
      'Use a static import, or add the specifier to the documented allowlist in svelte-conventions/SKILL.md with a reason (that allowlist edit is a policy change, not a per-file escape).',
  },
];

const violations: RatchetViolation[] = [];
const ratchetViolations: RatchetViolation[] = [];

const relPath = (file: string): string => file.replace(`${ROOT}/`, '').split(sep).join('/');

const lineOf = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
};

const walk = (dir: string, matches: (name: string) => boolean): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') {
      continue;
    }
    const full = resolve(dir, entry);
    // 🔴 TOCTOU: skip entries that vanish between readdirSync and statSync
    // (e.g. a live Chromium profile's lock/socket files) rather than crashing
    // the whole guard on an unrelated ENOENT.
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

const checkService = (file: string): void => {
  const content = readFileSync(file, 'utf8');
  const base = file.split('/').pop() ?? '';
  const nameMatch = base.match(/^(.*)_service\.svelte\.ts$/);
  if (!nameMatch) {
    return;
  }

  const hasServiceOptions =
    /export type \w*ServiceOptions\s*=/.test(content) ||
    /import\s+type\s*\{[^}]*\b\w*ServiceOptions\b[^}]*\}/s.test(content);
  if (!hasServiceOptions) {
    violations.push({
      file: relPath(file),
      rule: 'S1',
      message: 'missing a declared or imported `*ServiceOptions` type',
      line: 1,
    });
  }
  if (!/export type \w*ServiceInterface\s*=/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S2',
      message: 'missing exported `*ServiceInterface` type',
      line: 1,
    });
  }
  if (
    !/extends BaseFrontendClass[<(]/.test(content) &&
    !/extends BaseFrontendClass\b/.test(content)
  ) {
    violations.push({
      file: relPath(file),
      rule: 'S3',
      message: 'class does not extend BaseFrontendClass',
      line: 1,
    });
  }
  const className = content.match(/\bclass\s+(\w+)\s+extends\s+BaseFrontendClass\b/)?.[1];
  const hasSingletonFactory =
    className !== undefined &&
    new RegExp(
      `export\\s+const\\s+\\w+\\s*:\\s*\\w*ServiceInterface\\s*=\\s*${className}\\.create\\s*\\(`,
    ).test(content);
  const hasExportedFactory =
    className !== undefined &&
    new RegExp(
      `export\\s+const\\s+\\w+\\s*=\\s*[\\s\\S]{0,800}?=>\\s*${className}\\.create\\s*\\(`,
    ).test(content);
  if (!hasSingletonFactory && !hasExportedFactory) {
    violations.push({
      file: relPath(file),
      rule: 'S4',
      message:
        'missing an exported singleton or factory that invokes the declared service class `.create()`',
      line: 1,
    });
  }
  const newInstantiationMatch = className
    ? content.match(new RegExp(`new\\s+${className}\\s*\\(`))
    : null;
  if (newInstantiationMatch) {
    violations.push({
      file: relPath(file),
      rule: 'S4',
      message: 'instantiates the service with `new` instead of `.create()`',
      line: lineOf(content, newInstantiationMatch.index ?? 0),
    });
  }
  const untypedSingletonMatch =
    className !== undefined
      ? content.match(new RegExp(`export\\s+const\\s+\\w+\\s*=\\s*${className}\\.create\\s*\\(`))
      : null;
  if (untypedSingletonMatch) {
    violations.push({
      file: relPath(file),
      rule: 'S5',
      message: 'singleton export is not typed against its `*ServiceInterface`',
      line: lineOf(content, untypedSingletonMatch.index ?? 0),
    });
  }
  const imports = collectModuleImports({ source: content, fileName: file });
  const serviceDirectImport = findImport(imports, {
    matches: (specifier) => specifier.startsWith('$lib/services/'),
  });
  if (serviceDirectImport) {
    violations.push({
      file: relPath(file),
      rule: 'S6',
      message: 'imports a service from `$lib/services/*` instead of the `$services` barrel',
      line: serviceDirectImport.line,
    });
  }
  const loggerImport = findImport(imports, { matches: (specifier) => specifier === '$logger' });
  if (loggerImport) {
    violations.push({
      file: relPath(file),
      rule: 'S7',
      message: 'imports `$logger` — use inherited this.debug()/this.error() instead',
      line: loggerImport.line,
    });
  }

  // S8: arrow-function class-field methods. Matches `name = (...) => {` (or
  // `async (...) =>`) at class-body indentation, excluding $state/$derived
  // assignments (those are reactive fields, not methods).
  const arrowMethodRe =
    /^\s{2,}(?:private |protected |public |override )?_?\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+?)?=>\s*\{/gm;
  for (const match of content.matchAll(arrowMethodRe)) {
    const snippet = match[0];
    if (/\$state|\$derived/.test(snippet)) {
      continue;
    }
    violations.push({
      file: relPath(file),
      rule: 'S8',
      message: `arrow-function class-field method (breaks this/super): \`${snippet.trim()}\``,
      line: lineOf(content, match.index),
    });
  }

  // S9: exported `const` bindings other than the singleton service instance
  // (covers both data constants and stray exported helper functions — both
  // should live outside the service module).
  const exportedConstRe = /^export const (\w+)/gm;
  for (const match of content.matchAll(exportedConstRe)) {
    const name = match[1] ?? '';
    const isClassSingleton =
      className !== undefined &&
      new RegExp(
        `^export const ${name}\\s*:\\s*\\w*ServiceInterface\\s*=\\s*${className}\\.create\\s*\\(`,
        'm',
      ).test(content);
    const isClassFactory =
      className !== undefined &&
      new RegExp(
        `^export const ${name}\\s*=\\s*[\\s\\S]{0,800}?=>\\s*${className}\\.create\\s*\\(`,
        'm',
      ).test(content);
    if (isClassSingleton || isClassFactory) {
      continue;
    }
    violations.push({
      file: relPath(file),
      rule: 'S9',
      message: `exports \`${name}\` — only the singleton service instance should be exported; move constants to @aikami/constants and helper functions to a local data/utils module`,
      line: lineOf(content, match.index),
    });
  }

  // S10: exported types other than *ServiceOptions / *ServiceInterface.
  const exportedTypeRe = /^export type\s*\{?\s*(\w+)/gm;
  for (const match of content.matchAll(exportedTypeRe)) {
    const name = match[1] ?? '';
    if (/ServiceOptions$|ServiceInterface$/.test(name)) {
      continue;
    }
    violations.push({
      file: relPath(file),
      rule: 'S10',
      message: `exports type \`${name}\` — move it to @aikami/types|schemas or a local types/ folder`,
      line: lineOf(content, match.index),
    });
  }

  // S11 is an import/dependency rule, so it is answered by the TypeScript
  // parser rather than a regex: a `from '$services'` inside a doc comment must
  // not trip it, and `import '$views/x'` (no `from` clause) must.
  for (const entry of findImports(imports, {
    matches: (specifier) => specifier.startsWith('$lib/views/') || specifier.startsWith('$views/'),
  })) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 's11',
      message: 'S11 imports from Views/ViewModels — services must not depend upward',
      line: entry.line,
      identity: simpleHash(`s11:${entry.specifier}`),
    });
  }

  // S12: `await import()` outside the documented allowlist — see
  // guards/allowlist.ts for why the matching is exact rather than substring.
  for (const entry of findImports(imports, {
    matches: (specifier) => !isAllowlistedSpecifier(specifier, SHARED_ALLOWLIST),
    kind: 'dynamic',
    awaited: true,
  })) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 's12',
      message: `S12 uses \`await import(${entry.specifier === '' ? '<non-literal>' : `'${entry.specifier}'`})\` — only valid per the allowlist in svelte-conventions/SKILL.md`,
      line: entry.line,
      identity: simpleHash(`s12:${entry.specifier}:${entry.fingerprint}`),
    });
  }
};

// ── Scan ─────────────────────────────────────────────────────────────────

/**
 * Runs the full scan and returns what it found.
 *
 * Exported so a test (and a one-off identity migration) can exercise the REAL
 * collectors instead of re-implementing them — a migration that recomputes
 * identities from a copy of the logic can silently disagree with the guard.
 * The module-level arrays are reset first, so repeated calls are idempotent.
 */
export const collectViolations = (): {
  hard: RatchetViolation[];
  ratcheted: RatchetViolation[];
} => {
  violations.length = 0;
  ratchetViolations.length = 0;
  for (const root of APP_ROOTS) {
    for (const file of walk(root, (n) => n.endsWith('_service.svelte.ts'))) {
      checkService(file);
    }
  }
  return { hard: violations, ratcheted: ratchetViolations };
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = (): void => {
  const { hard, ratcheted } = collectViolations();

  const hardFailures = printHardViolations({
    name: 'service-conventions',
    violations: hard,
    heading: `🔴 service-conventions guard failed — ${hard.length} hard violation(s). S1–S10 have no baseline: fix them.`,
  });

  runRatchet({
    name: 'service-conventions',
    root: ROOT,
    baselinePath: BASELINE_PATH,
    baselineRelPath: BASELINE_REL_PATH,
    rules: RULES,
    violations: ratcheted,
    hardFailures,
    identityAware: true,
    args: process.argv.slice(2),
    contractionSummary: '✅ service-conventions baseline contracted (reductions only)',
  });
};

if (import.meta.main) {
  main();
}
