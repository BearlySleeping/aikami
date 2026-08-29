#!/usr/bin/env bun
// apps/frontend/client/scripts/write_test_tsconfig.ts
//
// Writes `.svelte-kit/tsconfig.json` with a `paths` map derived from
// vite.config.ts's `kit.alias` — the file tsconfig.test.json (see its
// `extends`) has always expected `svelte-kit sync` to produce.
//
// It doesn't: SvelteKit 3.0.0-next.25's embedded-config mode never writes
// `.svelte-kit/tsconfig.json`. Without it, `bun test
// --tsconfig-override=tsconfig.test.json` sees zero path mappings, and any
// transitively-imported `$logger` / `$lib/...` / `@aikami/...` specifier
// fails with "Cannot find package".
//
// Run before `bun test` in package.json's test:unit script.
//
// Delete this (and revert tsconfig.test.json if changed) once SvelteKit
// writes `.svelte-kit/tsconfig.json` again in embedded-config mode.

// biome-ignore-all lint/suspicious/noConsole: standalone script, no bundler
// context to resolve @aikami/logger's own alias-only import from (see below).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDirectory = resolve(clientRoot, '../../../packages');
const outFile = join(clientRoot, '.svelte-kit', 'tsconfig.json');

// tsconfig `paths` are relative to `baseUrl`, and must use POSIX separators
// even on Windows.
const toPosix = (path: string) => path.split('\\').join('/');
const toBaseUrlRelative = (absolute: string) => toPosix(relative(clientRoot, absolute));

type Alias = { prefix: string; base: string; wildcard: boolean };

const toSrcPath = (path: string) => resolve(clientRoot, 'src', path);

/** Read alias entries from vite.config.ts's `kit.alias` block. */
const readAliases = (): Alias[] => {
  const source = readFileSync(join(clientRoot, 'vite.config.ts'), 'utf8');
  const pattern = /'?([$@][\w/*.-]+)'?:\s*to(Src|Packages)Path\('([^']+)'\)/g;
  return [...source.matchAll(pattern)].map(([, key, kind, value]) => {
    const root = kind === 'Src' ? toSrcPath('') : packagesDirectory;
    const wildcard = (key as string).endsWith('/*');
    const target = (value as string).replace(/\/\*$/, '');
    return {
      prefix: (key as string).replace(/\/\*$/, ''),
      base: join(root, target),
      wildcard,
    };
  });
};

const paths: Record<string, string[]> = {};
for (const alias of readAliases()) {
  const base = toBaseUrlRelative(alias.base);
  const key = alias.wildcard ? `${alias.prefix}/*` : alias.prefix;
  const target = alias.wildcard ? `${base}/*` : base;
  paths[key] = [target];

  if (!alias.wildcard) {
    paths[`${alias.prefix}/*`] ??= [`${base}/*`];
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `${JSON.stringify({ compilerOptions: { baseUrl: '..', paths } }, null, 2)}\n`,
);
console.log(`Wrote ${Object.keys(paths).length} alias path(s) to ${outFile}`);
