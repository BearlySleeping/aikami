<script lang="ts">
// apps/frontend/client/src/routes/characters/+page.svelte
import StartView from '$lib/views/start/start_view.svelte';
import { getStartViewModel } from '$lib/views/start/start_view_model.svelte';

const viewModel = getStartViewModel({ className: 'StartViewModel' });
</script>

<StartView {viewModel} />
