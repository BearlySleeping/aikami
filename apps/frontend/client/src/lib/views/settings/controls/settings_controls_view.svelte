<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/controls/settings_controls_view.svelte
  //
  // Settings > Game > Controls sub-tab. Keybinding configuration persisted
  // to localStorage. Click an action to rebind it.
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { SettingsControlsViewModelInterface } from './settings_controls_view_model.svelte';

  type Props = {
    viewModel: SettingsControlsViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- Keybindings card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Control Settings</h2>
        <p class="text-base-content/60">
          {#if viewModel.listeningActionId}
            <span class="text-warning">Press a key to bind…</span>
          {:else}
            Click an action to rebind it. Pressing <kbd class="kbd kbd-xs">Escape</kbd> or clicking
            elsewhere cancels.
          {/if}
        </p>
        <div class="divider"></div>

        <div class="space-y-2">
          {#each viewModel.actions as action}
            {@const isListening = viewModel.listeningActionId === action.id}
            <button
              class="w-full flex items-center justify-between py-3 px-4 rounded-lg border transition-colors {isListening
                ? 'border-warning bg-warning/10 text-warning'
                : 'border-base-300 bg-base-200 hover:border-primary/40 hover:bg-base-100'}"
              onclick={() => {
                if (isListening) {
                  viewModel.cancelListening();
                } else {
                  viewModel.startListening(action.id);
                }
              }}
            >
              <span class="font-medium">{action.label}</span>
              {#if isListening}
                <span class="loading loading-spinner loading-xs text-warning"></span>
              {:else}
                <kbd class="kbd kbd-sm">{viewModel.bindings[action.id] ?? '---'}</kbd>
              {/if}
            </button>
          {/each}
        </div>

        <!-- Reset -->
        <div class="mt-4 pt-4 border-t border-base-300">
          <button
            class="btn btn-ghost btn-sm text-base-content/50"
            onclick={() => viewModel.resetDefaults()}
          >
            ↺ Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
