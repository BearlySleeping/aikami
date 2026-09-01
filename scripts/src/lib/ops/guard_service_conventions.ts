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
//         (see below) — 3 pre-existing violations.
//     S12 No `await import()` outside the documented allowlist
//         (svelte-conventions/SKILL.md's dynamic-import table). RATCHET —
//         12 pre-existing violations.
//
// S11 and S12 are RATCHETS, not hard-zero gates — see guard_type_safety.ts
// for the identical mechanism. Per-file counts are captured in
// guard_service_conventions_baseline.json and may only go DOWN. S1–S10 have
// zero pre-existing violations and stay hard gates.
//
// Usage:
//   bun scripts/src/lib/ops/guard_service_conventions.ts
//   bun scripts/src/lib/ops/guard_service_conventions.ts --update-baseline
// Exits non-zero on any hard-rule violation, any ratchet exceeding its
// baseline, or any ratchet improvement not yet locked in via
// --update-baseline.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src/lib/services'),
  resolve(ROOT, 'apps/frontend/hub/src/lib/client/services'),
];
const BASELINE_PATH = resolve(import.meta.dir, 'guard_service_conventions_baseline.json');

type Violation = { file: string; rule: string; message: string };
type RatchetRule = 's11' | 's12';
type RatchetCounts = Record<RatchetRule, number>;
type Baseline = Record<string, RatchetCounts>;

const RATCHET_RULES: RatchetRule[] = ['s11', 's12'];
const emptyCounts = (): RatchetCounts => ({ s11: 0, s12: 0 });

const violations: Violation[] = [];
const ratchetViolations: Violation[] = [];

const relPath = (file: string): string => file.replace(`${ROOT}/`, '');

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
    if (statSync(full).isDirectory()) {
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
    });
  }
  if (!/export type \w*ServiceInterface\s*=/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S2',
      message: 'missing exported `*ServiceInterface` type',
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
    });
  }
  if (className && new RegExp(`new\\s+${className}\\s*\\(`).test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S4',
      message: 'instantiates the service with `new` instead of `.create()`',
    });
  }
  if (
    className !== undefined &&
    new RegExp(`export\\s+const\\s+\\w+\\s*=\\s*${className}\\.create\\s*\\(`).test(content)
  ) {
    violations.push({
      file: relPath(file),
      rule: 'S5',
      message: 'singleton export is not typed against its `*ServiceInterface`',
    });
  }
  if (/from ['"]\$lib\/services\//.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S6',
      message: 'imports a service from `$lib/services/*` instead of the `$services` barrel',
    });
  }
  if (/from ['"]\$logger['"]/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S7',
      message: 'imports `$logger` — use inherited this.debug()/this.error() instead',
    });
  }

  // S8: arrow-function class-field methods. Matches `name = (...) => {` (or
  // `async (...) =>`) at class-body indentation, excluding $state/$derived
  // assignments (those are reactive fields, not methods).
  const arrowMethodRe =
    /^\s{2,}(?:private |protected |public |override )?_?\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+?)?=>\s*\{/gm;
  for (const match of content.matchAll(arrowMethodRe)) {
    const line = match[0];
    if (/\$state|\$derived/.test(line)) {
      continue;
    }
    violations.push({
      file: relPath(file),
      rule: 'S8',
      message: `arrow-function class-field method (breaks this/super): \`${line.trim()}\``,
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
    });
  }

  const viewImportCount = content.match(/from ['"]\$lib\/views\/|from ['"]\$views\//g)?.length ?? 0;
  for (let i = 0; i < viewImportCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'S11',
      message: 'imports from Views/ViewModels — services must not depend upward',
    });
  }

  const dynamicImportCount = content.match(/\bawait\s+import\s*\(/g)?.length ?? 0;
  for (let i = 0; i < dynamicImportCount; i++) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'S12',
      message:
        'uses `await import()` — only valid per the allowlist in svelte-conventions/SKILL.md',
    });
  }
};

// ── Ratchet baseline I/O ─────────────────────────────────────────────────

const loadBaseline = (): Baseline => {
  if (!existsSync(BASELINE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
};

const countsOf = (relPathValue: string): RatchetCounts => {
  const counts = emptyCounts();
  for (const v of ratchetViolations) {
    if (v.file === relPathValue) {
      counts[v.rule.toLowerCase() as RatchetRule]++;
    }
  }
  return counts;
};

// ── Main ─────────────────────────────────────────────────────────────────

for (const root of APP_ROOTS) {
  for (const file of walk(root, (n) => n.endsWith('_service.svelte.ts'))) {
    checkService(file);
  }
}

if (violations.length > 0) {
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
  }
  for (const [file, vs] of byFile) {
    console.error(`❌ ${file}`);
    for (const v of vs) {
      console.error(`      [${v.rule}] ${v.message}`);
    }
  }
  console.error(
    `\n🔴 service-conventions guard failed — ${violations.length} hard violation(s) across ${byFile.size} file(s)`,
  );
  process.exit(1);
}

const updateBaseline = Bun.argv.includes('--update-baseline');
const ratchetFiles = [...new Set(ratchetViolations.map((v) => v.file))].sort();

if (updateBaseline) {
  const baseline: Baseline = {};
  for (const file of ratchetFiles) {
    baseline[file] = countsOf(file);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✅ Baseline updated: ${ratchetFiles.length} file(s) with ratcheted violations`);
  process.exit(0);
}

const baseline = loadBaseline();
const allRatchetPaths = new Set([...ratchetFiles, ...Object.keys(baseline)]);

let ratchetFailed = false;
for (const file of [...allRatchetPaths].sort()) {
  const current = countsOf(file);
  const expected = baseline[file] ?? emptyCounts();
  const lines: string[] = [];

  for (const rule of RATCHET_RULES) {
    if (current[rule] > expected[rule]) {
      ratchetFailed = true;
      lines.push(
        `[${rule.toUpperCase()}] ${current[rule]} found, baseline allows ${expected[rule]}`,
      );
    } else if (current[rule] < expected[rule]) {
      ratchetFailed = true;
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
  }
}

if (ratchetFailed) {
  console.error('\n🔴 service-conventions ratchet guard failed — see violations above');
  process.exit(1);
}

console.log('✅ service-conventions guard passed — all services are compliant');
