<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/ai-settings/+page.svelte
//
// Dev sandbox for AI settings — provides seeded fixtures for testing
// the status board, provider tree, roles drawer, and connection editor.
// C-465 AC-9.

import { onMount } from 'svelte';
import AiSettingsView from '$lib/views/settings/ai/ai_settings_view.svelte';
import { getAiSettingsViewModel } from '$lib/views/settings/ai/ai_settings_view_model.svelte';
import { configService } from '$services';

const viewModel = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });

function fixtureLabel(f: string): string {
  if (f === 'zero') {
    return '0 connections';
  }
  if (f === 'one') {
    return '1 connection';
  }
  if (f === 'several') {
    return 'Several providers';
  }
  if (f === 'three-models') {
    return '3 models';
  }
  return 'Bad key';
}

let fixture = $state<'zero' | 'one' | 'several' | 'three-models' | 'bad-key'>('zero');
let isSeeding = $state(false);

function seedConnections(fixtureType: string): void {
  isSeeding = true;
  try {
    // Clear existing data first
    const existingConnections = configService.getAiConnections();
    for (const c of existingConnections) {
      configService.deleteAiConnection(c.id);
    }
    const existingProviders = configService.getProviders();
    for (const p of existingProviders) {
      configService.deleteProvider(p.id);
    }

    if (fixtureType === 'one') {
      const pid = configService.addProvider({
        registryId: 'openrouter',
        label: 'OpenRouter',
        credential: 'sk-or-v1-test-key',
        source: 'stored',
      });
      configService.addAiConnection({
        providerId: pid,
        capability: 'text',
        label: 'Sonnet',
        model: 'anthropic/claude-sonnet',
        params: {
          temperature: 0.7,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      });
    } else if (fixtureType === 'several') {
      const orPid = configService.addProvider({
        registryId: 'openrouter',
        label: 'OpenRouter',
        credential: 'sk-or-v1-test-key',
        source: 'stored',
      });
      configService.addAiConnection({
        providerId: orPid,
        capability: 'text',
        label: 'Sonnet',
        model: 'anthropic/claude-sonnet',
        params: {
          temperature: 0.7,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      });
      configService.addAiConnection({
        providerId: orPid,
        capability: 'text',
        label: 'Haiku',
        model: 'anthropic/claude-haiku',
        params: {
          temperature: 0.5,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
      });
      // Kokoro voice
      const kokoroPid = configService.addProvider({
        registryId: 'kokoro',
        label: 'Kokoro',
        source: 'stored',
      });
      configService.addAiConnection({
        providerId: kokoroPid,
        capability: 'voice',
        label: 'Kokoro TTS',
        model: 'kokoro',
        params: { voiceId: 'af_bella', speed: 1.0, pitch: 0 },
      });
      // Set a role assignment
      configService.setRoleAssignment('narration', configService.getAiConnections()[0].id);
    } else if (fixtureType === 'three-models') {
      const pid = configService.addProvider({
        registryId: 'openrouter',
        label: 'OpenRouter',
        credential: 'sk-or-v1-test-key',
        source: 'stored',
      });
      configService.addAiConnection({
        providerId: pid,
        capability: 'text',
        label: 'Opus',
        model: 'anthropic/claude-opus',
        params: {
          temperature: 0.7,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      });
      configService.addAiConnection({
        providerId: pid,
        capability: 'text',
        label: 'Sonnet',
        model: 'anthropic/claude-sonnet',
        params: {
          temperature: 0.7,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      });
      configService.addAiConnection({
        providerId: pid,
        capability: 'text',
        label: 'Haiku',
        model: 'anthropic/claude-haiku',
        params: {
          temperature: 0.5,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
      });
    } else if (fixtureType === 'bad-key') {
      const pid = configService.addProvider({
        registryId: 'openrouter',
        label: 'OpenRouter',
        credential: 'sk-or-v1-invalid-key',
        source: 'stored',
      });
      configService.addAiConnection({
        providerId: pid,
        capability: 'text',
        label: 'Sonnet',
        model: 'anthropic/claude-sonnet',
        params: {
          temperature: 0.7,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      });
    }

    void configService.save();
    // Force ViewModel reload
    void viewModel.initialize();
  } finally {
    isSeeding = false;
  }
}

onMount(() => {
  void configService.load().then(() => {
    seedConnections('zero');
  });
});
</script>

<div class="p-4 max-w-4xl mx-auto">
  <div class="mb-6">
    <h1 class="font-mono text-lg font-bold mb-2">🧪 Dev: AI Settings</h1>
    <p class="text-sm text-[#938ea1] mb-4 font-sans">
      Seed different connection states to test the AI settings section.
    </p>
    <div class="flex flex-wrap gap-2">
      {#each ['zero', 'one', 'several', 'three-models', 'bad-key'] as f}
        <button
          type="button"
          class="btn btn-sm font-mono text-xs {fixture === f ? 'btn-primary' : 'btn-ghost'}"
          disabled={isSeeding}
          onclick={() => { fixture = f as typeof fixture; seedConnections(fixture); }}
        >
          {fixtureLabel(f)}
        </button>
      {/each}
    </div>
  </div>

  <AiSettingsView {viewModel} />
</div>
