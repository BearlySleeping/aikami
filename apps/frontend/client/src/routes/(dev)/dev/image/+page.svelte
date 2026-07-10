<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/image/+page.svelte
import ImageView from '$views/dev/image/image_view.svelte';
import { getImageViewModel } from '$views/dev/image/image_view_model.svelte';

const viewModel = getImageViewModel({
  className: 'ImageViewModel',
});
</script>

<ImageView {viewModel} />
