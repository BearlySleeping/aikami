<script lang="ts">
// apps/frontend/client/src/lib/components/base_view_model_container.svelte
// Direct local module for lifecycle-container consumers that must avoid barrels.

import { BaseViewModelContainer as SharedBaseViewModelContainer } from '@aikami/frontend/components';
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { Snippet } from 'svelte';

type Props = {
  viewModel: BaseViewModelInterface;
  fillHeight?: boolean;
  children?: Snippet;
};

const { viewModel, fillHeight = false, children }: Props = $props();
</script>

<SharedBaseViewModelContainer {viewModel} {fillHeight}>
  {@render children?.()}
</SharedBaseViewModelContainer>
