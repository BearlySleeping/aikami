// apps/backend/image/scripts/generate_asset.test.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI test harness — console is the interface */
// CLI-surface tests for the C-510 `generate:asset` command.
//
// The transport itself is covered by the mocked-engine assertions in
// `@aikami/local-ai` (which run in CI); this file is the image-app half: the
// CLI must fail loudly on a bad invocation and must list the recipes it knows.
//
// It deliberately does NOT require a live sd-server — the live smoke is the
// `bun run --cwd apps/backend/image generate:asset prop "rusty iron gate"`
// invocation documented in the contract's Production Surface.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'generate_asset.ts');

const runCli = async (
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const result = await $`bun run ${SCRIPT} ${args}`.quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe('generate:asset CLI surface', () => {
  test('missing arguments exits non-zero with usage', async () => {
    const result = await runCli([]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage: bun run generate:asset');
  });

  test('an unknown recipe exits non-zero and names the known recipes', async () => {
    const result = await runCli(['not-a-recipe', 'a rusty gate']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown asset recipe "not-a-recipe"');
    expect(result.stderr).toContain('prop');
  });

  test('an unknown flag exits non-zero', async () => {
    const result = await runCli(['prop', 'a gate', '--nope']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown flag "--nope"');
  });

  test('an invalid engine exits non-zero', async () => {
    const result = await runCli(['prop', 'a gate', '--engine', 'midjourney']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--engine must be "sdcpp" or "comfyui"');
  });

  test('--timeout rejects a non-positive or non-numeric value', async () => {
    const zero = await runCli(['prop', 'a gate', '--timeout', '0']);
    expect(zero.exitCode).not.toBe(0);
    expect(zero.stderr).toContain('--timeout must be a positive integer number of seconds');

    const text = await runCli(['prop', 'a gate', '--timeout', 'soon']);
    expect(text.exitCode).not.toBe(0);
    expect(text.stderr).toContain('--timeout must be a positive integer number of seconds');
  });

  test('--timeout is accepted and reported, and does not block the run', async () => {
    // The engine is unreachable here, so the run still fails — but it must
    // fail on the transport, not on flag parsing, and it must echo the budget.
    const result = await runCli([
      'prop',
      'a rusty iron gate',
      '--base-url',
      'http://127.0.0.1:1',
      '--timeout',
      '900',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('Timeout: 900s');
    expect(result.stderr).not.toContain('--timeout must be');
  });

  test('the props recipe round-trips through ASSET_CATEGORIES', async () => {
    // A `props` recipe whose category were missing from ASSET_CATEGORIES would
    // be rejected at registry load — reaching the engine dispatch phase at all
    // proves the category table entry exists. The engine is unreachable here,
    // so the run fails with a transport error, not a category error.
    const result = await runCli(['prop', 'a rusty iron gate', '--base-url', 'http://127.0.0.1:1']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain('absent from ASSET_CATEGORIES');
    expect(result.stderr).not.toContain('Unknown asset recipe');
  });
});
