// apps/frontend/client/src/lib/views/agent/agent_pipeline_view_model.test.ts
//
// Unit tests for the agent pipeline ViewModel built from explicit capabilities.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, mock, test } from 'bun:test';
import type { AgentConfig } from '$types';
import {
  type AgentPipelineRunCapabilities,
  createAgentPipelineViewModel,
} from './agent_pipeline_view_model.svelte';

const AGENTS: AgentConfig[] = [
  {
    id: 'narrative-director',
    name: 'Narrative Director',
    phase: 'pre',
    systemPrompt: 'p',
    timeout: 500,
    enabled: true,
  },
  {
    id: 'world-state',
    name: 'World State',
    phase: 'post',
    systemPrompt: 'p',
    timeout: 500,
    enabled: false,
  },
];

const createRunner = (
  overrides: Partial<AgentPipelineRunCapabilities> = {},
): AgentPipelineRunCapabilities => ({
  runPipeline: async ({ mainGenerator }) => {
    const aiResponse = await mainGenerator('enriched');
    return { aiResponse, preResults: [], postResults: [] };
  },
  ...overrides,
});

const createViewModel = (overrides: Partial<AgentPipelineRunCapabilities> = {}) =>
  createAgentPipelineViewModel({
    className: 'AgentPipelineViewModelTest',
    runner: createRunner(overrides),
    availableAgents: AGENTS,
  });

describe('AgentPipelineViewModel', () => {
  test('seeds enabled agents from the injected catalog', () => {
    const viewModel = createViewModel();

    expect(viewModel.availableAgents).toEqual(AGENTS);
    expect(viewModel.isAgentEnabled('narrative-director')).toBe(true);
    expect(viewModel.isAgentEnabled('world-state')).toBe(false);
  });

  test('toggleAgent adds and removes agent ids', () => {
    const viewModel = createViewModel();

    viewModel.toggleAgent('world-state');
    expect(viewModel.isAgentEnabled('world-state')).toBe(true);

    viewModel.toggleAgent('world-state');
    expect(viewModel.isAgentEnabled('world-state')).toBe(false);
  });

  test('toggleDrawer flips the drawer flag', () => {
    const viewModel = createViewModel();

    expect(viewModel.showDrawer).toBe(false);
    viewModel.toggleDrawer();
    expect(viewModel.showDrawer).toBe(true);
  });

  test('runPipeline delegates to the runner and mirrors enabled agents', async () => {
    const baseRunner = createRunner().runPipeline;
    let receivedEnabledAgents: string[] | undefined;
    const runPipeline = mock(async (options: Parameters<typeof baseRunner>[0]) => {
      receivedEnabledAgents = options.enabledAgents;
      return baseRunner(options);
    });
    const viewModel = createViewModel({ runPipeline });

    const response = await viewModel.runPipeline({
      chatId: 'chat',
      userMessage: 'hello',
      systemPrompt: 'sys',
      mainGenerator: async (prompt) => `main:${prompt}`,
    });

    expect(response).toBe('main:enriched');
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(receivedEnabledAgents).toEqual(['narrative-director']);
    expect(viewModel.isRunning).toBe(false);
  });

  test('clearResults resets the run state', () => {
    const viewModel = createViewModel();
    viewModel.clearResults();

    expect(viewModel.results).toEqual([]);
    expect(viewModel.thoughtBubbles).toEqual([]);
    expect(viewModel.currentPhase).toBeNull();
  });
});
