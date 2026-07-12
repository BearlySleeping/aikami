// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureServer, findWorkspace, herdr, herdrJson } from '../../herdr/session.ts';
import { logPath } from './manifest_store.ts';
import type { ContractWorkerRole, WorkerLaunchRequest } from './types.ts';

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

/** Extract a contract identifier from a path. */
const extractContractId = (contractPath: string): string => {
  const match = contractPath.match(/(C-\d+|MIG-\d+)/);
  return match?.[0] ?? contractPath.split('/').pop() ?? contractPath;
};

/** Build the pi session ID for a contract role. Format: pi-{contractId}-agent-{role} */
const buildSessionId = (options: { contractId: string; role: string }): string =>
  `pi-${options.contractId}-agent-${options.role}`;

/** Map roles to their allowed pi tools. */
const toolsForRole = (role: ContractWorkerRole): string[] | undefined => {
  if (role === 'writer') {
    return [
      'read',
      'grep',
      'find',
      'ls',
      'edit',
      'write',
      'contract_scan_backlog',
      'contract_generate',
      'contract_stage_complete',
    ];
  }
  if (role === 'critic') {
    return ['read', 'grep', 'find', 'ls', 'contract_scan_backlog', 'contract_stage_complete'];
  }
  // Implementer and verifier use default pi tools.
  return undefined;
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

  /** Close a tab by label if it exists in the current workspace. */
  private async _closeTabByLabel(label: string): Promise<void> {
    const tabs = await herdrJson<TabListResult>(['tab', 'list', '--workspace', this._workspaceId]);
    const existingTab = tabs?.result.tabs.find((tab) => tab.label === label);
    if (existingTab) {
      await runHerdr(['tab', 'close', existingTab.tab_id]);
    }
  }

  /** Write the worker prompt and build the pi start command with env vars. */
  private _buildWorkerCommand(request: WorkerLaunchRequest, sessionId: string): string {
    const promptDirectory = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(promptDirectory, { recursive: true });
    const promptPath = join(promptDirectory, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: promptPath, content: request.prompt });

    const environment = [
      `CONTRACT_PIPELINE_RUN_ID=${shellQuote(request.runId)}`,
      `CONTRACT_PIPELINE_ROLE=${shellQuote(request.role)}`,
      `CONTRACT_PIPELINE_STAGE=${shellQuote(request.stage)}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${shellQuote(request.contractPath)}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${shellQuote(request.resultPath)}`,
    ].join(' ');

    const tools = toolsForRole(request.role);
    const toolsArg = tools ? ['--tools', tools.join(',')] : [];

    return [
      environment,
      'pi',
      '--session-id',
      shellQuote(sessionId),
      '--append-system-prompt',
      shellQuote(promptPath),
      ...toolsArg,
    ].join(' ');
  }

  /** Create a new worker tab and start pi. */
  private async _createWorkerTab(options: {
    tabLabel: string;
    sessionId: string;
    request: WorkerLaunchRequest;
  }): Promise<{ paneId: string }> {
    const tab = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      this._workspaceId,
      '--cwd',
      this._repoRoot,
      '--label',
      options.tabLabel,
      '--no-focus',
    ]);
    if (!tab?.result) {
      throw new Error(`Failed to create ${options.request.role} worker tab.`);
    }

    const paneId = tab.result.root_pane.pane_id;
    const startCommand = this._buildWorkerCommand(options.request, options.sessionId);
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

    // Send the task prompt as input to the running Pi process.
    const contractId = extractContractId(options.request.contractPath);
    const taskMessage = [
      `Execute the ${options.request.role} stage for ${contractId}.`,
      'Read the system prompt for full instructions.',
      'Finish through contract_stage_complete.',
      'Do not ask questions — if blocked, finish with status blocked.',
    ].join(' ');
    await runHerdr(['pane', 'send-text', paneId, taskMessage]);
    await runHerdr(['pane', 'send-keys', paneId, 'Enter']);

    return { paneId };
  }

  /**
   * Launch Pi in a persistent, role-named tab.
   *
   * First launch creates the tab and pi session.
   * Subsequent launches (feedback loops) close the old tab and recreate it,
   * restarting pi with the same --session-id to preserve conversation history.
   * Tab labels use the role name only (writer, critic, implementer, verifier).
   * Session IDs follow: pi-{contractId}-agent-{role}
   */
  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }

    const tabLabel = request.role; // "writer", "critic", "implementer", "verifier"
    const contractId = extractContractId(request.contractPath);
    const sessionId = buildSessionId({ contractId, role: request.role });

    // Close any existing tab with this role label for a clean restart.
    // Pi session history persists on disk via --session-id.
    await this._closeTabByLabel(tabLabel);

    return this._createWorkerTab({ tabLabel, sessionId, request });
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

    const contractId = extractContractId(options.contractPath);
    const sessionId = buildSessionId({ contractId, role: 'review' });

    // Close any existing review tab for a clean restart.
    await this._closeTabByLabel('review');

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
    const command = [
      environment,
      'pi',
      '--session-id',
      shellQuote(sessionId),
      '--append-system-prompt',
      shellQuote(promptPath),
    ].join(' ');

    const paneId = tab.result.root_pane.pane_id;
    await runHerdr(['pane', 'run', paneId, command]);
    await runHerdr(['wait', 'agent-status', paneId, '--status', 'idle', '--timeout', '30000']);
    await runHerdr([
      'pane',
      'send-text',
      paneId,
      `Review contract run ${this._runId}. Present the verified status, then wait for the user.`,
    ]);
    await runHerdr(['pane', 'send-keys', paneId, 'Enter']);
    return paneId;
  }

  /** Deliver one orchestrator update to the existing review session. */
  async sendReviewMessage(options: { paneId: string; message: string }): Promise<void> {
    await runHerdr(['pane', 'send-text', options.paneId, options.message]);
    await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
  }
}
