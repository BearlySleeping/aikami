import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'aikami-global-vlm-key-'));
const script = resolve(import.meta.dir, 'secrets.ts');
const original = {
  AIKAMI_ROOT: process.env.AIKAMI_ROOT,
  AIKAMI_MODE: process.env.AIKAMI_MODE,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};

afterEach(() => {
  if (original.AIKAMI_ROOT === undefined) {
    delete process.env.AIKAMI_ROOT;
  } else {
    process.env.AIKAMI_ROOT = original.AIKAMI_ROOT;
  }
  if (original.AIKAMI_MODE === undefined) {
    delete process.env.AIKAMI_MODE;
  } else {
    process.env.AIKAMI_MODE = original.AIKAMI_MODE;
  }
  if (original.OPENROUTER_API_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = original.OPENROUTER_API_KEY;
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const runSecretsLoader = (openRouterKey?: string) =>
  spawnSync('bun', ['run', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      AIKAMI_ROOT: root,
      AIKAMI_MODE: 'emulator',
      ...(openRouterKey === undefined ? {} : { OPENROUTER_API_KEY: openRouterKey }),
    },
  });

describe('OpenRouter credential ownership', () => {
  test('uses the global environment key ahead of any mode-local value', () => {
    writeFileSync(join(root, '.env.emulator'), 'OPENROUTER_API_KEY=project-local\n');
    process.env.AIKAMI_ROOT = root;
    process.env.AIKAMI_MODE = 'emulator';
    process.env.OPENROUTER_API_KEY = 'global-test-value';

    const result = runSecretsLoader('global-test-value');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("export OPENROUTER_API_KEY='global-test-value'");
    expect(result.stdout).not.toContain('project-local');
  });

  test('does not load an OpenRouter credential from a mode-local file', () => {
    writeFileSync(join(root, '.env.emulator'), 'OPENROUTER_API_KEY=project-local\n');
    process.env.AIKAMI_ROOT = root;
    process.env.AIKAMI_MODE = 'emulator';
    delete process.env.OPENROUTER_API_KEY;

    const result = runSecretsLoader();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('OPENROUTER_API_KEY');
    expect(result.stdout).not.toContain('project-local');
  });
});
