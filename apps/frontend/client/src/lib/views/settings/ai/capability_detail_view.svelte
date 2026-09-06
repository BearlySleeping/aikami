<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/capability_detail_view.svelte
//
// Per-capability detail view for Story & Dialogue, Artwork, and Read Aloud.
// Shows status, model, provider, and action buttons.
// Contract: C-484 AC-2

import { BaseViewModelContainer } from '$components';
import CapabilityDetailContent from './capability_detail_content.svelte';
import type { CapabilityDetailViewModelInterface } from './capability_detail_view_model.svelte';

type Props = {
  viewModel: CapabilityDetailViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <CapabilityDetailContent {viewModel} />
</BaseViewModelContainer>
