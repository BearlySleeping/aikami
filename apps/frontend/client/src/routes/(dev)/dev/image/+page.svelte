<script lang="ts">
import { getImageViewModel } from '$views/dev/image/image_composition';
// apps/frontend/client/src/routes/(dev)/dev/image/+page.svelte
import ImageView from '$views/dev/image/image_view.svelte';

const viewModel = getImageViewModel({
  className: 'ImageViewModel',
});
</script>

<ImageView {viewModel} />
