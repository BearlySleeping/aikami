// packages/shared/local-ai/src/lib/engines/transport_literals.test.ts
//
// AC-1 (C-510): exactly ONE module implements the sd.cpp generation transport.
//
// Greps the allowlisted source roots for the generation-transport literals
// (`/sdcpp/v1/img_gen`, `/sdcpp/v1/jobs/`) and asserts that the only non-test
// hit is this package's sd.cpp adapter. The `/sdapi/v1/sd-models` readiness
// probe is deliberately out of scope — it legitimately lives in five probe
// modules that must keep working unchanged.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** The generation-transport literals — readiness probes are NOT covered. */
const TRANSPORT_LITERALS = ['/sdcpp/v1/img_gen', '/sdcpp/v1/jobs/'];

/** The one module allowed to contain them. */
const ALLOWED_MODULE = 'packages/shared/local-ai/src/lib/engines/sdcpp_engine.ts';

/** Source roots the AC greps. */
const SCAN_ROOTS = [
  'packages',
  'apps/backend/image/scripts',
  'apps/backend/local-stack',
  'apps/frontend/client/src/lib/services/image',
];

/** Files that must contain none of the literals, verbatim from the AC. */
const MUST_BE_CLEAN = [
  'apps/backend/image/scripts/generate_avatar.ts',
  'apps/backend/image/scripts/check_health.ts',
  'apps/backend/image/scripts/image_service.test.ts',
  'apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.svelte.ts',
  'apps/frontend/client/src/lib/services/image/engine/comfyui_engine.svelte.ts',
];

/** Walks up from this file until the repo root (has `.moon/` + `packages/`). */
const findRepoRoot = (): string => {
  let candidate = resolve(import.meta.dir);
  for (let depth = 0; depth < 12; depth++) {
    if (existsSync(join(candidate, '.moon')) && existsSync(join(candidate, 'packages'))) {
      return candidate;
    }
    candidate = resolve(candidate, '..');
  }
  throw new Error(`Could not locate the repository root from ${import.meta.dir}`);
};

const REPO_ROOT = findRepoRoot();

const collectSourceFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.svelte-kit') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(?:ts|svelte)$/.test(entry.name)) {
      continue;
    }
    // Test files legitimately assert the literals.
    if (/\.test\.ts$/.test(entry.name) || /\.spec\.ts$/.test(entry.name)) {
      continue;
    }
    found.push(full);
  }
  return found;
};

const containsTransportLiteral = (contents: string): boolean =>
  TRANSPORT_LITERALS.some((literal) => contents.includes(literal));

describe('AC-1: one sd.cpp generation transport', () => {
  test('exactly one non-test module implements the transport', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectSourceFiles(join(REPO_ROOT, root))) {
        if (containsTransportLiteral(readFileSync(file, 'utf8'))) {
          offenders.push(relative(REPO_ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([ALLOWED_MODULE]);
  });

  test('the delegated modules and the backend scripts contain none', () => {
    for (const relPath of MUST_BE_CLEAN) {
      const full = join(REPO_ROOT, relPath);
      expect(existsSync(full)).toBe(true);
      expect(statSync(full).isFile()).toBe(true);
      const contents = readFileSync(full, 'utf8');
      for (const literal of TRANSPORT_LITERALS) {
        expect({ file: relPath, literal, present: contents.includes(literal) }).toEqual({
          file: relPath,
          literal,
          present: false,
        });
      }
    }
  });
});
