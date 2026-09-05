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
  | { status: 'unknown'; paneText: string | null };

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

  /** Set the agent status reported by getAgentStatus. */
  setAgentState(state: FakeAgentState): void {
    this._agentState = state;
  }

  /** Set whether isWorkerActive returns true. */
  setWorkerActive(active: boolean): void {
    this._workerActive = active;
  }

  /** Set whether isPaneAlive returns true. */
  setPaneAlive(alive: boolean): void {
    this._paneAlive = alive;
  }

  /** Nudges sent via nudgeWorker. */
  get nudges(): ReadonlyArray<{ paneId: string; message: string }> {
    return this._nudges;
  }

  /** Messages sent via sendReviewMessage. */
  get reviewMessages(): ReadonlyArray<{ paneId: string; message: string }> {
    return this._reviewMessages;
  }

  /** Workers launched via launchWorker. */
  get launchedWorkers(): ReadonlyArray<WorkerLaunchRequest> {
    return this._launchedWorkers;
  }

  /** Pane IDs returned by launchWorker. */
  get workerPaneIds(): ReadonlyArray<string> {
    return this._workerPaneIds;
  }

  /** Whether startReview was called. */
  get reviewStarted(): boolean {
    return this._reviewStarted;
  }

  /** The prompt passed to startReview. */
  get reviewPrompt(): string {
    return this._reviewPrompt;
  }

  /** Whether startReview was called with blockedReview. */
  get reviewBlocked(): boolean {
    return this._reviewBlocked;
  }

  // ── ContractHerdrAdapterInterface implementation ─────────────

  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    return {
      workspaceId: this._workspaceId,
      pipelinePaneId: this._pipelinePaneId,
    };
  }

  getWorkspaceId(): string {
    return this._workspaceId;
  }

  getWorkspacePath(): string {
    return this._workspacePath;
  }

  getWorktreeBranch(): string {
    return this._worktreeBranch;
  }

  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    this._launchedWorkers.push(request);
    const paneId = `fake-worker-${this._workerPaneIds.length + 1}`;
    this._workerPaneIds.push(paneId);
    return { paneId };
  }

  async isWorkerActive(_paneId: string): Promise<boolean> {
    return this._workerActive;
  }

  async nudgeWorker(options: { paneId: string; message: string }): Promise<void> {
    this._nudges.push(options);
  }

  async isPaneAlive(_paneId: string): Promise<boolean> {
    return this._paneAlive;
  }

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

  async sendReviewMessage(options: { paneId: string; message: string }): Promise<boolean> {
    this._reviewMessages.push(options);
    return true;
  }

  async getAgentStatus(_paneId: string): Promise<string | undefined> {
    return this._agentState.status;
  }

  async readPaneText(_paneId: string): Promise<string | null> {
    return this._agentState.paneText;
  }
}
