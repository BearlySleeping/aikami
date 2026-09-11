// scripts/src/lib/ops/guard_service_mock_coverage.ts
//
// Structural guard: every runtime (value) export of the client `$services`
// barrel that is REACHABLE from a Bun-lane test must exist as a key in
// test_preload.ts's `localServicesMockBase()`.
//
// Why reachability and not the whole barrel: the preload globally replaces
// `$services`, so a module reachable from a Bun test that imports a name the
// mock lacks crashes at link time. Only that reachable set is the legacy
// scope. Migrated features — features with their own explicit composition and
// a Vitest browser test — never load the preload, so their services are not in
// the reachable set and must NOT be added to the legacy mock.
//
// This is what makes the guard legacy-scoped. It used to compare every barrel
// export against the preload inventory, which forced authors of new
// (migrated) features to extend the very preload the migration is removing.
//
// Concretely:
//   • `legacy_service_scope.ts` walks the client-internal module graph from
//     every `src/lib/**/*.test.ts` and collects the `$services` names those
//     modules import. That is the required legacy set.
//   • The guard fails if any required name is missing from the mock, or if a
//     required name is not actually a barrel value export.
//
// History: the original regression class (PRs #241, #243, C-466/C-467) is a
// new `$services` export crashing tests that never reference it. That is still
// covered — if those tests are reachable from the Bun lane, the new export is
// in the required set.
//
// Usage:
//   bun scripts/src/lib/ops/guard_service_mock_coverage.ts
//   bun scripts/src/lib/ops/guard_service_mock_coverage.ts --show-all
// Exits non-zero when a reachable `$services` export lacks a preload mock.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { annotate } from './gha_annotate.ts';
import {
  collectRequiredServiceExports,
  computeInventoryViolations,
  nodeFileExists,
  nodeReadFile,
  stripComments,
  stripStringsAndComments,
} from './legacy_service_scope.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const BARREL_PATH = resolve(ROOT, 'apps/frontend/client/src/lib/services/index.ts');
const TEST_PRELOAD_PATH = resolve(
  ROOT,
  'apps/frontend/client/src/lib/testing/local_services_mock.ts',
);
const CLIENT_LIB_ROOT = resolve(ROOT, 'apps/frontend/client/src/lib');
const CLIENT_SRC_ROOT = resolve(ROOT, 'apps/frontend/client/src');
const relPath = (file: string): string => relative(ROOT, file);

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
  return candidates.find((candidate) => existsSync(candidate));
};

/** Named-export value identifiers declared directly in one file (not re-exports). */
const localValueExports = (content: string): string[] => {
  const names: string[] = [];
  for (const match of content.matchAll(/^export\s+const\s+(\w+)/gm)) {
    names.push(match[1] ?? '');
  }
  for (const match of content.matchAll(/^export\s+class\s+(\w+)/gm)) {
    names.push(match[1] ?? '');
  }
  for (const match of content.matchAll(/^export\s+function\s+(\w+)/gm)) {
    names.push(match[1] ?? '');
  }
  // `export { a, type B, c as d }` with no `from` — local re-export list.
  for (const match of content.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    const isTypeOnlyStatement = /^export\s+type\s*\{/.test(match[0]);
    if (isTypeOnlyStatement) {
      continue;
    }
    for (const rawEntry of (match[1] ?? '').split(',')) {
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
  for (const match of content.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    const target = resolveModulePath(file, match[1] ?? '');
    if (target) {
      for (const name of collectExports(target)) {
        names.add(name);
      }
    }
  }

  // `export { a, type b } from './x'` — resolve target only for the entries
  // actually present in this statement, filtering type-only ones.
  for (const match of content.matchAll(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
    const isTypeOnlyStatement = /^export\s+type\s*\{/.test(match[0]);
    if (isTypeOnlyStatement) {
      continue;
    }
    for (const rawEntry of (match[1] ?? '').split(',')) {
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
  for (let index = openIndex; index < stripped.length; index++) {
    if (stripped[index] === '{') {
      depth++;
    } else if (stripped[index] === '}') {
      depth--;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = stripped.slice(openIndex + 1, end);

  const keys = new Set<string>();
  let bodyDepth = 0;
  for (const line of body.split('\n')) {
    const depthBeforeLine = bodyDepth;
    for (const char of line) {
      if (char === '{' || char === '(' || char === '[') {
        bodyDepth++;
      } else if (char === '}' || char === ')' || char === ']') {
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

// ── Bun-lane entry points ───────────────────────────────────────────────────

const collectBunTestFiles = (): string[] => {
  const files: string[] = [];
  const queue = [CLIENT_LIB_ROOT];
  while (queue.length > 0) {
    const directory = queue.pop();
    if (!directory) {
      continue;
    }
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '__tests__') {
        continue;
      }
      const fullPath = resolve(directory, entry);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        queue.push(fullPath);
      } else if (entry.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }
  return files;
};

// ── Main ─────────────────────────────────────────────────────────────────

const INVENTORY_PATH = resolve(import.meta.dir, 'guard_service_mock_coverage_legacy.json');

const readInventory = (): string[] => {
  if (!existsSync(INVENTORY_PATH)) {
    return [];
  }
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as string[];
};

const barrelExports = new Set(collectExports(BARREL_PATH));
const mockKeys = extractMockBaseKeys(readFileSync(TEST_PRELOAD_PATH, 'utf8'));
const testFiles = collectBunTestFiles();
const required = collectRequiredServiceExports({
  entryFiles: testFiles,
  clientSrcRoot: CLIENT_SRC_ROOT,
  readFile: nodeReadFile,
  fileExists: nodeFileExists,
});
// Only barrel value exports need a mock; a `$services` name outside the barrel
// (type-only, or supplied by a test's own module mock) is out of scope.
const requiredBarrelExports = required.filter((name) => barrelExports.has(name));

// `--seed` regenerates the inventory from the static dependency scan. The scan
// deliberately over-approximates (it cannot see runtime `mock.module()`
// replacements), so seeding takes only exports that already have a mock — an
// unmocked reachable entry is by definition not required by a passing test.
// Curate the result after seeding; the normal run enforces the file.
if (Bun.argv.includes('--seed')) {
  const seeded = requiredBarrelExports.filter((name) => mockKeys.has(name)).sort();
  writeFileSync(INVENTORY_PATH, `${JSON.stringify(seeded, null, 2)}\n`);
  console.log(
    `✅ Seeded ${seeded.length} legacy-required '$services' export(s) into ${relPath(INVENTORY_PATH)}`,
  );
  process.exit(0);
}

const inventory = readInventory();
const { missingMocks, notBarrelExports } = computeInventoryViolations({
  inventory,
  mockKeys,
  barrelExports,
});

const showAll = Bun.argv.includes('--show-all');
const staleMockKeys = [...mockKeys].filter((name) => !barrelExports.has(name));
const reachableNotInventoried = requiredBarrelExports.filter((name) => !inventory.includes(name));

if (missingMocks.length > 0 || notBarrelExports.length > 0) {
  if (missingMocks.length > 0) {
    console.error(
      `❌ ${missingMocks.length} legacy scoped '$services' export(s) lost their preload mock — a Bun test that transitively imports one will crash at link time:\n`,
    );
    for (const name of missingMocks) {
      console.error(`      ${name}`);
      annotate({
        file: relPath(TEST_PRELOAD_PATH),
        line: 1,
        message: `'${name}' is in the legacy inventory (${relPath(INVENTORY_PATH)}) but has no localServicesMockBase() key. Add it back, or — if its feature migrated to explicit DI — remove it from both the inventory and the preload.`,
        title: 'service-mock-coverage guard',
      });
    }
  }

  if (notBarrelExports.length > 0) {
    console.error(
      `❌ ${notBarrelExports.length} legacy inventory entr${notBarrelExports.length === 1 ? 'y is' : 'ies are'} no longer a '$services' barrel export — prune the inventory:\n`,
    );
    for (const name of notBarrelExports) {
      console.error(`      ${name}`);
    }
  }

  console.error(
    `\n🔴 service-mock-coverage guard failed — this guard protects the LEGACY preload lane only.\n` +
      `   Scope: ${relPath(INVENTORY_PATH)} — the explicit list of $services exports the legacy lane requires.\n` +
      `   • Migrated features: inject only the capabilities you need via a feature composition file\n` +
      `     (reference: views/settings/account/) and remove their service from both the barrel and this\n` +
      `     inventory, so the scope shrinks.\n` +
      `   • Remaining legacy tests: keep the health of each inventory entry's mock key.`,
  );
  process.exit(1);
}

if (showAll) {
  console.log(`Legacy inventory (${inventory.length}):`);
  for (const name of inventory) {
    console.log(`      ${name}`);
  }
  if (reachableNotInventoried.length > 0) {
    console.log(
      `Reachable via the static scan but not inventoried (${reachableNotInventoried.length}; scan over-approximates, likely runtime-mocked):`,
    );
    for (const name of reachableNotInventoried) {
      console.log(`      ${name}`);
    }
  }
  if (staleMockKeys.length > 0) {
    console.log(`Mock keys that are no longer barrel exports (${staleMockKeys.length}):`);
    for (const name of staleMockKeys) {
      console.log(`      ${name}`);
    }
  }
}

console.log(
  `✅ service-mock-coverage guard passed — ${inventory.length} legacy-scoped export(s) all mocked (${testFiles.length} Bun test file(s) scanned, ${barrelExports.size} barrel exports, ${mockKeys.size} mock keys)`,
);
