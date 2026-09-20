// scripts/src/lib/env/__tests__/scripts_env.test.ts
//
// The mode-switch contract of the scripts env loader.
//
// `getScriptsEnv` prefers `process.env` over the per-mode cache, and
// `initScriptsEnv` injects loaded values into `process.env`. That combination
// used to leak: after resolving `staging`, a later `production` resolution
// still saw staging's `CATALOG_BUCKET`, because the injection was never undone
// and `process.env` outranks the cache. A process that plans staging and then
// promotes to production would have targeted the wrong bucket — the exact
// failure the release-target gate exists to prevent, reintroduced one layer
// below it.
//
// The loader is process-global state, so this file uses scratch mode names that
// no other test can be sitting on (guaranteeing a real mode change) and restores
// whatever mode it found on the way out.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAikamiMode } from '../mode.ts';
import { getScriptsEnv, initScriptsEnv, loadedScriptsEnvMode } from '../scripts_env.ts';

/** A key no real env file uses, so the test cannot collide with a real one. */
const KEY = 'AIKAMI_TEST_SCRIPTS_ENV_PROBE';

/** Scratch modes: never equal to whatever was loaded before, so the first
 *  `initScriptsEnv` below is always a real mode change. */
const MODE_A = 'aikami-test-env-a';
const MODE_B = 'aikami-test-env-b';

/** The mode the loader was on before this file ran, for restoration. */
const ORIGINAL_MODE = loadedScriptsEnvMode();

let root: string;

const writeModeEnv = (mode: string, value: string): void => {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', `.env.${mode}`), `${KEY}=${value}\n`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aikami-scripts-env-'));
  delete process.env[KEY];
});

afterEach(() => {
  delete process.env[KEY];
  rmSync(root, { recursive: true, force: true });
  // Put the loader back where we found it — leaving it on a scratch mode would
  // make the next test in this process read these temp files.
  initScriptsEnv(ORIGINAL_MODE ?? resolveAikamiMode());
});

describe('scripts env loader — mode switching', () => {
  test('a mode change does not leak the previous mode value', () => {
    writeModeEnv(MODE_A, 'a-value');
    writeModeEnv(MODE_B, 'b-value');

    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('a-value');

    initScriptsEnv(MODE_B, root);
    expect(getScriptsEnv(KEY)).toBe('b-value');
  });

  test('a value provided by direnv/CI survives a mode change', () => {
    writeModeEnv(MODE_A, 'a-value');
    writeModeEnv(MODE_B, 'b-value');
    process.env[KEY] = 'from-direnv';

    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('from-direnv');

    initScriptsEnv(MODE_B, root);
    expect(getScriptsEnv(KEY)).toBe('from-direnv');
  });

  test('a value overwritten by someone else is not undone by a mode change', () => {
    writeModeEnv(MODE_A, 'a-value');
    writeModeEnv(MODE_B, 'b-value');

    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('a-value');

    // Simulate a caller that deliberately overrode the injected value.
    process.env[KEY] = 'explicitly-overridden';

    initScriptsEnv(MODE_B, root);
    expect(getScriptsEnv(KEY)).toBe('explicitly-overridden');
  });

  test('re-initialising the same mode is a no-op', () => {
    writeModeEnv(MODE_A, 'a-value');
    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('a-value');
    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('a-value');
  });

  test('a mode whose env file is absent contributes nothing', () => {
    writeModeEnv(MODE_A, 'a-value');
    initScriptsEnv(MODE_A, root);
    expect(getScriptsEnv(KEY)).toBe('a-value');

    // MODE_B has no file: the previous value must be dropped, not inherited.
    initScriptsEnv(MODE_B, root);
    expect(getScriptsEnv(KEY)).toBeUndefined();
  });
});
