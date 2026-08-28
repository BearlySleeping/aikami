#!/usr/bin/env bun
// apps/frontend/hub/scripts/write_test_tsconfig.ts
//
// Writes `.svelte-kit/tsconfig.json` with a `paths` map derived from
// vite.config.ts's `kit.alias` — the file tsconfig.test.json (see its
// `extends`) has always expected `svelte-kit sync` to produce.
//
// It doesn't: confirmed by running `bunx svelte-kit sync` and inspecting
// `.svelte-kit/` — SvelteKit 3.0.0-next.25's embedded-config mode (hub has no
// svelte.config.js) never writes it. Without it, `bun test
// --tsconfig-override=tsconfig.test.json` sees zero path mappings, and any
// transitively-imported `$lib/...` / `@aikami/backend/svelte-kit/...`
// specifier fails with "Cannot find module" — silently, because nothing else
// in the hub test suite happens to import through an alias, so this went
// unnoticed until C-... (server_bundle_purity.test.ts's hang was masking the
// real test output entirely).
//
// Run before `bun test` in package.json's test/test:unit scripts. Confirmed
// via a minimal repro that `bun test --tsconfig-override` DOES honor a
// `paths` map when the file exists directly (unlike the missing-`extends`
// case) — so this is a real fix, not a workaround for a second Bun bug.
//
// Delete this (and revert tsconfig.test.json if changed) once SvelteKit
// writes `.svelte-kit/tsconfig.json` again in embedded-config mode.

// biome-ignore-all lint/suspicious/noConsole: standalone script, no bundler
// context to resolve @aikami/logger's own alias-only import from (see below).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelteAliases } from './svelte_aliases';

const hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDirectory = resolve(hubRoot, '../../../packages');
const outFile = join(hubRoot, '.svelte-kit', 'tsconfig.json');

// tsconfig `paths` are relative to `baseUrl`, and must use POSIX separators
// even on Windows.
const toPosix = (path: string) => path.split('\\').join('/');
const toBaseUrlRelative = (absolute: string) => toPosix(relative(hubRoot, absolute));

const paths: Record<string, string[]> = {};
for (const alias of svelteAliases(hubRoot, packagesDirectory)) {
  const base = toBaseUrlRelative(alias.base);
  const key = alias.wildcard ? `${alias.prefix}/*` : alias.prefix;
  const target = alias.wildcard ? `${base}/*` : base;
  // `$lib` (bare) and `$lib/*` (wildcard) are declared separately with
  // different roots (see svelte_aliases.ts) — both keys are kept as-is,
  // matching how Vite treats them, rather than merged into one entry.
  paths[key] = [target];

  // Unlike Vite's alias resolver (which lets a bare, non-wildcard key like
  // `$utils` resolve a subpath such as `$utils/catalog.ts` too — see
  // svelte_aliases.ts's matchAlias docstring), TypeScript's `paths` treats a
  // bare key as an exact match only. Add the `/*` counterpart so a subpath
  // import resolves the same way here, UNLESS this prefix already has its
  // own distinct wildcard entry (the `$lib` / `$lib/*` case, mapped to
  // different roots on purpose) that this loop will emit separately.
  if (!alias.wildcard) {
    paths[`${alias.prefix}/*`] ??= [`${base}/*`];
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  // `baseUrl` is resolved relative to THIS file's own directory
  // (.svelte-kit/), not the tsconfig.test.json that extends it — so it must
  // point back up at hubRoot (".."), matching the hubRoot-relative `paths`
  // values above.
  `${JSON.stringify({ compilerOptions: { baseUrl: '..', paths } }, null, 2)}\n`,
);
console.log(`Wrote ${Object.keys(paths).length} alias path(s) to ${outFile}`);
