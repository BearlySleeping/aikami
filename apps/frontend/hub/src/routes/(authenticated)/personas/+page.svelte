<script lang="ts">
// apps/frontend/hub/src/routes/(authenticated)/personas/+page.svelte
import PersonasView from '$lib/views/personas/personas_view.svelte';
import { getPersonasViewModel } from '$lib/views/personas/personas_view_model.svelte.ts';
import type { PageProps } from './$types.js';

let { data }: PageProps = $props();

const viewModel = getPersonasViewModel({ data, className: 'PersonasViewModel' });
</script>

<PersonasView {viewModel} />
