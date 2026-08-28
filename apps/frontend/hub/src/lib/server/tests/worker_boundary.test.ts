// apps/frontend/hub/src/lib/server/tests/worker_boundary.test.ts
//
// 🔴 THE WORKERS BOUNDARY — the whole point of this file.
//
// The hub deploys to Cloudflare Workers (C-426): `@sveltejs/adapter-cloudflare`
// + wrangler.jsonc, running on workerd, not Bun and not Node. `nodejs_compat`
// is on, so *some* `node:*` builtins resolve — but only some, and the set is
// not the one Bun gives you locally.
//
// A `node:fs` import in the server graph therefore builds fine, passes
// `bun test`, passes `moon check`, and then throws on the first production
// request. Nothing in the toolchain catches it: Vite externalizes Node
// builtins rather than erroring, and `vite preview` runs under Bun where they
// all work.
//
// So this test walks the *server* import graph — `hooks.server.ts`, every
// `+server.ts` / `+*.server.ts`, and everything they reach, including across
// workspace packages — and fails on any `node:*` specifier not in ALLOWED
// below. Adding a specifier to ALLOWED is the moment to check Cloudflare's
// compat table; the list is deliberately small so that stays a conscious act.
//
// Scope: the server-only graph. `.svelte` components also execute during SSR,
// but a component importing `node:fs` is a different mistake with a different
// smell, and walking the full component graph would cost far more than it
// catches.

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { matchAlias, resolveFile, svelteAliases } from '../../../../scripts/svelte_aliases';

const hubRoot = resolve(import.meta.dir, '../../../..');
const repoRoot = resolve(hubRoot, '../../..');
const packagesDirectory = join(repoRoot, 'packages');

/**
 * `node:*` specifiers the Worker graph is permitted to import.
 *
 * Deliberately short. Before adding one, confirm it is listed as supported at
 * https://developers.cloudflare.com/workers/runtime-apis/nodejs/ — "it works
 * in `vite preview`" proves nothing, because preview runs under Bun.
 */
const ALLOWED = new Set<string>([
  // AsyncLocalStorage — workerd implements this natively (it predates
  // nodejs_compat as the `nodejs_als` flag). Reached via @aikami/logger's
  // request-scoped log context.
  'node:async_hooks',
  // Shimmed under nodejs_compat; @aikami/logger reads env/log level from it.
  'node:process',
]);

/** Specifiers SvelteKit synthesises at build time — no file to walk. */
const VIRTUAL_PREFIXES = ['$env/', './$types', '$app/'];

/**
 * Blank out comments so a commented-out import is not mistaken for a real one.
 *
 * Line lengths are preserved (comment bodies become spaces) purely so the
 * regexes downstream see the same shape they would in the original source.
 * `packages/frontend/utils/src/lib/internal.ts` is the reason this exists: it
 * carries a commented-out `import('./firebase/app-check')` that the resolver
 * otherwise reported as a dangling import.
 */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      // Not perfect — a `//` inside a string literal would be cut early. That
      // only ever removes text from a line, so it cannot invent an import.
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');

/** Test scaffolding runs under Bun on a dev machine, never in the Worker. */
const isTestFile = (file: string): boolean =>
  file.includes('.test.') || /[/\\](?:tests|__tests__)[/\\]/.test(file);

/** Every file under `directory` matching `predicate`, recursively. */
const filesUnder = (directory: string, predicate: (file: string) => boolean): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(full, predicate));
    } else if (predicate(full)) {
      found.push(full);
    }
  }
  return found;
};

/** Workspace package name → its entry files, from each package.json. */
const workspaceEntries = (): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const scope of readdirSync(packagesDirectory)) {
    const scopeDirectory = join(packagesDirectory, scope);
    if (!statSync(scopeDirectory).isDirectory()) {
      continue;
    }
    for (const name of readdirSync(scopeDirectory)) {
      const packageDirectory = join(scopeDirectory, name);
      let manifest: { name?: string; main?: string; exports?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
      } catch {
        continue; // Not a package directory.
      }
      if (!manifest.name) {
        continue;
      }
      if (manifest.main) {
        entries.set(manifest.name, join(packageDirectory, manifest.main));
      }
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        if (typeof target !== 'string') {
          continue;
        }
        const key = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
        entries.set(key, join(packageDirectory, target));
      }
    }
  }
  return entries;
};

const ALIASES = svelteAliases(hubRoot, packagesDirectory);
const WORKSPACE = workspaceEntries();

type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'node'; specifier: string }
  | { kind: 'external' }
  | { kind: 'unresolved' };

const resolveSpecifier = (specifier: string, importer: string): Resolution => {
  if (specifier.startsWith('node:')) {
    return { kind: 'node', specifier };
  }
  if (VIRTUAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return { kind: 'external' };
  }
  if (specifier.startsWith('.')) {
    const path = resolveFile(resolve(dirname(importer), specifier));
    return path ? { kind: 'file', path } : { kind: 'unresolved' };
  }

  const alias = matchAlias(ALIASES, specifier);
  if (alias !== undefined) {
    const rest = specifier.slice(alias.prefix.length).replace(/^\//, '');
    const path = resolveFile(rest ? join(alias.base, rest) : alias.base);
    return path ? { kind: 'file', path } : { kind: 'unresolved' };
  }

  const workspace = WORKSPACE.get(specifier);
  if (workspace !== undefined) {
    const path = resolveFile(workspace);
    return path ? { kind: 'file', path } : { kind: 'unresolved' };
  }

  // A workspace-shaped specifier we could not follow means this resolver has
  // fallen behind the codebase — fail rather than quietly stop walking.
  if (specifier.startsWith('$') || specifier.startsWith('@aikami/')) {
    return { kind: 'unresolved' };
  }
  return { kind: 'external' }; // Third-party package — not ours to police.
};

type Walk = {
  visited: Set<string>;
  nodeImports: Map<string, string[]>;
  unresolved: string[];
};

const walkServerGraph = (roots: string[]): Walk => {
  const walk: Walk = { visited: new Set(), nodeImports: new Map(), unresolved: [] };

  const visit = (file: string): void => {
    if (walk.visited.has(file) || isTestFile(file)) {
      return;
    }
    walk.visited.add(file);

    const source = stripComments(readFileSync(file, 'utf8'));
    const specifiers = [
      ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;'"]*?from\s*'([^']+)'/g)].map(
        (match) => match[1] as string,
      ),
      ...[...source.matchAll(/\bimport\s*\(\s*'([^']+)'\s*\)/g)].map((match) => match[1] as string),
    ];

    for (const specifier of specifiers) {
      const resolution = resolveSpecifier(specifier, file);
      const where = relative(repoRoot, file);
      if (resolution.kind === 'node') {
        walk.nodeImports.set(resolution.specifier, [
          ...(walk.nodeImports.get(resolution.specifier) ?? []),
          where,
        ]);
      } else if (resolution.kind === 'file') {
        visit(resolution.path);
      } else if (resolution.kind === 'unresolved') {
        walk.unresolved.push(`${where} → ${specifier}`);
      }
    }
  };

  roots.forEach(visit);
  return walk;
};

const entryPoints = [
  join(hubRoot, 'src/hooks.server.ts'),
  ...filesUnder(
    join(hubRoot, 'src/routes'),
    (file) => file.endsWith('+server.ts') || file.endsWith('.server.ts'),
  ),
].filter((file) => resolveFile(file) !== undefined);

const graph = walkServerGraph(entryPoints);

describe('hub Worker boundary — the server graph must run on workerd', () => {
  it('finds the server entry points', () => {
    // Guards the guard: a bad glob would make every case below vacuously pass.
    expect(entryPoints.length).toBeGreaterThan(5);
    expect(entryPoints.some((file) => file.endsWith('hooks.server.ts'))).toBe(true);
  });

  it('walks past the hub into the workspace packages it imports', () => {
    // The real risk lives in packages/backend/*, not in src/. If the resolver
    // stops at the package boundary this suite is worthless.
    const outside = [...graph.visited].filter((file) => file.startsWith(packagesDirectory));
    expect(outside.length).toBeGreaterThan(0);
  });

  it('resolves every workspace specifier it encounters', () => {
    // An unresolved `$…` or `@aikami/…` import means coverage silently shrank.
    // Teach `svelteAliases` / `workspaceEntries` about it rather than muting.
    expect(graph.unresolved).toEqual([]);
  });

  it('imports no `node:*` builtin outside the allowlist', () => {
    const offenders = [...graph.nodeImports.entries()]
      .filter(([specifier]) => !ALLOWED.has(specifier))
      .flatMap(([specifier, importers]) =>
        importers.map((importer) => `${importer}  imports  ${specifier}`),
      )
      .sort();
    expect(offenders).toEqual([]);
  });
});

describe('resolveSpecifier', () => {
  it('classifies each specifier shape', () => {
    // Proves the classifier actually fires — otherwise the suite above could
    // pass simply because everything came back `external`.
    const importer = join(hubRoot, 'src/hooks.server.ts');
    expect(resolveSpecifier('node:fs', importer).kind).toBe('node');
    expect(resolveSpecifier('drizzle-orm', importer).kind).toBe('external');
    expect(resolveSpecifier('$env/dynamic/private', importer).kind).toBe('external');
    expect(resolveSpecifier('@aikami/types', importer).kind).toBe('file');
    expect(resolveSpecifier('@aikami/not-a-real-package', importer).kind).toBe('unresolved');
  });

  it('prefers the longest matching alias', () => {
    // `$lib` and `$lib/*` point at different roots in svelte.config.js; a
    // shortest-match resolver would send `$lib/server/...` to the wrong tree.
    const importer = join(hubRoot, 'src/hooks.server.ts');
    const resolved = resolveSpecifier('$lib/server/api', importer);
    expect(resolved.kind).toBe('file');
    if (resolved.kind === 'file') {
      expect(resolved.path).toContain(join('hub', 'src', 'lib', 'server', 'api'));
    }
  });
});
