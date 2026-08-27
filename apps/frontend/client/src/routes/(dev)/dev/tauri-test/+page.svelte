<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/tauri-test/+page.svelte
//
// Dev route — platform diagnostics for the Tauri desktop webview.
// Logicless view; every probe lives in the ViewModel.

import {
  getTauriTestViewModel,
  type TauriTestViewModelInterface,
} from './tauri_test_view_model.svelte';

let viewModel = $state<TauriTestViewModelInterface | undefined>(undefined);
let copied = $state(false);

$effect(() => {
  const vm = getTauriTestViewModel({ className: 'TauriTest' });
  viewModel = vm;
  void vm.initialize();
  return () => {
    void vm.dispose().catch(() => {
      // dispose silently
    });
  };
});

const badgeClass = (status: string): string => {
  if (status === 'pass') {
    return 'badge-success';
  }
  if (status === 'warn') {
    return 'badge-warning';
  }
  if (status === 'fail') {
    return 'badge-error';
  }
  return 'badge-ghost';
};

const copyReport = async (): Promise<void> => {
  if (!viewModel) {
    return;
  }
  try {
    await navigator.clipboard.writeText(viewModel.report);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  } catch {
    copied = false;
  }
};
</script>

<svelte:head>
  <title>Tauri Platform Diagnostics</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto flex flex-col gap-4">
  <header class="flex items-center justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-bold">Tauri Platform Diagnostics</h1>
      <p class="text-sm text-base-content/60">
        Isolates viewport, canvas, WebGL, render loop and worker layers so a blank game canvas names
        its own cause.
      </p>
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-sm btn-primary"
        onclick={() => viewModel?.runProbes()}
        disabled={viewModel?.running}
      >
        {viewModel?.running ? 'Running...' : 'Re-run'}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" onclick={copyReport}>
        {copied ? 'Copied' : 'Copy report'}
      </button>
    </div>
  </header>

  {#each viewModel?.groups ?? [] as group (group.title)}
    <section class="card bg-base-200 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-primary/70 mb-3">
        {group.title}
      </h2>
      <div class="flex flex-col gap-2">
        {#each group.rows as row (row.label)}
          <div class="flex flex-col gap-1 border-b border-base-300 last:border-0 pb-2 last:pb-0">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm">{row.label}</span>
              <span class="flex items-center gap-2 shrink-0">
                <code class="text-xs opacity-80 break-all">{row.value}</code>
                <span class="badge badge-sm {badgeClass(row.status)}">{row.status}</span>
              </span>
            </div>
            {#if row.note}
              <p class="text-xs text-base-content/60">{row.note}</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}

  {#if (viewModel?.groups ?? []).length === 0}
    <div class="flex items-center justify-center h-32 text-base-content/40">Running probes...</div>
  {/if}
</div>
