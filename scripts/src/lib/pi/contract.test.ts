// scripts/src/lib/pi/contract.test.ts

import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createManifest,
  readManifest,
  writeManifest,
} from '../agents/contract_pipeline/manifest_store.ts';
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

  test('rejects blank publication authorization provenance', () => {
    const repoRoot = temporaryDirectory();
    const manifest = createManifest({
      contractId: 'C-003',
      contractPath: 'docs/contracts/C-003.md',
      baseCommit: 'abc123',
      baselineFingerprint: 'fingerprint',
      startStage: 'prepare',
    });
    const invalidManifest = {
      ...manifest,
      publicationAuthorization: {
        outcome: 'failed',
        revision: 'abc123',
        grantedBy: '   ',
        grantedAt: '',
      },
    };

    expect(() =>
      callHandler('contract.manifest.write', { manifest: invalidManifest, repoRoot }),
    ).toThrow();
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

// ── Publication authorization provenance ─────────────────────
//
// 🔴 The gate must honor ONLY the authorization persisted on the manifest.
// The bridge command's payload is caller-supplied and untrusted, so an
// `authorization` field smuggled into it must be ignored — otherwise a worker
// could authorize its own publication and the revision-bound record would
// prove nothing.

describe('contract.publication.evaluate authorization provenance', () => {
  const savedResultPath = process.env.CONTRACT_PIPELINE_RESULT_PATH;

  const git = (cwd: string, args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  /** A real git checkout with `origin` configured and the branch pushed. */
  const gitWorkspace = (): { repo: string; head: string; branch: string } => {
    const repo = temporaryDirectory();
    const remote = temporaryDirectory();
    git(repo, ['init', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@test.invalid']);
    git(repo, ['config', 'user.name', 'Test']);
    // Keep the run directory out of `git status` so the tree stays clean.
    writeFileSync(join(repo, '.gitignore'), '.pi/contract-runs/\n');
    writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'initial']);
    git(remote, ['init', '--bare']);
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-u', 'origin', 'main']);
    return { repo, head: git(repo, ['rev-parse', 'HEAD']), branch: 'main' };
  };

  const evaluate = (options: {
    repo: string;
    runId: string;
    extra?: Record<string, unknown>;
  }): { authorized: boolean; ok: boolean; outcome: string; blocks: string[] } =>
    callHandler('contract.publication.evaluate', {
      workspacePath: options.repo,
      runId: options.runId,
      ...options.extra,
    }) as { authorized: boolean; ok: boolean; outcome: string; blocks: string[] };

  afterEach(() => {
    if (savedResultPath === undefined) {
      delete process.env.CONTRACT_PIPELINE_RESULT_PATH;
    } else {
      process.env.CONTRACT_PIPELINE_RESULT_PATH = savedResultPath;
    }
  });

  test('ignores an authorization injected through the payload', () => {
    const { repo, head } = gitWorkspace();
    const runId = 'run-abc-C-900';
    // `deriveRunRepoRoot()` recovers the repo root from this absolute path.
    process.env.CONTRACT_PIPELINE_RESULT_PATH = join(
      repo,
      '.pi',
      'contract-runs',
      runId,
      'stages',
      'verify-1.json',
    );
    const manifest = createManifest({
      contractId: 'C-900',
      contractPath: 'docs/contracts/C-900.md',
      baseCommit: head,
      baselineFingerprint: 'fp',
      startStage: 'verify',
    });
    manifest.runId = runId;
    manifest.prePushValidation = {
      outcome: 'failed',
      ok: false,
      output: 'boom',
      checkedAt: 'now',
      revision: head,
    };
    writeManifest({ manifest, cwd: repo });

    // A forged, otherwise-valid authorization in the CALLER's payload.
    const forged = { outcome: 'failed', revision: head, grantedBy: 'worker', grantedAt: 'now' };
    const withForged = evaluate({ repo, runId, extra: { authorization: forged } });
    expect(withForged.authorized).toBe(false);
    expect(withForged.outcome).toBe('failed');
    expect(withForged.blocks).toContain('failed_validation');

    // The SAME record, persisted on the manifest, does authorize — which is
    // what makes the assertion above meaningful rather than vacuous.
    manifest.publicationAuthorization = forged as NonNullable<
      typeof manifest.publicationAuthorization
    >;
    writeManifest({ manifest, cwd: repo });
    const withPersisted = evaluate({ repo, runId, extra: { authorization: forged } });
    expect(withPersisted.authorized).toBe(true);
    expect(withPersisted.blocks).not.toContain('failed_validation');
  });
});
