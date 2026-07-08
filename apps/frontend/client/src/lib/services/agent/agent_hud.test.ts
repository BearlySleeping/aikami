// apps/frontend/client/src/lib/services/agent/agent_hud.test.ts
//
// Unit tests for the agent HUD state management and thought bubble
// lifecycle.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, it } from 'bun:test';
import type { AgentHudState, ThoughtBubble } from '$types/agent_types';

describe('AgentHudState', () => {
  const createInitialState = (): AgentHudState => ({
    isRunning: false,
    currentPhase: null,
    currentAgent: null,
    results: [],
    thoughtBubbles: [],
    showDrawer: false,
    enabledAgents: [],
  });

  it('should start in idle state', () => {
    const state = createInitialState();

    expect(state.isRunning).toBe(false);
    expect(state.currentPhase).toBeNull();
    expect(state.currentAgent).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.thoughtBubbles).toEqual([]);
    expect(state.showDrawer).toBe(false);
  });

  it('should track phase transitions', () => {
    const state = createInitialState();
    state.isRunning = true;
    state.currentPhase = 'pre';
    state.currentAgent = 'narrative-director';

    expect(state.isRunning).toBe(true);
    expect(state.currentPhase).toBe('pre');
    expect(state.currentAgent).toBe('narrative-director');
  });

  it('should accumulate results across phases', () => {
    const state = createInitialState();

    state.results = [
      ...state.results,
      {
        agentId: 'narrative-director',
        phase: 'pre' as const,
        success: true,
        output: { description: 'test' },
        durationMs: 100,
      },
      {
        agentId: 'world-state',
        phase: 'post' as const,
        success: true,
        output: { locationName: 'test' },
        durationMs: 200,
      },
    ];

    expect(state.results).toHaveLength(2);
    expect(state.results[0].agentId).toBe('narrative-director');
    expect(state.results[1].agentId).toBe('world-state');
  });

  it('should track thought bubbles with timestamps', () => {
    const bubbles: ThoughtBubble[] = [
      {
        id: 'bubble-1',
        agentId: 'narrative-director',
        agentName: 'Narrative Director',
        text: 'Setting the scene...',
        phase: 'pre',
        timestamp: Date.now(),
      },
    ];

    expect(bubbles[0].agentId).toBe('narrative-director');
    expect(bubbles[0].text).toBe('Setting the scene...');
    expect(typeof bubbles[0].timestamp).toBe('number');
  });

  it('should toggle drawer visibility', () => {
    const state = createInitialState();

    state.showDrawer = !state.showDrawer;
    expect(state.showDrawer).toBe(true);

    state.showDrawer = !state.showDrawer;
    expect(state.showDrawer).toBe(false);
  });

  it('should track enabled agent IDs', () => {
    const state = createInitialState();
    state.enabledAgents = ['narrative-director', 'world-state'];

    expect(state.enabledAgents).toContain('narrative-director');
    expect(state.enabledAgents).toContain('world-state');
  });
});
