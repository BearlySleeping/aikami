// apps/frontend/client/src/lib/services/agent/agent_llm.ts
//
// Thin agent-facing wrapper over TextGenerationService. Injects the agent's
// text task (derived from its id) so the gateway can route each agent to its
// own role connection and apply the task's token/temperature preset. Runners
// pass their abort signal through so a timed-out agent cancels its request.
//
// It also names the CALLER'S PARTITION, which the wrapper is the right place to
// do because it is the one layer that knows both halves: which agent is
// running, and that the agent's answer is going to be written into campaign
// state. Every built-in agent mutates the world — relationships, quests,
// schedules, items — so an extraction that coalesced with an identical call
// belonging to a DIFFERENT campaign would hand one player's world state to
// another. Coalescing is still free within a campaign; it just stops crossing
// the line that matters.
//
// Contract: C-236, C-507, issue #382

import { AGENT_TEXT_TASKS } from '@aikami/constants';
import type { AgentConfig } from '$types';
import { textGenerationService } from '../ai/text_generation_service.svelte.ts';
import { campaignService } from '../campaign/campaign_service.svelte.ts';

/** Runs a structured agent extraction with task routing + cancellation. */
export const extractAgentStructure = (options: {
  config: AgentConfig;
  schema: Record<string, unknown>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** A caller-supplied partition, when the runner knows one. */
  scope?: string;
  requestId?: string;
}): Promise<unknown> => {
  const { config, ...rest } = options;
  // Honor an explicit AgentConfig.task (e.g. custom agents) before the
  // built-in id lookup, so the resolved task always wins.
  return textGenerationService.extractStructure({
    ...rest,
    task: config.task ?? AGENT_TEXT_TASKS[config.id],
    // The active campaign, read live. A fallback is used rather than leaving
    // the scope off: "unscoped" is a real, shareable value, and an agent
    // running outside a campaign would then coalesce with every other
    // out-of-campaign agent — which is precisely the case where sharing is
    // least defensible.
    scope: options.scope ?? campaignService.activeCampaign?.id ?? 'no-campaign',
    // The agent's own id is a stable, content-free identity for the request.
    // It is what makes a turn's agent calls one traceable line rather than N
    // unrelated spans.
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
  });
};
