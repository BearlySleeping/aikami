<script lang="ts">
// apps/frontend/client/src/routes/+page.svelte
// Root page — checks for existing campaigns and routes accordingly.
// First launch → /capability; returning player → start menu.
// Contract: C-318 (capability), C-317 (campaign-first start menu)

import StartView from '$views/start/start_view.svelte';
import { getStartViewModel } from '$views/start/start_view_model.svelte';

const viewModel = getStartViewModel({ className: 'StartViewModel' });
</script>

<StartView {viewModel} />
