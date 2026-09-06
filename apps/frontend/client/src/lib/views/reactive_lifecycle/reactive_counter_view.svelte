<script lang="ts">
// apps/frontend/client/src/lib/views/reactive_lifecycle/reactive_counter_view.svelte
import {
  getReactiveCounter,
  type ReactiveCounterInterface,
} from './reactive_counter_view_model.svelte';

type Props = {
  viewModel?: ReactiveCounterInterface;
};

const { viewModel = getReactiveCounter({ initialCount: 0 }) }: Props = $props();
</script>

<div data-testid="reactive-counter">
  <p data-testid="count-display">Count: {viewModel.count}</p>
  <p data-testid="doubled-display">Doubled: {viewModel.doubled}</p>
  <p data-testid="label-display">Label: {viewModel.label}</p>
  <p data-testid="tick-display">Ticks: {viewModel.tickCount}</p>

  {#if viewModel.isAsyncPending}
    <p data-testid="async-status" class="async-pending">Async: pending...</p>
  {:else if viewModel.asyncResult}
    <p data-testid="async-result">Async: {viewModel.asyncResult}</p>
  {:else}
    <p data-testid="async-status" class="async-idle">Async: idle</p>
  {/if}

  <div class="actions">
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
      onclick={() => viewModel.startAsyncOperation({ delayMs: 50, result: "fast result" })}
    >
      Async Fast
    </button>
    <button
      type="button"
      data-testid="btn-async-slow"
      onclick={() => viewModel.startAsyncOperation({ delayMs: 5000, result: "slow result" })}
    >
      Async Slow
    </button>
    <button type="button" data-testid="btn-dispose" onclick={() => viewModel.dispose()}>
      Dispose
    </button>
  </div>
</div>

<style>
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.async-pending {
  color: #f59e0b;
}
.async-idle {
  color: #6b7280;
}
p {
  margin: 4px 0;
}
</style>
