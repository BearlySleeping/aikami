// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ensureServer, findWorkspace, herdr, herdrJson } from '../../herdr/session.ts';
import { provisionJjWorkspace } from '../jj.ts';
import { logPath } from './manifest_store.ts';
import { piModelFlags } from './models.ts';
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
  result: { panes: Array<{ pane_id: string; tab_id: string; agent_status?: string }> };
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

/**
 * Build a run-scoped pi session ID.
 * Format: pi-{contractId}-{runId}-agent-{role}
 * Includes runId to prevent cross-run contamination.
 */
const buildSessionId = (options: { contractId: string; runId: string; role: string }): string =>
  `pi-${options.contractId}-${options.runId}-agent-${options.role}`;

// ── Role tool allowlists ────────────────────────────────────

/**
 * Map roles to their allowed pi tools.
 * Writer: read codebase, generate/edit contract
 * Critic: read codebase + edit contract (fixes inline, no writer bounce)
 * Implementer/verifier: default tools (no restrictions)
 */
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
    // Critic can edit the contract to fix issues inline.
    // No bash/write to code — only contract file mutations via edit.
    return [
      'read',
      'grep',
      'find',
      'ls',
      'edit',
      'contract_scan_backlog',
      'contract_stage_complete',
    ];
  }
  // Implementer and verifier use default pi tools.
  return undefined;
};

/** Adapter surface consumed by the contract orchestrator. */
export type ContractHerdrAdapterInterface = {
  initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }>;
  getWorkspaceId(): string;
  getWorkspacePath(): string;
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
  private readonly _workspaceLabel: string;
  private _workspaceId = '';
  private _pipelinePaneId = '';
  private _workspacePath = '';

  constructor(options: { repoRoot: string; runId: string; contractId: string }) {
    this._repoRoot = options.repoRoot;
    this._runId = options.runId;
    this._workspaceLabel = `aikami-contract-${options.contractId}`;
  }

  /** Create or recover the contract-specific workspace and pipeline log tab. */
  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    await ensureServer();
    const label = this._workspaceLabel;
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

        this._provisionJjWorkspace();

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

      this._provisionJjWorkspace();

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

    this._provisionJjWorkspace();

    return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
  }

  /** Return the current workspace ID. Must be called after initialize(). */
  getWorkspaceId(): string {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    return this._workspaceId;
  }

  /** Return the isolated jj workspace path. Must be called after initialize(). */
  getWorkspacePath(): string {
    return this._workspacePath;
  }

  /**
   * Provision an isolated jj workspace on top of dev.
   * The root working copy is never moved — all file mutations happen here.
   */
  private _provisionJjWorkspace(): void {
    const wsName = this._runId; // already prefixed "run-" from createManifest
    try {
      const { workspacePath, changeId } = provisionJjWorkspace({
        repoRoot: this._repoRoot,
        name: wsName,
        baseRevision: 'dev',
      });
      this._workspacePath = workspacePath;
      console.log(`🔧 jj workspace: ${workspacePath} (change: ${changeId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  jj workspace provisioning failed — using repo root: ${message}`);
    }
  }

  /** Close a tab by label if it exists in the current workspace. */
  private async _closeTabByLabel(label: string): Promise<void> {
    const tabs = await herdrJson<TabListResult>(['tab', 'list', '--workspace', this._workspaceId]);
    const existingTab = tabs?.result.tabs.find((tab) => tab.label === label);
    if (existingTab) {
      await runHerdr(['tab', 'close', existingTab.tab_id]);
    }
  }

  /**
   * Send text to Pi and submit it.
   * Retries Enter up to 3 times with increasing delays to handle
   * welcome/update overlays that may consume Enter keypresses.
   */
  /**
   * Send text to Pi and submit it.
   * Sends a pre-Enter to clear any overlay, then the task text + Enter.
   * Re-sends the full text+Enter up to 5 more times with 2s gaps to handle
   * slow context-mode bootstrapping swallowing the initial input.
   */
  private async _sendTaskText(options: { paneId: string; text: string }): Promise<void> {
    // Dismiss any residual overlay with a throwaway keystroke.
    await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Send the task text + Enter, then re-send unconditionally up to 5 more
    // times. Pi's TUI may not be ready to accept input on the first few
    // attempts (context-mode bootstrapping, extension loading).
    for (let i = 0; i < 6; i++) {
      await runHerdr(['pane', 'send-text', options.paneId, options.text]);
      await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
      if (i < 5) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  /** Write the static worker prompt and build the pi JSON-mode headless command. */
  private _buildWorkerCommand(
    request: WorkerLaunchRequest,
    sessionId: string | undefined,
    taskMessagePath: string,
  ): string {
    const promptDirectory = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(promptDirectory, { recursive: true });
    const promptPath = join(promptDirectory, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: promptPath, content: request.prompt });

    const workspaceEnv = this._workspacePath
      ? ` CONTRACT_PIPELINE_WORKSPACE_PATH=${shellQuote(this._workspacePath)}`
      : '';

    const environment = [
      `CONTRACT_PIPELINE_RUN_ID=${shellQuote(request.runId)}`,
      `CONTRACT_PIPELINE_ROLE=${shellQuote(request.role)}`,
      `CONTRACT_PIPELINE_STAGE=${shellQuote(request.stage)}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${shellQuote(request.contractPath)}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${shellQuote(request.resultPath)}`,
      workspaceEnv,
    ].join(' ');

    const tools = toolsForRole(request.role);
    const toolsArg = tools ? ['--tools', tools.join(',')] : [];
    const sessionArg = sessionId !== undefined ? ['--session-id', shellQuote(sessionId)] : [];

    // JSON headless mode — no TUI. pi reads the prompt via -p (from file),
    // calls tools, writes contract_stage_complete result, and exits.
    const catFile = `$(cat ${shellQuote(taskMessagePath)})`;
    const modelFlags = piModelFlags(request.role);
    return [
      environment,
      'pi',
      '--mode',
      'json',
      ...sessionArg,
      ...modelFlags,
      '--append-system-prompt',
      shellQuote(promptPath),
      ...toolsArg,
      '-p',
      `"${catFile}"`,
    ].join(' ');
  }

  /** Create a new worker tab and start pi. */
  private async _createWorkerTab(options: {
    tabLabel: string;
    sessionId: string | undefined;
    request: WorkerLaunchRequest;
  }): Promise<{ paneId: string }> {
    // Writer and critic work at repo root (only touch docs/contracts/).
    // Implementer and verifier use the isolated jj workspace.
    const isolationRoles: ContractWorkerRole[] = ['implementer', 'verifier'];
    const cwd =
      isolationRoles.includes(options.request.role) && this._workspacePath
        ? this._workspacePath
        : this._repoRoot;

    // Copy contract into jj workspace so implementer/verifier can read it.
    if (cwd !== this._repoRoot && existsSync(options.request.contractPath)) {
      const wsContractPath = join(cwd, relative(this._repoRoot, options.request.contractPath));
      mkdirSync(dirname(wsContractPath), { recursive: true });
      copyFileSync(options.request.contractPath, wsContractPath);
    }

    const tab = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      this._workspaceId,
      '--cwd',
      cwd,
      '--label',
      options.tabLabel,
      '--no-focus',
    ]);
    if (!tab?.result) {
      throw new Error(`Failed to create ${options.request.role} worker tab.`);
    }

    const paneId = tab.result.root_pane.pane_id;

    // Build the task message and write it to a file for pi -p (JSON headless mode).
    const contractId = extractContractId(options.request.contractPath);
    const isRetry = options.request.attempt > 1;
    const parts: string[] = [];

    parts.push(
      isRetry
        ? `Continue the ${options.request.role} stage for ${contractId} (attempt ${options.request.attempt}). You are resuming in the same session — build on your previous work.`
        : `Begin the ${options.request.role} stage for ${contractId}. Assess the current state against the system prompt and ensure the stage is complete.`,
    );

    if (options.request.userMessage) {
      parts.push(options.request.userMessage);
    }

    parts.push(
      'Your LAST action MUST call contract_stage_complete. Even if already complete, call it with passed.',
      'Printing a text summary without the tool call will block the pipeline forever.',
      'Do not ask questions — if blocked, finish with status blocked.',
    );

    const taskMessagePath = join(
      this._repoRoot,
      '.pi/contract-runs',
      options.request.runId,
      'prompts',
      `${options.request.stage}-${options.request.attempt}-task.md`,
    );
    // Ensure the prompts directory exists before writing task message.
    // _buildWorkerCommand also creates this, but atomicWrite needs it NOW.
    mkdirSync(dirname(taskMessagePath), { recursive: true });
    atomicWrite({ path: taskMessagePath, content: parts.join('\n\n') });

    const startCommand = this._buildWorkerCommand(
      options.request,
      options.sessionId,
      taskMessagePath,
    );
    // Wrap in bash -c so env vars and $(cat ...) are interpreted correctly.
    // fish (herdr's default shell) silently fails with VAR=value command syntax.
    await runHerdr(['pane', 'run', paneId, `bash -c ${shellQuote(startCommand)}`]);

    return { paneId };
  }

  /**
   * Launch Pi in a persistent, role-named tab.
   *
   * Session IDs include the run ID: pi-{contractId}-{runId}-agent-{role}
   * This prevents cross-run contamination (previous bug: same contract ID
   * across runs reused the session, causing critic rubber-stamping).
   *
   * Retries (implement↔verify feedback loops) close the old tab and
   * recreate, restarting pi with the same session ID so conversation
   * history is preserved within a single run.
   */
  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }

    const tabLabel = request.role;
    const contractId = extractContractId(request.contractPath);

    // Per-run session: prevents cross-run contamination.
    const sessionId = buildSessionId({
      contractId,
      runId: request.runId,
      role: request.role,
    });

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
    const sessionId = buildSessionId({
      contractId,
      runId: this._runId,
      role: 'review',
    });

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
    // Wrap in bash -c so env vars are interpreted correctly.
    // fish (herdr's default shell) silently fails with VAR=value command syntax.
    await runHerdr(['pane', 'run', paneId, `bash -c ${shellQuote(command)}`]);
    await runHerdr(['wait', 'agent-status', paneId, '--status', 'idle', '--timeout', '30000']);
    await this._sendTaskText({
      paneId,
      text: `Review contract run ${this._runId}. Present the verified status from the manifest. Do NOT re-run tests — the verifier already passed them. Wait for the user.`,
    });
    return paneId;
  }

  /** Deliver one orchestrator update to the existing review session. */
  async sendReviewMessage(options: { paneId: string; message: string }): Promise<void> {
    await this._sendTaskText({ paneId: options.paneId, text: options.message });
  }
}
