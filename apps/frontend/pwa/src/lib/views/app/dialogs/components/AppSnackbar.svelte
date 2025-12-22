<script lang="ts">
    import type { AppDialogsViewModelInterface } from "../app-dialogs-view-model.svelte";
    import BaseViewModelContainer from "$components/BaseViewModelContainer.svelte";

    type Props = {
        viewModel: AppDialogsViewModelInterface;
    };

    let { viewModel }: Props = $props();

    const getAlertClass = (type?: string): string => {
        switch (type) {
            case "success":
                return "alert-success";
            case "error":
                return "alert-error";
            case "warning":
                return "alert-warning";
            case "info":
                return "alert-info";
            default:
                return "alert-info";
        }
    };
</script>

{#if viewModel.snackbar}
    <BaseViewModelContainer
        {viewModel}
        class="toast toast-top toast-center z-50"
    >
        <div class="alert {getAlertClass(viewModel.snackbar.type)} shadow-lg">
            <span>{viewModel.snackbar.text}</span>
            <button
                class="btn btn-sm btn-ghost"
                onclick={() => viewModel.hideSnackbar()}
                aria-label="Close"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </div>
    </BaseViewModelContainer>
{/if}
