// scripts/src/lib/pi/contract.test.ts

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, readManifest } from '../agents/contract_pipeline/manifest_store.ts';
import { readStageResult } from '../agents/contract_pipeline/stage_result.ts';
import { handlers } from './contract.ts';

const temporaryPaths: string[] = [];

const temporaryDirectory = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'aikami-pi-contract-'));
  temporaryPaths.push(path);
  return path;
};

const callHandler = (command: string, payload: Record<string, unknown>): unknown => {
  const handler = handlers[command];
  if (!handler) {
    throw new Error(`Missing test handler: ${command}`);
  }
  return handler(payload);
};

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe('contract bridge payload validation', () => {
  test('writes a fully valid manifest', () => {
    const repoRoot = temporaryDirectory();
    const manifest = createManifest({
      contractId: 'C-001',
      contractPath: 'docs/contracts/C-001.md',
      baseCommit: 'abc123',
      baselineFingerprint: 'fingerprint',
      startStage: 'prepare',
    });

    callHandler('contract.manifest.write', { manifest, repoRoot });

    expect(readManifest({ runId: manifest.runId, cwd: repoRoot })?.contractId).toBe('C-001');
  });

  test('rejects an invalid nested manifest enum before writing', () => {
    const repoRoot = temporaryDirectory();
    const manifest = createManifest({
      contractId: 'C-002',
      contractPath: 'docs/contracts/C-002.md',
      baseCommit: 'abc123',
      baselineFingerprint: 'fingerprint',
      startStage: 'prepare',
    });
    const invalidManifest = {
      ...manifest,
      attempts: [
        {
          stage: 'not-a-stage',
          role: 'implementer',
          attempt: 1,
          paneId: 'pane-1',
          startTime: new Date().toISOString(),
        },
      ],
    };

    expect(() =>
      callHandler('contract.manifest.write', { manifest: invalidManifest, repoRoot }),
    ).toThrow();
    expect(readManifest({ runId: manifest.runId, cwd: repoRoot })).toBeUndefined();
  });

  test('rejects an incomplete stage result before writing', () => {
    const directory = temporaryDirectory();
    const resultPath = join(directory, 'result.json');

    expect(() =>
      callHandler('contract.stage.writeResult', {
        resultPath,
        result: { runId: 'run-1', stage: 'implementer', status: 'passed' },
      }),
    ).toThrow();
    expect(existsSync(resultPath)).toBe(false);
  });

  test('writes a fully valid stage result', () => {
    const directory = temporaryDirectory();
    const resultPath = join(directory, 'result.json');
    const result = {
      runId: 'run-1',
      stage: 'implementer' as const,
      attempt: 1,
      status: 'passed' as const,
      summary: 'done',
      findings: [],
      filesTouched: [],
      evidence: [],
      contractHash: 'contract-hash',
      diffHash: 'diff-hash',
    };

    callHandler('contract.stage.writeResult', { resultPath, result });

    expect(
      readStageResult({ resultPath, runId: 'run-1', role: 'implementer', attempt: 1 }),
    ).toEqual(result);
  });
});
