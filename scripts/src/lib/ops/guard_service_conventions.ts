// scripts/src/lib/ops/guard_service_conventions.ts
//
// Structural guards for the frontend service conventions documented in
// .pi/skills/svelte-conventions/SKILL.md — mirrors guard_mvvm_conventions.ts
// but for `*_service.svelte.ts` files under apps/frontend/client. Modeled on
// ai_gateway_service.svelte.ts as the reference implementation.
//
//   Service rules (*_service.svelte.ts):
//     S1  Exports a `${Name}ServiceOptions` type.
//     S2  Exports a `${Name}ServiceInterface` type.
//     S3  The class extends BaseFrontendClass.
//     S4  Exported via a `ClassName.create(options)` factory — never `new
//         ClassName(`.
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
//
// Usage: bun scripts/src/lib/ops/guard_service_conventions.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [resolve(ROOT, 'apps/frontend/client/src/lib/services')];

type Violation = { file: string; rule: string; message: string };

const violations: Violation[] = [];

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

  if (!/export type \w*ServiceOptions\s*=/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S1',
      message: 'missing exported `*ServiceOptions` type',
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
  if (!/\w+\.create\(/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S4',
      message: 'missing `ClassName.create(options)` factory export',
    });
  }
  if (/new\s+\w*Service\s*\(/.test(content)) {
    violations.push({
      file: relPath(file),
      rule: 'S4',
      message: 'instantiates the service with `new` instead of `.create()`',
    });
  }
  if (
    /export const \w+\s*=\s*\w+\.create\(/.test(content) &&
    !/export const \w+\s*:\s*\w*ServiceInterface\s*=\s*\w+\.create\(/.test(content)
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
    if (new RegExp(`^export const ${name}\\s*:?[^=]*=\\s*\\w+\\.create\\(`, 'm').test(content)) {
      continue; // the singleton instance itself
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
    `\n🔴 service-conventions guard failed — ${violations.length} violation(s) across ${byFile.size} file(s)`,
  );
  process.exit(1);
}

console.log('✅ service-conventions guard passed — all services are compliant');
