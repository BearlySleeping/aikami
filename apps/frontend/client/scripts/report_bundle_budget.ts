#!/usr/bin/env bun

// apps/frontend/client/scripts/report_bundle_budget.ts
//
// Lightweight bundle-budget report and ratchet for the client build.
//
// Individual chunk size is not enough: an app can ship 200 small chunks and
// still have a huge initial route. This script reads the Vite manifest to
// measure per-route dependency closures, plus raw/gzip totals, and compares the
// result against a reviewed budget baseline. Hard gates are always fatal;
// tracked metrics are reported and ratcheted (a PR may not silently grow them).
//
// Hard gates (fatal):
//   - largest individual deployment asset < 24 MiB  (see check_deploy_assets)
//   - bundled ORT WASM = 0                          (see check_deploy_assets)
//   - duplicate large binaries = 0                  (see check_deploy_assets)
//   - production dev-route entries = 0              (see check_deploy_assets)
//   - new first-party ineffective dynamic imports = 0
//   - static import cycles = 0                      (see check_bundle)
//
// Tracked metrics (reported + ratcheted):
//   - largest JS chunk raw/gzip
//   - total JS, total CSS, total WASM
//   - initial dependency closure for /, /game, /settings
//   - worker bundle sizes
//
// Usage:
//   bun scripts/report_bundle_budget.ts [--update] [--build <dir>] [--manifest <path>]
//   bun scripts/report_bundle_budget.ts --expect-dev-routes
//
// `--update` rewrites the baseline after an intentional change (review the diff).
// `--expect-dev-routes` reports the metrics but skips the ratchet, for a build
// that deliberately includes the `(dev)` sandbox routes (see the CLI docs below).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Default build output dir, relative to the client app. */
export const DEFAULT_BUILD_DIR = 'build';

/** Default Vite manifest, produced by `svelte-kit` under `.svelte-kit`. */
export const DEFAULT_MANIFEST = '.svelte-kit/output/client/.vite/manifest.json';

/** Default budget baseline, committed for the ratchet. */
export const DEFAULT_BASELINE = 'scripts/bundle_budget.baseline.json';

/**
 * Fractional headroom allowed on a tracked metric before it is a regression.
 * (10%: normal code growth is fine; a doubling is not.)
 */
export const TRACKED_REGRESSION_RATIO = 1.1;

/** Routes whose initial dependency closure is measured. */
export const TRACKED_ROUTES = ['/', '/game', '/settings'] as const;

/** A Vite manifest entry (subset of the v3 shape we rely on). */
type ManifestEntry = {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};

type Manifest = Record<string, ManifestEntry>;

/** The measured budget. */
export type BundleBudget = {
  /** Number of emitted JS chunks. */
  readonly jsChunkCount: number;
  /** Largest JS chunk, raw bytes. */
  readonly largestJsChunkBytes: number;
  /** Largest JS chunk, gzip bytes. */
  readonly largestJsChunkGzipBytes: number;
  /** Largest JS chunk's emitted path. */
  readonly largestJsChunk: string;
  /** Total JS bytes across the build. */
  readonly totalJsBytes: number;
  /** Total CSS bytes across the build. */
  readonly totalCssBytes: number;
  /** Total WASM bytes across the build. */
  readonly totalWasmBytes: number;
  /** Worker bundle sizes, largest first. */
  readonly workerBundles: readonly {
    readonly id: string;
    readonly file: string;
    readonly bytes: number;
  }[];
  /** Initial (static) dependency closure sizes per tracked route. */
  readonly routeClosures: readonly {
    readonly route: string;
    readonly files: number;
    readonly rawBytes: number;
  }[];
};

/** Recursively collects files under `dir`. */
const collectFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectFiles(path));
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
};

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

const WORKER_ASSET_PREFIX = '_app/immutable/workers/';
const WORKER_CONTENT_HASH_RE = /-[a-zA-Z0-9_-]{8}(?=\.js$)/;

/** Returns a stable logical id for a manifested worker entry asset. */
const workerIdentifier = (file: string): string =>
  file.slice(WORKER_ASSET_PREFIX.length).replace(WORKER_CONTENT_HASH_RE, '');

/** Collects logical worker entries from manifest asset references. */
const manifestWorkers = (manifest: Manifest): { id: string; file: string }[] => {
  const workersById = new Map<string, string>();
  for (const entry of Object.values(manifest)) {
    for (const file of entry.assets ?? []) {
      if (!file.startsWith(WORKER_ASSET_PREFIX) || !file.endsWith('.js')) {
        continue;
      }
      const id = workerIdentifier(file);
      const existing = workersById.get(id);
      if (existing && existing !== file) {
        throw new Error(`worker id ${id} resolves to both ${existing} and ${file}`);
      }
      workersById.set(id, file);
    }
  }
  return [...workersById].map(([id, file]) => ({ id, file }));
};

/** Reads the Vite manifest, or undefined when absent. */
export const loadManifest = (path: string): Manifest | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
};

/**
 * Parses SvelteKit's route table from the built app entry.
 *
 * The emitted app entry contains a literal map such as:
 *   "/game":[57],"/settings":[58],...
 * which maps a route path to its node numbers.
 */
export const parseRouteTable = (appEntrySource: string): Map<string, number[]> => {
  const table = new Map<string, number[]>();
  const pattern = /"(\/[^"]*)":\[([0-9,\s]*)\]/g;
  for (const match of appEntrySource.matchAll(pattern)) {
    const ids = match[2]
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    table.set(match[1], ids);
  }
  return table;
};

/**
 * Builds a lookup index for resolving `imports` references to manifest keys.
 *
 * A manifest `imports` entry is usually the *key* of the referenced entry, so
 * the direct `manifest[reference]` hit below resolves it. The emitted `file`
 * uses a different naming convention, though: the Vite/rolldown key for a
 * shared chunk is `_<hash>.js` while the emitted file is
 * `_app/immutable/chunks/<hash>.js` (no leading underscore). Index both the
 * emitted basename and its underscore-stripped form so a reference written
 * either way still resolves, which keeps the closure exact instead of silently
 * dropping an edge.
 */
const buildBasenameIndex = (manifest: Manifest): Map<string, string> => {
  const index = new Map<string, string>();
  const add = (name: string | undefined, key: string): void => {
    if (name && !index.has(name)) {
      index.set(name, key);
    }
  };
  for (const [key, entry] of Object.entries(manifest)) {
    const basename = entry.file.split('/').pop();
    add(basename, key);
    // Emitted chunk basenames omit the leading `_` that manifest keys carry.
    if (basename?.startsWith('_')) {
      add(basename.slice(1), key);
    }
  }
  return index;
};

/** Resolves a manifest `imports` reference to a manifest key. */
const resolveImport = (
  reference: string,
  manifest: Manifest,
  basenameIndex: Map<string, string>,
): string | undefined => {
  if (manifest[reference]) {
    return reference;
  }
  const basename = reference.split('/').pop();
  if (!basename) {
    return undefined;
  }
  return basenameIndex.get(basename) ?? basenameIndex.get(basename.replace(/^_/, ''));
};

/**
 * Computes the transitive static-import closure for a set of starting keys.
 * Dynamic imports are deliberately excluded: they are not in the initial
 * dependency closure the browser must fetch before the route renders.
 */
export const transitiveClosure = (
  manifest: Manifest,
  startKeys: readonly string[],
): Set<string> => {
  const basenameIndex = buildBasenameIndex(manifest);
  const visited = new Set<string>();
  const queue = [...startKeys];

  while (queue.length > 0) {
    const key = queue.pop();
    if (!key || visited.has(key)) {
      continue;
    }
    visited.add(key);
    const entry = manifest[key];
    if (!entry) {
      continue;
    }
    for (const reference of entry.imports ?? []) {
      const resolved = resolveImport(reference, manifest, basenameIndex);
      if (resolved) {
        queue.push(resolved);
      }
    }
  }

  return visited;
};

/** Maps a route path to its manifest node entry keys. */
const routeKeys = (route: string, table: Map<string, number[]>, manifest: Manifest): string[] => {
  const ids = table.get(route);
  if (!ids) {
    throw new Error(`route table is missing tracked route ${route}`);
  }
  const keys: string[] = [];
  for (const id of ids) {
    const suffix = `client-optimized/nodes/${id}.js`;
    const key = Object.keys(manifest).find((candidate) => candidate.endsWith(suffix));
    if (!key) {
      throw new Error(`tracked route ${route} references missing manifest node ${id}`);
    }
    keys.push(key);
  }
  return keys;
};

/** Measures the bundle budget from a build directory and manifest. */
export const measureBundleBudget = (options: {
  buildDir: string;
  manifest: Manifest | undefined;
  appEntrySource: string | undefined;
}): BundleBudget => {
  if (!options.manifest) {
    throw new Error('bundle budget requires a Vite manifest');
  }
  if (!options.appEntrySource) {
    throw new Error('bundle budget requires the emitted app entry source');
  }

  const files = collectFiles(options.buildDir);
  const jsFiles = files.filter((file) => file.endsWith('.js'));
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  const wasmFiles = files.filter((file) => file.endsWith('.wasm'));

  const jsSizes = jsFiles.map((file) => ({ file, bytes: statSync(file).size }));
  const largest = jsSizes.sort((a, b) => b.bytes - a.bytes)[0];

  const largestGzip = largest ? gzipSync(readFileSync(largest.file), { level: 9 }).byteLength : 0;

  const manifest = options.manifest;
  const routeTable = parseRouteTable(options.appEntrySource);

  const routeClosures = TRACKED_ROUTES.map((route) => {
    const startKeys = routeKeys(route, routeTable, manifest);
    const closure = transitiveClosure(manifest, startKeys);
    const emittedFiles = new Set<string>();
    for (const key of closure) {
      const entry = manifest[key];
      if (!entry) {
        continue;
      }
      emittedFiles.add(entry.file);
      for (const css of entry.css ?? []) {
        emittedFiles.add(css);
      }
    }

    let rawBytes = 0;
    let fileCount = 0;
    for (const file of emittedFiles) {
      const path = join(options.buildDir, file);
      if (existsSync(path)) {
        rawBytes += statSync(path).size;
        fileCount++;
      }
    }
    if (fileCount === 0) {
      throw new Error(`tracked route ${route} has no emitted files in its manifest closure`);
    }
    return { route, files: fileCount, rawBytes };
  });

  return {
    jsChunkCount: jsFiles.length,
    largestJsChunkBytes: largest?.bytes ?? 0,
    largestJsChunkGzipBytes: largestGzip,
    largestJsChunk: largest ? relative(options.buildDir, largest.file) : '',
    totalJsBytes: sum(jsSizes.map((entry) => entry.bytes)),
    totalCssBytes: sum(cssFiles.map((file) => statSync(file).size)),
    totalWasmBytes: sum(wasmFiles.map((file) => statSync(file).size)),
    workerBundles: manifestWorkers(manifest)
      .map(({ id, file }) => ({
        id,
        file,
        bytes: statSync(join(options.buildDir, file)).size,
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10),
    routeClosures,
  };
};

/** The committed baseline shape (a previous budget plus a version tag). */
export type BudgetBaseline = {
  readonly version: 1;
  readonly budget: BundleBudget;
};

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(3)} MiB`;

/** Renders a human-readable report. */
export const formatBudget = (budget: BundleBudget): string => {
  const lines: string[] = [''];
  lines.push('Bundle budget:');
  lines.push(
    `  JS: ${budget.jsChunkCount} chunks, ${mib(budget.totalJsBytes)} total; largest ${mib(budget.largestJsChunkBytes)} raw / ${mib(budget.largestJsChunkGzipBytes)} gzip (${budget.largestJsChunk})`,
  );
  lines.push(`  CSS total:  ${mib(budget.totalCssBytes)}`);
  lines.push(`  WASM total: ${mib(budget.totalWasmBytes)}`);
  if (budget.workerBundles.length > 0) {
    lines.push('  Worker bundles:');
    for (const worker of budget.workerBundles) {
      lines.push(`    ${mib(worker.bytes).padStart(10)}  ${worker.id} (${worker.file})`);
    }
  }
  if (budget.routeClosures.length > 0) {
    lines.push('  Initial dependency closure (static):');
    for (const closure of budget.routeClosures) {
      lines.push(
        `    ${closure.route.padEnd(9)} ${closure.files} files, ${mib(closure.rawBytes)} raw`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
};

/** Compares two budgets and returns the metrics that regressed beyond headroom. */
export const findBudgetRegressions = (current: BundleBudget, baseline: BundleBudget): string[] => {
  const regressions: string[] = [];

  const check = (label: string, now: number, before: number): void => {
    if (before > 0 && now > before * TRACKED_REGRESSION_RATIO) {
      regressions.push(
        `${label}: ${before} → ${now} (+${(((now - before) / before) * 100).toFixed(0)}%)`,
      );
    }
  };

  check('largest JS chunk raw', current.largestJsChunkBytes, baseline.largestJsChunkBytes);
  check('largest JS chunk gzip', current.largestJsChunkGzipBytes, baseline.largestJsChunkGzipBytes);
  check('total JS', current.totalJsBytes, baseline.totalJsBytes);
  check('total CSS', current.totalCssBytes, baseline.totalCssBytes);
  check('total WASM', current.totalWasmBytes, baseline.totalWasmBytes);

  for (const closure of current.routeClosures) {
    const before = baseline.routeClosures.find((entry) => entry.route === closure.route);
    if (before) {
      check(`initial closure ${closure.route}`, closure.rawBytes, before.rawBytes);
    }
  }

  for (const worker of current.workerBundles) {
    const before = baseline.workerBundles.find((entry) => entry.id === worker.id);
    if (before) {
      check(`worker ${worker.id}`, worker.bytes, before.bytes);
    }
  }

  return regressions;
};

/** Finds the emitted client app entry source (contains the route table). */
export const findAppEntrySource = (buildDir: string): string | undefined => {
  const entryDir = join(buildDir, '_app/immutable/entry');
  if (!existsSync(entryDir)) {
    return undefined;
  }
  for (const file of readdirSync(entryDir)) {
    if (!file.startsWith('app') || !file.endsWith('.js')) {
      continue;
    }
    const source = readFileSync(join(entryDir, file), 'utf8');
    if (source.includes('"),[') || source.includes('":[')) {
      return source;
    }
  }
  return undefined;
};

/**
 * CLI entry.
 *
 * Hard gates are enforced elsewhere (check_deploy_assets / check_bundle); this
 * script reports the tracked metrics and fails only on a tracked regression.
 *
 * `--expect-dev-routes` reports the metrics without ratcheting. The committed
 * baseline measures the production route graph, so a build that deliberately
 * includes the `(dev)` sandbox routes is not comparable to it and would always
 * look like a ~20% regression. `scripts/build_client.ts` passes this flag
 * exactly when `resolveIncludeDevRoutes('build')` says the sandboxes were
 * requested, so the ratchet still guards every ordinary build.
 */
export const runCli = (argv: string[] = process.argv.slice(2)): number => {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const update = argv.includes('--update');
  const expectDevRoutes = argv.includes('--expect-dev-routes');
  const buildDir = resolve(flag('--build') ?? DEFAULT_BUILD_DIR);
  const manifestPath = resolve(flag('--manifest') ?? DEFAULT_MANIFEST);
  const baselinePath = resolve(flag('--baseline') ?? DEFAULT_BASELINE);

  // Refuse rather than silently corrupt the ratchet: a dev-route build's numbers
  // describe the sandbox route graph, and writing them into the production
  // baseline would permanently raise the budget for every ordinary build.
  if (update && expectDevRoutes) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(
      'report_bundle_budget: --update and --expect-dev-routes are mutually exclusive —\n' +
        'a dev-route build must never be written into the production baseline.',
    );
    return 1;
  }

  if (!existsSync(buildDir)) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(`report_bundle_budget: no build output at ${buildDir} — run the build first.`);
    return 1;
  }

  let budget: BundleBudget;
  try {
    budget = measureBundleBudget({
      buildDir,
      manifest: loadManifest(manifestPath),
      appEntrySource: findAppEntrySource(buildDir),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(`report_bundle_budget: ${message}`);
    return 1;
  }

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log(formatBudget(budget));

  if (expectDevRoutes) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(
      [
        'report_bundle_budget: --expect-dev-routes — ratchet skipped.',
        '  This build deliberately includes the `(dev)` sandbox routes, and the committed',
        '  baseline measures the production route graph. The numbers above are therefore',
        '  informational only; they are not comparable to the baseline and are not',
        '  written to it.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  if (update) {
    const baseline: BudgetBaseline = { version: 1, budget };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(`report_bundle_budget: wrote baseline to ${baselinePath}`);
    return 0;
  }

  if (!existsSync(baselinePath)) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(
      `report_bundle_budget: no baseline at ${baselinePath} — run with --update to create.`,
    );
    return 0;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BudgetBaseline;
  const regressions = findBudgetRegressions(budget, baseline.budget);

  if (regressions.length > 0) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(
      [
        '',
        `✗ report_bundle_budget: ${regressions.length} tracked metric(s) regressed beyond ${(TRACKED_REGRESSION_RATIO - 1) * 100}% headroom:`,
        ...regressions.map((line) => `  ${line}`),
        '',
        'If the growth is intentional, run with --update and review the baseline diff.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.log('✓ report_bundle_budget: no tracked regressions.');
  return 0;
};

if (import.meta.main) {
  process.exit(runCli());
}
