// apps/frontend/client/src/lib/views/agent/agent_pipeline_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the Agent Pipeline system. Demonstrates
// pipeline execution with mock agents and HUD integration.
//
// Contract: C-236 Agent Pipeline System

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { BUILT_IN_AGENTS } from '$services';
import type { AgentConfig, AgentRunResult, ThoughtBubble } from '$types';
import type { AgentHudViewModelInterface } from './agent_hud_view_model.svelte.ts';
import { getAgentHudViewModel } from './agent_hud_view_model.svelte.ts';
import type { AgentPipelineViewModelInterface } from './agent_pipeline_view_model.svelte.ts';
import { getAgentPipelineViewModel } from './agent_pipeline_view_model.svelte.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentPipelineSandboxViewModelOptions = BaseViewModelOptions;

export type AgentPipelineSandboxViewModelInterface = BaseViewModelInterface & {
  /** The pipeline ViewModel (for agent management). */
  readonly pipelineViewModel: AgentPipelineViewModelInterface;
  /** The HUD ViewModel (for drawer display). */
  readonly hudViewModel: AgentHudViewModelInterface;
  /** All available agents. */
  readonly availableAgents: ReadonlyArray<AgentConfig>;
  /** Whether the pipeline is currently running. */
  readonly isRunning: boolean;
  /** Agent results from the last run. */
  readonly results: ReadonlyArray<AgentRunResult>;
  /** Thought bubbles from the last run. */
  readonly thoughtBubbles: ReadonlyArray<ThoughtBubble>;
  /** Whether the HUD drawer is open. */
  readonly showDrawer: boolean;
  /** Test message for triggering pipeline. */
  testMessage: string;

  /** Toggles an agent on/off. */
  toggleAgent(agentId: string): void;
  /** Whether the given agent is currently enabled. */
  isAgentEnabled(agentId: string): boolean;
  /** Toggles the HUD drawer. */
  toggleDrawer(): void;
  /** Runs the pipeline with a mock main generator. */
  runTestPipeline(): Promise<void>;
};

// ── Implementation ───────────────────────────────────────────────────────

export class AgentPipelineSandboxViewModel
  extends BaseViewModel<AgentPipelineSandboxViewModelOptions>
  implements AgentPipelineSandboxViewModelInterface
{
  pipelineViewModel: AgentPipelineViewModelInterface;
  hudViewModel: AgentHudViewModelInterface;
  testMessage = $state('This is a test message to trigger the agent pipeline.');

  constructor(options: AgentPipelineSandboxViewModelOptions) {
    super(options);

    this.pipelineViewModel = getAgentPipelineViewModel({
      className: 'AgentPipelineViewModel:sandbox',
    });

    this.hudViewModel = getAgentHudViewModel({
      className: 'AgentHudViewModel:sandbox',
    });
  }

  // ── Getters ──────────────────────────────────────────────────────

  get availableAgents(): ReadonlyArray<AgentConfig> {
    return BUILT_IN_AGENTS;
  }

  get isRunning(): boolean {
    return this.pipelineViewModel.isRunning;
  }

  get results(): ReadonlyArray<AgentRunResult> {
    return this.pipelineViewModel.results;
  }

  get thoughtBubbles(): ReadonlyArray<ThoughtBubble> {
    return this.pipelineViewModel.thoughtBubbles;
  }

  get showDrawer(): boolean {
    return this.pipelineViewModel.showDrawer;
  }

  // ── Public methods ───────────────────────────────────────────────

  /** @inheritdoc */
  toggleAgent(agentId: string): void {
    this.pipelineViewModel.toggleAgent(agentId);
  }

  /** @inheritdoc */
  isAgentEnabled(agentId: string): boolean {
    return this.pipelineViewModel.isAgentEnabled(agentId);
  }

  /** @inheritdoc */
  toggleDrawer(): void {
    this.pipelineViewModel.toggleDrawer();
    this.hudViewModel.showDrawer = this.pipelineViewModel.showDrawer;
  }

  /** @inheritdoc */
  async runTestPipeline(): Promise<void> {
    // Sync HUD state from pipeline
    this.hudViewModel.updateState({
      isRunning: true,
      phase: 'pre',
      agentName: null,
      results: [],
    });

    try {
      await this.pipelineViewModel.runPipeline({
        chatId: 'sandbox-chat',
        userMessage: this.testMessage,
        systemPrompt: 'You are an AI Game Master for a fantasy RPG. Describe the world vividly.',
        mainGenerator: async (enrichedPrompt: string) => {
          // Update HUD for main phase
          this.hudViewModel.updateState({
            isRunning: true,
            phase: 'main',
            agentName: null,
            results: [...this.pipelineViewModel.results],
          });

          // Mock main generation
          await new Promise((resolve) => setTimeout(resolve, 200));

          return `[Narrative scene begins]\n\nYou stand before the ancient ruins of a forgotten temple. Moss-covered stones rise from the mist-shrouded ground, and the faint sound of chanting echoes from within. What do you do?\n\n[System prompt enriched: ${enrichedPrompt.includes('[NARRATIVE DIRECTION]')}]`;
        },
      });

      // Sync final state
      this.hudViewModel.updateState({
        isRunning: false,
        phase: null,
        agentName: null,
        results: [...this.pipelineViewModel.results],
      });
    } catch {
      this.hudViewModel.updateState({
        isRunning: false,
        phase: null,
        agentName: null,
        results: [...this.pipelineViewModel.results],
      });
    }
  }
}

export const getAgentPipelineSandboxViewModel = (
  options: AgentPipelineSandboxViewModelOptions,
): AgentPipelineSandboxViewModelInterface => AgentPipelineSandboxViewModel.create(options);
