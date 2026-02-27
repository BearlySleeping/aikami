<script lang="ts">
import type { LoginViewModelInterface } from '../login-view-model.svelte.ts';
import { getForgotPasswordViewModel } from './forgot-password-view-model.svelte.ts';

type Props = {
  viewModel: LoginViewModelInterface;
};

let { viewModel }: Props = $props();

const _forgotPasswordViewModel = getForgotPasswordViewModel({
  // svelte-ignore state_referenced_locally
  loginViewModel: viewModel,
  className: 'ForgotPasswordViewModel',
});
</script>

{#if forgotPasswordViewModel.isOpen}
    <BaseViewModelContainer
        viewModel={forgotPasswordViewModel}
        class="modal modal-open"
    >
        <div class="modal-box">
            <h3 class="font-bold text-lg mb-4">
                {t.forgot_password()}
            </h3>

            <p class="text-sm opacity-70 mb-4">
                {t.forgot_password_description()}
            </p>

            <form
                class="flex flex-col gap-4"
                onsubmit={(e) => {
                    e.preventDefault();
                    forgotPasswordViewModel.handleSubmit();
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
                        class:input-error={forgotPasswordViewModel.errors.email}
                        placeholder={t.email_placeholder()}
                        value={forgotPasswordViewModel.form.email}
                        oninput={(e) => {
                            forgotPasswordViewModel.form.email =
                                e.currentTarget.value;
                            forgotPasswordViewModel.handleChange("email");
                        }}
                        disabled={forgotPasswordViewModel.isSubmitting}
                        autocomplete="email"
                    />
                    {#if forgotPasswordViewModel.errors.email}
                        <div class="label">
                            <span class="label-text-alt text-error">
                                {forgotPasswordViewModel.errors.email}
                            </span>
                        </div>
                    {/if}
                </div>

                <div class="modal-action">
                    <button
                        type="button"
                        class="btn btn-ghost"
                        onclick={() => forgotPasswordViewModel.close()}
                        disabled={forgotPasswordViewModel.isSubmitting}
                    >
                        {t.cancel()}
                    </button>
                    <button
                        type="submit"
                        class="btn btn-primary"
                        disabled={forgotPasswordViewModel.isSubmitting}
                    >
                        {#if forgotPasswordViewModel.isSubmitting}
                            <span class="loading loading-spinner"></span>
                        {/if}
                        {t.send_reset_email()}
                    </button>
                </div>
            </form>
        </div>
        <div
            class="modal-backdrop"
            onclick={() => forgotPasswordViewModel.close()}
            onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    forgotPasswordViewModel.close();
                }
            }}
            role="button"
            tabindex="0"
        ></div>
    </BaseViewModelContainer>
{/if}
