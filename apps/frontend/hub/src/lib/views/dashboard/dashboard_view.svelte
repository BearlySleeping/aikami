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
      Welcome to the Aikami Hub — where communities share assets, maps and mods.
    </p>
  </div>
</BaseViewModelContainer>
