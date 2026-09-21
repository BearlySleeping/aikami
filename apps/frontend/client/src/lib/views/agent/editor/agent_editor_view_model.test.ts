// apps/frontend/client/src/lib/views/agent/editor/agent_editor_view_model.test.ts
//
// Tests for AC-8: An agent can only be pointed at a compatible connection.
// Contract: C-463
//
// The ViewModel receives its registry, config catalog and runner as typed
// capabilities, so this suite constructs it with plain fixtures instead of
// mocking the global `$services` registry.

import { describe, expect, mock, test } from 'bun:test';
import type { Connection } from '$types';
import {
  type AgentEditorConfigCapabilities,
  type AgentEditorRegistryCapabilities,
  type AgentEditorRunCapabilities,
  type AgentEditorViewModelInterface,
  createAgentEditorViewModel,
} from './agent_editor_view_model.svelte';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeConnection = (
  overrides: Partial<Connection> & Pick<Connection, 'id' | 'name' | 'capability'>,
): Connection => ({
  provider: 'test',
  apiKey: '',
  baseUrl: '',
  model: 'test-model',
  generationParams: {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repetitionPenalty: 1.1,
    presencePenalty: 0,
    maxTokens: 1024,
    contextSize: 4096,
  },
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const createViewModel = (
  connections: readonly Connection[] = [],
): AgentEditorViewModelInterface => {
  const registry: AgentEditorRegistryCapabilities = {
    createAgent: mock(),
    updateAgent: mock(),
    importAgent: mock(),
    exportAgent: mock(),
  };
  const config: AgentEditorConfigCapabilities = { state: { connections } };
  const runner: AgentEditorRunCapabilities = { run: mock() };
  return createAgentEditorViewModel({
    className: 'AgentEditorViewModelTest',
    registry,
    config,
    runner,
  });
};

// ---------------------------------------------------------------------------

describe('C-463 AC-8: Agent connection picker filters by capability', () => {
  test('connectionOptions contains only text connections', () => {
    // Setup: text, image, and voice connections
    const text = makeConnection({
      id: 'text-1',
      name: 'OpenRouter Text',
      capability: 'text',
    });
    const image = makeConnection({
      id: 'image-1',
      name: 'ComfyUI Image',
      capability: 'image',
    });
    const voice = makeConnection({
      id: 'voice-1',
      name: 'Kokoro Voice',
      capability: 'voice',
    });

    const vm = createViewModel([text, image, voice]);
    const options = vm.connectionOptions;

    // Should include the "Use chat default" option
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options[0]).toEqual({ value: '', label: 'Use chat default' });

    // Text connection should be present
    const textOption = options.find((o) => o.value === text.id);
    expect(textOption).toBeDefined();
    expect(textOption?.label).toBe('OpenRouter Text');

    // No image or voice connections should appear
    expect(options.find((o) => o.label === 'ComfyUI Image')).toBeUndefined();
    expect(options.find((o) => o.label === 'Kokoro Voice')).toBeUndefined();
  });

  test('connectionOptions with only text connections shows all of them', () => {
    const textA = makeConnection({ id: 'text-a', name: 'Text A', capability: 'text' });
    const textB = makeConnection({ id: 'text-b', name: 'Text B', capability: 'text' });

    const vm = createViewModel([textA, textB]);
    const options = vm.connectionOptions;

    expect(options.find((o) => o.value === textA.id)).toBeDefined();
    expect(options.find((o) => o.value === textB.id)).toBeDefined();
  });

  test('connectionOptions with no connections only has default option', () => {
    const vm = createViewModel();
    const options = vm.connectionOptions;

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({ value: '', label: 'Use chat default' });
  });
});
