// scripts/src/lib/agents/contract_pipeline/stage_runner.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { writeStageResult } from './stage_result.ts';
import { runStage } from './stage_runner.ts';
import type { ContractStageResult, WorkerLaunchRequest } from './types.ts';

// Resolve the project root from this file's location:
// scripts/src/lib/agents/contract_pipeline/stage_runner.test.ts
// → ../../../../../.. = monorepo root
const projectRoot = resolve(dirname(import.meta.path), '..', '..', '..', '..', '..');

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aikami-contract-stage-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createPassedResult = (options: { runId: string; attempt: number }): ContractStageResult => ({
  runId: options.runId,
  stage: 'writer',
  attempt: options.attempt,
  status: 'passed',
  summary: 'Contract draft completed.',
  findings: [],
  filesTouched: ['docs/contracts/C-365-test.md'],
  evidence: ['Canonical prompt was expanded.'],
  contractHash: 'contract-hash',
  diffHash: 'diff-hash',
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('runStage', () => {
  it('delivers the expanded canonical writer prompt and advances from a valid artifact', async () => {
    const runDirectory = createTemporaryDirectory();
    const launches: WorkerLaunchRequest[] = [];

    const outcome = await runStage({
      repoRoot: projectRoot,
      runDirectory,
      runId: 'run-ac1',
      stage: 'write_contract',
      attempt: 1,
      contractPath: 'docs/contracts/C-365-test.md',
      timeoutMs: 500,
      pollIntervalMs: 10,
      launchWorker: async (request) => {
        launches.push(request);
        writeStageResult({
          resultPath: request.resultPath,
          result: createPassedResult({ runId: request.runId, attempt: request.attempt }),
        });
        return { paneId: 'pane-writer', diagnostic: 'prompt example: ## Contract Writer Summary' };
      },
    });

    expect(launches).toHaveLength(1);
    expect(launches[0]?.delivery).toBe('direct_prompt');
    expect(launches[0]?.prompt).toContain('C-365-test.md');
    expect(launches[0]?.prompt).not.toContain('$ARGUMENTS');
    expect(launches[0]?.prompt.trimStart().startsWith('/contract-create')).toBe(false);
    expect(outcome.result.status).toBe('passed');
    expect(outcome.paneId).toBe('pane-writer');
  });

  it('ignores a stale artifact until the expected run, stage, and attempt arrives', async () => {
    const runDirectory = createTemporaryDirectory();

    const outcome = await runStage({
      repoRoot: projectRoot,
      runDirectory,
      runId: 'run-current',
      stage: 'write_contract',
      attempt: 2,
      contractPath: 'docs/contracts/C-365-test.md',
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      launchWorker: async (request) => {
        writeStageResult({
          resultPath: request.resultPath,
          result: createPassedResult({ runId: 'run-stale', attempt: 1 }),
        });
        setTimeout(() => {
          writeStageResult({
            resultPath: request.resultPath,
            result: createPassedResult({ runId: request.runId, attempt: request.attempt }),
          });
        }, 30);
        return { paneId: 'pane-writer', diagnostic: 'stale result emitted first' };
      },
    });

    expect(outcome.result.runId).toBe('run-current');
    expect(outcome.result.attempt).toBe(2);
  });

  it('blocks when terminal text claims completion without a result artifact', async () => {
    const runDirectory = createTemporaryDirectory();

    const outcome = await runStage({
      repoRoot: projectRoot,
      runDirectory,
      runId: 'run-spoofed',
      stage: 'write_contract',
      attempt: 1,
      contractPath: 'docs/contracts/C-365-test.md',
      timeoutMs: 40,
      pollIntervalMs: 10,
      launchWorker: async () => ({
        paneId: 'pane-writer',
        diagnostic: '## Contract Writer Summary\nNext: critique',
      }),
    });

    expect(outcome.result.status).toBe('blocked');
    expect(outcome.result.findings).toContain(
      'No exact contract_stage_complete result was produced before timeout.',
    );
  });
});
