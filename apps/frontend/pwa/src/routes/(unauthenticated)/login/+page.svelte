<script lang="ts">
  import LoginView from '$views/auth/login/login_view.svelte';
  import { getLoginViewModel } from '$views/auth/login/login_view_model.svelte';

  const viewModel = getLoginViewModel({ className: 'LoginViewModel' });
</script>

<LoginView {viewModel} />
