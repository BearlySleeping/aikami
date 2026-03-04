<script lang="ts">
import t from '$i18n';
import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
import type { ProfileViewModelInterface } from './profile-view-model.svelte.ts';

type Props = {
  viewModel: ProfileViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    {#if viewModel.errorMessage}
        <div class="alert alert-error">
            <span>{viewModel.errorMessage}</span>
        </div>
    {/if}
    {#if viewModel.user}
        <div class="p-4">
            <div class="card bg-base-100 shadow-xl">
                <div class="card-body">
                    <h2 class="card-title">{viewModel.user.displayName}</h2>
                    <p>{viewModel.user.email}</p>
                    <div class="card-actions justify-end">
                        <button
                            class="btn btn-primary"
                            onclick={() => viewModel.signOut()}
                            >{t.sign_out()}</button
                        >
                    </div>
                </div>
            </div>
        </div>
    {/if}
</BaseViewModelContainer>
