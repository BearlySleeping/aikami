// apps/frontend/hub/src/lib/__tests__/server_bundle_purity.test.ts
//
// C-446 AC-1: PixiJS must never enter the hub server bundle.
//
// The hub deploys to Cloudflare Workers. PixiJS is a heavy client-only
// library that must never appear in the SSR bundle. This test walks the
// server import graph and asserts no PixiJS marker is present.
//
// See also: src/lib/server/tests/worker_boundary.test.ts for the full
// Workers-boundary guard (node:* imports).

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const hubRoot = resolve(import.meta.dir, '../../..');

/** Files that are server-only entry points. */
const serverEntryPoints = [
  join(hubRoot, 'src/hooks.server.ts'),
  ...(() => {
    const routesDir = join(hubRoot, 'src/routes');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.server.ts')) {
          files.push(full);
        }
      }
    };
    walk(routesDir);
    return files;
  })(),
].filter((file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
});

/** PixiJS markers that indicate a Pixi import in the server graph. */
const PIXI_MARKERS = ['pixi.js', '@pixi/'];

/**
 * Walk the server import graph looking for PixiJS markers.
 * Parses relative imports from each visited file and recurses.
 */
const findPixiInServerGraph = (): string[] => {
  const visited = new Set<string>();
  const offenders: string[] = [];

  // Match static import statements: import ... from '...' or import "..."
  const importPattern = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
  // Match dynamic import expressions: import('...')
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  // Only follow relative imports (starts with ./ or ../)
  const isRelative = (specifier: string): boolean =>
    specifier.startsWith('./') || specifier.startsWith('../');

  const visit = (file: string): void => {
    if (visited.has(file)) {
      return;
    }
    visited.add(file);

    try {
      const source = readFileSync(file, 'utf8');
      const lower = source.toLowerCase();

      for (const marker of PIXI_MARKERS) {
        if (lower.includes(marker.toLowerCase())) {
          offenders.push(`${file} contains PixiJS marker: "${marker}"`);
          return; // One report per file is enough.
        }
      }

      // Recurse into relative imports to walk the full server import graph.
      // `matchAll` is used (rather than a shared `.exec()` loop) because
      // `visit` is recursive: a shared regex's `.lastIndex` would get
      // clobbered by the nested call scanning a different `source` string,
      // corrupting the outer loop's position and blowing up into a
      // combinatorial re-scan of the whole graph — this hung `bun test`
      // indefinitely in CI. `matchAll` snapshots its own iterator state per
      // call, so recursion can't interfere with it.
      const dir = file.slice(0, file.lastIndexOf('/'));
      const specifiers = [
        ...[...source.matchAll(importPattern)].map((match) => match[1] ?? match[2] ?? ''),
        ...[...source.matchAll(dynamicImportPattern)].map((match) => match[1] ?? ''),
      ];

      for (const specifier of specifiers) {
        if (isRelative(specifier)) {
          const resolved = join(dir, specifier);
          // Try .ts, .js extensions
          for (const ext of ['.ts', '.js', '']) {
            const candidate = resolved.endsWith(ext) ? resolved : `${resolved}${ext}`;
            try {
              if (statSync(candidate).isFile()) {
                visit(candidate);
                break;
              }
            } catch {
              // File not found with this extension, try next
            }
          }
        }
      }
    } catch {
      // Skip files that can't be read.
    }
  };

  serverEntryPoints.forEach(visit);
  return offenders;
};

describe('C-446 AC-1: PixiJS must never enter the hub server bundle', () => {
  it('finds the server entry points', () => {
    expect(serverEntryPoints.length).toBeGreaterThan(0);
    expect(serverEntryPoints.some((file) => file.endsWith('hooks.server.ts'))).toBe(true);
  });

  it('server entry points contain no PixiJS markers', () => {
    const offenders = findPixiInServerGraph();
    expect(offenders).toEqual([]);
  });
});
