<script lang="ts">
  import RegisterView from '$views/auth/register/RegisterView.svelte';
  import { getRegisterViewModel } from '$views/auth/register/register-view-model.svelte.ts';

  const viewModel = getRegisterViewModel({ className: 'RegisterView' });
</script>

<RegisterView {viewModel} />
