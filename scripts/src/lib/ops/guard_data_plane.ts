// scripts/src/lib/ops/guard_data_plane.ts
//
// C-436: structural guards for the server data plane's architectural
// invariants — enforced by CI, not by convention.
//
//   I-1  No database module or `drizzle-orm` reference may reach a client
//        bundle. The built-bundle half is proven by `hub:build` + a grep of
//        build/client (documented in the AC-4 evidence); this guard catches
//        the SOURCE-level regressions that would otherwise ship: imports of
//        @aikami/backend-database outside server-only code, or in any
//        .svelte file.
//
//   I-9  No Postgres/Neon dependencies may reappear: `pg`, `postgres`,
//        and `@neondatabase/serverless` must not appear anywhere in
//        workspace sources; drizzle-typebox must not be in the lockfile
//        (peer-depends on the OLD scoped @sinclair/typebox); and
//        @sinclair/typebox must never be added as a direct dependency.
//
//   I-11 @aikami/schemas has no CLI/generator/wrangler surface — no
//        reference to `wrangler`, `drizzle-kit`, or `node:child_process`
//        anywhere in its source or package.json dependencies (C-454 AC-7).
//
// Usage: bun scripts/src/lib/ops/guard_data_plane.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dir, '../../../..');

let failures = 0;

const fail = (message: string): void => {
  failures += 1;
  console.error(`❌ ${message}`);
};

const ok = (message: string): void => {
  console.log(`✅ ${message}`);
};

// ── File walker ─────────────────────────────────────────────────────────

const walk = (dir: string, exts: readonly string[]): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.svelte-kit' || entry === 'build') {
      continue;
    }
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
};

// ── I-1: source-level server-only enforcement ───────────────────────────

const HUB_SRC = resolve(ROOT, 'apps/frontend/hub/src');

/** Hub source extensions the guard scans (client-bound .svelte + server-capable .ts). */
const HUB_SOURCE_EXTS = ['.ts', '.svelte'];

/**
 * Forbidden client-bound references (I-1). `pg` and `drizzle-orm` are
 * matched as module specifiers only, so a bare word like "jpeg" or a
 * comment mentioning drizzle never trips the guard.
 */
const FORBIDDEN_REF_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '@aikami/backend-database', re: /@aikami\/backend-database/ },
  { label: 'drizzle-orm', re: /(?:from\s+|require\(\s*)['"`]drizzle-orm['"`]/ },
];

const guardServerOnlyImports = (): void => {
  const files = walk(HUB_SRC, HUB_SOURCE_EXTS);
  const offenders: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const hits = FORBIDDEN_REF_PATTERNS.filter(({ re }) => re.test(content)).map(
      ({ label }) => label,
    );
    if (hits.length === 0) {
      continue;
    }
    // A .svelte file is ALWAYS client-bound — reject it before evaluating
    // the server-only path exception, which exists only for .ts modules.
    if (file.endsWith('.svelte')) {
      offenders.push(`${file.replace(`${ROOT}/`, '')} (${hits.join(', ')})`);
      continue;
    }
    const isServerOnly =
      file.includes('/lib/server/') || file.endsWith('.server.ts') || file.endsWith('+server.ts');
    if (!isServerOnly) {
      offenders.push(`${file.replace(`${ROOT}/`, '')} (${hits.join(', ')})`);
    }
  }

  if (offenders.length > 0) {
    fail(
      'I-1: database/pg/drizzle/NEON reference outside server-only code:\n' +
        offenders.map((f) => `      ${f}`).join('\n'),
    );
  } else {
    ok('I-1: database references are confined to $lib/server / *.server.ts');
  }
};

// ── I-9: no Postgres/Neon / duplicate-TypeBox dependencies ───────────

/** Every workspace source tree (apps, packages, scripts) and the source extensions to scan. */
const WORKSPACE_TREES = [
  resolve(ROOT, 'apps'),
  resolve(ROOT, 'packages'),
  resolve(ROOT, 'scripts/src'),
];
const SOURCE_EXTS = ['.ts', '.tsx', '.svelte', '.js', '.mjs'];

type ForbiddenPattern = {
  label: string;
  re: RegExp;
};

type ParsedPackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  bundleDependencies?: string[] | boolean;
};

const guardNeonDependencies = (): void => {
  // 1. pg, postgres, @neondatabase/serverless anywhere in workspace sources
  //    (excluding this guard's own source, which names the packages in its docs).
  const sourceFiles = WORKSPACE_TREES.flatMap((tree) => walk(tree, SOURCE_EXTS)).filter(
    (file) => file !== fileURLToPath(import.meta.url),
  );
  const pgHits = sourceFiles.filter((file) => {
    const content = readFileSync(file, 'utf8');
    return (
      content.includes('@neondatabase/serverless') ||
      /(?:from\s+|require\(\s*)['"`]pg['"`]/.test(content) ||
      /(?:from\s+|require\(\s*)['"`]postgres['"`]/.test(content)
    );
  });
  if (pgHits.length > 0) {
    fail(`I-9: pg/postgres/@neondatabase/serverless referenced in ${pgHits.length} file(s)`);
  } else {
    ok('I-9: no pg/postgres/@neondatabase/serverless references');
  }

  // 2. drizzle-typebox must not be in the lockfile.
  const lockPath = resolve(ROOT, 'bun.lock');
  const lockContent = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
  if (lockContent.includes('drizzle-typebox')) {
    fail('I-9: drizzle-typebox present in bun.lock (peer-depends on old @sinclair/typebox)');
  } else {
    ok('I-9: drizzle-typebox absent from bun.lock');
  }

  // 3. @sinclair/typebox must not be a DIRECT dependency of any workspace
  //    package manifest (apps, packages, scripts, root).
  const pkgFiles = [
    ...WORKSPACE_TREES.flatMap((tree) => walk(tree, ['package.json'])),
    resolve(ROOT, 'scripts/package.json'),
    resolve(ROOT, 'package.json'),
  ];
  const sinclairDeps = pkgFiles.filter((file) => {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      pkg.dependencies?.['@sinclair/typebox'] !== undefined ||
      pkg.devDependencies?.['@sinclair/typebox'] !== undefined
    );
  });
  if (sinclairDeps.length > 0) {
    fail(`I-9: @sinclair/typebox is a direct dependency in:\n${sinclairDeps.join('\n')}`);
  } else {
    ok('I-9: @sinclair/typebox not a direct dependency anywhere');
  }
};

// ── I-11: @aikami/schemas has no CLI/generator/wrangler surface ─────────

/**
 * Guard that @aikami/schemas has no reference to wrangler, drizzle-kit, or
 * node:child_process anywhere in its source or package.json dependencies.
 * Enforces AC-7 of C-454: "@aikami/schemas gets no CLI, no generator, no
 * wrangler" structurally, not by convention.
 */
const guardSchemasNoCli = (): void => {
  const SCHEMAS_DIR = resolve(ROOT, 'packages/shared/schemas');
  const SCHEMAS_SRC = resolve(SCHEMAS_DIR, 'src');
  const SCHEMAS_PKG = resolve(SCHEMAS_DIR, 'package.json');

  // 1. Scan source files for forbidden references
  const sourceFiles = walk(SCHEMAS_SRC, SOURCE_EXTS);
  const FORBIDDEN_PATTERNS = [
    { label: 'wrangler', re: /\bwrangler\b/ },
    { label: 'drizzle-kit', re: /\bdrizzle-kit\b/ },
    { label: 'node:child_process', re: /['"`]node:child_process['"`]/ },
  ] as const satisfies readonly ForbiddenPattern[];
  const sourceHits: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    const matched = FORBIDDEN_PATTERNS.filter(({ re }) => re.test(content)).map(
      ({ label }) => label,
    );
    if (matched.length > 0) {
      sourceHits.push(`${file.replace(`${ROOT}/`, '')} (${matched.join(', ')})`);
    }
  }
  if (sourceHits.length > 0) {
    fail(
      'I-11: @aikami/schemas source references forbidden CLI/generator/wrangler:\n' +
        sourceHits.map((f) => `      ${f}`).join('\n'),
    );
  } else {
    ok('I-11: @aikami/schemas source has no CLI/generator/wrangler references');
  }

  // 2. Scan package.json dependencies
  if (existsSync(SCHEMAS_PKG)) {
    const pkg = JSON.parse(readFileSync(SCHEMAS_PKG, 'utf8')) as ParsedPackageManifest;
    const dependencyNames = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...(Array.isArray(pkg.bundledDependencies) ? pkg.bundledDependencies : []),
      ...(Array.isArray(pkg.bundleDependencies) ? pkg.bundleDependencies : []),
    ];
    const forbiddenDeps = dependencyNames.filter(
      (dep) => dep === 'wrangler' || dep === 'drizzle-kit',
    );
    if (forbiddenDeps.length > 0) {
      fail(
        'I-11: @aikami/schemas package.json depends on forbidden package(s): ' +
          forbiddenDeps.join(', '),
      );
    } else {
      ok('I-11: @aikami/schemas package.json has no forbidden CLI/generator deps');
    }
  }
};

// ── Main ────────────────────────────────────────────────────────────────

guardServerOnlyImports();
guardNeonDependencies();
guardSchemasNoCli();

if (failures > 0) {
  console.error(`\n🔴 data-plane guard failed with ${failures} violation(s)`);
  process.exit(1);
}
console.log('\n✅ data-plane guard passed (I-1 source + I-9 + I-11)');
