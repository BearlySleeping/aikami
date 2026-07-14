// apps/frontend/client/src/lib/services/agent/cyoa_toggle.test.ts
//
// Unit tests for the per-chat CYOA toggle — AC-5: when the CYOA agent
// is excluded from enabledAgents, the pipeline never runs it.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { describe, expect, it } from 'bun:test';
import { CYOA_AGENT_ID } from '@aikami/constants';
import { AgentPipelineService } from './agent_pipeline_service.svelte.ts';
import { BUILT_IN_AGENTS } from './built_in_agents.ts';

const createService = () =>
  AgentPipelineService.create({ className: 'AgentPipelineService' }) as AgentPipelineService;

describe('CYOA per-chat toggle (C-245 AC-5)', () => {
  it('should register cyoa as a built-in post-agent, enabled by default', () => {
    const cyoa = BUILT_IN_AGENTS.find((a) => a.id === CYOA_AGENT_ID);

    expect(cyoa).toBeDefined();
    expect(cyoa?.phase).toBe('post');
    expect(cyoa?.enabled).toBe(true);
  });

  it('should not run the cyoa agent when excluded from enabledAgents', async () => {
    const service = createService();
    const ranAgents: string[] = [];

    const result = await service.runPipeline({
      chatId: 'chat-1',
      userMessage: 'I approach the crossroads.',
      systemPrompt: 'You are a GM.',
      mainGenerator: async () => 'The crossroads split three ways.',
      // Every built-in EXCEPT cyoa
      enabledAgents: BUILT_IN_AGENTS.filter((a) => a.id !== CYOA_AGENT_ID).map((a) => a.id),
      onAgentResult: (r) => {
        ranAgents.push(r.agentId);
      },
    });

    expect(result.aiResponse).toBe('The crossroads split three ways.');
    expect(ranAgents).not.toContain(CYOA_AGENT_ID);
    expect(result.postResults.every((r) => r.agentId !== CYOA_AGENT_ID)).toBe(true);
  });

  it('should include the cyoa agent when present in enabledAgents', async () => {
    const service = createService();
    const ranAgents: string[] = [];

    await service.runPipeline({
      chatId: 'chat-1',
      userMessage: 'I approach the crossroads.',
      systemPrompt: 'You are a GM.',
      mainGenerator: async () => 'The crossroads split three ways.',
      enabledAgents: [CYOA_AGENT_ID],
      onAgentResult: (r) => {
        ranAgents.push(r.agentId);
      },
    });

    // The agent ran (result present) — success may be false in tests
    // (no live text generation backend) but the toggle gating is what
    // this test verifies.
    expect(ranAgents).toContain(CYOA_AGENT_ID);
  });
});
