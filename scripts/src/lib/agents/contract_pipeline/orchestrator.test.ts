// scripts/src/lib/agents/contract_pipeline/orchestrator.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updateContractStatus } from './contract_status.ts';
import { captureGitState } from './git_state.ts';
import type { ContractHerdrAdapterInterface } from './herdr_adapter.ts';
import { createManifest, writeManifest } from './manifest_store.ts';
import { runContractPipeline } from './orchestrator.ts';
import { writeStageResult } from './stage_result.ts';
import type { ContractReviewDecision, WorkerLaunchRequest } from './types.ts';

const temporaryDirectories: string[] = [];

const setupRepository = (): { root: string; contractPath: string } => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-orchestrator-'));
  temporaryDirectories.push(root);
  const contractPath = join(root, 'docs/contracts/C-365-test.md');
  mkdirSync(dirname(contractPath), { recursive: true });
  writeFileSync(
    contractPath,
    '# Contract C-365: Test Pipeline\n\n| **Status** | draft |\n\n## Acceptance Criteria\n',
  );
  mkdirSync(join(root, '.pi/prompts'), { recursive: true });
  for (const file of [
    'contract-create.md',
    'contract-critique.md',
    'contract.md',
    'contract-verify.md',
    'contract-review-captain.md',
  ]) {
    writeFileSync(join(root, '.pi/prompts', file), `Role prompt for $ARGUMENTS (${file})`);
  }
  writeFileSync(join(root, '.gitignore'), '.pi/contract-runs/\n');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'],
    { cwd: root, stdio: 'ignore' },
  );
  return { root, contractPath };
};

class FakeAdapter implements ContractHerdrAdapterInterface {
  readonly root: string;
  readonly contractPath: string;
  launchedRoles: string[] = [];
  workerPrompts: string[] = [];
  criticStatuses: Array<'passed' | 'changes_requested'> = ['passed'];
  reviewStarts = 0;

  constructor(options: { root: string; contractPath: string }) {
    this.root = options.root;
    this.contractPath = options.contractPath;
  }

  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    return { workspaceId: 'workspace-test', pipelinePaneId: 'pane-pipeline' };
  }

  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    this.launchedRoles.push(request.role);
    this.workerPrompts.push(request.prompt);
    if (request.role === 'implementer') {
      updateContractStatus({ contractPath: this.contractPath, status: 'implemented' });
      mkdirSync(join(this.root, 'scripts/src'), { recursive: true });
      writeFileSync(join(this.root, 'scripts/src/feature.ts'), 'export const feature = true;\n');
    }
    const status = request.role === 'critic' ? (this.criticStatuses.shift() ?? 'passed') : 'passed';
    writeStageResult({
      resultPath: request.resultPath,
      result: {
        runId: request.runId,
        stage: request.role,
        attempt: request.attempt,
        status,
        summary: `${request.role} ${status}`,
        findings: status === 'changes_requested' ? ['Add exact retry evidence.'] : [],
        filesTouched: [],
        evidence: ['fake adapter'],
        contractHash: 'contract',
        diffHash: captureGitState(this.root).fingerprint,
      },
    });
    return { paneId: `pane-${request.role}` };
  }

  async startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
  }): Promise<string> {
    this.reviewStarts += 1;
    expect(options.prompt).toContain('.pi/contract-runs/');
    mkdirSync(dirname(options.reviewDecisionPath), { recursive: true });
    const decision: ContractReviewDecision = {
      runId: options.prompt.match(/run-[\w-]+/)?.[0] ?? '',
      decision: 'approve',
      summary: 'User approved test run.',
      diffHash: captureGitState(this.root).fingerprint,
      contractChanged: false,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(options.reviewDecisionPath, JSON.stringify(decision));
    return 'pane-review';
  }

  async sendReviewMessage(): Promise<void> {}
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('runContractPipeline', () => {
  it('runs writer, critic, implementer, verifier, then one final review', async () => {
    const repository = setupRepository();
    const adapter = new FakeAdapter(repository);
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      target: repository.contractPath,
      adapterFactory: () => adapter,
    });

    expect(adapter.launchedRoles).toEqual(['writer', 'critic', 'implementer', 'verifier']);
    expect(adapter.reviewStarts).toBe(1);
    expect(manifest.currentStage).toBe('accepted');
    expect(manifest.verificationFingerprint).toBeDefined();
    expect(manifest.attempts).toHaveLength(4);
    expect(readFileSync(repository.contractPath, 'utf-8')).toContain('| **Status** | verified |');
  });

  it('passes complete critic findings to the next writer attempt', async () => {
    const repository = setupRepository();
    const adapter = new FakeAdapter(repository);
    adapter.criticStatuses = ['changes_requested', 'passed'];
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      target: repository.contractPath,
      adapterFactory: () => adapter,
    });

    expect(adapter.launchedRoles).toEqual([
      'writer',
      'critic',
      'writer',
      'critic',
      'implementer',
      'verifier',
    ]);
    expect(adapter.workerPrompts[2]).toContain('Add exact retry evidence.');
    expect(manifest.criticLoops).toBe(1);
    expect(manifest.currentStage).toBe('accepted');
  });

  it('resumes from the recorded stage without replaying completed roles', async () => {
    const repository = setupRepository();
    updateContractStatus({ contractPath: repository.contractPath, status: 'implemented' });
    execFileSync('git', ['add', '.'], { cwd: repository.root, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'implemented'],
      { cwd: repository.root, stdio: 'ignore' },
    );
    const baseline = captureGitState(repository.root);
    const resumable = createManifest({
      contractId: 'C-365',
      contractPath: repository.contractPath,
      baseCommit: 'implemented',
      baselineFingerprint: baseline.fingerprint,
      startStage: 'verify',
    });
    writeManifest({ manifest: resumable, cwd: repository.root });
    const adapter = new FakeAdapter(repository);
    const manifest = await runContractPipeline({
      repoRoot: repository.root,
      resumeRunId: resumable.runId,
      adapterFactory: () => adapter,
    });

    expect(adapter.launchedRoles).toEqual(['verifier']);
    expect(manifest.currentStage).toBe('accepted');
  });
});
