// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

  /** Launch Pi directly in a dedicated tab — fully visible to the user. */
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

    const paneId = tab.result.root_pane.pane_id;

    // Delete any pre-existing contract file before the writer's first attempt.
    // This ensures the contract is always created through Pi (via contract_generate)
    // rather than relying on a stale programmatically-generated shell.
    if (request.role === 'writer' && request.attempt === 1) {
      try {
        unlinkSync(resolve(this._repoRoot, request.contractPath));
      } catch {
        // File does not exist — nothing to clean up.
      }
    }

    // Write the expanded prompt to a file that Pi loads via --append-system-prompt.
    const promptDirectory = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(promptDirectory, { recursive: true });
    const promptPath = join(promptDirectory, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: promptPath, content: request.prompt });

    // Write the result path hint so contract_stage_complete knows where to write.
    const environment = [
      `CONTRACT_PIPELINE_RUN_ID=${shellQuote(request.runId)}`,
      `CONTRACT_PIPELINE_ROLE=${shellQuote(request.role)}`,
      `CONTRACT_PIPELINE_STAGE=${shellQuote(request.stage)}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${shellQuote(request.contractPath)}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${shellQuote(request.resultPath)}`,
    ].join(' ');
    const contractId = request.contractPath.match(/(C-\d+|MIG-\d+)/)?.[0] ?? request.runId;
    const sessionId = `contract-${request.runId}-${request.stage}-${request.attempt}`;
    const toolsArg = [];
    if (request.role === 'writer') {
      toolsArg.push(
        '--tools',
        'read,grep,find,ls,edit,write,contract_scan_backlog,contract_generate,contract_stage_complete',
      );
    } else if (request.role === 'critic') {
      toolsArg.push('--tools', 'read,grep,find,ls,contract_scan_backlog,contract_stage_complete');
    }

    // Start Pi interactively — no JSON mode, no -p. The user sees the full Pi TUI.
    const startCommand = [
      environment,
      'pi',
      '--session-id',
      shellQuote(sessionId),
      '--append-system-prompt',
      shellQuote(promptPath),
      ...toolsArg,
    ].join(' ');
    await runHerdr(['pane', 'run', paneId, startCommand]);

    // Wait for Pi to be idle (ready for prompt).
    const idleResult = await herdr([
      'wait',
      'agent-status',
      paneId,
      '--status',
      'idle',
      '--timeout',
      '30000',
    ]);
    if (idleResult.code !== 0) {
      await new Promise((r) => setTimeout(r, 3_000));
    }

    // Send the task prompt.
    const taskMessage = [
      `Execute the ${request.role} stage for ${contractId}.`,
      'Read the system prompt for full instructions.',
      'Finish through contract_stage_complete.',
      'Do not ask questions — if blocked, finish with status blocked.',
    ].join(' ');
    await runHerdr(['pane', 'run', paneId, taskMessage]);

    return { paneId };
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
