// scripts/src/lib/agents/evaluation/cli.test.ts

import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('evaluation CLI', () => {
  test('rejects an invalid thinking level before invoking the provider', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'aikami-eval-cli-'));
    const providerMarker = join(temporaryDirectory, 'pi-called');
    const fakePi = join(temporaryDirectory, 'pi');
    writeFileSync(fakePi, '#!/bin/sh\n: > "$PI_CALLED_MARKER"\n');
    chmodSync(fakePi, 0o755);

    try {
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          join(import.meta.dir, 'cli.ts'),
          '--paid',
          '--tasks',
          'pure_typescript_v1',
          '--configs',
          'flash',
          '--thinking',
          'turbo',
          '--max-cost',
          '1',
          '--max-turns',
          '1',
          '--max-minutes',
          '1',
        ],
        env: {
          ...process.env,
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ''}`,
          PI_CALLED_MARKER: providerMarker,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('--thinking must be a supported thinking level; received "turbo".');
      expect(existsSync(providerMarker)).toBeFalse();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
