<script lang="ts">
  import RegisterView from '$views/auth/register/register_view.svelte';
  import { getRegisterViewModel } from '$views/auth/register/register_view_model.svelte.ts';

  const viewModel = getRegisterViewModel({ className: 'RegisterView' });
</script>

<RegisterView {viewModel} />
