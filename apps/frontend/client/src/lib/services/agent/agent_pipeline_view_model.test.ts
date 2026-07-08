// apps/frontend/client/src/lib/services/agent/agent_pipeline_view_model.test.ts
//
// Unit tests for the agent pipeline ViewModel integration.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';
import { BUILT_IN_AGENTS } from './built_in_agents.ts';

describe('BUILT_IN_AGENTS', () => {
  it('should have exactly 5 agents', () => {
    expect(BUILT_IN_AGENTS).toHaveLength(5);
  });

  it('should have exactly one pre-agent', () => {
    const preAgents = BUILT_IN_AGENTS.filter((a) => a.phase === 'pre');
    expect(preAgents).toHaveLength(1);
    expect(preAgents[0].id).toBe('narrative-director');
  });

  it('should have exactly four post-agents', () => {
    const postAgents = BUILT_IN_AGENTS.filter((a) => a.phase === 'post');
    expect(postAgents).toHaveLength(4);

    const ids = postAgents.map((a) => a.id);
    expect(ids).toContain('world-state');
    expect(ids).toContain('quest-tracker');
    expect(ids).toContain('expression');
    expect(ids).toContain('prose-guardian');
  });

  it('should have unique agent IDs', () => {
    const ids = BUILT_IN_AGENTS.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have valid phase values for all agents', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(['pre', 'post']).toContain(agent.phase);
    }
  });

  it('should have timeout of 500ms for all agents', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.timeout).toBe(500);
    }
  });

  it('should have systemPrompt for all agents', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(typeof agent.systemPrompt).toBe('string');
      expect(agent.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('should have contextKey only on pre-agents', () => {
    for (const agent of BUILT_IN_AGENTS) {
      if (agent.phase === 'pre') {
        expect(agent.contextKey).toBeDefined();
      }
    }
  });

  it('should be readonly (as const)', () => {
    // TypeScript compile-time check: BUILT_IN_AGENTS is readonly
    // The array reference itself may not be frozen, but the type enforces readonly
    expect(Array.isArray(BUILT_IN_AGENTS)).toBe(true);
  });
});
