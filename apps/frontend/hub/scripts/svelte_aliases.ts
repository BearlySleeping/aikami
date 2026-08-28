// apps/frontend/hub/scripts/svelte_aliases.ts
//
// Reads the `kit.alias` map straight out of vite.config.ts (hub has no
// svelte.config.js — SvelteKit 3 embeds config in the Vite plugin), so a
// single source of truth drives both:
//
//   - write_test_tsconfig.ts, which turns it into a `paths` map so `bun test`
//     can resolve `$lib/...`, `@aikami/backend/svelte-kit/...` etc. — see that
//     file for why this is necessary at all (SvelteKit 3.0.0-next.25 never
//     writes `.svelte-kit/tsconfig.json` in embedded-config mode, so `bun
//     test --tsconfig-override` sees zero path mappings otherwise).
//   - worker_boundary.test.ts, which walks the server import graph
//     independently of bun's own resolver entirely.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Alias = { prefix: string; base: string; wildcard: boolean };

/**
 * The `kit.alias` map from vite.config.ts, read from the config itself so a
 * new alias cannot silently go unresolved here. The config builds values with
 * `toSrcPath('x')` / `toPackagesPath('x')`, which is regular enough to read
 * without executing it.
 */
export const svelteAliases = (hubRoot: string, packagesDirectory: string): Alias[] => {
  const source = readFileSync(join(hubRoot, 'vite.config.ts'), 'utf8');
  const pattern = /'?([$@][\w/*.-]+)'?:\s*to(Src|Packages)Path\('([^']+)'\)/g;
  return [...source.matchAll(pattern)].map(([, key, kind, value]) => {
    const root = kind === 'Src' ? join(hubRoot, 'src') : packagesDirectory;
    const wildcard = (key as string).endsWith('/*');
    // The config is inconsistent about whether the *value* repeats the `/*`
    // (`'$lib/*': toSrcPath('lib/*')` vs
    // `'@aikami/frontend/services/*': toPackagesPath('frontend/services/src/lib')`).
    // Normalise both sides to a bare directory and rejoin explicitly.
    const target = (value as string).replace(/\/\*$/, '');
    return {
      prefix: (key as string).replace(/\/\*$/, ''),
      base: join(root, target),
      wildcard,
    };
  });
};

/**
 * Longest-prefix match, mirroring Vite: an alias applies to sub-paths whether
 * or not its key ends in `/*` (`$utils` resolves `$utils/catalog.ts`).
 *
 * `$lib` and `$lib/*` are declared with the same prefix but different roots,
 * so ties break toward the wildcard entry for a sub-path and the plain entry
 * for an exact hit.
 */
export const matchAlias = (aliases: Alias[], specifier: string): Alias | undefined => {
  let best: Alias | undefined;
  for (const alias of aliases) {
    const isSubPath = specifier.startsWith(`${alias.prefix}/`);
    if (!isSubPath && specifier !== alias.prefix) {
      continue;
    }
    const better =
      best === undefined ||
      alias.prefix.length > best.prefix.length ||
      (alias.prefix.length === best.prefix.length &&
        alias.wildcard === isSubPath &&
        best.wildcard !== isSubPath);
    if (better) {
      best = alias;
    }
  }
  return best;
};

/** Resolve a path that may be missing its extension or be a directory barrel. */
export const resolveFile = (candidate: string): string | undefined => {
  const attempts = [
    candidate,
    // Some barrels import the emitted name (`./lib/ai/index.js`) while the
    // source on disk is `.ts`.
    ...(candidate.endsWith('.js') ? [candidate.replace(/\.js$/, '.ts')] : []),
    `${candidate}.ts`,
    `${candidate}.js`,
    join(candidate, 'index.ts'),
    join(candidate, 'index.js'),
  ];
  for (const attempt of attempts) {
    try {
      if (statSync(attempt).isFile()) {
        return attempt;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};
