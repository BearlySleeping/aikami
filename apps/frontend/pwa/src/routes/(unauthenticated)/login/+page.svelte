<script lang="ts">
  import LoginView from '$views/auth/login/LoginView.svelte';
  import { getLoginViewModel } from '$views/auth/login/login-view-model.svelte';

  const viewModel = getLoginViewModel({ className: 'LoginViewModel' });
</script>

<LoginView {viewModel} />
