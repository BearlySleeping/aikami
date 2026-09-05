// scripts/src/lib/agents/contract_pipeline/fake_adapter.ts
//
// Fake Herdr adapter for deterministic scenario tests.
// Implements ContractHerdrAdapterInterface with controllable state —
// no live Herdr, no filesystem, no real Git operations.

import type { ContractHerdrAdapterInterface } from './herdr_adapter.ts';
import type { WorkerLaunchRequest } from './types.ts';

/** Controllable agent status for test scenarios. */
export type FakeAgentState =
  | { status: 'idle'; paneText: string | null }
  | { status: 'working'; paneText: string | null }
  | { status: 'blocked'; paneText: string | null }
  | { status: 'done'; paneText: string | null }
  | { status: undefined; paneText: string | null };

/** Simulated review start outcome. */
export type FakeReviewOutcome = {
  paneId: string;
  startResult: { ok: boolean; paneId: string; taskDelivered: boolean };
};

/**
 * Fake Herdr adapter that implements the full ContractHerdrAdapterInterface
 * with test-controllable state. No live Herdr, no filesystem, no Git.
 *
 * Use with runContractPipeline's `adapterFactory` option to inject into the
 * orchestrator for deterministic scenario testing.
 */
export class FakeHerdrAdapter implements ContractHerdrAdapterInterface {
  private _workspaceId: string;
  private _pipelinePaneId: string;
  private _workspacePath: string;
  private _worktreeBranch: string;
  private _agentState: FakeAgentState;
  private _nudges: Array<{ paneId: string; message: string }> = [];
  private _reviewMessages: Array<{ paneId: string; message: string }> = [];
  private _launchedWorkers: WorkerLaunchRequest[] = [];
  private _workerPaneIds: string[] = [];
  private _workerActive: boolean;
  private _paneAlive: boolean;
  private _reviewStarted = false;
  private _reviewPrompt = '';
  private _reviewBlocked = false;
  /** Last review start result. */
  lastReviewStart: FakeReviewOutcome | null = null;

  constructor(options?: {
    workspaceId?: string;
    pipelinePaneId?: string;
    workspacePath?: string;
    worktreeBranch?: string;
    initialState?: FakeAgentState;
    workerActive?: boolean;
    paneAlive?: boolean;
  }) {
    this._workspaceId = options?.workspaceId ?? 'fake-ws';
    this._pipelinePaneId = options?.pipelinePaneId ?? 'fake-pipeline';
    this._workspacePath = options?.workspacePath ?? '/tmp/fake-worktree';
    this._worktreeBranch = options?.worktreeBranch ?? 'contract-task-fake';
    this._agentState = options?.initialState ?? { status: 'idle', paneText: '' };
    this._workerActive = options?.workerActive ?? true;
    this._paneAlive = options?.paneAlive ?? true;
  }

  // ── Controllable test state ──────────────────────────────────

  /** Set the status and pane text returned by subsequent agent queries. Returns no value. */
  setAgentState(state: FakeAgentState): void {
    this._agentState = state;
  }

  /** Set the worker activity result returned by isWorkerActive. Returns no value. */
  setWorkerActive(active: boolean): void {
    this._workerActive = active;
  }

  /** Set the pane liveness result returned by isPaneAlive. Returns no value. */
  setPaneAlive(alive: boolean): void {
    this._paneAlive = alive;
  }

  /** Return a read-only view of nudges recorded by nudgeWorker. */
  get nudges(): ReadonlyArray<{ paneId: string; message: string }> {
    return this._nudges;
  }

  /** Return a read-only view of messages recorded by sendReviewMessage. */
  get reviewMessages(): ReadonlyArray<{ paneId: string; message: string }> {
    return this._reviewMessages;
  }

  /** Return a read-only view of worker requests recorded by launchWorker. */
  get launchedWorkers(): ReadonlyArray<WorkerLaunchRequest> {
    return this._launchedWorkers;
  }

  /** Return a read-only view of pane IDs allocated by launchWorker. */
  get workerPaneIds(): ReadonlyArray<string> {
    return this._workerPaneIds;
  }

  /** Return whether startReview has been called. */
  get reviewStarted(): boolean {
    return this._reviewStarted;
  }

  /** Return the prompt from the latest startReview call, or an empty string before one. */
  get reviewPrompt(): string {
    return this._reviewPrompt;
  }

  /** Return whether the latest startReview call requested a blocked review. */
  get reviewBlocked(): boolean {
    return this._reviewBlocked;
  }

  // ── ContractHerdrAdapterInterface implementation ─────────────

  /** Return the configured workspace and pipeline pane identifiers without external setup. */
  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    return {
      workspaceId: this._workspaceId,
      pipelinePaneId: this._pipelinePaneId,
    };
  }

  /** Return the configured workspace identifier. */
  getWorkspaceId(): string {
    return this._workspaceId;
  }

  /** Return the configured workspace checkout path. */
  getWorkspacePath(): string {
    return this._workspacePath;
  }

  /** Return the configured worktree branch name. */
  getWorktreeBranch(): string {
    return this._worktreeBranch;
  }

  /** Record a worker request and return a newly allocated sequential fake pane ID. */
  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    this._launchedWorkers.push(request);
    const paneId = `fake-worker-${this._workerPaneIds.length + 1}`;
    this._workerPaneIds.push(paneId);
    return { paneId };
  }

  /** Return the configured worker activity state without inspecting the pane ID. */
  async isWorkerActive(_paneId: string): Promise<boolean> {
    return this._workerActive;
  }

  /** Record a worker nudge and resolve without a value. */
  async nudgeWorker(options: { paneId: string; message: string }): Promise<void> {
    this._nudges.push(options);
  }

  /** Return the configured pane liveness state without inspecting the pane ID. */
  async isPaneAlive(_paneId: string): Promise<boolean> {
    return this._paneAlive;
  }

  /** Record review startup details and return the fixed review pane and delivery result. */
  async startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
    yolo?: boolean;
    blockedReview?: boolean;
    useWorktreeCwd?: boolean;
  }): Promise<{ paneId: string; taskDelivered: boolean }> {
    this._reviewStarted = true;
    this._reviewPrompt = options.prompt;
    this._reviewBlocked = !!options.blockedReview;
    const paneId = 'fake-review-pane';
    const taskDelivered = true;
    this.lastReviewStart = {
      paneId,
      startResult: { ok: true, paneId, taskDelivered },
    };
    return { paneId, taskDelivered };
  }

  /** Record a review message and resolve true to indicate successful delivery. */
  async sendReviewMessage(options: { paneId: string; message: string }): Promise<boolean> {
    this._reviewMessages.push(options);
    return true;
  }

  /** Return the configured agent status unchanged, including undefined when unreported. */
  async getAgentStatus(_paneId: string): Promise<string | undefined> {
    return this._agentState.status;
  }

  /** Return the configured pane text, including null when no text is available. */
  async readPaneText(_paneId: string): Promise<string | null> {
    return this._agentState.paneText;
  }
}
