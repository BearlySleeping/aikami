<script lang="ts">
// apps/frontend/client/src/lib/views/auth/login/login_view.svelte
//
// Shared login control — the single source of truth for the Google
// sign-in / sign-out button used by the start menu, the in-game menu, and
// the /link device-handoff page. Self-instantiates its LoginViewModel (per
// svelte-conventions); an optional `viewModel` prop exists for tests/DI.
//
// The rendered state is fully reactive to authService, so after a
// signInWithRedirect round-trip this re-renders to the signed-in state on
// the next page load with no button handler involvement.

import { BaseViewModelContainer } from '$components';
import LoginControl from './login_control.svelte';
import { getLoginViewModel, type LoginViewModelInterface } from './login_view_model.svelte';

type Props = {
  /** Override the self-instantiated view model (tests/DI). */
  viewModel?: LoginViewModelInterface;
  /** Extra classes for the button (defaults to the standard menu style). */
  buttonClass?: string;
};

let {
  viewModel = getLoginViewModel({ className: 'LoginViewModel' }),
  buttonClass = 'btn btn-outline btn-lg',
}: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  <LoginControl {viewModel} {buttonClass} />
</BaseViewModelContainer>
