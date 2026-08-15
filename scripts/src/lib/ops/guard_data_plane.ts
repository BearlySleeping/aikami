// scripts/src/lib/ops/guard_data_plane.ts
//
// C-394 AC-4: structural guards for the server data plane's architectural
// invariants — enforced by CI, not by convention.
//
//   I-1  No database module, `pg`, `drizzle-orm` or NEON_DATABASE_URL
//        reference may reach a client bundle. The built-bundle half is
//        proven by `hub:build` + a grep of build/client (documented in the
//        AC-4 evidence); this guard catches the SOURCE-level regressions
//        that would otherwise ship: imports of @aikami/backend-database
//        outside server-only code, or in any .svelte file.
//
//   I-9  No Neon-proprietary dependency: @neondatabase/serverless must not
//        appear anywhere; drizzle-typebox must not be in the lockfile
//        (peer-depends on the OLD scoped @sinclair/typebox); and
//        @sinclair/typebox must never be added as a direct dependency.
//
// Usage: bun scripts/src/lib/ops/guard_data_plane.ts
// Exits non-zero on any violation.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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

const guardServerOnlyImports = (): void => {
  const files = walk(HUB_SRC, ['.ts', '.svelte']);
  const offenders: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes('@aikami/backend-database')) {
      continue;
    }
    const isServerOnly =
      file.includes('/lib/server/') || file.endsWith('.server.ts') || file.endsWith('+server.ts');
    if (!isServerOnly) {
      offenders.push(file.replace(`${ROOT}/`, ''));
    }
  }

  if (offenders.length > 0) {
    fail(
      'I-1: @aikami/backend-database imported outside server-only code:\n' +
        offenders.map((f) => `      ${f}`).join('\n'),
    );
  } else {
    ok('I-1: database package imports are confined to $lib/server / *.server.ts');
  }
};

// ── I-9: no Neon-proprietary / duplicate-TypeBox dependencies ───────────

const guardNeonDependencies = (): void => {
  // 1. @neondatabase/serverless anywhere in TypeScript sources.
  const tsFiles = [
    ...walk(resolve(ROOT, 'apps'), ['.ts']),
    ...walk(resolve(ROOT, 'packages'), ['.ts']),
  ];
  const neondbHits = tsFiles.filter((file) =>
    readFileSync(file, 'utf8').includes('@neondatabase/serverless'),
  );
  if (neondbHits.length > 0) {
    fail(`I-9: @neondatabase/serverless referenced in ${neondbHits.length} file(s)`);
  } else {
    ok('I-9: no @neondatabase/serverless references');
  }

  // 2. drizzle-typebox must not be in the lockfile.
  const lockPath = resolve(ROOT, 'bun.lock');
  const lockContent = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
  if (lockContent.includes('drizzle-typebox')) {
    fail('I-9: drizzle-typebox present in bun.lock (peer-depends on old @sinclair/typebox)');
  } else {
    ok('I-9: drizzle-typebox absent from bun.lock');
  }

  // 3. @sinclair/typebox must not be a DIRECT dependency of any package.
  const pkgFiles = [
    ...walk(resolve(ROOT, 'apps'), ['package.json']),
    ...walk(resolve(ROOT, 'packages'), ['package.json']),
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

// ── Main ────────────────────────────────────────────────────────────────

guardServerOnlyImports();
guardNeonDependencies();

if (failures > 0) {
  console.error(`\n🔴 data-plane guard failed with ${failures} violation(s)`);
  process.exit(1);
}
console.log('\n✅ data-plane guard passed (I-1 source + I-9)');
