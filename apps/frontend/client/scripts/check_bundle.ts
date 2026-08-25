// apps/frontend/client/scripts/check_bundle.ts
//
// Post-build guard over the emitted JS chunks.
//
// FAILS the build on a static-import cycle between chunks (see below).
// REPORTS, without failing, namespace-object getters that reference an
// identifier no longer bound in their chunk.
//
// Why this exists: rolldown is free to split one source module across several
// chunks, and a barrel that is *dynamically* imported gets a namespace facade
// chunk that re-exports from wherever its members landed — including route
// nodes. That can introduce an edge the source graph never had, closing a
// cycle between chunks. The browser then evaluates a chunk before its
// dependency has initialised, and a `class X extends Base` whose `Base` lives
// in the not-yet-evaluated chunk throws at module-evaluation time:
//
//   TypeError: class heritage undefined is not an object or null
//
// That failure only appears in a production bundle (dev serves unbundled ESM),
// only after deploy, and points at a hashed chunk rather than any source file.
// A build-time check is the cheapest place to catch it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

/** Default bundle root, relative to the client app directory. */
const DEFAULT_BUNDLE_DIR = 'build/_app/immutable';

/**
 * Static import specifiers in an emitted chunk.
 *
 * Both forms are matched on the minified output:
 * - `import{a}from"./x.js"`, `export{a}from"./x.js"` → the `from` clause
 * - `import"./x.js"` → a bare side-effect import
 *
 * Dynamic `import("./x.js")` is deliberately NOT matched: it defers
 * evaluation, so it cannot cause the init-order failure this guard exists to
 * prevent, and rolldown relies on it to break cycles.
 */
const FROM_CLAUSE = /from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|[;}\s])import\s*["']([^"']+)["']/g;

/** Recursively collects every `.js` file under `dir`. */
const collectChunks = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectChunks(path));
    } else if (path.endsWith('.js')) {
      found.push(path);
    }
  }
  return found;
};

/** Resolves the relative specifiers a chunk statically imports, to absolute paths. */
const staticDeps = (options: { path: string; sources: Map<string, string> }): string[] => {
  const source = options.sources.get(options.path) ?? '';
  const deps = new Set<string>();

  for (const pattern of [FROM_CLAUSE, SIDE_EFFECT_IMPORT]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      // Bare specifiers are externals — they are not part of the emitted graph.
      if (!specifier?.startsWith('.')) {
        continue;
      }
      const resolved = resolve(dirname(options.path), specifier);
      if (options.sources.has(resolved)) {
        deps.add(resolved);
      }
    }
  }

  return [...deps];
};

/**
 * Finds every static-import cycle via a colour-marking DFS. Each cycle is
 * returned as the path of chunks from the re-entered node back to itself.
 */
const findCycles = (sources: Map<string, string>): string[][] => {
  const White = 0;
  const Grey = 1;
  const Black = 2;

  const colour = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (path: string): void => {
    colour.set(path, Grey);
    stack.push(path);

    for (const dep of staticDeps({ path, sources })) {
      const state = colour.get(dep) ?? White;
      if (state === Grey) {
        // Back edge — everything from `dep` up the stack forms the cycle.
        cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      } else if (state === White) {
        visit(dep);
      }
    }

    stack.pop();
    colour.set(path, Black);
  };

  for (const path of sources.keys()) {
    if ((colour.get(path) ?? White) === White) {
      visit(path);
    }
  }

  return cycles;
};

/** Namespace-object getter: `exportedName:()=>localBinding`. */
const NAMESPACE_GETTER = /([A-Za-z_$][\w$]*)\s*:\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\b/g;

/** Declaration and import forms that introduce a module-level binding. */
const DECLARATION = /\b(?:var|let|const|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from/g;
const DEFAULT_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g;

/**
 * Identifiers a getter may legitimately reference without a local binding.
 * Kept deliberately small — a false negative here is a missed warning, not a
 * broken build.
 */
const AMBIENT = new Set([
  'console',
  'document',
  'false',
  'globalThis',
  'location',
  'navigator',
  'new',
  'null',
  'performance',
  'Promise',
  'this',
  'true',
  'typeof',
  'undefined',
  'window',
  'CanvasRenderingContext2D',
  'WebGLRenderingContext',
  'WebGL2RenderingContext',
]);

/**
 * Finds namespace getters whose target identifier has no binding in the chunk.
 *
 * Rolldown emits `{ Name: () => Name }` for every export of a dynamically
 * imported module. When the minifier proves an exported constant is only ever
 * inlined, the binding disappears but the getter keeps the original name —
 * reading that property then throws ReferenceError. Only long names are
 * considered, so minified one- and two-character locals are not flagged.
 */
const findUnboundNamespaceGetters = (
  sources: Map<string, string>,
): { chunk: string; exported: string; target: string }[] => {
  const found: { chunk: string; exported: string; target: string }[] = [];

  for (const [chunk, source] of sources) {
    const bound = new Set<string>();
    for (const match of source.matchAll(DECLARATION)) {
      bound.add(match[1]);
    }
    for (const match of source.matchAll(NAMED_IMPORT)) {
      for (const clause of match[1].split(',')) {
        const [, alias] = clause.split(' as ');
        bound.add((alias ?? clause).trim());
      }
    }
    for (const match of source.matchAll(DEFAULT_IMPORT)) {
      bound.add(match[1]);
    }

    const seen = new Set<string>();
    for (const match of source.matchAll(NAMESPACE_GETTER)) {
      const [, exported, target] = match;
      if (target.length < 3 || AMBIENT.has(target) || bound.has(target) || seen.has(exported)) {
        continue;
      }
      seen.add(exported);
      found.push({ chunk, exported, target });
    }
  }

  return found;
};

/** First-party source roots, relative to the repo root. */
const SOURCE_ROOTS = ['apps/frontend/client/src', 'packages'];

/** Repo root, four levels up from apps/frontend/client/scripts. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

/** Memoized first-party export names, collected on first use. */
let firstPartyExports: Set<string> | undefined;

/** Collects every name exported by a first-party `.ts`/`.svelte` module. */
const collectFirstPartyExports = (): Set<string> => {
  const names = new Set<string>();

  const scan = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (!path.endsWith('.ts') && !path.endsWith('.svelte')) {
        continue;
      }
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(
        /export\s+(?:declare\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g,
      )) {
        names.add(match[1]);
      }
      for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const clause of match[1].split(',')) {
          const [, alias] = clause.split(' as ');
          names.add((alias ?? clause).trim());
        }
      }
    }
  };

  for (const root of SOURCE_ROOTS) {
    scan(join(REPO_ROOT, root));
  }
  return names;
};

/**
 * Whether an identifier is exported by first-party source.
 *
 * The same rolldown defect affects third-party packages (pixi.js ships dozens
 * of these), and those cannot be fixed here — so the gate only fires on names
 * this repo actually exports.
 */
const isFirstPartyExport = (name: string): boolean => {
  firstPartyExports ??= collectFirstPartyExports();
  return firstPartyExports.has(name);
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Only a positional argument names the bundle dir. Flags are ignored: this
// script sits at the end of build chains where a passthrough like
// `--mode production` can arrive uninvited, and reading that as a path
// produces a baffling "no bundle at .../--mode" failure.
const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const bundleDir = resolve(positional ?? DEFAULT_BUNDLE_DIR);

let chunkPaths: string[];
try {
  chunkPaths = collectChunks(bundleDir);
} catch {
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.error(`check_bundle: no bundle at ${bundleDir} — run the build first.`);
  process.exit(1);
}

if (chunkPaths.length === 0) {
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.error(`check_bundle: ${bundleDir} contains no .js chunks.`);
  process.exit(1);
}

const chunkSources = new Map(chunkPaths.map((path) => [path, readFileSync(path, 'utf8')]));
const cycles = findCycles(chunkSources);
const unbound = findUnboundNamespaceGetters(chunkSources);

const short = (path: string): string => relative(bundleDir, path);

const firstPartyUnbound = unbound.filter((entry) => isFirstPartyExport(entry.target));

if (firstPartyUnbound.length > 0) {
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.error(
    [
      '',
      `✗ check_bundle: ${firstPartyUnbound.length} namespace getter(s) reference an identifier`,
      '  that no longer exists in the emitted chunk.',
      '',
      'These sit in the namespace object rolldown builds for a dynamically imported',
      'module. The minifier proved the exported constant is only ever inlined and',
      'dropped its binding, but the getter still names it — so reading that property',
      'off the namespace throws ReferenceError at the access site.',
      '',
      'Fix: import the value directly (a static named import, or from the module that',
      "declares it) instead of reading it off a dynamic import's namespace object.",
      '',
      ...firstPartyUnbound.map((entry) => `  ${short(entry.chunk)}: ${entry.exported}`),
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (cycles.length === 0) {
  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(`✓ check_bundle: ${chunkSources.size} chunks, no static-import cycles.`);
  process.exit(0);
}

// biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
console.error(
  [
    '',
    `✗ check_bundle: ${cycles.length} static-import cycle(s) across ${chunkSources.size} chunks.`,
    '',
    'A cycle between emitted chunks makes module evaluation order undefined. The',
    'usual symptom in the browser is a class whose base class has not initialised:',
    '',
    '  TypeError: class heritage undefined is not an object or null',
    '',
    "Most common cause: `await import('@aikami/<barrel>')` for a value that could",
    'be a static named import. The dynamic import forces a namespace facade chunk',
    'that re-exports from every chunk the barrel landed in — including route nodes.',
    'Prefer a static named import, or import the value from a leaf module.',
    '',
    'Cycles:',
    ...cycles.map((cycle, index) => `  ${index + 1}. ${cycle.map(short).join('\n     → ')}`),
    '',
  ].join('\n'),
);
process.exit(1);
