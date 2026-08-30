<script lang="ts">
import { BaseViewModelContainer } from '$lib/components';
// apps/frontend/hub/src/lib/views/login/login_view.svelte
import LoginContent from './login_content.svelte';
import type { LoginViewModelInterface } from './login_view_model.svelte.ts';

type Props = {
  viewModel: LoginViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  <LoginContent {viewModel} />
</BaseViewModelContainer>
