<script lang="ts">
// apps/frontend/hub/src/lib/views/dashboard/dashboard_view.svelte
import BaseViewModelContainer from '$components/base_view_model_container.svelte';
import type { DashboardViewModelInterface } from './dashboard_view_model.svelte.ts';

type Props = { viewModel: DashboardViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="flex flex-col gap-6 p-6">
  <div>
    <h1 class="font-display text-2xl text-foreground">Dashboard</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Welcome to the Aikami Hub — where communities share assets, maps, mods and personas.
    </p>
  </div>

  {#if viewModel.isLoading}
    <div class="flex justify-center py-12">
      <div
        class="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent"
      ></div>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        type="button"
        class="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
        onclick={() => viewModel.goToPersonas()}
      >
        <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          My Personas
        </div>
        <div class="mt-2 font-display text-3xl text-foreground">{viewModel.personaCount}</div>
        <div class="mt-1 text-xs text-muted-foreground">Browse and manage →</div>
      </button>
    </div>
  {/if}
</BaseViewModelContainer>
