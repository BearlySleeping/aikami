// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ensureServer, findWorkspace, herdr, herdrJson } from '../../herdr/session.ts';
import { provisionGitWorktree } from '../git_worktree.ts';
import { logPath } from './manifest_store.ts';
import { getContractModelForRole, getContractThinkingForRole } from './models.ts';
import type { ContractWorkerRole, WorkerLaunchRequest } from './types.ts';
import { PIPELINE_BASE_BRANCH } from './types.ts';

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

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const AGENT_READY_TIMEOUT_MS = 120_000;
const SEND_ACCEPT_TIMEOUT_MS = 45_000;
const MAX_SEND_ATTEMPTS = 5;
const SHELL_READY_TIMEOUT_MS = 90_000;
const SHELL_NAMES = new Set(['fish', 'bash', 'zsh', 'sh', 'dash']);

type PaneProcessInfoResult = {
  result: { process_info: { foreground_processes: Array<{ name: string }> } };
};

const isShellIdle = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.every((c) => SHELL_NAMES.has(c.name)) : false;
};

const isCommandRunning = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.some((c) => !SHELL_NAMES.has(c.name)) : false;
};

const waitForShellReady = async (paneId: string): Promise<boolean> => {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  let consecutiveIdle = 0;
  let delay = 500;
  while (Date.now() < deadline) {
    const idle = await isShellIdle(paneId).catch(() => false);
    consecutiveIdle = idle ? consecutiveIdle + 1 : 0;
    if (consecutiveIdle >= 2) {
      return true;
    }
    await sleep(delay);
    delay = Math.min(delay * 1.25, 3_000);
  }
  return false;
};

const runPaneCommand = async (options: { paneId: string; command: string }): Promise<void> => {
  const ready = await waitForShellReady(options.paneId);
  if (!ready) {
    console.warn(`⚠️  Pane ${options.paneId} shell never became idle`);
  }
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    await runHerdr(['pane', 'run', options.paneId, options.command]);
    const dl = Date.now() + 10_000;
    while (Date.now() < dl) {
      if (await isCommandRunning(options.paneId).catch(() => false)) {
        return;
      }
      await sleep(500);
    }
    await sleep(1_000 * attempt);
  }
  console.warn(`⚠️  Command never observed in pane ${options.paneId}`);
};

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
  private readonly _headless: boolean;
  private _workspaceId = '';
  private _pipelinePaneId = '';
  private _workspacePath = '';

  constructor(options: {
    repoRoot: string;
    runId: string;
    contractId: string;
    headless?: boolean;
  }) {
    this._repoRoot = options.repoRoot;
    this._runId = options.runId;
    this._workspaceLabel = `aikami-contract-${options.contractId}`;
    this._headless = options.headless ?? process.env.CONTRACT_PIPELINE_HEADLESS === '1';
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

        this._provisionGitWorktree();

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
      await runPaneCommand({
        paneId: this._pipelinePaneId,
        command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
      });

      this._provisionGitWorktree();

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
    await runPaneCommand({
      paneId: this._pipelinePaneId,
      command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
    });

    this._provisionGitWorktree();

    return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
  }

  /** Return the current workspace ID. Must be called after initialize(). */
  getWorkspaceId(): string {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    return this._workspaceId;
  }

  /** Return the isolated git worktree path. Must be called after initialize(). */
  getWorkspacePath(): string {
    return this._workspacePath;
  }

  /**
   * Provision an isolated Git Worktree on top of the base branch.
   * The root working copy is never moved — all file mutations happen here.
   */
  private _provisionGitWorktree(): void {
    const wsName = this._runId; // already prefixed "run-" from createManifest
    try {
      const { workspacePath, branchName, headCommit } = provisionGitWorktree({
        repoRoot: this._repoRoot,
        name: wsName,
        baseRevision: PIPELINE_BASE_BRANCH,
      });
      this._workspacePath = workspacePath;
      console.log(
        `🔧 git worktree: ${workspacePath} (branch: ${branchName}, commit: ${headCommit})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  git worktree provisioning failed — using repo root: ${message}`);
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
  private async _getAgentStatus(paneId: string): Promise<string | undefined> {
    const panes = await herdrJson<PaneListResult>([
      'pane',
      'list',
      '--workspace',
      this._workspaceId,
    ]);
    return panes?.result.panes.find((p) => p.pane_id === paneId)?.agent_status;
  }

  private async _waitForAgentStatus(o: {
    paneId: string;
    statuses: readonly string[];
    timeoutMs: number;
  }): Promise<boolean> {
    const dl = Date.now() + o.timeoutMs;
    let delay = 500;
    while (Date.now() < dl) {
      const s = await this._getAgentStatus(o.paneId).catch(() => undefined);
      if (s !== undefined && o.statuses.includes(s)) {
        return true;
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 5_000);
    }
    return false;
  }

  private async _sendTaskText(options: { paneId: string; text: string }): Promise<void> {
    const ready = await this._waitForAgentStatus({
      paneId: options.paneId,
      statuses: ['idle', 'blocked'],
      timeoutMs: AGENT_READY_TIMEOUT_MS,
    });
    if (!ready) {
      console.warn(`⚠️  Pane ${options.paneId} never reported receptive`);
    }
    await runHerdr(['pane', 'send-keys', options.paneId, 'Escape']);
    await sleep(500);
    for (let a = 1; a <= MAX_SEND_ATTEMPTS; a++) {
      await runHerdr(['pane', 'run', options.paneId, options.text]);
      const ok = await this._waitForAgentStatus({
        paneId: options.paneId,
        statuses: ['working', 'done'],
        timeoutMs: SEND_ACCEPT_TIMEOUT_MS,
      });
      if (ok) {
        return;
      }
      await runHerdr(['pane', 'send-keys', options.paneId, 'Escape']);
      await sleep(1_000 * a);
      const late = await this._getAgentStatus(options.paneId).catch(() => undefined);
      if (late === 'working' || late === 'done') {
        return;
      }
    }
    console.warn(`⚠️  Prompt to ${options.paneId} unacked after ${MAX_SEND_ATTEMPTS} attempts`);
  }

  /** Write the static worker prompt and build the pi start command. */
  private _buildWorkerCommand(
    request: WorkerLaunchRequest,
    sessionId: string | undefined,
    taskMessagePath: string,
  ): string {
    const pd = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(pd, { recursive: true });
    const pp = join(pd, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: pp, content: request.prompt });
    const wsEnv = this._workspacePath
      ? `CONTRACT_PIPELINE_WORKSPACE_PATH=${shellQuote(this._workspacePath)}`
      : '';
    const env = [
      `CONTRACT_PIPELINE_RUN_ID=${shellQuote(request.runId)}`,
      `CONTRACT_PIPELINE_ROLE=${shellQuote(request.role)}`,
      `CONTRACT_PIPELINE_STAGE=${shellQuote(request.stage)}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${shellQuote(request.contractPath)}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${shellQuote(request.resultPath)}`,
      wsEnv,
    ]
      .filter(Boolean)
      .join(' ');
    const ta = toolsForRole(request.role) ? ['--tools', toolsForRole(request.role)?.join(',')] : [];
    const sa = sessionId !== undefined ? ['--session-id', shellQuote(sessionId)] : [];
    const ma = [
      '--model',
      shellQuote(getContractModelForRole(request.role)),
      '--thinking',
      getContractThinkingForRole(request.role),
    ];
    if (this._headless) {
      const cf = `$(cat ${shellQuote(taskMessagePath)})`;
      return [
        env,
        'pi',
        '--mode',
        'json',
        '--approve',
        ...ma,
        ...sa,
        '--append-system-prompt',
        shellQuote(pp),
        ...ta,
        '-p',
        `"${cf}"`,
      ].join(' ');
    }
    return [
      env,
      'pi',
      '--approve',
      ...ma,
      ...sa,
      '--append-system-prompt',
      shellQuote(pp),
      ...ta,
    ].join(' ');
  }

  /** Create a new worker tab and start pi. */
  private async _createWorkerTab(options: {
    tabLabel: string;
    sessionId: string | undefined;
    request: WorkerLaunchRequest;
  }): Promise<{ paneId: string }> {
    // Writer and critic work at repo root (only touch docs/contracts/).
    // Implementer and verifier use the isolated Git Worktree.
    const isolationRoles: ContractWorkerRole[] = ['implementer', 'verifier'];
    const cwd =
      isolationRoles.includes(options.request.role) && this._workspacePath
        ? this._workspacePath
        : this._repoRoot;

    // Copy contract into worktree so implementer/verifier can read it.
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
    mkdirSync(dirname(taskMessagePath), { recursive: true });
    atomicWrite({ path: taskMessagePath, content: parts.join('\n\n') });

    const startCommand = this._buildWorkerCommand(
      options.request,
      options.sessionId,
      taskMessagePath,
    );
    await runPaneCommand({ paneId, command: startCommand });

    if (!this._headless) {
      await this._sendTaskText({
        paneId,
        text:
          `${parts[0]} ` +
          `Read your full task brief at ${taskMessagePath} FIRST, then execute it. ` +
          'Your LAST action MUST call contract_stage_complete — a text summary without the tool call blocks the pipeline forever. ' +
          'Do not ask questions; if blocked, finish with status blocked.',
      });
    }

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
      this._workspacePath
        ? `CONTRACT_PIPELINE_WORKSPACE_PATH=${shellQuote(this._workspacePath)}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const command = [
      environment,
      'pi',
      '--approve',
      '--model',
      shellQuote(getContractModelForRole('review')),
      '--thinking',
      getContractThinkingForRole('review'),
      '--session-id',
      shellQuote(sessionId),
      '--append-system-prompt',
      shellQuote(promptPath),
    ].join(' ');

    const paneId = tab.result.root_pane.pane_id;
    await runPaneCommand({ paneId, command });
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
