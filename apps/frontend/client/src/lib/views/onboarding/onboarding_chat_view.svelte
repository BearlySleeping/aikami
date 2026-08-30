<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_chat_view.svelte
//
// Inline DM chat interface for the onboarding flow.
// Extracted from PersonaCreateView's CHAT phase for embedding in the
// coordinator view without the full-page layout.

import { onDestroy } from 'svelte';
import { BaseViewModelContainer } from '$components';
import LpcPreviewView from '$lib/views/character/lpc_preview/lpc_preview_view.svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';
import type { PersonaCreateViewModelInterface } from '$views/character/persona/create/persona_create_view_model.svelte';

type Props = {
  viewModel: PersonaCreateViewModelInterface;
};

const { viewModel }: Props = $props();

// ── Inline LPC preview ─────────────────────────────────────────────────
const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'LpcPreviewViewModel',
});

onDestroy(() => {
  previewVm.dispose();
});

$effect(() => {
  void viewModel.lpcRecipe;
  previewVm.setRecipes(viewModel.lpcPreviewRecipes);
});

let messagesContainer = $state<HTMLDivElement>();

$effect(() => {
  void viewModel.messages.length;
  if (messagesContainer) {
    requestAnimationFrame(() => {
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    });
  }
});
</script>
<BaseViewModelContainer {viewModel}>
  <!-- ═══ CHAT Phase ═══ -->
  {#if viewModel.phase === 'CHAT'}
    <!-- Chat messages -->
    <div class="card bg-base-200 shadow mb-6">
      <div class="card-body p-0">
        <div
          bind:this={messagesContainer}
          class="flex flex-col gap-3 p-4 max-h-96 overflow-y-auto min-h-64"
        >
          {#if viewModel.messages.length === 0}
            <div class="flex items-center justify-center h-64 text-base-content/40 text-sm">
              <div class="text-center">
                <p class="mb-2 text-lg">⚔️</p>
                <p>Describe your persona to the Dungeon Master.</p>
                <p class="text-xs mt-1">Example: "I want to play a chaotic neutral goblin rogue"</p>
              </div>
            </div>
          {:else}
            {#each viewModel.messages as message}
              {#if message.role === 'system'}
              <!-- System messages are hidden from the chat UI -->
              {:else if message.role === 'user'}
                <div class="chat chat-end">
                  <div class="chat-bubble chat-bubble-primary">{message.content}</div>
                </div>
              {:else if message.role === 'assistant'}
                <div class="chat chat-start">
                  <div class="chat-bubble chat-bubble-secondary">{message.content}</div>
                </div>
              {/if}
            {/each}
          {/if}

          {#if viewModel.isStreaming}
            <div class="chat chat-start">
              <div class="chat-bubble chat-bubble-secondary">
                <span class="loading loading-dots loading-sm"></span>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="card bg-base-200 shadow mb-4">
      <div class="card-body p-4">
        <div class="flex gap-3 items-end">
          <textarea
            class="textarea textarea-bordered flex-1 min-h-16"
            placeholder="Describe your persona..."
            bind:value={viewModel.chatInput}
            disabled={viewModel.isStreaming}
            onkeydown={(e) => viewModel.handleKeydown(e)}
            rows="2"
          ></textarea>
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => viewModel.handleSend()}
            disabled={!viewModel.chatInput.trim() || viewModel.isStreaming}
          >
            Send
          </button>
        </div>
        <div class="label mt-1">
          <span class="label-text-alt text-base-content/40"
            >Enter to send, Shift+Enter for new line</span
          >
        </div>
      </div>
    </div>

    <!-- Generate button -->
    <div class="flex justify-center">
      <button
        type="button"
        class="btn btn-accent btn-wide"
        onclick={() => viewModel.generateCharacter()}
        disabled={viewModel.isStreaming}
      >
        {viewModel.generateButtonLabel}
      </button>
    </div>
  {/if}

  <!-- ═══ GENERATING Phase ═══ -->
  {#if viewModel.phase === 'GENERATING'}
    <div class="card bg-base-200 shadow">
      <div class="card-body items-center py-16 gap-6">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <h2 class="text-xl font-semibold">Generating Your Persona</h2>
        <p class="text-base-content/60 text-sm text-center max-w-md">
          The AI is analyzing your conversation and creating a persona sheet. This usually takes a
          few seconds...
        </p>
      </div>
    </div>
  {/if}

  <!-- ═══ LPC Preview (shown during CHAT when recipe exists) ═══ -->
  {#if viewModel.lpcRecipe && viewModel.phase === 'CHAT'}
    <div class="divider text-xs text-base-content/40 my-4">LPC Sprite Preview</div>
    <div class="w-full max-w-xs mx-auto mb-4">
      <LpcPreviewView viewModel={previewVm} />
    </div>
  {/if}
</BaseViewModelContainer>
