// scripts/src/lib/ops/guard_service_mock_coverage.ts
//
// Structural guard: every runtime (value) export of the `$services` barrel
// (apps/frontend/client/src/lib/services/index.ts) must have a matching key
// in test_preload.ts's `localServicesMockBase()` — the shared mock every
// test file is expected to spread when it mocks '$services' (see the doc
// comment above that function).
//
// Without this, a new `$services` export compiles and works in the app but
// silently breaks every test file that transitively imports the module that
// added it — the test doesn't reference the new export directly, so nothing
// local warns; the failure surfaces only in an unrelated file, at test-run
// time, with a "not found in module" SyntaxError. This exact class of bug
// has shipped three times (PRs #241, #243, and the C-466/C-467 merge fixed
// directly on main on 2026-09-05) despite being called out by name in two of
// those PRs' own review notes — hence a structural guard instead of relying
// on review discipline a fourth time.
//
// This is a RATCHET, not a hard-zero gate — see guard_service_conventions.ts
// for the identical mechanism. 106 pre-existing gaps exist today (most never
// crash a test because no test file transitively imports the module that
// adds them — yet); retrofitting all of them is out of scope for what this
// guard exists to prevent. guard_service_mock_coverage_baseline.json
// grandfathers today's gaps; the guard's only job is to stop the set from
// growing, and to nudge the baseline back down when a gap gets covered.
//
// Usage:
//   bun scripts/src/lib/ops/guard_service_mock_coverage.ts
//   bun scripts/src/lib/ops/guard_service_mock_coverage.ts --update-baseline
//   bun scripts/src/lib/ops/guard_service_mock_coverage.ts --show-all
// Exits non-zero if a NEW barrel export lacks a mock-base key, or if a
// baseline-listed gap is now covered but the baseline hasn't been updated to
// drop it. --show-all ignores the baseline (as if empty) and lists every
// current gap, including already-grandfathered ones. --update-baseline
// rewrites the baseline file to exactly match the current gap set.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { annotate } from './gha_annotate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const BARREL_PATH = resolve(ROOT, 'apps/frontend/client/src/lib/services/index.ts');
const TEST_PRELOAD_PATH = resolve(ROOT, 'apps/frontend/client/src/lib/test_preload.ts');
const relPath = (file: string): string => file.replace(`${ROOT}/`, '');

// ── Strip comments (but keep string contents intact — export-statement
// specifiers like './ai/foo.ts' must survive) ───────────────────────────────

const stripComments = (source: string): string => {
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
      result += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          result += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        result += source[i];
        i++;
      }
      if (i < n) {
        result += source[i];
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
};

// ── Strip comments AND string contents (used only where the string's
// contents themselves are irrelevant — mirrors guard_service_conventions.ts)

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

// ── Resolve a barrel's runtime-value export names ───────────────────────────
//
// Follows `export * from './x'` and `export { a, b } from './x'` one level
// into each target file (the barrel's own re-export sources are plain
// leaf/service files in this codebase — none of them re-export a third
// barrel), collecting every VALUE export name. Type-only exports
// (`export type ...`, `export type { A } from ...`, and the `type` modifier
// on an individual named export) are excluded on purpose — they vanish at
// runtime and $services consumers never need a mock for them.

const resolveModulePath = (fromFile: string, specifier: string): string | undefined => {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.svelte.ts`, `${base}/index.ts`];
  return candidates.find((c) => existsSync(c));
};

/** Named-export value identifiers declared directly in one file (not re-exports). */
const localValueExports = (content: string): string[] => {
  const names: string[] = [];
  for (const m of content.matchAll(/^export\s+const\s+(\w+)/gm)) {
    names.push(m[1] ?? '');
  }
  for (const m of content.matchAll(/^export\s+class\s+(\w+)/gm)) {
    names.push(m[1] ?? '');
  }
  for (const m of content.matchAll(/^export\s+function\s+(\w+)/gm)) {
    names.push(m[1] ?? '');
  }
  // `export { a, type B, c as d }` with no `from` — local re-export list.
  for (const m of content.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    const isTypeOnlyStatement = /^export\s+type\s*\{/.test(m[0]);
    if (isTypeOnlyStatement) {
      continue;
    }
    for (const rawEntry of (m[1] ?? '').split(',')) {
      const entry = rawEntry.trim();
      if (!entry || entry.startsWith('type ')) {
        continue;
      }
      const exported = entry
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (exported) {
        names.push(exported);
      }
    }
  }
  return names.filter(Boolean);
};

const visited = new Set<string>();

const collectExports = (file: string): string[] => {
  if (visited.has(file) || !existsSync(file)) {
    return [];
  }
  visited.add(file);
  const content = stripComments(readFileSync(file, 'utf8'));
  const names = new Set(localValueExports(content));

  // `export * from './x'` (value re-export — `export type * from` is a
  // distinct, rarer form and unused in this barrel; skip it if ever added).
  for (const m of content.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    const target = resolveModulePath(file, m[1] ?? '');
    if (target) {
      for (const name of collectExports(target)) {
        names.add(name);
      }
    }
  }

  // `export { a, type b } from './x'` — resolve target only for the entries
  // actually present in this statement, filtering type-only ones.
  for (const m of content.matchAll(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
    const isTypeOnlyStatement = /^export\s+type\s*\{/.test(m[0]);
    if (isTypeOnlyStatement) {
      continue;
    }
    for (const rawEntry of (m[1] ?? '').split(',')) {
      const entry = rawEntry.trim();
      if (!entry || entry.startsWith('type ')) {
        continue;
      }
      const exported = entry
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (exported) {
        names.add(exported);
      }
    }
  }

  return [...names];
};

// ── Extract localServicesMockBase()'s top-level keys ────────────────────────
//
// Brace-depth-aware so a key inside a nested object/array/proxy handler
// literal (several mock entries have one) is never mistaken for a top-level
// mock key.

const extractMockBaseKeys = (content: string): Set<string> => {
  const stripped = stripStringsAndComments(content);
  const startMatch = stripped.match(/localServicesMockBase\s*=\s*\(\)\s*=>\s*\(\{/);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(
      `Could not locate 'export const localServicesMockBase = () => ({' in ${relPath(TEST_PRELOAD_PATH)} — guard needs updating if this was renamed/reshaped.`,
    );
  }
  const openIndex = startMatch.index + startMatch[0].length - 1; // index of the '{'
  let depth = 0;
  let end = openIndex;
  for (let i = openIndex; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      depth++;
    } else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = stripped.slice(openIndex + 1, end);

  const keys = new Set<string>();
  let bodyDepth = 0;
  for (const line of body.split('\n')) {
    const depthBeforeLine = bodyDepth;
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') {
        bodyDepth++;
      } else if (ch === '}' || ch === ')' || ch === ']') {
        bodyDepth--;
      }
    }
    if (depthBeforeLine !== 0) {
      continue;
    }
    const keyMatch = line.match(/^\s*(\w+)\s*:/);
    if (keyMatch?.[1]) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
};

// ── Baseline I/O ─────────────────────────────────────────────────────────
//
// A ratchet, not a hard-zero gate: 106 pre-existing gaps exist today (most
// never crash a test because no test file transitively imports the module
// that adds them — yet). Retrofitting all 106 at once is out of scope for
// what this guard exists to prevent. The baseline grandfathers today's
// gaps; the guard's only job is to make sure the set never grows.

const BASELINE_PATH = resolve(import.meta.dir, 'guard_service_mock_coverage_baseline.json');

const loadBaseline = (): string[] => {
  if (!existsSync(BASELINE_PATH)) {
    return [];
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as string[];
};

// ── Main ─────────────────────────────────────────────────────────────────

const barrelExports = collectExports(BARREL_PATH).sort();
const mockKeys = extractMockBaseKeys(readFileSync(TEST_PRELOAD_PATH, 'utf8'));
const missing = barrelExports.filter((name) => !mockKeys.has(name));

const updateBaseline = Bun.argv.includes('--update-baseline');
const showAll = Bun.argv.includes('--show-all');

if (updateBaseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(missing, null, 2)}\n`);
  console.log(`✅ Baseline updated: ${missing.length} pre-existing gap(s) recorded`);
  process.exit(0);
}

const baseline = showAll ? [] : loadBaseline();
const baselineSet = new Set(baseline);
const missingSet = new Set(missing);

const newGaps = missing.filter((name) => !baselineSet.has(name));
const resolvedGaps = baseline.filter((name) => !missingSet.has(name));

if (newGaps.length > 0) {
  console.error(
    `❌ ${newGaps.length} NEW '$services' export(s) missing from localServicesMockBase() in ${relPath(TEST_PRELOAD_PATH)}:\n`,
  );
  for (const name of newGaps) {
    console.error(`      ${name}`);
    annotate({
      file: relPath(TEST_PRELOAD_PATH),
      line: 1,
      message: `'${name}' is exported from $services but has no key in localServicesMockBase() — add \`${name}: _createServiceStub(),\` (or _createCallableStub()/a literal, matching its real shape).`,
      title: 'service-mock-coverage guard',
    });
  }
  console.error(
    `\n🔴 service-mock-coverage guard failed — add each name above to localServicesMockBase() in test_preload.ts.\n` +
      `   This is the exact regression class behind PRs #241, #243, and the C-466/C-467 test-infra fix (2026-09-05):\n` +
      `   a new $services export works in the app but crashes every test that transitively imports it, in a file\n` +
      `   that never touches the new export directly.`,
  );
  process.exit(1);
}

if (resolvedGaps.length > 0) {
  console.error(
    `❌ ${resolvedGaps.length} baseline entr${resolvedGaps.length === 1 ? 'y is' : 'ies are'} now covered — run with --update-baseline to lock this in:\n`,
  );
  for (const name of resolvedGaps) {
    console.error(`      ${name}`);
  }
  process.exit(1);
}

console.log(
  `✅ service-mock-coverage guard passed — no new gaps (${baseline.length} pre-existing, grandfathered; ${barrelExports.length - baseline.length} of ${barrelExports.length} '$services' exports are covered)`,
);
