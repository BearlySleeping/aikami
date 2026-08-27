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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  const importRe = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
  // Match dynamic import expressions: import('...')
  const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  // Only follow relative imports (starts with ./ or ../)
  const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

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

      // Recurse into relative imports to walk the full server import graph
      const dir = file.substring(0, file.lastIndexOf('/'));
      let match: RegExpExecArray | null;

      while ((match = importRe.exec(source)) !== null) {
        const specifier = match[1] ?? match[2] ?? '';
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

      while ((match = dynamicImportRe.exec(source)) !== null) {
        const specifier = match[1] ?? '';
        if (isRelative(specifier)) {
          const resolved = join(dir, specifier);
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
