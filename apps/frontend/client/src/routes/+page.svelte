<script lang="ts">
// apps/frontend/client/src/routes/+page.svelte
// Root page — checks for existing campaigns and routes accordingly.
// First launch → /setup; returning player → start menu.
// Contract: C-318 (capability), C-317 (campaign-first start menu)

import { getStartViewModel } from '$views/start/start_composition.ts';
import StartView from '$views/start/start_view.svelte';

const viewModel = getStartViewModel({ className: 'StartViewModel' });
</script>

<StartView {viewModel} />
