<script lang="ts">
  // apps/frontend/pwa/src/lib/views/auth/login/forgot-password/ForgotPasswordDialog.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { LoginViewModelInterface } from '../login-view-model.svelte.ts';
  import { getForgotPasswordViewModel } from './forgot-password-view-model.svelte.ts';

  type Props = {
    loginViewModel: LoginViewModelInterface;
  };

  let { loginViewModel }: Props = $props();

  const viewModel = getForgotPasswordViewModel({
    // svelte-ignore state_referenced_locally
    loginViewModel,
    className: 'ForgotPasswordViewModel',
  });
</script>

{#if viewModel.isOpen}
  <BaseViewModelContainer {viewModel} class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{t.forgot_password()}</h3>

      <p class="text-sm opacity-70 mb-4">{t.forgot_password_description()}</p>

      <form
        class="flex flex-col gap-4"
        onsubmit={(e) => {
                    e.preventDefault();
                    viewModel.handleSubmit();
                }}
      >
        <div class="form-control">
          <label class="label" for="forgot-email">
            <span class="label-text">{t.email()}</span>
          </label>
          <input
            id="forgot-email"
            type="email"
            class="input input-bordered"
            class:input-error={viewModel.errors.email}
            placeholder={t.email_placeholder()}
            value={viewModel.form.email}
            oninput={(e) => {
                            viewModel.form.email =
                                e.currentTarget.value;
                            viewModel.handleChange("email");
                        }}
            disabled={viewModel.isSubmitting}
            autocomplete="email"
          >
          {#if viewModel.errors.email}
            <div class="label">
              <span class="label-text-alt text-error"> {viewModel.errors.email} </span>
            </div>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => viewModel.close()}
            disabled={viewModel.isSubmitting}
          >
            {t.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={viewModel.isSubmitting}>
            {#if viewModel.isSubmitting}
              <span class="loading loading-spinner"></span>
            {/if}
            {t.send_reset_email()}
          </button>
        </div>
      </form>
    </div>
    <div
      class="modal-backdrop"
      onclick={() => viewModel.close()}
      onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    viewModel.close();
                }
            }}
      role="button"
      tabindex="0"
    ></div>
  </BaseViewModelContainer>
{/if}
