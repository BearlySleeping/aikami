<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/reactive-lifecycle/+page.svelte
import ReactiveCounterView from '../../../../lib/views/reactive_lifecycle/reactive_counter_view.svelte';
import { getReactiveCounterViewModel } from '../../../../lib/views/reactive_lifecycle/reactive_counter_view_model.svelte';

const viewModel = getReactiveCounterViewModel({ initialCount: 0 });
</script>

<svelte:head>
  <title>Reactive Lifecycle Test</title>
</svelte:head>

<h1>Reactive Lifecycle Tests</h1>
<p class="description">
  Compiled Svelte 5 component test harness for C-477. Demonstrates real
  <code>$state</code>, <code>$derived</code>, <code>$effect.root</code>, and cleanup lifecycle.
</p>

<ReactiveCounterView {viewModel} />
