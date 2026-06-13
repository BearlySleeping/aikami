<script lang="ts">
  // apps/frontend/client/src/lib/views/dashboard/dashboard_view.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { DashboardViewModelInterface } from './dashboard_view_model.svelte.ts';

  type Props = {
    viewModel: DashboardViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.errorMessage}
    <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
  {/if}
  <div class="flex flex-col items-center justify-center h-full text-center p-6">
    <h1 class="text-4xl font-bold mb-4">{t.dashboard_welcome()}</h1>
    <p class="mb-8">{t.dashboard_welcome_message()}</p>

    <!-- Save Slots Section -->
    <div class="w-full max-w-md mb-8">
      <h2 class="text-lg font-semibold mb-3 text-base-content/80">Saved Games</h2>

      {#if viewModel.isLoadingSlots}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      {:else if viewModel.saveSlots.length === 0}
        <p class="text-sm text-base-content/50">No saved games yet.</p>
      {:else}
        <div class="space-y-2">
          {#each viewModel.saveSlots as slot (slot.slotNumber)}
            <div
              class="flex items-center justify-between rounded-lg border border-base-300 bg-base-200 p-3"
            >
              <div class="text-left">
                <p class="text-sm font-medium">Slot {slot.slotNumber}</p>
                <p class="text-xs text-base-content/50">
                  {slot.lastLocationName || 'Unknown location'}
                  {#if slot.updatedAt}
                    — {new Date(slot.updatedAt).toLocaleDateString()}
                  {/if}
                </p>
              </div>
              <button class="btn btn-primary btn-sm" onclick={() => viewModel.resumeGame(slot)}>
                Resume
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <button class="btn btn-primary" onclick={() => viewModel.goToCharacterCreator()}>
      {t.create_new_character()}
    </button>
  </div>
</BaseViewModelContainer>
