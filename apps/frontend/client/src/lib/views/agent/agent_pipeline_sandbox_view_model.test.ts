// apps/frontend/client/src/lib/views/agent/agent_pipeline_sandbox_view_model.test.ts
//
// Unit tests for the agent pipeline sandbox ViewModel. The nested pipeline and
// HUD ViewModels are injected as capabilities.
//
// Contract: C-236 Agent Pipeline System

import { describe, expect, test } from 'bun:test';
import type { AgentConfig } from '$types';
import { AgentHudViewModel } from './agent_hud_view_model.svelte.ts';
import { createAgentPipelineSandboxViewModel } from './agent_pipeline_sandbox_view_model.svelte';
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
];

const runner: AgentPipelineRunCapabilities = {
  runPipeline: async ({ mainGenerator }) => ({
    aiResponse: await mainGenerator(''),
    preResults: [],
    postResults: [],
  }),
};

const createViewModel = () => {
  const pipeline = createAgentPipelineViewModel({
    className: 'pipeline',
    runner,
    availableAgents: AGENTS,
  });
  const hud = AgentHudViewModel.create({ className: 'hud' });
  return createAgentPipelineSandboxViewModel({
    className: 'SandboxTest',
    pipeline,
    hud,
    availableAgents: AGENTS,
  });
};

describe('AgentPipelineSandboxViewModel', () => {
  test('exposes the injected agent catalog', () => {
    const viewModel = createViewModel();
    expect(viewModel.availableAgents).toEqual(AGENTS);
  });

  test('toggleAgent delegates to the pipeline ViewModel', () => {
    const viewModel = createViewModel();

    viewModel.toggleAgent('narrative-director');
    expect(viewModel.isAgentEnabled('narrative-director')).toBe(false);
  });

  test('toggleDrawer mirrors the pipeline drawer onto the HUD', () => {
    const viewModel = createViewModel();

    viewModel.toggleDrawer();
    expect(viewModel.showDrawer).toBe(true);
    expect(viewModel.hudViewModel.showDrawer).toBe(true);
  });
});
