// apps/frontend/client/src/lib/views/agent/agent_pipeline_view_model.svelte.ts
//
// ViewModel that wraps the agent pipeline service for use in the chat
// flow. Manages HUD state, per-chat agent toggles, retry logic, and
// integration with the main generation flow.
//
// Contract: C-236 Agent Pipeline System

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { agentPipelineService, BUILT_IN_AGENTS } from '$services';
import type {
  AgentConfig,
  AgentHudState,
  AgentPhase,
  AgentRunResult,
  ThoughtBubble,
} from '$types/agent_types';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentPipelineViewModelOptions = BaseViewModelOptions;

export type AgentPipelineViewModelInterface = BaseViewModelInterface & {
  /** Current HUD state (reactive). */
  readonly hudState: AgentHudState;
  /** Whether the pipeline is currently running. */
  readonly isRunning: boolean;
  /** Current phase being executed. */
  readonly currentPhase: AgentPhase | null;
  /** All results from the current pipeline run. */
  readonly results: ReadonlyArray<AgentRunResult>;
  /** Recent thought bubbles from current run. */
  readonly thoughtBubbles: ReadonlyArray<ThoughtBubble>;
  /** Whether the HUD drawer is open. */
  readonly showDrawer: boolean;

  /** Toggles the HUD drawer open/closed. */
  toggleDrawer(): void;

  /** Toggles a single agent on/off for the current chat. */
  toggleAgent(agentId: string): void;

  /** Whether the given agent is currently enabled. */
  isAgentEnabled(agentId: string): boolean;

  /** List of all built-in agent configs. */
  readonly availableAgents: ReadonlyArray<AgentConfig>;

  /** Clears results and thought bubbles from the previous run. */
  clearResults(): void;

  /** Runs the pipeline around a main generation callback. */
  runPipeline(options: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    npcId?: string;
  }): Promise<string>;
};

// ── Implementation ───────────────────────────────────────────────────────

export class AgentPipelineViewModel
  extends BaseViewModel<AgentPipelineViewModelOptions>
  implements AgentPipelineViewModelInterface
{
  private _hudState = $state<AgentHudState>({
    isRunning: false,
    currentPhase: null,
    currentAgent: null,
    results: [],
    thoughtBubbles: [],
    showDrawer: false,
    enabledAgents: BUILT_IN_AGENTS.map((a) => a.id),
  });

  // ── Getters ──────────────────────────────────────────────────────

  get hudState(): AgentHudState {
    return this._hudState;
  }

  get isRunning(): boolean {
    return this._hudState.isRunning;
  }

  get currentPhase(): AgentPhase | null {
    return this._hudState.currentPhase;
  }

  get results(): ReadonlyArray<AgentRunResult> {
    return this._hudState.results;
  }

  get thoughtBubbles(): ReadonlyArray<ThoughtBubble> {
    return this._hudState.thoughtBubbles;
  }

  get showDrawer(): boolean {
    return this._hudState.showDrawer;
  }

  get availableAgents(): ReadonlyArray<AgentConfig> {
    return BUILT_IN_AGENTS;
  }

  // ── Public methods ───────────────────────────────────────────────

  /** @inheritdoc */
  toggleDrawer(): void {
    this._hudState.showDrawer = !this._hudState.showDrawer;
  }

  /** @inheritdoc */
  toggleAgent(agentId: string): void {
    const enabled = this._hudState.enabledAgents;
    if (enabled.includes(agentId)) {
      this._hudState.enabledAgents = enabled.filter((id) => id !== agentId);
    } else {
      this._hudState.enabledAgents = [...enabled, agentId];
    }
  }

  /** @inheritdoc */
  isAgentEnabled(agentId: string): boolean {
    return this._hudState.enabledAgents.includes(agentId);
  }

  /** @inheritdoc */
  clearResults(): void {
    this._hudState.results = [];
    this._hudState.thoughtBubbles = [];
    this._hudState.currentPhase = null;
    this._hudState.currentAgent = null;
  }

  /** @inheritdoc */
  async runPipeline({
    chatId,
    userMessage,
    systemPrompt,
    mainGenerator,
    npcId,
  }: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    npcId?: string;
  }): Promise<string> {
    if (this._hudState.isRunning) {
      this.warn('runPipeline:already-running');
      return mainGenerator(systemPrompt);
    }

    this._hudState.isRunning = true;
    this._hudState.results = [];
    this._hudState.thoughtBubbles = [];

    try {
      const result = await agentPipelineService.runPipeline({
        chatId,
        userMessage,
        systemPrompt,
        mainGenerator,
        npcId,
        enabledAgents: this._hudState.enabledAgents,
        onPhaseChange: (phase) => {
          this._hudState.currentPhase = phase;
          this._hudState.currentAgent = null;
        },
        onAgentResult: (agentResult) => {
          this._hudState.results = [...this._hudState.results, agentResult];
          this._hudState.currentAgent = agentResult.agentId;
        },
      });

      return result.aiResponse;
    } finally {
      this._hudState.isRunning = false;
      this._hudState.currentPhase = null;
      this._hudState.currentAgent = null;
    }
  }
}

export const getAgentPipelineViewModel = (
  options: AgentPipelineViewModelOptions,
): AgentPipelineViewModelInterface => AgentPipelineViewModel.create(options);
