<script lang="ts">
    import t from "$i18n";
    import type { ChatViewModelInterface } from "./chat-view-model.svelte";
    import BaseViewModelContainer from "$components/BaseViewModelContainer.svelte";

    type Props = {
        viewModel: ChatViewModelInterface;
    };
    const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    <div class="p-4">
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body">
                {#if viewModel.errorMessage}
                    <div class="alert alert-error">
                        <span>{viewModel.errorMessage}</span>
                    </div>
                {/if}

                {#if viewModel.isLoading}
                    <div class="flex justify-center">
                        <span class="loading loading-spinner"></span>
                    </div>
                {:else if viewModel.npc}
                    <h2 class="card-title">
                        {t.chatWith({ name: viewModel.npc.name })}
                    </h2>
                    <div
                        class="flex flex-col h-96 overflow-y-auto border border-base-300 rounded-lg p-4 space-y-4"
                    >
                        <!-- Chat messages will go here -->
                    </div>
                    <form
                        onsubmit={(e) => {
                            e.preventDefault();
                            viewModel.sendMessage();
                        }}
                        class="mt-4 flex"
                    >
                        <textarea
                            bind:value={viewModel.message}
                            placeholder={t.typeYourMessage()}
                            class="textarea textarea-bordered flex-grow"
                            disabled={viewModel.isSending}
                        ></textarea>
                        <button
                            type="submit"
                            class="btn btn-primary ml-2"
                            disabled={viewModel.isSending}
                        >
                            {#if viewModel.isSending}
                                <span class="loading loading-spinner"></span>
                            {:else}
                                {t.send()}
                            {/if}
                        </button>
                    </form>
                {/if}
            </div>
        </div>
    </div>
</BaseViewModelContainer>
