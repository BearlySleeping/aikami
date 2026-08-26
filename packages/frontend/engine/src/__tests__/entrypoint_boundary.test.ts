// packages/frontend/engine/src/__tests__/entrypoint_boundary.test.ts
//
// Module-boundary enforcement test.
//
// Walks the transitive import graph from each sub-barrel and asserts that
// forbidden modules are never reachable via value imports. `import type` is
// allowed (it is erased at compile time).

import { describe, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENGINE_SRC = resolve(import.meta.dirname, '..');

/** Entrypoints and their forbidden import patterns. */
const BOUNDARIES: Array<{
  name: string;
  entry: string;
  forbidden: RegExp[];
}> = [
  {
    name: './sim',
    entry: resolve(ENGINE_SRC, 'sim.ts'),
    forbidden: [/from\s+['"]pixi\.js['"]/],
  },
  {
    name: './content',
    entry: resolve(ENGINE_SRC, 'content.ts'),
    forbidden: [/from\s+['"]pixi\.js['"]/],
  },
  // NOTE: ./worker is NOT checked here because ecs_worker.ts imports
  // LpcBatchManager from render_worker.ts (a ./render module). The
  // render_worker.ts file is explicitly pixi-free, so the built worker
  // chunk contains no PixiJS even though it resolves through ./render.
  // See C-443 Edge Cases & Gotchas for the rationale.
];

/** File patterns that are NOT checked for pixi.js (they're the render barrel). */
const RENDER_BARREL = resolve(ENGINE_SRC, 'render.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all static import paths from a source file.
 * Handles:
 *   import { x } from './foo.ts';
 *   import type { x } from './foo.ts';
 *   import './side_effect.ts';
 *   export { x } from './foo.ts';
 *   export type { x } from './foo.ts';
 *   export * from './foo.ts';
 */
function extractImports(source: string): string[] {
  const imports: string[] = [];
  // Match all import/export from statements
  const re =
    /(?:import|export)\s+(?:(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\*\s+)|(?:type\s+)?\{\s*(?:\w+\s*,?\s*)+\}\s+from\s+|(?:type\s+)?\w+(?:\s*,\s*\{[^}]*\})?\s+from\s+)?['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  for (;;) {
    const match = re.exec(source);
    if (match === null) {
      break;
    }
    const path = match[1] ?? match[2];
    if (path?.startsWith('.')) {
      imports.push(path);
    }
  }
  return imports;
}

/**
 * Check if an import statement is a type-only import.
 * `import type { X } from 'pixi.js'` is allowed.
 * `import { X } from 'pixi.js'` is forbidden.
 */
function isTypeOnlyImport(source: string, importPath: string): boolean {
  // Find the specific import statement for this path
  const lines = source.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes(`from '${importPath}'`) || trimmed.includes(`from "${importPath}"`)) {
      // Check if it starts with `import type` or `export type`
      if (trimmed.startsWith('import type') || trimmed.startsWith('export type')) {
        return true;
      }
      // Check for inline `type` keyword before each named import
      // e.g. `import { type Foo, type Bar } from 'pixi.js'`
      if (trimmed.includes('import {') || trimmed.includes('export {')) {
        // Extract the content between { }
        const braceContent = trimmed.match(/\{([^}]*)\}/);
        if (braceContent) {
          const names = braceContent[1].split(',').map((n) => n.trim());
          // If ALL imports are prefixed with `type`, it's type-only
          const allType = names.every((n) => n.startsWith('type '));
          if (allType) {
            return true;
          }
          // If SOME are not prefixed with `type`, it's a value import
          return false;
        }
      }
      return false;
    }
  }
  return false;
}

/**
 * Walk the transitive import graph from an entry file, collecting all
 * reachable local module paths.
 */
function walkGraph(entryPath: string, visited: Set<string> = new Set()): string[] {
  const resolved = resolve(entryPath);
  if (visited.has(resolved)) {
    return [];
  }
  if (!existsSync(resolved)) {
    return [];
  }
  visited.add(resolved);

  const source = readFileSync(resolved, 'utf-8');
  const imports = extractImports(source);
  const result: string[] = [resolved];

  for (const imp of imports) {
    // Resolve relative imports
    const baseDir = dirname(resolved);
    // Try with .ts extension
    let resolvedPath = resolve(baseDir, imp);
    if (!existsSync(resolvedPath)) {
      // Try adding .ts
      if (!resolvedPath.endsWith('.ts')) {
        resolvedPath += '.ts';
      }
      if (!existsSync(resolvedPath)) {
        // Try index.ts
        const dir = resolvedPath.replace(/\.ts$/, '');
        const indexPath = resolve(dir, 'index.ts');
        if (existsSync(indexPath)) {
          resolvedPath = indexPath;
        } else {
          continue; // Skip non-resolvable imports (external packages)
        }
      }
    }
    result.push(...walkGraph(resolvedPath, visited));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engine entrypoint boundaries', () => {
  for (const boundary of BOUNDARIES) {
    describe(`${boundary.name}`, () => {
      it('contains no forbidden imports', () => {
        const visited = new Set<string>();
        const files = walkGraph(boundary.entry, visited);

        const violations: Array<{ file: string; line: string }> = [];

        for (const file of files) {
          // Skip the render barrel itself
          if (file === RENDER_BARREL) {
            continue;
          }

          const source = readFileSync(file, 'utf-8');
          const lines = source.split('\n');

          for (const pattern of boundary.forbidden) {
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (pattern.test(line)) {
                // Check if this is a type-only import (allowed)
                const importPath = line.match(/from\s+['"]([^'"]+)['"]/)?.[1];
                if (importPath && isTypeOnlyImport(source, importPath)) {
                  continue; // type-only imports are allowed
                }
                const relPath = relative(ENGINE_SRC, file);
                violations.push({
                  file: relPath,
                  line: `${i + 1}: ${line.trim()}`,
                });
              }
            }
          }
        }

        if (violations.length > 0) {
          const detail = violations.map((v) => `  ${v.file}:${v.line}`).join('\n');
          throw new Error(
            `${boundary.name} imports pixi.js (or other forbidden module) in:\n${detail}\n\n` +
              `Import chain hint: check which module in the transitive graph pulls in pixi.js.`,
          );
        }
      });
    });
  }
});
