<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/ai-settings/+page.svelte
//
// Dev sandbox for AI settings fixture states.

import AiSettingsView from '$lib/views/settings/ai/ai_settings_view.svelte';
import { getAiSettingsDevViewModel } from '$lib/views/settings/ai/ai_settings_view_model.dev.svelte';

const viewModel = getAiSettingsDevViewModel({ className: 'AiSettingsDevViewModel' });
</script>

<div class="p-4 max-w-4xl mx-auto">
  <div class="mb-6">
    <h1 class="font-mono text-lg font-bold mb-2">🧪 Dev: AI Settings</h1>
    <p class="text-sm text-base-content/70 mb-4 font-sans">
      Seed different connection states to test the AI settings section.
    </p>
    <div class="flex flex-wrap gap-2">
      {#each viewModel.fixtureOptions as option (option.id)}
        <button
          type="button"
          class="btn btn-sm font-mono text-xs {option.buttonClass}"
          disabled={viewModel.isSeeding}
          onclick={() => viewModel.selectFixture(option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <AiSettingsView {viewModel} />
</div>
