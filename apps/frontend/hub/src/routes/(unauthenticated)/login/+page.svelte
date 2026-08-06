<script lang="ts">
import LoginView from '$views/login/login_view.svelte';
import { getLoginViewModel } from '$views/login/login_view_model.svelte.ts';

const viewModel = getLoginViewModel({ className: 'LoginViewModel' });
</script>

<LoginView {viewModel} />
