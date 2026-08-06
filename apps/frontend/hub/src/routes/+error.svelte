<script lang="ts">
import AppErrorView from '$views/app/error/app_error_view.svelte';
import { getAppErrorViewModel } from '$views/app/error/app_error_view_model.svelte';

const viewModel = getAppErrorViewModel({
  className: 'AppErrorViewModel',
});
</script>

<AppErrorView {viewModel} />
