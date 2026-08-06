<script lang="ts">
import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

type Props = { viewModel: AppDialogsViewModelInterface };
const { viewModel }: Props = $props();

let dialogElement = $state<HTMLDivElement | undefined>();
let previouslyFocused: HTMLElement | null = null;

// Move focus into the dialog when it opens so Escape is handled by the
// active modal, and restore focus to the trigger when it closes.
$effect(() => {
  if (viewModel.confirmDialog && dialogElement) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    dialogElement.focus();
  }
});

$effect(() => {
  if (!viewModel.confirmDialog && previouslyFocused) {
    previouslyFocused.focus();
    previouslyFocused = null;
  }
});
</script>

{#if viewModel.confirmDialog}
  <div
    bind:this={dialogElement}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    onclick={() => viewModel.confirmDialogCancel()}
    onkeydown={(e) => { if (e.key === 'Escape') { viewModel.confirmDialogCancel() } }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-elevated"
      onclick={(e: MouseEvent) => e.stopPropagation()}
      role="none"
    >
      <h3 class="font-display text-lg text-foreground">{viewModel.confirmDialog.title}</h3>

      {#if viewModel.confirmDialog.message}
        <p class="mt-2 text-sm text-muted-foreground">{viewModel.confirmDialog.message}</p>
      {/if}

      <div class="mt-6 flex justify-end gap-2">
        {#if !viewModel.confirmDialog.hideDisagreeButton}
          <button
            type="button"
            class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            onclick={() => viewModel.confirmDialogCancel()}
          >
            {viewModel.confirmDialog.disagreeLabel}
          </button>
        {/if}
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          onclick={() => viewModel.confirmDialogAgree()}
        >
          {viewModel.confirmDialog.agreeLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
