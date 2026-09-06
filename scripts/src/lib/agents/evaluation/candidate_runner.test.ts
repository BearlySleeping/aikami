// scripts/src/lib/agents/evaluation/candidate_runner.test.ts

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCandidateTest } from './candidate_runner.ts';

describe('isolated candidate execution', () => {
  it('scrubs credentials and denies filesystem and network capabilities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aikami-candidate-runner-'));
    const target = 'probe.ts';
    const forbiddenPath = join(directory, 'not-readable.txt');
    const previousSecret = process.env.AIKAMI_EVAL_TEST_SECRET;
    process.env.AIKAMI_EVAL_TEST_SECRET = 'must-not-leak';
    try {
      await writeFile(forbiddenPath, 'private');
      await writeFile(
        join(directory, target),
        `import { readFile } from 'node:fs/promises';
export const probe = async () => {
  let filesystemDenied = false;
  let networkDenied = false;
  try { await readFile(${JSON.stringify(forbiddenPath)}, 'utf-8'); } catch { filesystemDenied = true; }
  try { await fetch('http://127.0.0.1:9'); } catch { networkDenied = true; }
  return { credential: process.env.AIKAMI_EVAL_TEST_SECRET, filesystemDenied, networkDenied };
};\n`,
      );

      const result = await runCandidateTest({
        sandboxPath: directory,
        target,
        testSource: `
const probe = await candidate.probe();
if (probe.credential !== undefined) return { accepted: false, diagnostics: 'credential leaked' };
if (!probe.filesystemDenied) return { accepted: false, diagnostics: 'filesystem read escaped sandbox' };
if (!probe.networkDenied) return { accepted: false, diagnostics: 'network access was allowed' };
return { accepted: true, diagnostics: '' };
`,
      });
      expect(result).toEqual({ accepted: true, diagnostics: '' });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AIKAMI_EVAL_TEST_SECRET;
      } else {
        process.env.AIKAMI_EVAL_TEST_SECRET = previousSecret;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('terminates a candidate that never settles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aikami-candidate-timeout-'));
    try {
      await writeFile(
        join(directory, 'never.ts'),
        'export const never = (): Promise<never> => new Promise(() => { setInterval(() => {}, 100); });\n',
      );
      const startedAt = Date.now();
      const result = await runCandidateTest({
        sandboxPath: directory,
        target: 'never.ts',
        testSource: 'await candidate.never(); return { accepted: true, diagnostics: "" };',
      });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContain('exceeded 2000ms');
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
