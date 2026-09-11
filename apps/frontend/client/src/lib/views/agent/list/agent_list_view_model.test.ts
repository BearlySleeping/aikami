// apps/frontend/client/src/lib/views/agent/list/agent_list_view_model.test.ts
//
// Unit tests for the Agent List ViewModel.
//
// This suite exercises the ViewModel through plain feature fixtures — no
// global `$services` barrel mock and no dependency on the test_preload mock
// inventory. Each test constructs exactly the capabilities it needs.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { AgentConfig, CustomAgentDefinition } from '$types';
import {
  type AgentListCapabilities,
  createAgentListViewModel,
} from './agent_list_view_model.svelte';

const BUILT_IN_FIXTURE: readonly AgentConfig[] = [
  {
    id: 'narrative-director',
    name: 'Narrative Director',
    phase: 'pre',
    systemPrompt: 'Direct the narrative.',
    timeout: 15_000,
    enabled: true,
  },
];

const CUSTOM_AGENT_FIXTURE: CustomAgentDefinition = {
  formatVersion: '1.0.0',
  type: 'agent_definition',
  id: 'custom-1',
  name: 'Custom One',
  description: 'A custom agent',
  phase: 'post',
  promptTemplate: 'Do the thing',
  outputSchema: {},
  resultType: 'custom',
  timeout: 15_000,
  enabled: true,
  isBuiltIn: false,
  uid: 'test-uid',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const createCapabilities = (
  overrides: Partial<AgentListCapabilities> = {},
): AgentListCapabilities => ({
  listAgents: async () => [CUSTOM_AGENT_FIXTURE],
  deleteAgent: async () => {},
  duplicateAgent: async () => CUSTOM_AGENT_FIXTURE,
  exportAgent: async () => '{}',
  ...overrides,
});

const createViewModel = (options: Partial<AgentListCapabilities> = {}) =>
  createAgentListViewModel({
    className: 'AgentListViewModel',
    agents: createCapabilities(options),
    builtInAgents: BUILT_IN_FIXTURE,
    onCreateAgent: () => {},
    onEditAgent: () => {},
  });

describe('AgentListViewModel — refresh', () => {
  test('lists custom agents through the injected capability', async () => {
    const listAgents = mock(async () => [CUSTOM_AGENT_FIXTURE]);
    const viewModel = createViewModel({ listAgents });

    await viewModel.refresh();

    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(viewModel.customAgents).toEqual([CUSTOM_AGENT_FIXTURE]);
    expect(viewModel.isLoading).toBe(false);
    expect(viewModel.errorMessage).toBeUndefined();
  });

  test('records an error message when listing fails', async () => {
    const viewModel = createViewModel({
      listAgents: async () => {
        throw new Error('boom');
      },
    });

    await viewModel.refresh();

    expect(viewModel.errorMessage).toBe('boom');
    expect(viewModel.customAgents).toEqual([]);
    expect(viewModel.isLoading).toBe(false);
  });
});

describe('AgentListViewModel — custom-agent actions', () => {
  test('deleteAgent delegates the id and refreshes', async () => {
    const deleteAgent = mock(async () => {});
    const listAgents = mock(async () => []);
    const viewModel = createViewModel({ deleteAgent, listAgents });

    await viewModel.deleteAgent('custom-1');

    expect(deleteAgent).toHaveBeenCalledWith({ id: 'custom-1' });
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('duplicateAgent delegates the id and refreshes', async () => {
    const duplicateAgent = mock(async () => CUSTOM_AGENT_FIXTURE);
    const listAgents = mock(async () => []);
    const viewModel = createViewModel({ duplicateAgent, listAgents });

    await viewModel.duplicateAgent('custom-1');

    expect(duplicateAgent).toHaveBeenCalledWith({ id: 'custom-1' });
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  test('exportAgent delegates the id and downloads the payload', async () => {
    const exportAgent = mock(async () => '{"type":"agent_definition"}');
    const click = mock(() => {});
    const anchor = { href: '', download: '', click };
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    (globalThis as Record<string, unknown>).document = {
      createElement: mock(() => anchor),
    };
    URL.createObjectURL = mock(() => 'blob:mock');
    URL.revokeObjectURL = mock(() => {});

    try {
      const listAgents = mock(async () => [CUSTOM_AGENT_FIXTURE]);
      const viewModel = createViewModel({ exportAgent, listAgents });
      await viewModel.refresh();

      await viewModel.exportAgent('custom-1');

      expect(exportAgent).toHaveBeenCalledWith({ id: 'custom-1' });
      expect(anchor.download).toBe('custom_one.aikami.agent.json');
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as Record<string, unknown>).document = originalDocument;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe('AgentListViewModel — built-in agents', () => {
  test('exposes the injected built-in agent catalog', () => {
    const viewModel = createViewModel();

    expect(viewModel.builtInAgents).toEqual(BUILT_IN_FIXTURE);
  });
});

describe('AgentListViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);
  });
});
