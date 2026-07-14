<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/image-gen/+page.svelte
import ImageGenView from '$views/dev/image_gen/image_gen_view.svelte';
import { getImageGenViewModel } from '$views/dev/image_gen/image_gen_view_model.svelte';

const viewModel = getImageGenViewModel({
  className: 'ImageGenViewModel',
});
</script>

<ImageGenView {viewModel} />
