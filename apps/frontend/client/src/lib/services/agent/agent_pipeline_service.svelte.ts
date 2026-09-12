// apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts
//
// Core agent pipeline orchestrator. Runs pre-agents, injects results
// into the system prompt, runs main generation, then runs post-agents
// sequentially with failure isolation and 500ms timeout enforcement.
//
// Contract: C-236 Agent Pipeline System

import { AGENT_TEXT_TASKS, DEFAULT_AGENT_TIMEOUT_MS, type TextTask } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type {
  AgentConfig,
  AgentPhase,
  AgentPipelineContext,
  AgentRunResult,
  CustomAgentDefinition,
} from '$types';
import { agentRegistryService } from './agent_registry_service.svelte.ts';
import { runBattleTriggerAgent } from './agents/battle_trigger_agent.ts';
import { runCyoaAgent } from './agents/cyoa_agent.ts';
import { runExpressionAgent } from './agents/expression_agent.ts';
import { runMusicDjAgent } from './agents/music_dj_agent.ts';
import { runNarrativeDirectorAgent } from './agents/narrative_director_agent.ts';
import { runProseGuardianAgent } from './agents/prose_guardian_agent.ts';
import { runQuestTrackerAgent } from './agents/quest_tracker_agent.ts';
import { runRelationshipAgent } from './agents/relationship_agent.ts';
import { runSchedulePlannerAgent } from './agents/schedule_planner_agent.ts';
import { runWorldStateAgent } from './agents/world_state_agent.ts';
import { BUILT_IN_AGENTS } from './built_in_agents.ts';
import { customAgentToConfig, runCustomAgent } from './custom_agent_factory.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentPipelineServiceOptions = BaseFrontendClassOptions;

export type AgentPipelineServiceInterface = BaseFrontendClassInterface & {
  /**
   * Runs the full agent pipeline around a main generation callback.
   *
   * Phase order: pre → main → post. Pre-agents run in parallel and their
   * results are injected into the system prompt. Post-agents run in parallel
   * with per-agent abortable timeouts and failure isolation. When
   * `background` is set, post-agents are fire-and-forget and reported through
   * `onPostResults` so they never block the turn's critical path.
   *
   * @param options.chatId - Chat/conversation ID.
   * @param options.userMessage - Raw user message text.
   * @param options.systemPrompt - Assembled system prompt (from GM prompt service).
   * @param options.mainGenerator - Callback that performs the main AI generation.
   * @param options.enabledAgents - Optional set of agent IDs to enable (default: all built-in).
   * @param options.npcId - Optional NPC ID.
   * @param options.background - Run post-agents off the critical path.
   * @param options.signal - Aborts every in-flight agent request.
   * @param options.onPhaseChange - Callback for phase transitions (HUD updates).
   * @param options.onAgentResult - Callback for individual agent results (HUD updates).
   * @param options.onPostResults - Receives background post-agent results.
   * @returns The main generation result and all agent run results.
   */
  runPipeline(options: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    enabledAgents?: string[];
    npcId?: string;
    background?: boolean;
    signal?: AbortSignal;
    onPhaseChange?: (phase: AgentPhase) => void;
    onAgentResult?: (result: AgentRunResult) => void;
    onPostResults?: (results: AgentRunResult[]) => void;
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
 * Options passed to every agent runner. `signal` cancels the underlying LLM
 * request when the agent times out; `task` selects the gateway's role routing.
 */
type AgentRunnerOptions = {
  config: AgentConfig;
  context: AgentPipelineContext;
  aiResponse: string;
  signal?: AbortSignal;
  task?: TextTask;
};

const AGENT_RUNNERS: Record<string, (options: AgentRunnerOptions) => Promise<AgentRunResult>> = {
  'narrative-director': runNarrativeDirectorAgent,
  'world-state': runWorldStateAgent,
  'quest-tracker': runQuestTrackerAgent,
  expression: runExpressionAgent,
  cyoa: runCyoaAgent,
  'prose-guardian': runProseGuardianAgent,
  'music-dj': runMusicDjAgent,
  'schedule-planner': runSchedulePlannerAgent,
  'battle-trigger': runBattleTriggerAgent,
  relationship: runRelationshipAgent,
};
// ── Implementation ───────────────────────────────────────────────────────

class AgentPipelineService
  extends BaseFrontendClass<AgentPipelineServiceOptions>
  implements AgentPipelineServiceInterface
{
  /**
   * Resolves active agents from built-in and custom registries,
   * filtering by enabledAgents when provided.
   */
  private async _resolveAgents(enabledAgents?: string[]): Promise<AgentConfig[]> {
    const builtIn = BUILT_IN_AGENTS.filter(
      (a) => !enabledAgents || enabledAgents.length === 0 || enabledAgents.includes(a.id),
    );

    // Discover custom agents from the registry
    let custom: AgentConfig[] = [];
    try {
      const customDefs = await agentRegistryService.listAgents();
      custom = customDefs
        .filter((d: CustomAgentDefinition) => d.enabled)
        .filter(
          (d: CustomAgentDefinition) =>
            !enabledAgents || enabledAgents.length === 0 || enabledAgents.includes(d.id),
        )
        .map((d: CustomAgentDefinition) => customAgentToConfig(d));
    } catch {
      this.warn('_resolveAgents:failed-to-load-custom');
    }

    // Merge: built-in first, then custom agents
    return [...builtIn, ...custom];
  }

  /** @inheritdoc */
  async runPipeline({
    chatId,
    userMessage,
    systemPrompt,
    mainGenerator,
    enabledAgents,
    npcId,
    background,
    signal,
    onPhaseChange,
    onAgentResult,
    onPostResults,
  }: {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    mainGenerator: (enrichedPrompt: string) => Promise<string>;
    enabledAgents?: string[];
    npcId?: string;
    background?: boolean;
    signal?: AbortSignal;
    onPhaseChange?: (phase: AgentPhase) => void;
    onAgentResult?: (result: AgentRunResult) => void;
    onPostResults?: (results: AgentRunResult[]) => void;
  }): Promise<{
    aiResponse: string;
    preResults: AgentRunResult[];
    postResults: AgentRunResult[];
  }> {
    const allAgents = await this._resolveAgents(enabledAgents);
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
      signal,
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

    // ── Phase 3: Post-agents (parallel, failure-isolated) ──────────
    onPhaseChange?.('post');
    if (background) {
      // Off the critical path: fire-and-forget, report when they land.
      void this._runAgents({
        agents: postAgents,
        context,
        aiResponse,
        signal,
        onAgentResult,
      })
        .then((results) => onPostResults?.(results))
        .catch((error: unknown) => this.warn('post-agents:background-failed', error));
      return { aiResponse, preResults, postResults: [] };
    }

    const postResults = await this._runAgents({
      agents: postAgents,
      context,
      aiResponse,
      signal,
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
   * Runs a batch of agents in parallel. Each agent has its own abortable
   * timeout, so one slow agent never blocks the rest and its underlying LLM
   * request is cancelled rather than leaked.
   */
  private async _runAgents({
    agents,
    context,
    aiResponse,
    signal,
    onAgentResult,
  }: {
    agents: AgentConfig[];
    context: AgentPipelineContext;
    aiResponse?: string;
    signal?: AbortSignal;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<AgentRunResult[]> {
    return Promise.all(
      agents.map((agent) =>
        this._runAgentWithTimeout({ agent, context, aiResponse, signal, onAgentResult }),
      ),
    );
  }

  /**
   * Runs a single agent with an abortable timeout. On timeout (or external
   * cancellation) the underlying LLM request is aborted, and a failure result
   * is returned without crashing the pipeline.
   */
  private async _runAgentWithTimeout({
    agent,
    context,
    aiResponse,
    signal,
    onAgentResult,
  }: {
    agent: AgentConfig;
    context: AgentPipelineContext;
    aiResponse?: string;
    signal?: AbortSignal;
    onAgentResult?: (result: AgentRunResult) => void;
  }): Promise<AgentRunResult> {
    const task = agent.task ?? AGENT_TEXT_TASKS[agent.id];
    const timeoutMs = agent.timeout > 0 ? agent.timeout : DEFAULT_AGENT_TIMEOUT_MS;
    const start = performance.now();

    const controller = new AbortController();
    let timedOut = false;
    const linkExternal = (): void => {
      if (!signal) {
        return;
      }
      if (signal.aborted) {
        controller.abort(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    };
    linkExternal();

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const runner = AGENT_RUNNERS[agent.id];
      const result = runner
        ? await runner({
            config: agent,
            context,
            aiResponse: aiResponse ?? '',
            signal: controller.signal,
            task,
          })
        : await this._runCustomAgent({
            agent,
            context,
            aiResponse: aiResponse ?? '',
            signal: controller.signal,
            task,
          });
      onAgentResult?.(result);
      return result;
    } catch (error) {
      let message: string;
      if (timedOut) {
        message = `Timeout after ${timeoutMs}ms`;
      } else if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }
      const result: AgentRunResult = {
        agentId: agent.id,
        phase: agent.phase,
        success: false,
        error: message,
        durationMs: Math.round(performance.now() - start),
      };
      onAgentResult?.(result);
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Resolves and executes a custom agent definition, if one exists. */
  private async _runCustomAgent({
    agent,
    context,
    aiResponse,
    signal,
    task,
  }: {
    agent: AgentConfig;
    context: AgentPipelineContext;
    aiResponse: string;
    signal: AbortSignal;
    task?: TextTask;
  }): Promise<AgentRunResult> {
    try {
      const definition = await agentRegistryService.getAgent({ id: agent.id });
      if (definition) {
        return await runCustomAgent({
          config: agent,
          context,
          definition,
          aiResponse,
          signal,
          task,
        });
      }
    } catch {
      // Fall through to the error below
    }

    return {
      agentId: agent.id,
      phase: agent.phase,
      success: false,
      error: `No runner registered for agent "${agent.id}"`,
      durationMs: 0,
    };
  }
}

export { AgentPipelineService };

/**
 * Shared singleton instance of the agent pipeline service.
 */
export const agentPipelineService: AgentPipelineServiceInterface = AgentPipelineService.create({
  className: 'AgentPipelineService',
}) as AgentPipelineServiceInterface;
