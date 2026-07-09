/**
 * Validates all .wgsl shader files for the PixiJS v8 WebGPU reflection parser bug.
 *
 * PixiJS v8's extractAttributesFromGpuProgram.ts uses a regex that fails when
 * a WGSL vertex shader input attribute is declared immediately before a closing
 * parenthesis without trailing whitespace. This causes a WebGPU validation crash.
 *
 * Rule: every `@location(N)` attribute declaration before `)` must have a
 * trailing space between the type and the closing paren.
 *
 *   ❌ fn f(@location(0) a: vec2f, @location(1) b: vec2f)
 *   ✅ fn f(@location(0) a: vec2f, @location(1) b: vec2f )
 *
 * Usage: bun run scripts/src/lib/ops/validate_wgsl.ts [directory]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

function findWgslFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        walk(full);
      } else if (entry.endsWith('.wgsl')) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

function validateWgslFile(path: string): string[] {
  const errors: string[] = [];
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Match function parameter lists containing @location attributes.
    // Look for patterns like: `@location(N) name: type)`  — no space before )`.
    // We specifically target the case where a type is immediately followed by `)`
    // preceded by a `@location` attribute on the same line.
    //
    // Pattern: `@location(`, then some chars, then `:`, then type, then `)` directly.
    // We want to catch: `@location(0) aPosition: vec2f)`
    const hasLocation = line.includes('@location(');
    if (!hasLocation) {
      continue;
    }

    // Find all `@location(...)` followed by text that ends with `: type)`
    // (no space before the closing paren)
    const badPattern = /@location\(\d+\)\s+\w+\s*:\s*\w+\)/g;
    let match: RegExpExecArray | null;
    while (true) {
      match = badPattern.exec(line);
      if (match === null) {
        break;
      }
      errors.push(
        `${path}:${lineNum}: WebGPU reflection bug — attribute before ')' without trailing space.\n` +
          `  Found:  ${match[0].trim()}\n` +
          `  Fix:    add a space before the closing paren, e.g.:\n` +
          `          @location(N) name: type )   ← space before )`,
      );
    }
  }

  return errors;
}

function main() {
  const targetArg = process.argv[2];
  const searchDir = targetArg ? resolve(REPO_ROOT, targetArg) : REPO_ROOT;

  const wgslFiles = findWgslFiles(searchDir);

  if (wgslFiles.length === 0) {
    console.log('✓ No .wgsl shader files found — nothing to validate.');
    process.exit(0);
  }

  console.log(`Validating ${wgslFiles.length} .wgsl shader file(s)...`);

  let totalErrors = 0;
  for (const file of wgslFiles) {
    const errors = validateWgslFile(file);
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(err);
      }
      totalErrors += errors.length;
    }
  }

  if (totalErrors > 0) {
    console.error(`\n✗ ${totalErrors} WebGPU reflection bug(s) found in .wgsl files.`);
    console.error(
      '  Fix: add a trailing space before closing parentheses in @location attribute lists.',
    );
    console.error(
      '  See docs/architecture/limitations.md § PixiJS v8 WebGPU Shader Reflection Bug',
    );
    process.exit(1);
  }

  console.log('✓ All .wgsl files pass WebGPU reflection validation.');
}

main();
