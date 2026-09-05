// .pi/scripts/measure_tool_surface.test.ts
//
// C-474 AC-4: Measurement reflects the assembled surface.
// Verifies category contributions, approximate counts, unavailable categories,
// and effective profile reporting.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const MEASUREMENT_SCRIPT = resolve(import.meta.dir, 'measure_tool_surface.ts');

const runMeasurement = (role?: string) => {
  const env = { ...process.env };
  if (role === undefined) {
    delete env.CONTRACT_PIPELINE_ROLE;
  } else {
    env.CONTRACT_PIPELINE_ROLE = role;
  }
  return Bun.spawnSync({
    cmd: [process.execPath, 'run', MEASUREMENT_SCRIPT],
    cwd: REPO_ROOT,
    env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
};

describe('AC-4: Measurement CLI', () => {
  test('reports collected tools, categories, and the default profile', () => {
    const result = runMeasurement();
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/TOTAL across \d+ registered tools/);
    expect(output).toMatch(/gh_pr\s+github_cli\.ts/);
    expect(output).toMatch(/github\s+\d+\s+\d+/);
    expect(output).toContain('none (all tools loaded)');
    expect(output).toContain('Approximation only');
    expect(output).not.toContain('Token ratio');
  });

  test('reports the selected pipeline role profile', () => {
    const result = runMeasurement('implementer');
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/TOTAL across \d+ registered tools/);
    expect(output).toContain('implementer (publication + browser + vision optional)');
  });
});
