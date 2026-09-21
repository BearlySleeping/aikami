// apps/frontend/client/src/lib/views/auth/login/login_composition.ts
//
// Production wiring for the shared login control. This is the only module in
// the feature that imports the production auth singleton; the ViewModel
// receives it as a typed capability.

import { isTauri } from '$lib/views/utils/is_tauri';
import { authService } from '$services';
import {
  createLoginViewModel,
  type LoginViewModelInterface,
  type LoginViewModelOptions,
} from './login_view_model.svelte';

/**
 * Builds the login ViewModel wired to the production auth singleton and the
 * real Tauri platform probe.
 */
export const getLoginViewModel = (
  options: Omit<LoginViewModelOptions, 'auth' | 'isTauri' | 'currentUrl'>,
): LoginViewModelInterface =>
  createLoginViewModel({
    ...options,
    auth: authService,
    isTauri,
  });
