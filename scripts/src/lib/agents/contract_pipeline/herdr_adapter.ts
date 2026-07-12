// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureServer, findWorkspace, herdr, herdrJson } from '../../herdr/session.ts';
import { logPath } from './manifest_store.ts';
import type { WorkerLaunchRequest } from './types.ts';

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type TabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type TabListResult = {
  result: { tabs: Array<{ tab_id: string; label: string }> };
};

type PaneListResult = {
  result: { panes: Array<{ pane_id: string; tab_id: string }> };
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const runHerdr = async (args: string[]): Promise<void> => {
  const result = await herdr(args);
  if (result.code !== 0) {
    throw new Error(`Herdr command failed: herdr ${args.join(' ')}`);
  }
};

const atomicWrite = (options: { path: string; content: string }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, options.content);
  renameSync(temporaryPath, options.path);
};

/** Adapter surface consumed by the contract orchestrator. */
export type ContractHerdrAdapterInterface = {
  initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }>;
  launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }>;
  startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
  }): Promise<string>;
  sendReviewMessage(options: { paneId: string; message: string }): Promise<void>;
};

/** Herdr adapter for one contract run workspace. */
export class ContractHerdrAdapter implements ContractHerdrAdapterInterface {
  private readonly _repoRoot: string;
  private readonly _runId: string;
  private _workspaceId = '';
  private _pipelinePaneId = '';

  constructor(options: { repoRoot: string; runId: string }) {
    this._repoRoot = options.repoRoot;
    this._runId = options.runId;
  }

  /** Create or recover the run-specific workspace and pipeline log tab. */
  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    await ensureServer();
    const label = `aikami-contract-${this._runId}`;
    const existingWorkspaceId = await findWorkspace(label);
    if (existingWorkspaceId) {
      const tabs = await herdrJson<TabListResult>([
        'tab',
        'list',
        '--workspace',
        existingWorkspaceId,
      ]);
      const panes = await herdrJson<PaneListResult>([
        'pane',
        'list',
        '--workspace',
        existingWorkspaceId,
      ]);
      const pipelineTab = tabs?.result.tabs.find((tab) => tab.label === 'pipeline');
      const pipelinePane = pipelineTab
        ? panes?.result.panes.find((pane) => pane.tab_id === pipelineTab.tab_id)
        : undefined;
      if (pipelinePane) {
        this._workspaceId = existingWorkspaceId;
        this._pipelinePaneId = pipelinePane.pane_id;
        return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
      }

      const recoveredTab = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        existingWorkspaceId,
        '--cwd',
        this._repoRoot,
        '--label',
        'pipeline',
        '--no-focus',
      ]);
      if (!recoveredTab?.result) {
        throw new Error(`Failed to recover pipeline tab for ${this._runId}.`);
      }
      this._workspaceId = existingWorkspaceId;
      this._pipelinePaneId = recoveredTab.result.root_pane.pane_id;
      await runHerdr([
        'pane',
        'run',
        this._pipelinePaneId,
        `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
      ]);
      return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
    }

    const result = await herdrJson<WorkspaceCreateResult>([
      'workspace',
      'create',
      '--cwd',
      this._repoRoot,
      '--label',
      label,
      '--no-focus',
    ]);
    if (!result?.result) {
      throw new Error(`Failed to create Herdr workspace for ${this._runId}.`);
    }

    this._workspaceId = result.result.workspace.workspace_id;
    this._pipelinePaneId = result.result.root_pane.pane_id;
    await runHerdr(['tab', 'rename', result.result.tab.tab_id, 'pipeline']);
    await runHerdr([
      'pane',
      'run',
      this._pipelinePaneId,
      `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
    ]);
    return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
  }

  /** Launch a headless Pi worker in a dedicated tab. */
  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    const tab = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      this._workspaceId,
      '--cwd',
      this._repoRoot,
      '--label',
      `${request.role}-${request.attempt}`,
      '--no-focus',
    ]);
    if (!tab?.result) {
      throw new Error(`Failed to create ${request.role} worker tab.`);
    }

    const promptDirectory = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(promptDirectory, { recursive: true });
    const promptPath = join(promptDirectory, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: promptPath, content: request.prompt });

    const workerPath = join(this._repoRoot, 'scripts/src/lib/agents/contract_pipeline/worker.ts');
    const command = [
      'bun',
      'run',
      shellQuote(workerPath),
      '--run-id',
      shellQuote(request.runId),
      '--stage',
      shellQuote(request.stage),
      '--attempt',
      String(request.attempt),
      '--contract',
      shellQuote(request.contractPath),
      '--prompt',
      shellQuote(promptPath),
      '--result',
      shellQuote(request.resultPath),
      '--usage',
      shellQuote(request.usagePath),
    ].join(' ');
    await runHerdr(['pane', 'run', tab.result.root_pane.pane_id, command]);
    return { paneId: tab.result.root_pane.pane_id };
  }

  /** Start the single interactive review Pi session. */
  async startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
  }): Promise<string> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    const existingTabs = await herdrJson<TabListResult>([
      'tab',
      'list',
      '--workspace',
      this._workspaceId,
    ]);
    const existingPanes = await herdrJson<PaneListResult>([
      'pane',
      'list',
      '--workspace',
      this._workspaceId,
    ]);
    const existingReviewTab = existingTabs?.result.tabs.find(
      (candidate) => candidate.label === 'review',
    );
    const existingReviewPane = existingReviewTab
      ? existingPanes?.result.panes.find(
          (candidate) => candidate.tab_id === existingReviewTab.tab_id,
        )
      : undefined;
    if (existingReviewPane) {
      return existingReviewPane.pane_id;
    }

    const tab = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      this._workspaceId,
      '--cwd',
      this._repoRoot,
      '--label',
      'review',
      '--no-focus',
    ]);
    if (!tab?.result) {
      throw new Error('Failed to create review tab.');
    }

    const promptPath = join(
      this._repoRoot,
      '.pi/contract-runs',
      this._runId,
      'prompts',
      'review.md',
    );
    mkdirSync(dirname(promptPath), { recursive: true });
    mkdirSync(dirname(options.reviewDecisionPath), { recursive: true });
    atomicWrite({ path: promptPath, content: options.prompt });

    const environment = [
      `CONTRACT_PIPELINE_RUN_ID=${shellQuote(this._runId)}`,
      'CONTRACT_PIPELINE_ROLE=review',
      `CONTRACT_PIPELINE_CONTRACT_PATH=${shellQuote(options.contractPath)}`,
      `CONTRACT_PIPELINE_REVIEW_PATH=${shellQuote(options.reviewDecisionPath)}`,
    ].join(' ');
    const command = `${environment} pi --session-id ${shellQuote(`contract-${this._runId}-review`)} --append-system-prompt ${shellQuote(promptPath)}`;
    const paneId = tab.result.root_pane.pane_id;
    await runHerdr(['pane', 'run', paneId, command]);
    await runHerdr(['wait', 'agent-status', paneId, '--status', 'idle', '--timeout', '30000']);
    await runHerdr([
      'pane',
      'run',
      paneId,
      `Review contract run ${this._runId}. Present the verified status, then wait for the user.`,
    ]);
    return paneId;
  }

  /** Deliver one orchestrator update to the existing review session. */
  async sendReviewMessage(options: { paneId: string; message: string }): Promise<void> {
    await runHerdr(['pane', 'run', options.paneId, options.message]);
  }
}
