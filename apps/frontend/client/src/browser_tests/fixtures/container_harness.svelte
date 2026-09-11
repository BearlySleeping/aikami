<script lang="ts">
// apps/frontend/client/src/browser_tests/fixtures/container_harness.svelte
//
// Mounted-component harness for the BaseViewModelContainer lifecycle tests.
// Holds the ViewModel prop in local state and exposes `replace()` so a test can
// change instance identity while the container stays mounted.

import BaseViewModelContainer from '@aikami/frontend/components/base/base_view_model_container.svelte';
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import { untrack } from 'svelte';

type Props = {
  initial: BaseViewModelInterface;
  replacement?: BaseViewModelInterface;
};

let { initial, replacement }: Props = $props();
// Deliberately seed from the initial prop only — `replace()` swaps identity.
let current = $state<BaseViewModelInterface>(untrack(() => initial));

export function replace(): void {
  if (replacement) {
    current = replacement;
  }
}
</script>

<BaseViewModelContainer viewModel={current}>
  <p data-testid="container-content">{current._className}</p>
</BaseViewModelContainer>
