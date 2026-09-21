#!/usr/bin/env bun

// apps/frontend/client/scripts/check_deploy_assets.ts
//
// Post-build deployment-asset guard for the Cloudflare client output.
//
// Cloudflare Workers Static Assets rejects any individual file above 25 MiB
// ("Asset too large. Cloudflare Workers supports assets of sizes of up to
// 25 MiB."). Aikami uses a stricter 24 MiB ceiling to keep a safety margin,
// and forbids ONNX Runtime WASM in the deployable build entirely: ORT belongs
// on the `aikami-dist` distribution plane and is fetched at runtime (see
// packages/frontend/local-runtime/src/lib/ort_runtime.ts).
//
// This guard fails the build when:
//   1. any file in `build/` is >= ORT/asset ceiling (24 MiB), or
//   2. any emitted `ort-*.wasm` exists at any path, at any size, or
//   3. two different paths carry byte-identical large binaries (> duplicate
//      threshold), which wastes Cloudflare's per-asset budget (the Asyncify
//      artifact was previously emitted both under `assets/` and
//      `workers/assets/`).
//
// It also always prints a largest-assets report (top 20) so regressions are
// visible without opening a bundle analyzer.
//
// Wiring: runs after `check_bundle.ts` in the client build, and again on the
// Cloudflare deploy path immediately before `wrangler deploy` — a cached or
// reused build must never reach Wrangler unchecked.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Aikami's hard per-asset ceiling (bytes): 24 MiB. */
export const MAX_ASSET_BYTES = 24 * 1024 * 1024;

/** Cloudflare's platform ceiling (bytes): 25 MiB. Reported for context. */
export const CLOUDFLARE_MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Files at or above this size are hashed for duplicate detection (1 MiB). */
export const DUPLICATE_HASH_THRESHOLD_BYTES = 1024 * 1024;

/**
 * Files at or above this size are additionally reported as duplicate
 * candidates (256 KiB), without failing the build. The hard gate stays at
 * {@link DUPLICATE_HASH_THRESHOLD_BYTES}; this lower tier keeps smaller
 * duplicate emissions (e.g. the ~820 KiB sqlite3 WASM, emitted once per Vite
 * build graph) visible in the report.
 */
export const DUPLICATE_REPORT_THRESHOLD_BYTES = 256 * 1024;

/** How many largest assets to print. */
export const LARGEST_REPORT_COUNT = 20;

/** Default deployment output directory, relative to the client app. */
export const DEFAULT_BUILD_DIR = 'build';

/**
 * Route-group directory under `src/routes` that must never appear in a normal
 * distributable build. Its routes are development sandboxes.
 */
export const DEV_ROUTE_GROUP = '(dev)';

/** A single emitted deployment file. */
export type DeployAsset = {
  /** Path relative to the build root, POSIX separators. */
  readonly relativePath: string;
  /** Raw byte size, exact. */
  readonly bytes: number;
};

/** A group of paths carrying byte-identical content. */
export type DuplicateGroup = {
  readonly sha256: string;
  readonly bytes: number;
  readonly relativePaths: readonly string[];
};

/** The complete guard result. */
export type DeployAssetReport = {
  /** Every file under the build root. */
  readonly assets: readonly DeployAsset[];
  /** Files at or above {@link MAX_ASSET_BYTES}. */
  readonly oversized: readonly DeployAsset[];
  /** Emitted `ort-*.wasm` files — forbidden regardless of size. */
  readonly ortLeaks: readonly DeployAsset[];
  /** Byte-identical large binaries emitted at multiple paths. */
  readonly duplicates: readonly DuplicateGroup[];
  /** Byte-identical binaries ≥ {@link DUPLICATE_REPORT_THRESHOLD_BYTES} (informational). */
  readonly duplicateCandidates: readonly DuplicateGroup[];
  /** Emitted dev-route output directories (empty when allowed). */
  readonly devRouteLeaks: readonly string[];
  /** Largest {@link LARGEST_REPORT_COUNT} assets, descending. */
  readonly largest: readonly DeployAsset[];
  /** Total bytes across all deployment files. */
  readonly totalBytes: number;
  /** True when no violation was found. */
  readonly ok: boolean;
};

/** Recursively collects every file under `dir` with its exact byte size. */
export const collectDeployAssets = (dir: string): DeployAsset[] => {
  const found: DeployAsset[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        found.push({
          relativePath: relative(dir, path).split('\\').join('/'),
          bytes: statSync(path).size,
        });
      }
    }
  };

  walk(dir);
  return found;
};

/** True when a filename is an ONNX Runtime WASM binary. */
export const isOrtWasm = (relativePath: string): boolean => {
  const name = relativePath.split('/').pop() ?? relativePath;
  return /^ort-.*\.wasm$/i.test(name);
};

/** Formats a byte count as MiB with three decimals (exact enough to compare). */
export const toMib = (bytes: number): number => bytes / (1024 * 1024);

/** Finds byte-identical large binaries emitted at multiple paths. */
export const findDuplicateBinaries = (
  root: string,
  assets: readonly DeployAsset[],
  thresholdBytes: number = DUPLICATE_HASH_THRESHOLD_BYTES,
): DuplicateGroup[] => {
  const byHash = new Map<string, { bytes: number; relativePaths: string[] }>();

  for (const asset of assets) {
    if (asset.bytes < thresholdBytes) {
      continue;
    }
    const content = readFileSync(join(root, asset.relativePath));
    const sha256 = createHash('sha256').update(content).digest('hex');
    const existing = byHash.get(sha256);
    if (existing) {
      existing.relativePaths.push(asset.relativePath);
    } else {
      byHash.set(sha256, { bytes: asset.bytes, relativePaths: [asset.relativePath] });
    }
  }

  return [...byHash.entries()]
    .filter(([, group]) => group.relativePaths.length > 1)
    .map(([sha256, group]) => ({
      sha256,
      bytes: group.bytes,
      relativePaths: [...group.relativePaths].sort(),
    }))
    .sort((a, b) => b.bytes - a.bytes);
};

/**
 * Finds emitted dev-route output directories.
 *
 * Aikami's `(dev)` route group (development sandboxes) is excluded from normal
 * distributable builds by `scripts/gate_dev_routes.ts`. When it leaks back in,
 * SvelteKit emits the routes under a real URL prefix (today `/dev/...`). This
 * detects those directories in the final output so a production build can
 * assert zero dev-route entries.
 *
 * Detection is deliberately prefix-based on the emitted tree: the `(dev)` group
 * maps one-to-one onto a URL path, so the first non-group segment under
 * `src/routes/(dev)` is the emitted directory name.
 *
 * @param root       Build output root.
 * @param routeGroup Emitted directory name of the dev route group (e.g. `dev`).
 */
export const findDevRouteOutputs = (root: string, routeGroup = 'dev'): string[] => {
  const found: string[] = [];
  const walk = (current: string, relativeParts: string[]): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const parts = [...relativeParts, entry.name];
      if (parts.length === 1 && entry.name === routeGroup) {
        found.push(entry.name);
        continue;
      }
      walk(join(current, entry.name), parts);
    }
  };
  walk(root, []);
  return found;
};

/** Options controlling which violations are fatal. */
export type AnalyzeOptions = {
  /**
   * When true, dev-route output is expected (an explicit QA/dev build) and is
   * not reported as a violation.
   */
  readonly allowDevRoutes?: boolean;
  /** Emitted dev-route directory name. Defaults to `dev`. */
  readonly devRouteGroup?: string;
};

/**
 * Inspect an adapter output directory and return the full report.
 *
 * Pure and synchronous so tests can drive it against fixture directories.
 */
export const analyzeDeployAssets = (root: string, options?: AnalyzeOptions): DeployAssetReport => {
  const assets = collectDeployAssets(root);
  const oversized = assets.filter((asset) => asset.bytes >= MAX_ASSET_BYTES);
  const ortLeaks = assets.filter((asset) => isOrtWasm(asset.relativePath));
  const duplicates = findDuplicateBinaries(root, assets);
  const duplicateCandidates =
    DUPLICATE_REPORT_THRESHOLD_BYTES === DUPLICATE_HASH_THRESHOLD_BYTES
      ? duplicates
      : findDuplicateBinaries(root, assets, DUPLICATE_REPORT_THRESHOLD_BYTES);
  const devRouteLeaks = options?.allowDevRoutes
    ? []
    : findDevRouteOutputs(root, options?.devRouteGroup);
  const largest = [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, LARGEST_REPORT_COUNT);
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);

  return {
    assets,
    oversized,
    ortLeaks,
    duplicates,
    duplicateCandidates,
    devRouteLeaks,
    largest,
    totalBytes,
    ok:
      oversized.length === 0 &&
      ortLeaks.length === 0 &&
      duplicates.length === 0 &&
      devRouteLeaks.length === 0,
  };
};

/** Renders the report as a human-readable block (no color; CI-safe). */
export const formatReport = (report: DeployAssetReport, buildDir: string): string => {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    `check_deploy_assets: ${report.assets.length} files, ${(report.totalBytes / 1024 / 1024).toFixed(2)} MiB total`,
  );
  lines.push(`  ceiling: ${toMib(MAX_ASSET_BYTES).toFixed(0)} MiB (Cloudflare: 25 MiB)`);
  lines.push('');

  lines.push(`  Largest ${LARGEST_REPORT_COUNT} assets:`);
  for (const asset of report.largest) {
    lines.push(
      `    ${toMib(asset.bytes).toFixed(3).padStart(9)} MiB  ${asset.bytes.toString().padStart(12)} B  ${asset.relativePath}`,
    );
  }
  lines.push('');

  if (report.duplicates.length > 0) {
    lines.push(`  Duplicate large binaries (${report.duplicates.length}):`);
    for (const group of report.duplicates) {
      lines.push(`    ${toMib(group.bytes).toFixed(3)} MiB  sha256:${group.sha256.slice(0, 16)}…`);
      for (const path of group.relativePaths) {
        lines.push(`      ${path}`);
      }
    }
    lines.push('');
  }

  const informationalDuplicates = report.duplicateCandidates.filter(
    (candidate) => !report.duplicates.some((group) => group.sha256 === candidate.sha256),
  );
  if (informationalDuplicates.length > 0) {
    lines.push(
      `  Duplicate binaries ≥ ${(DUPLICATE_REPORT_THRESHOLD_BYTES / 1024).toFixed(0)} KiB (informational, ${informationalDuplicates.length}):`,
    );
    for (const group of informationalDuplicates) {
      lines.push(`    ${toMib(group.bytes).toFixed(3)} MiB  sha256:${group.sha256.slice(0, 16)}…`);
      for (const path of group.relativePaths) {
        lines.push(`      ${path}`);
      }
    }
    lines.push('');
  }

  if (report.ortLeaks.length > 0) {
    lines.push(`  ORT WASM leaks (${report.ortLeaks.length}) — forbidden in the client build:`);
    for (const asset of report.ortLeaks) {
      lines.push(
        `    ${toMib(asset.bytes).toFixed(3)} MiB  ${asset.bytes.toString()} B  ${asset.relativePath}`,
      );
    }
    lines.push('');
  }

  if (report.devRouteLeaks.length > 0) {
    lines.push(`  Dev-route output present (${report.devRouteLeaks.length}) — must not ship:`);
    for (const path of report.devRouteLeaks) {
      lines.push(`    ${path}/`);
    }
    lines.push('');
  }

  if (report.oversized.length > 0) {
    lines.push(
      `  Assets over the ${toMib(MAX_ASSET_BYTES).toFixed(0)} MiB ceiling (${report.oversized.length}):`,
    );
    for (const asset of report.oversized) {
      lines.push(
        `    ${toMib(asset.bytes).toFixed(3)} MiB  ${asset.bytes.toString()} B  ${asset.relativePath}`,
      );
    }
    lines.push('');
  }

  lines.push(report.ok ? `  ✓ ${buildDir} OK` : `  ✗ ${buildDir} FAILED`);
  return lines.join('\n');
};

/** Renders the actionable failure explanation for a failing report. */
const formatFailure = (report: DeployAssetReport, buildDir: string): string => {
  const lines: string[] = [
    '',
    '✗ check_deploy_assets: the Cloudflare client output is not deployable.',
    '',
  ];

  if (report.ortLeaks.length > 0) {
    lines.push(
      'ONNX Runtime WASM was emitted into the client build. ORT belongs on the',
      '`aikami-dist` distribution plane and must be fetched at runtime via the',
      'shared ORT seam (packages/frontend/local-runtime/src/lib/ort_runtime.ts).',
      'Do not delete the file: fix the bundler boundary so Vite never resolves it.',
      'Expected: apps/frontend/client/scripts/ort_external_plugin.ts rewrites the',
      'package-owned `new URL(ort-wasm-*.wasm, import.meta.url)` references.',
      '',
      ...report.ortLeaks.map(
        (asset) =>
          `  ${asset.relativePath} — ${toMib(asset.bytes).toFixed(3)} MiB (${asset.bytes} B)`,
      ),
      '',
    );
  }

  if (report.oversized.length > 0) {
    lines.push(
      `Files at or above Aikami's ${toMib(MAX_ASSET_BYTES).toFixed(0)} MiB asset ceiling (Cloudflare rejects > 25 MiB):`,
      '',
      ...report.oversized.map(
        (asset) =>
          `  ${asset.relativePath} — ${toMib(asset.bytes).toFixed(3)} MiB (${asset.bytes} B)`,
      ),
      '',
    );
  }

  if (report.duplicates.length > 0) {
    lines.push(
      'Byte-identical large binaries are emitted at multiple paths:',
      '',
      ...report.duplicates.flatMap((group) => [
        `  ${toMib(group.bytes).toFixed(3)} MiB  sha256:${group.sha256.slice(0, 16)}…`,
        ...group.relativePaths.map((path) => `    ${path}`),
      ]),
      '',
    );
  }

  if (report.devRouteLeaks.length > 0) {
    lines.push(
      'Development sandbox routes were emitted into a normal distributable build.',
      'Production must contain zero `(dev)` route entries. Rebuild through the',
      'dev-route gate (scripts/gate_dev_routes.ts), or pass --allow-dev-routes for',
      'an explicit QA build.',
      '',
      ...report.devRouteLeaks.map((path) => `  ${path}/`),
      '',
    );
  }

  lines.push(formatReport(report, buildDir));
  return lines.join('\n');
};

/**
 * CLI: analyze the client build and exit non-zero on any violation.
 *
 * A positional argument names the build directory; other flags are ignored
 * (the build chain can pass through `--mode production` uninvited — see
 * check_bundle.ts for the same rationale). `--allow-dev-routes` opts a QA/dev
 * build into shipping the `(dev)` route group.
 */
export const runCli = (argv: string[] = process.argv.slice(2)): number => {
  const positional = argv.find((arg) => !arg.startsWith('-'));
  const buildDir = resolve(positional ?? DEFAULT_BUILD_DIR);
  const allowDevRoutes = argv.includes('--allow-dev-routes');

  let report: DeployAssetReport;
  try {
    report = analyzeDeployAssets(buildDir, { allowDevRoutes });
  } catch {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.error(`check_deploy_assets: no build output at ${buildDir} — run the build first.`);
    return 1;
  }

  if (report.ok) {
    // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
    console.log(formatReport(report, buildDir));
    return 0;
  }

  // biome-ignore lint/suspicious/noConsole: build script reports to stdout/stderr
  console.error(formatFailure(report, buildDir));
  return 1;
};

if (import.meta.main) {
  process.exit(runCli());
}
