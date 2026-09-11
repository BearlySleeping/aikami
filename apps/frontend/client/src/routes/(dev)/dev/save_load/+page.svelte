<script lang="ts">
import { getSaveLoadViewModel } from '$views/dev/save_load/save_load_composition';
// apps/frontend/client/src/routes/(dev)/dev/save_load/+page.svelte
import SaveLoadView from '$views/dev/save_load/save_load_view.svelte';

const viewModel = getSaveLoadViewModel({
  className: 'SaveLoadViewModel',
});
</script>

<SaveLoadView {viewModel} />
