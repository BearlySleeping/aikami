// scripts/src/lib/agents/contract_pipeline/orchestrator.test.ts
// biome-ignore-all lint/style/useNamingConvention: test descriptions are human-readable
//
// NOTE: Full orchestrator integration tests require a running herdr server
// (for checkAgentWorking polling). Core pipeline logic is verified via
// state_machine.test.ts and stage_runner.test.ts.
// These tests verify manifest structure and dry-run correctness.

import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureGitState, currentCommit } from './git_state.ts';
import { createManifest, writeManifest } from './manifest_store.ts';
import { runContractPipeline } from './orchestrator.ts';

const temporaryDirectories: string[] = [];

const setupRepository = (): { root: string; contractPath: string } => {
  const root = mkdtempSync(join(process.cwd(), '.pi', 'tmp-test-contract-pipeline-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, '.gitignore'), '.pi/contract-runs/\n.pi/workspaces/\n');
  mkdirSync(join(root, 'docs', 'contracts'), { recursive: true });
  const contractPath = join(root, 'docs/contracts/C-365-test.md');
  writeFileSync(
    contractPath,
    `# Contract C-365: Test\n\n| **Status** | draft |\n\n## Acceptance Criteria\n\nAC-1: something observable.\n`,
  );
  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'],
    { cwd: root, stdio: 'ignore' },
  );
  return { root, contractPath };
};

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('runContractPipeline', () => {
  it('resolves contract and creates manifest on dry run', async () => {
    const repository = setupRepository();
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      target: repository.contractPath,
      dryRun: true,
    });

    expect(manifest.version).toBe(3);
    expect(manifest.contractId).toBe('C-365');
    expect(manifest.currentStage).toBe('write_contract');
    expect(manifest.attempts).toHaveLength(0);
    expect(manifest.verifyLoops).toBe(0);
  });

  it('resolves contract by ID (not file path)', async () => {
    const repository = setupRepository();
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      target: 'C-365',
      dryRun: true,
    });

    expect(manifest.contractId).toBe('C-365');
  });

  it('rejects dirty worktree', async () => {
    const repository = setupRepository();
    writeFileSync(join(repository.root, 'dirty-file.ts'), '// changed');
    await expect(
      runContractPipeline({
        repoRoot: repository.root,
        target: repository.contractPath,
        dryRun: true,
      }),
    ).rejects.toThrow(/dirty/);
  });

  it('allows dirty worktree with --allow-dirty', async () => {
    const repository = setupRepository();
    writeFileSync(join(repository.root, 'dirty-file.ts'), '// changed');
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      target: repository.contractPath,
      dryRun: true,
      allowDirty: true,
    });

    expect(manifest.contractId).toBe('C-365');
  });

  it('creates manifest with correct resume info', async () => {
    const repository = setupRepository();
    // Set the contract status to implemented so resume picks up implement stage.
    const contractPath = repository.contractPath;
    const content = readFileSync(contractPath, 'utf-8');
    writeFileSync(
      contractPath,
      content.replace('| **Status** | draft |', '| **Status** | implemented |'),
    );

    // Create a pre-existing manifest for resume.
    const baseline = captureGitState(repository.root);
    const resumable = createManifest({
      contractId: 'C-365',
      contractPath: repository.contractPath,
      baseCommit: currentCommit(repository.root),
      baselineFingerprint: baseline.fingerprint,
      startStage: 'implement',
    });
    writeManifest({ manifest: resumable, cwd: repository.root });

    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      resumeRunId: resumable.runId,
      dryRun: true,
    });

    expect(manifest.runId).toBe(resumable.runId);
    expect(manifest.currentStage).toBe('verify'); // STATUS_TO_START_STAGE['implemented'] = 'verify'
  });
});
