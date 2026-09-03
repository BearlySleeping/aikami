// apps/frontend/client/src/lib/views/agent/editor/agent_editor_view_model.test.ts
//
// Tests for AC-8: An agent can only be pointed at a compatible connection.
// Contract: C-463

import { describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock dependencies (same pattern as config_service.test.ts)
// ---------------------------------------------------------------------------

const vaultStore = new Map<string, string>();

mock.module('$lib/views/utils/crypto_vault', () => ({
  encrypt: mock(async (options: { text: string }): Promise<void> => {
    vaultStore.set('__vault', options.text);
  }),
  decrypt: mock(async (): Promise<string | undefined> => vaultStore.get('__vault')),
  clearVault: mock(async (): Promise<void> => vaultStore.delete('__vault')),
  __esModule: true,
}));

import { configService } from '../../../services/config/config_service.svelte.ts';
import { getAgentEditorViewModel } from './agent_editor_view_model.svelte.ts';

describe('C-463 AC-8: Agent connection picker filters by capability', () => {
  test('connectionOptions contains only text connections', () => {
    // Setup: add text, image, and voice connections
    const textId = configService.addConnection({
      name: 'OpenRouter Text',
      provider: 'openrouter',
      capability: 'text',
      apiKey: 'sk-key',
      baseUrl: '',
      model: 'claude-sonnet',
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
      source: 'stored',
    });

    configService.addConnection({
      name: 'ComfyUI Image',
      provider: 'comfyui',
      capability: 'image',
      apiKey: '',
      baseUrl: 'http://localhost:8188',
      model: 'sd_xl',
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
      source: 'stored',
    });

    configService.addConnection({
      name: 'Kokoro Voice',
      provider: 'kokoro',
      capability: 'voice',
      apiKey: '',
      baseUrl: '',
      model: 'kokoro',
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
      source: 'stored',
    });

    const vm = getAgentEditorViewModel({ className: 'AgentEditorViewModelTest' });
    const options = vm.connectionOptions;

    // Should include the "Use chat default" option
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options[0]).toEqual({ value: '', label: 'Use chat default' });

    // Text connection should be present
    const textOption = options.find((o) => o.value === textId);
    expect(textOption).toBeDefined();
    expect(textOption?.label).toBe('OpenRouter Text');

    // No image or voice connections should appear
    const imageOption = options.find((o) => o.label === 'ComfyUI Image');
    expect(imageOption).toBeUndefined();
    const voiceOption = options.find((o) => o.label === 'Kokoro Voice');
    expect(voiceOption).toBeUndefined();
  });

  test('connectionOptions with only text connections shows all of them', () => {
    const textA = configService.addConnection({
      name: 'Text A',
      provider: 'openrouter',
      capability: 'text',
      apiKey: 'key-a',
      baseUrl: '',
      model: 'model-a',
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
      source: 'stored',
    });

    const textB = configService.addConnection({
      name: 'Text B',
      provider: 'openai',
      capability: 'text',
      apiKey: 'key-b',
      baseUrl: '',
      model: 'model-b',
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
      source: 'stored',
    });

    const vm = getAgentEditorViewModel({ className: 'AgentEditorViewModelTest' });
    const options = vm.connectionOptions;

    expect(options.find((o) => o.value === textA)).toBeDefined();
    expect(options.find((o) => o.value === textB)).toBeDefined();
  });

  test('connectionOptions with no connections only has default option', () => {
    const vm = getAgentEditorViewModel({ className: 'AgentEditorViewModelTest' });
    const options = vm.connectionOptions;

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({ value: '', label: 'Use chat default' });
  });
});
