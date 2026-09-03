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
// Exits non-zero on any hard-rule violation, any ratchet exceeding its
// baseline, or any ratchet improvement not yet locked in via
// --update-baseline. --show-all ignores the baseline entirely (as if it
// were empty) so every current ratchet violation prints, including ones
// already accepted into the baseline. It never writes the baseline file.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const APP_ROOTS = [
  resolve(ROOT, 'apps/frontend/client/src/lib/services'),
  resolve(ROOT, 'apps/frontend/hub/src/lib/client/services'),
];
const BASELINE_PATH = resolve(import.meta.dir, 'guard_service_conventions_baseline.json');

type Violation = { file: string; rule: string; message: string; line: number };
type RatchetRule = 's11' | 's12';
type RatchetCounts = Record<RatchetRule, number>;
type Baseline = Record<string, RatchetCounts>;

const RATCHET_RULES: RatchetRule[] = ['s11', 's12'];
const emptyCounts = (): RatchetCounts => ({ s11: 0, s12: 0 });

const violations: Violation[] = [];
const ratchetViolations: Violation[] = [];

const relPath = (file: string): string => file.replace(`${ROOT}/`, '').split(sep).join('/');

// Blanks out comments and string/template literal contents (preserving
// newlines) so regex matches never fire inside a comment or a string.
const stripStringsAndComments = (source: string): string => {
  let result = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && c2 === '*') {
      result += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      result += ' ';
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += ' ';
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
};

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
  const serviceDirectImportMatch = content.match(/from ['"]\$lib\/services\//);
  if (serviceDirectImportMatch) {
    violations.push({
      file: relPath(file),
      rule: 'S6',
      message: 'imports a service from `$lib/services/*` instead of the `$services` barrel',
      line: lineOf(content, serviceDirectImportMatch.index ?? 0),
    });
  }
  const loggerImportMatch = content.match(/from ['"]\$logger['"]/);
  if (loggerImportMatch) {
    violations.push({
      file: relPath(file),
      rule: 'S7',
      message: 'imports `$logger` — use inherited this.debug()/this.error() instead',
      line: lineOf(content, loggerImportMatch.index ?? 0),
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

  for (const match of content.matchAll(/from ['"]\$lib\/views\/|from ['"]\$views\//g)) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'S11',
      message: 'imports from Views/ViewModels — services must not depend upward',
      line: lineOf(content, match.index),
    });
  }

  const strippedContent = stripStringsAndComments(content);
  // S12 allowlist: dynamic imports that are explicitly permitted.
  // See svelte-conventions/SKILL.md dynamic-import table.
  const allowlistPatterns = [
    /@aikami\/frontend\/engine/,
    /onnxruntime-web/,
    /kokoro-js/,
    /pixi\.js/,
    /@tauri-apps/,
    /\?worker&type=module/,
    /eruda/,
  ];
  const dynamicImportMatches = [...strippedContent.matchAll(/\bawait\s+import\s*\(/g)];
  const dynamicImportCount = dynamicImportMatches.length;
  const allowlistedCount = allowlistPatterns.reduce((count, pattern) => {
    const matches = strippedContent.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
  const effectiveCount = Math.max(0, dynamicImportCount - allowlistedCount);
  // Heuristic: report the last `effectiveCount` occurrences — a best-effort
  // pointer, since which specific call is "non-allowlisted" isn't tracked.
  for (const match of dynamicImportMatches.slice(dynamicImportCount - effectiveCount)) {
    ratchetViolations.push({
      file: relPath(file),
      rule: 'S12',
      message:
        'uses `await import()` — only valid per the allowlist in svelte-conventions/SKILL.md',
      line: lineOf(content, match.index),
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
      console.error(`      ${file}:${v.line} [${v.rule}] ${v.message}`);
      annotate({
        file,
        line: v.line,
        message: `[${v.rule}] ${v.message}`,
        title: 'service-conventions guard',
      });
    }
  }
  console.error(
    `\n🔴 service-conventions guard failed — ${violations.length} hard violation(s) across ${byFile.size} file(s)`,
  );
  process.exit(1);
}

const updateBaseline = Bun.argv.includes('--update-baseline');
const showAll = Bun.argv.includes('--show-all');
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

const baseline = showAll ? {} : loadBaseline();
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
    for (const v of ratchetViolations.filter((r) => r.file === file)) {
      console.error(`        ${file}:${v.line} [${v.rule}] ${v.message}`);
      annotate({
        file,
        line: v.line,
        message: `[${v.rule}] ${v.message}`,
        title: 'service-conventions guard',
      });
    }
  }
}

if (ratchetFailed) {
  console.error('\n🔴 service-conventions ratchet guard failed — see violations above');
  process.exit(1);
}

console.log('✅ service-conventions guard passed — all services are compliant');
