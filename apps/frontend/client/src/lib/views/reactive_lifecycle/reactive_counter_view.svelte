<script lang="ts">
// apps/frontend/client/src/lib/views/reactive_lifecycle/reactive_counter_view.svelte
import { BaseViewModelContainer } from '$components';
import type { ReactiveCounterViewModelInterface } from './reactive_counter_view_model.svelte';

type Props = {
  viewModel: ReactiveCounterViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div data-testid="reactive-counter">
    <p class="my-1" data-testid="count-display">Count: {viewModel.count}</p>
    <p class="my-1" data-testid="doubled-display">Doubled: {viewModel.doubled}</p>
    <p class="my-1" data-testid="label-display">Label: {viewModel.label}</p>
    <p class="my-1" data-testid="tick-display">Ticks: {viewModel.tickCount}</p>

    {#if viewModel.isAsyncPending}
      <p class="my-1 text-amber-500" data-testid="async-status">Async: pending...</p>
    {:else if viewModel.asyncResult}
      <p class="my-1" data-testid="async-result">Async: {viewModel.asyncResult}</p>
    {:else}
      <p class="my-1 text-gray-500" data-testid="async-status">Async: idle</p>
    {/if}

    <div class="mt-3 flex flex-wrap gap-2">
      <button type="button" data-testid="btn-increment" onclick={() => viewModel.increment()}>
        Increment
      </button>
      <button type="button" data-testid="btn-decrement" onclick={() => viewModel.decrement()}>
        Decrement
      </button>
      <button type="button" data-testid="btn-reset" onclick={() => viewModel.reset()}>Reset</button>
      <button
        type="button"
        data-testid="btn-async-fast"
        onclick={() => viewModel.startAsyncOperation({ delayMs: 50, result: 'fast result' })}
      >
        Async Fast
      </button>
      <button
        type="button"
        data-testid="btn-async-slow"
        onclick={() => viewModel.startAsyncOperation({ delayMs: 5000, result: 'slow result' })}
      >
        Async Slow
      </button>
      <button type="button" data-testid="btn-dispose" onclick={() => void viewModel.dispose()}>
        Dispose
      </button>
    </div>
  </div>
</BaseViewModelContainer>
