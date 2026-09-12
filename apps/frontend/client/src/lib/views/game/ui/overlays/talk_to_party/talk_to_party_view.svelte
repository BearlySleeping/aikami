<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view.svelte
import { BaseViewModelContainer } from '$components';
import GuidedComposer from '$lib/components/messaging/guided_composer.svelte';
import RichMessageList from '$lib/components/messaging/rich_message_list.svelte';
import RichMessageRow from '$lib/components/messaging/rich_message_row.svelte';
import type { TalkToPartyViewModelInterface } from './talk_to_party_view_model.svelte';

type Props = {
  viewModel: TalkToPartyViewModelInterface;
};

const { viewModel }: Props = $props();

/** Badge color for an approval value. */
const approvalBadgeClass = $derived.by(() => {
  if (viewModel.approval > 0) {
    return 'badge-success';
  }
  if (viewModel.approval < 0) {
    return 'badge-error';
  }
  return 'badge-ghost';
});
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Talking to {viewModel.npcName}"
    tabindex="-1"
    onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
  >
    <div
      class="mx-auto flex w-full max-w-2xl flex-col rounded-xl border border-base-300 bg-base-200/95 shadow-2xl"
      style="height: 50vh;"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-bold text-primary">{viewModel.npcName}</h3>
          <span class="badge badge-xs {approvalBadgeClass}">
            {viewModel.approval > 0 ? '+' : ''}{viewModel.approval}
          </span>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          onclick={() => viewModel.close()}
        >
          Close
        </button>
      </div>

      <!-- Messages — shared RichMessageList / RichMessageRow (Phase 3) -->
      <RichMessageList
        messages={viewModel.richMessages}
        containerClass="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        isStreaming={viewModel.isStreaming}
        bind:containerElement={viewModel.messageContainerElement}
      >
        {#snippet renderRow(message)}
          <RichMessageRow {message} variant="dialogue" characterName={viewModel.npcName} readOnly />
        {/snippet}

        {#snippet after()}
          {#if viewModel.isStreaming}
            <div class="flex gap-2 py-2" aria-live="polite">
              <span
                class="inline-flex items-center gap-1 rounded-2xl rounded-bl-md bg-base-100 px-4 py-2.5 shadow-sm"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-base-content/40 animate-bounce"></span>
                <span
                  class="h-1.5 w-1.5 rounded-full bg-base-content/50 animate-bounce"
                  style="animation-delay: 150ms"
                ></span>
                <span
                  class="h-1.5 w-1.5 rounded-full bg-base-content/60 animate-bounce"
                  style="animation-delay: 300ms"
                ></span>
              </span>
            </div>
          {/if}
        {/snippet}
      </RichMessageList>

      <!-- Input area — shared GuidedComposer (Phase 3 unification) -->
      <div class="border-t border-base-300 px-4 py-3">
        <GuidedComposer
          value={viewModel.inputText}
          onInput={(text) => viewModel.setInput(text)}
          onSend={() => void viewModel.sendMessage()}
          onKeyDown={(event) => viewModel.handleKeyDown(event)}
          onCancel={() => viewModel.cancelStream()}
          placeholder="Talk to {viewModel.npcName}..."
          disabled={viewModel.isStreaming}
          isStreaming={viewModel.isStreaming}
        />
      </div>
    </div>
  </div>
</BaseViewModelContainer>
