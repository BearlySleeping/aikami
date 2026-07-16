<script lang="ts">
// apps/frontend/client/src/lib/views/auth/login/LoginView.svelte
import t from '$i18n';
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ForgotPasswordDialog from './forgot-password/forgot_password_dialog.svelte';
import type { LoginViewModelInterface } from './login_view_model.svelte.ts';

type Props = {
  viewModel: LoginViewModelInterface;
};

let { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  class="min-h-screen flex items-center justify-center bg-base-200 p-4"
>
  <div class="card w-full max-w-md bg-base-100 shadow-xl">
    <div class="card-body">
      <h1 class="text-3xl font-bold text-center mb-6">{t.login()}</h1>

      <!-- Social Sign In Buttons -->
      <div class="flex flex-col gap-2 mb-6">
        <button
          type="button"
          class="btn btn-outline gap-2"
          disabled={viewModel.isSubmitting ||
                        !!viewModel.isSocialSigningIn}
          onclick={() => viewModel.socialLogin("google")}
        >
          {#if viewModel.isSocialSigningIn === "google"}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <svg class="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <title>icon</title>
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          {/if}
          {t.continue_with_google()}
        </button>

        <button
          type="button"
          class="btn btn-outline gap-2"
          disabled={viewModel.isSubmitting ||
                        !!viewModel.isSocialSigningIn}
          onclick={() => viewModel.socialLogin("github")}
        >
          {#if viewModel.isSocialSigningIn === "github"}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <svg
              class="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>icon</title>
              <path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
              />
            </svg>
          {/if}
          {t.continue_with_github()}
        </button>
      </div>

      <div class="divider">{t.or()}</div>

      <!-- Email/Password Form -->
      <form
        class="flex flex-col gap-4"
        onsubmit={(e) => {
                    e.preventDefault();
                    viewModel.handleSubmit();
                }}
      >
        <div class="form-control">
          <label class="label" for="email">
            <span class="label-text">{t.email()}</span>
          </label>
          <input
            id="email"
            type="email"
            class="input input-bordered"
            class:input-error={viewModel.errors.email}
            placeholder={t.email_placeholder()}
            value={viewModel.form.email}
            oninput={(e) => {
                            viewModel.form.email = e.currentTarget.value;
                            viewModel.handleChange("email");
                        }}
            disabled={viewModel.isSubmitting ||
                            !!viewModel.isSocialSigningIn}
            autocomplete="email"
          >
          {#if viewModel.errors.email}
            <div class="label">
              <span class="label-text-alt text-error"> {viewModel.errors.email} </span>
            </div>
          {/if}
        </div>

        <div class="form-control">
          <label class="label" for="password">
            <span class="label-text">{t.password()}</span>
          </label>
          <input
            id="password"
            type="password"
            class="input input-bordered"
            class:input-error={viewModel.errors.password}
            placeholder={t.password_placeholder()}
            value={viewModel.form.password}
            oninput={(e) => {
                            viewModel.form.password = e.currentTarget.value;
                            viewModel.handleChange("password");
                        }}
            disabled={viewModel.isSubmitting ||
                            !!viewModel.isSocialSigningIn}
            autocomplete="current-password"
          >
          {#if viewModel.errors.password}
            <div class="label">
              <span class="label-text-alt text-error"> {viewModel.errors.password} </span>
            </div>
          {/if}
        </div>

        {#if viewModel.errorMessage}
          <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
        {/if}

        <div class="flex justify-end">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.openForgotPasswordDialog()}
            disabled={viewModel.isSubmitting ||
                            !!viewModel.isSocialSigningIn}
          >
            {t.forgot_password()}
          </button>
        </div>

        <button
          type="submit"
          class="btn btn-primary"
          disabled={viewModel.isSubmitting ||
                        !!viewModel.isSocialSigningIn}
        >
          {#if viewModel.isSubmitting}
            <span class="loading loading-spinner"></span>
          {/if}
          {t.login()}
        </button>
      </form>

      <div class="divider"></div>

      <p class="text-center text-sm">
        {t.dont_have_account()}
        <button
          type="button"
          class="link link-primary"
          onclick={() => viewModel.goToRegister()}
          disabled={viewModel.isSubmitting ||
                        !!viewModel.isSocialSigningIn}
        >
          {t.register()}
        </button>
      </p>
    </div>
  </div>
</BaseViewModelContainer>

<ForgotPasswordDialog loginViewModel={viewModel} />
