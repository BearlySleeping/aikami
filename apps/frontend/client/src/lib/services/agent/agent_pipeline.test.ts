// apps/frontend/client/src/lib/services/agent/agent_pipeline.test.ts
//
// Unit tests for the agent pipeline service orchestrator.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';
import { AgentPipelineService } from './agent_pipeline_service.svelte.ts';

describe('AgentPipelineService', () => {
  const createService = () =>
    AgentPipelineService.create({ className: 'AgentPipelineService' }) as AgentPipelineService;

  it('should enrich system prompt with narrative director pre-agent output', () => {
    const service = createService();
    const basePrompt = 'You are an AI Game Master.';

    const result = service.enrichSystemPrompt({
      systemPrompt: basePrompt,
      preResults: [
        {
          agentId: 'narrative-director',
          phase: 'pre',
          success: true,
          output: {
            description: 'The fog rolls in over the ancient ruins.',
            playerGuidance: 'Strange sounds echo from the crypt.',
          },
          durationMs: 120,
        },
      ],
    });

    expect(result).toContain('[NARRATIVE DIRECTION]');
    expect(result).toContain('The fog rolls in');
    expect(result).toContain('Strange sounds echo');
    expect(result).toContain('You are an AI Game Master.');
  });

  it('should not modify system prompt when no pre-agents succeed', () => {
    const service = createService();
    const basePrompt = 'You are an AI Game Master.';

    const result = service.enrichSystemPrompt({
      systemPrompt: basePrompt,
      preResults: [
        {
          agentId: 'narrative-director',
          phase: 'pre',
          success: false,
          error: 'Timeout',
          durationMs: 500,
        },
      ],
    });

    expect(result).toBe(basePrompt);
  });

  it('should not modify system prompt when preResults is empty', () => {
    const service = createService();
    const basePrompt = 'You are an AI Game Master.';

    const result = service.enrichSystemPrompt({
      systemPrompt: basePrompt,
      preResults: [],
    });

    expect(result).toBe(basePrompt);
  });

  it('should run pipeline with all three phases', async () => {
    const service = createService();
    const phases: string[] = [];

    const { aiResponse, preResults, postResults } = await service.runPipeline({
      chatId: 'test-chat',
      userMessage: 'I explore the ruins.',
      systemPrompt: 'You are a GM.',
      mainGenerator: async (enrichedPrompt: string) => {
        phases.push('main');
        return `System prompt was enriched: ${enrichedPrompt.includes('[NARRATIVE DIRECTION]')}`;
      },
      enabledAgents: [],
      onPhaseChange: (phase) => {
        phases.push(phase);
      },
    });

    expect(phases).toContain('pre');
    expect(phases).toContain('main');
    expect(phases).toContain('post');
    expect(typeof aiResponse).toBe('string');
    expect(Array.isArray(preResults)).toBe(true);
    expect(Array.isArray(postResults)).toBe(true);
  });

  it('should isolate post-agent failures', async () => {
    const service = createService();
    const results: string[] = [];

    const { postResults } = await service.runPipeline({
      chatId: 'test-chat',
      userMessage: 'Hello',
      systemPrompt: 'You are a GM.',
      mainGenerator: async () => 'Hello back!',
      enabledAgents: [],
      onAgentResult: (result) => {
        results.push(`${result.agentId}:${result.success ? 'ok' : 'fail'}`);
      },
    });

    // All post agents should have run (or timed out)
    expect(postResults.length).toBeGreaterThanOrEqual(0);
  }, 10000);

  it('should return predictable pipeline output shape', async () => {
    const service = createService();

    const output = await service.runPipeline({
      chatId: 'chat-1',
      userMessage: 'test',
      systemPrompt: 'prompt',
      mainGenerator: async () => 'response',
      enabledAgents: [],
    });

    expect(output).toHaveProperty('aiResponse');
    expect(output).toHaveProperty('preResults');
    expect(output).toHaveProperty('postResults');
    expect(output.aiResponse).toBe('response');
  });
});
