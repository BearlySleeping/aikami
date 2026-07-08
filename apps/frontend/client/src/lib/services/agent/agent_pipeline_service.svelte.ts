// apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts
//
// Core agent pipeline orchestrator. Runs pre-agents, injects results
// into the system prompt, runs main generation, then runs post-agents
// sequentially with failure isolation and 500ms timeout enforcement.
//
// Contract: C-236 Agent Pipeline System

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AgentConfig,
  AgentPhase,
  AgentPipelineContext,
  AgentRunResult,
} from '$types/agent_types';
import { runExpressionAgent } from './agents/expression_agent.ts';
import { runNarrativeDirectorAgent } from './agents/narrative_director_agent.ts';
import { runProseGuardianAgent } from './agents/prose_guardian_agent.ts';
import { runQuestTrackerAgent } from './agents/quest_tracker_agent.ts';
import { runWorldStateAgent } from './agents/world_state_agent.ts';
import { BUILT_IN_AGENTS } from './built_in_agents.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentPipelineServiceOptions = BaseFrontendClassOptions;

export type AgentPipelineServiceInterface = BaseFrontendClassInterface & {
  /**
   * Runs the full agent pipeline around a main generation callback.
   *
   * Phase order: pre → main → post. Pre-agents run in parallel, results
   * injected into system prompt. Post-agents run sequentially with
   * failure isolation and 500ms timeout enforcement.
   *
   * @param options.chatId - Chat/conversation ID.
   * @param options.userMessage - Raw user message text.
   * @param options.systemPrompt - Assembled system prompt (from GM prompt service).
   * @param options.mainGenerator - Callback that performs the main AI generation.
   * @param options.enabledAgents - Optional set of agent IDs to enable (default: all built-in).
   * @param options.npcId - Optional NPC ID.
   * @param options.onPhaseChange - Callback for phase transitions (HUD updates).
   * @param options.onAgentResult - Callback for individual agent results (HUD updates).
   * @returns The main generation result and all agent run results.
   */
  runPipeline(options: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    enabledAgents?: string[];
    npcId?: string;
    onPhaseChange?: (phase: AgentPhase) => void;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<{
    aiResponse: string;
    preResults: AgentRunResult[];
    postResults: AgentRunResult[];
  }>;

  /**
   * Injects pre-agent results into the system prompt as tagged sections.
   *
   * @param systemPrompt - Base system prompt.
   * @param preResults - Results from pre-agents.
   * @returns Enriched system prompt.
   */
  enrichSystemPrompt(options: { systemPrompt: string; preResults: AgentRunResult[] }): string;
};

// ── Agent runner registry ────────────────────────────────────────────────

/**
 * Maps agent IDs to their async runner functions.
 * Each runner receives config, context, and optionally the AI response.
 */
const AGENT_RUNNERS: Record<
  string,
  (options: {
    config: AgentConfig;
    context: AgentPipelineContext;
    aiResponse?: string;
  }) => Promise<AgentRunResult>
> = {
  'narrative-director': runNarrativeDirectorAgent,
  'world-state': (opts) =>
    runWorldStateAgent({
      config: opts.config,
      _context: opts.context,
      aiResponse: opts.aiResponse ?? '',
    }),
  'quest-tracker': (opts) =>
    runQuestTrackerAgent({
      config: opts.config,
      _context: opts.context,
      aiResponse: opts.aiResponse ?? '',
    }),
  expression: (opts) =>
    runExpressionAgent({
      config: opts.config,
      _context: opts.context,
      aiResponse: opts.aiResponse ?? '',
    }),
  'prose-guardian': (opts) =>
    runProseGuardianAgent({
      config: opts.config,
      _context: opts.context,
      aiResponse: opts.aiResponse ?? '',
    }),
};

// ── Implementation ───────────────────────────────────────────────────────

class AgentPipelineService
  extends BaseFrontendClass<AgentPipelineServiceOptions>
  implements AgentPipelineServiceInterface
{
  /**
   * Resolves active agents from the built-in registry, filtering by
   * enabledAgents when provided.
   */
  private _resolveAgents(enabledAgents?: string[]): AgentConfig[] {
    const agents = BUILT_IN_AGENTS.filter((a) => a.enabled);

    if (enabledAgents && enabledAgents.length > 0) {
      return agents.filter((a) => enabledAgents.includes(a.id));
    }

    return [...agents];
  }

  /** @inheritdoc */
  async runPipeline({
    chatId,
    userMessage,
    systemPrompt,
    mainGenerator,
    enabledAgents,
    npcId,
    onPhaseChange,
    onAgentResult,
  }: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    enabledAgents?: string[];
    npcId?: string;
    onPhaseChange?: (phase: AgentPhase) => void;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<{
    aiResponse: string;
    preResults: AgentRunResult[];
    postResults: AgentRunResult[];
  }> {
    const allAgents = this._resolveAgents(enabledAgents);
    const preAgents = allAgents.filter((a) => a.phase === 'pre');
    const postAgents = allAgents.filter((a) => a.phase === 'post');

    // Build initial pipeline context
    const context: AgentPipelineContext = {
      chatId,
      npcId,
      userMessage,
      systemPrompt,
      preResults: [],
    };

    // ── Phase 1: Pre-agents (parallel) ─────────────────────────────
    onPhaseChange?.('pre');
    const preResults = await this._runAgents({
      agents: preAgents,
      context,
      onAgentResult,
    });

    // Update context with pre-agent results
    context.preResults = preResults;

    // Enrich system prompt with pre-agent output
    const enrichedPrompt = this.enrichSystemPrompt({
      systemPrompt,
      preResults,
    });

    // ── Phase 2: Main generation ───────────────────────────────────
    onPhaseChange?.('main');
    const aiResponse = await mainGenerator(enrichedPrompt);

    // ── Phase 3: Post-agents (sequential, failure-isolated) ────────
    onPhaseChange?.('post');
    const postResults = await this._runPostAgentsSequentially({
      agents: postAgents,
      context,
      aiResponse,
      onAgentResult,
    });

    return { aiResponse, preResults, postResults };
  }

  /** @inheritdoc */
  enrichSystemPrompt({
    systemPrompt,
    preResults,
  }: {
    systemPrompt: string;
    preResults: AgentRunResult[];
  }): string {
    if (preResults.length === 0) {
      return systemPrompt;
    }

    const sections: string[] = [systemPrompt];

    for (const result of preResults) {
      if (!result.success || !result.output) {
        continue;
      }

      const agent = BUILT_IN_AGENTS.find((a) => a.id === result.agentId);
      const key = agent?.contextKey ?? result.agentId.toUpperCase().replace(/-/g, '_');

      const output = result.output as Record<string, unknown>;

      if (key === 'NARRATIVE_DIRECTOR' && typeof output.description === 'string') {
        sections.push('');
        sections.push('[NARRATIVE DIRECTION]');
        sections.push(output.description);
        if (typeof output.playerGuidance === 'string' && output.playerGuidance.length > 0) {
          sections.push(`Guidance: ${output.playerGuidance}`);
        }
        sections.push('[/NARRATIVE DIRECTION]');
      }
    }

    return sections.join('\n');
  }

  // ── Private: Agent execution ─────────────────────────────────────

  /**
   * Runs a batch of pre-agents in parallel with timeout enforcement.
   * Each agent is individually wrapped in a 500ms timeout.
   */
  private async _runAgents({
    agents,
    context,
    onAgentResult,
  }: {
    agents: AgentConfig[];
    context: AgentPipelineContext;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<AgentRunResult[]> {
    const promises = agents.map((agent) =>
      this._runAgentWithTimeout({ agent, context, onAgentResult }),
    );

    return Promise.all(promises);
  }

  /**
   * Runs post-agents sequentially, isolating failures so one agent's
   * crash doesn't prevent the rest from executing.
   */
  private async _runPostAgentsSequentially({
    agents,
    context,
    aiResponse,
    onAgentResult,
  }: {
    agents: AgentConfig[];
    context: AgentPipelineContext;
    aiResponse: string;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<AgentRunResult[]> {
    const results: AgentRunResult[] = [];

    for (const agent of agents) {
      const result = await this._runAgentWithTimeout({
        agent,
        context,
        aiResponse,
        onAgentResult,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Runs a single agent with a 500ms timeout. If the agent exceeds the
   * timeout, returns a failure result without crashing the pipeline.
   */
  private async _runAgentWithTimeout({
    agent,
    context,
    aiResponse,
    onAgentResult,
  }: {
    agent: AgentConfig;
    context: AgentPipelineContext;
    aiResponse?: string;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<AgentRunResult> {
    const runner = AGENT_RUNNERS[agent.id];
    if (!runner) {
      const result: AgentRunResult = {
        agentId: agent.id,
        phase: agent.phase,
        success: false,
        error: `No runner registered for agent "${agent.id}"`,
        durationMs: 0,
      };
      onAgentResult?.(result);
      return result;
    }

    const timeoutMs = Math.min(agent.timeout, 500);

    // Race the agent run against a timeout promise
    const timeoutPromise = new Promise<AgentRunResult>((resolve) => {
      setTimeout(() => {
        resolve({
          agentId: agent.id,
          phase: agent.phase,
          success: false,
          error: `Timeout after ${timeoutMs}ms`,
          durationMs: timeoutMs,
        });
      }, timeoutMs);
    });

    const runPromise = runner({ config: agent, context, aiResponse });

    const result = await Promise.race([runPromise, timeoutPromise]);
    onAgentResult?.(result);
    return result;
  }
}

export { AgentPipelineService };

/**
 * Shared singleton instance of the agent pipeline service.
 */
export const agentPipelineService: AgentPipelineServiceInterface = AgentPipelineService.create({
  className: 'AgentPipelineService',
}) as AgentPipelineServiceInterface;
