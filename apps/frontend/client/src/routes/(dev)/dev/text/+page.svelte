<script lang="ts">
import { getTextViewModel } from '$views/dev/text/text_composition';
// apps/frontend/client/src/routes/(dev)/dev/text/+page.svelte
import TextView from '$views/dev/text/text_view.svelte';

const viewModel = getTextViewModel({
  className: 'TextViewModel',
});
</script>

<TextView {viewModel} />
