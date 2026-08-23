<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
//
// NPC dialogue overlay — Marinara-inspired modern chat UX.
// - Free-text-first input (C-371): always-visible textarea + send
// - Marinara-style texting bubbles with role-colored tails
// - Animated suggestion chips with intent icons
// - Skill check dice overlay (C-162)
// - Message actions, branches, editing, TTS (C-343)
//
// C-424: the message list and composer are now the shared RichMessageList /
// GuidedComposer components. Surface-specific concerns (skill-check dice,
// portrait row, spatial speech bubble, suggestion chips, combat escalation)
// are preserved here via snippets.
import GameDice from '$lib/components/game/game_dice.svelte';
import GuidedComposer from '$lib/components/messaging/guided_composer.svelte';
import RichMessageList from '$lib/components/messaging/rich_message_list.svelte';
import RichMessageRow from '$lib/components/messaging/rich_message_row.svelte';
import type { MessageAction } from '$types';
import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';

type Props = {
  viewModel: DialogueOverlayViewModelInterface;
};

const { viewModel }: Props = $props();

/** Whether the dialogue is expanded to full-view (hides avatars, maxes chat area). */
let isFullscreen = $state(false);

const toggleFullscreen = (): void => {
  isFullscreen = !isFullscreen;
};

/** Map dialogue messages to the shared RichMessage row shape (C-424). */
const richMessages = $derived(
  viewModel.messages.map((m) => ({
    id: m.id,
    text: m.content,
    sender: m.role === 'player' ? ('user' as const) : ('ai' as const),
    timestamp: new Date(0),
  })),
);

/** Bubble intent chip class for a suggestion chip. */
const chipClassFor = (intentType: string): string => {
  if (intentType === 'combat') {
    return 'btn-outline btn-error';
  }
  if (intentType === 'skill_check') {
    return 'btn-outline btn-accent';
  }
  if (intentType === 'trade') {
    return 'btn-outline btn-warning';
  }
  if (intentType === 'quest') {
    return 'btn-outline btn-info';
  }
  return 'btn-outline';
};

/** Dispatches a shared MessageAction to the dialogue ViewModel. */
const handleRowAction = (messageId: string, action: MessageAction): void => {
  const msg = viewModel.messages.find((m) => m.id === messageId);
  if (!msg) {
    return;
  }
  switch (action) {
    case 'copy':
      void viewModel.copyMessage(msg.content);
      break;
    case 'retry':
      viewModel.regenerateResponse(messageId);
      break;
    case 'speak':
      viewModel.speakMessage(msg.content);
      break;
    case 'branch':
      viewModel.createBranch({ parentMessageId: messageId });
      break;
    case 'edit':
      viewModel.startEdit(messageId);
      break;
    case 'delete':
      viewModel.deleteMessage(messageId);
      break;
  }
};
</script>

<div
  class="pointer-events-auto absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-base-300/60 to-transparent"
  role="dialog"
  aria-modal="true"
  aria-label="Dialogue with {viewModel.npcName}"
  data-testid="dialogue-overlay"
>
  <!-- Spatial speech bubble — positioned over the NPC's rendered sprite (C-161) -->
  {#if viewModel.hasNpcScreenPosition && !isFullscreen}
    {@const clampedX = Math.max(16, Math.min(viewModel.npcScreenX, typeof window !== 'undefined' ? window.innerWidth - 16 : 400))}
    {@const clampedY = Math.max(16, Math.min(viewModel.npcScreenY, typeof window !== 'undefined' ? window.innerHeight - 16 : 300))}
    <div
      class="speech-bubble pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-base-100/90 px-3 py-1.5 text-xs font-semibold text-primary shadow-lg backdrop-blur-sm"
      style="left: {clampedX}px; top: {clampedY - 48}px;"
    >
      {viewModel.npcName}
    </div>
  {/if}

  <!-- d20 Skill Check Dice (C-157 / C-162) -->
  <GameDice dice={viewModel.diceState} />

  <!-- Avatar row — NPC left, Player + Party right -->
  {#if !isFullscreen}
    <div class="mx-auto mb-3 flex w-full max-w-2xl items-end justify-between px-2">
      <!-- NPC Avatar -->
      <div
        class="{viewModel.highlightSpeaker === 'npc' ? 'scale-110' : ''} transition-transform duration-200"
      >
        <div
          class="h-28 w-28 overflow-hidden border-2 shadow-lg {viewModel.highlightSpeaker === 'npc'
          ? 'border-warning shadow-warning/30'
          : 'border-base-content/10'}"
        >
          <img
            src={viewModel.npcAvatarUrl}
            alt={viewModel.npcName}
            class="h-full w-full object-contain"
            loading="lazy"
          >
        </div>
      </div>

      <!-- Right side: Player + Party members -->
      <div class="flex items-end gap-2">
        {#if viewModel.showPartyUi}
          <div class="h-20 w-20 overflow-hidden border-2 border-info/30 shadow-lg">
            <img
              src="/assets/npc/gandalf/neutral.webp"
              alt="Companion"
              class="h-full w-full object-contain opacity-70"
              loading="lazy"
            >
          </div>
        {/if}
        <div
          class="{viewModel.highlightSpeaker === 'player' ? 'scale-110' : ''} transition-transform duration-200"
        >
          <div
            class="h-28 w-28 overflow-hidden border-2 shadow-lg {viewModel.highlightSpeaker === 'player'
            ? 'border-primary shadow-primary/30'
            : 'border-base-content/10'}"
          >
            <img
              src={viewModel.playerAvatarUrl}
              alt="You"
              class="h-full w-full object-contain"
              loading="lazy"
            >
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Dialogue Box — glass card at bottom 45% of screen -->
  <div
    class="mx-auto mb-6 flex w-full flex-col rounded-2xl border border-base-content/10 bg-base-200/90 shadow-2xl backdrop-blur-md"
    class:max-w-2xl={!isFullscreen}
    class:max-w-4xl={isFullscreen}
    class:h-[45vh]={!isFullscreen}
    class:h-[calc(100dvh-2rem)]={isFullscreen}
    class:mx-2={isFullscreen}
  >
    <!-- Header: NPC name + address mode + End Chat -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-base-content/10 px-4 py-2.5"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-bold text-primary">{viewModel.npcName}</h3>
        {#if viewModel.isTtsSpeaking}
          <span class="text-xs animate-pulse" title="TTS speaking">🔊</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={toggleFullscreen}
          title={isFullscreen ? 'Exit full view' : 'Full view'}
          aria-label={isFullscreen ? 'Exit full view' : 'Enter full view'}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? '⊡' : '⛶'}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          onclick={() => viewModel.endChat()}
        >
          End Chat
        </button>
      </div>
    </div>

    {#snippet imageBlock(image: { id: string; url: string | null; status: string })}
      <div class="flex justify-center py-1">
        {#if image.status === 'generating'}
          <div class="skeleton h-48 w-64 rounded-xl"></div>
        {:else if image.status === 'done' && image.url}
          <div class="overflow-hidden rounded-xl shadow-md max-w-xs">
            <img
              src={image.url}
              alt="Generated scene"
              class="w-full h-auto object-cover"
              loading="lazy"
            >
          </div>
        {:else if image.status === 'error'}
          <span class="text-xs text-error italic">Image generation failed</span>
        {/if}
      </div>
    {/snippet}

    <!-- Scrollable message history (shared RichMessageList, C-424) -->
    <RichMessageList
      messages={richMessages}
      bind:containerElement={viewModel.messageContainerElement}
      containerClass="flex-1 space-y-3 overflow-y-auto px-4 py-3"
      isStreaming={viewModel.isStreaming}
    >
      {#snippet before()}
        <!-- Images created before any message -->
        {#each viewModel.generatedImages.filter((img) => img.afterMessageId === null) as image (image.id)}
          {@render imageBlock(image)}
        {/each}
      {/snippet}

      {#snippet renderRow(message, index)}
        {@const original = viewModel.messages.find((m) => m.id === message.id)}
        <RichMessageRow
          {message}
          variant="dialogue"
          characterName={viewModel.npcName}
          npcAvatarUrl={viewModel.npcAvatarUrl}
          playerAvatarUrl={viewModel.playerAvatarUrl}
          showPartyUi={viewModel.showPartyUi}
          senderName={original?.senderName}
          isPartyMate={original?.senderName != null && original?.senderName !== viewModel.npcName}
          editing={viewModel.editingMessageId === message.id}
          editText={viewModel.editText}
          onEditChange={(t) => viewModel.setEditText(t)}
          onEditSave={(id) => viewModel.editMessage({ messageId: id, newText: viewModel.editText })}
          onEditCancel={() => viewModel.cancelEdit()}
          isStreaming={viewModel.isStreaming}
          isLast={index === viewModel.messages.length - 1}
          streamingText={viewModel.streamingText}
          isResolvingSkillCheck={viewModel.isResolvingSkillCheck}
          alternativeLabel={original?.alternativeLabel ?? ''}
          canSwipeLeft={original?.canSwipeLeft ?? false}
          canSwipeRight={original?.canSwipeRight ?? false}
          ttsAvailable={viewModel.streamingTtsEnabled}
          onSwipe={(id, direction) => viewModel.swipeAlternative(id, direction)}
          onAction={handleRowAction}
        >
          {#snippet renderFooter(messageId)}
            <!-- Images anchored to this message -->
            {#each viewModel.generatedImages.filter((img) => img.afterMessageId === messageId) as image (image.id)}
              {@render imageBlock(image)}
            {/each}

            <!-- Dice roll result banner — anchored to the message it appeared after -->
            {#if viewModel.rollResultBanner && viewModel.rollResultBanner.afterMessageId === messageId}
              <div class="flex justify-center py-2">
                <div
                  class="rounded-xl px-4 py-2 text-center shadow-md {viewModel.rollResultBanner.isSuccess
                    ? 'bg-success/10 border border-success/30'
                    : 'bg-error/10 border border-error/30'}"
                >
                  <span class="text-xs text-base-content/50"
                    >{viewModel.rollResultBanner.checkType}
                    Check</span
                  >
                  <div class="flex items-baseline gap-2">
                    <span
                      class="text-2xl font-bold {viewModel.rollResultBanner.isSuccess ? 'text-success' : 'text-error'}"
                      >{viewModel.rollResultBanner.value}</span
                    >
                    <span class="text-sm text-base-content/50"
                      >vs DC {viewModel.rollResultBanner.dc}</span
                    >
                  </div>
                  <span
                    class="text-sm font-bold {viewModel.rollResultBanner.isSuccess ? 'text-success' : 'text-error'}"
                  >
                    {viewModel.rollResultBanner.isSuccess ? '✅ SUCCESS' : '❌ FAILURE'}
                  </span>
                </div>
              </div>
            {/if}
          {/snippet}
        </RichMessageRow>
      {/snippet}

      {#snippet after()}
        <!-- Typing indicator — shown while waiting for NPC response -->
        {#if viewModel.isStreaming && viewModel.messages.length > 0 && viewModel.messages[viewModel.messages.length - 1].role === 'player'}
          <div class="flex gap-2">
            <div class="rounded-2xl rounded-bl-md bg-base-100 px-4 py-2.5 shadow-sm">
              <span class="inline-flex items-center gap-1">
                <span
                  class="h-1.5 w-1.5 rounded-full bg-base-content/30 animate-bounce"
                  style="animation-delay: 0ms"
                ></span>
                <span
                  class="h-1.5 w-1.5 rounded-full bg-base-content/40 animate-bounce"
                  style="animation-delay: 150ms"
                ></span>
                <span
                  class="h-1.5 w-1.5 rounded-full bg-base-content/50 animate-bounce"
                  style="animation-delay: 300ms"
                ></span>
              </span>
            </div>
          </div>
        {/if}

        {#if viewModel.streamError}
          <div class="rounded-lg bg-error/10 p-2 text-center text-xs text-error">
            {viewModel.streamError}
          </div>
        {/if}

        <!-- CYOA choice buttons -->
        {#if viewModel.activeChoices.length > 0}
          <div class="space-y-1 px-2" data-testid="cyoa-choices">
            {#each viewModel.activeChoices as choice (choice.id)}
              <button
                type="button"
                class="btn btn-sm btn-outline w-full justify-start gap-2 normal-case text-sm"
                onclick={() => viewModel.sendMessage(choice.label)}
              >
                <span class="truncate text-left">{choice.label}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if viewModel.isResolvingSkillCheck}
          <div class="flex items-center justify-center gap-2 py-2 text-xs text-base-content/50">
            <span class="loading loading-spinner loading-xs"></span>
            <span>Resolving skill check...</span>
          </div>
        {/if}

        <!-- Branch selector -->
        {#if viewModel.branches.length > 0}
          <div class="border-t border-base-content/10 px-3 py-1">
            <div class="flex items-center gap-1 text-xs">
              <span class="text-base-content/50">Branch:</span>
              <button
                type="button"
                class="btn btn-xs"
                class:btn-active={viewModel.activeBranchId === null}
                onclick={() => viewModel.switchBranch(null)}
              >
                Main
              </button>
              {#each viewModel.branches as branch (branch.branchId)}
                <button
                  type="button"
                  class="btn btn-xs"
                  class:btn-active={viewModel.activeBranchId === branch.branchId}
                  onclick={() => viewModel.switchBranch(branch.branchId)}
                >
                  {branch.label ?? 'Branch'}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/snippet}
    </RichMessageList>

    <!-- Toast notification -->
    {#if viewModel.toastMessage}
      <div class="absolute top-2 right-2 z-50">
        <div class="alert alert-success text-sm">{viewModel.toastMessage}</div>
      </div>
    {/if}

    <!-- Delete confirmation modal -->
    {#if viewModel.pendingDeleteMessageId}
      <!-- daisyUI v5: modal-box needs the .modal.modal-open wrapper to be visible -->
      <div class="modal modal-open bg-base-300/60">
        <div class="modal-box w-80">
          <h3 class="text-lg font-bold">Delete Message?</h3>
          <p class="py-4 text-sm">This will remove the message and all subsequent replies.</p>
          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => viewModel.cancelDelete()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-error btn-sm"
              onclick={() => viewModel.confirmDelete()}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Input area (shared GuidedComposer, C-424) -->
    <div class="shrink-0 border-t border-base-content/10 px-4 py-3">
      {#if viewModel.recruitAvailable}
        <div class="flex items-center justify-center gap-3">
          <div class="badge badge-success badge-lg gap-1">🤝 Recruitable</div>
          <button
            type="button"
            class="btn btn-success btn-sm"
            onclick={() => viewModel.recruitCompanion()}
          >
            Recruit {viewModel.npcName}
          </button>
        </div>
      {:else}
        <GuidedComposer
          value={viewModel.inputText}
          onInput={(t) => viewModel.setInput(t)}
          onSend={() => viewModel.sendMessage()}
          onKeyDown={(e) => viewModel.handleKeyDown(e)}
          placeholder="Reply to {viewModel.npcName}..."
          disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
          sendDisabled={viewModel.isResolvingSkillCheck}
          requireText={false}
          isSending={viewModel.isResolvingSkillCheck}
          isStreaming={viewModel.isStreaming}
          onCancel={() => viewModel.cancelStreaming()}
          sendIcon="↑"
          square={true}
          textareaRef={(el) => {
            viewModel.inputElement = el ?? undefined;
          }}
        >
          {#snippet above()}
            <!-- Suggestion chips — rendered inside the card, above the input -->
            {#if viewModel.suggestedChips.length > 0}
              {#key viewModel.suggestedChips.map((c) => c.id).join('|')}
                <div
                  class="flex flex-wrap gap-1.5 border-t border-base-content/5 px-4 py-2"
                  data-testid="suggestion-chips"
                >
                  {#each viewModel.suggestedChips as chip (chip.id)}
                    <button
                      type="button"
                      class="btn btn-xs gap-1 normal-case border-base-content/15 {chipClassFor(chip.intentType)}"
                      disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
                      onclick={() => viewModel.handleChipTap(chip.id)}
                      aria-label={chip.label}
                    >
                      <span>
                        {#if chip.intentType === 'skill_check'}
                          🎲
                        {:else if chip.intentType === 'combat'}
                          ⚔️
                        {:else if chip.intentType === 'trade'}
                          💰
                        {:else if chip.intentType === 'quest'}
                          📋
                        {:else}
                          💬
                        {/if}
                      </span>
                      {chip.label}
                    </button>
                  {/each}
                </div>
              {/key}
            {/if}
          {/snippet}

          {#snippet extras()}
            <div class="flex items-center justify-between">
              <!-- TTS toggle (C-417 AC-5: accessible name + visible label) -->
              <label class="flex cursor-pointer items-center gap-1.5">
                <span class="text-xs font-medium text-base-content/60">🔊 TTS</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs toggle-primary"
                  aria-label="Toggle text-to-speech"
                  checked={viewModel.streamingTtsEnabled}
                  onclick={() => viewModel.toggleStreamingTts()}
                >
              </label>
              <!-- Draft recovery badge -->
              {#if viewModel.showDraftRecovery}
                <span class="badge badge-info badge-sm gap-1" aria-live="polite">
                  📝 Draft restored
                </span>
              {/if}
            </div>
          {/snippet}
        </GuidedComposer>
      {/if}
    </div>
  </div>
</div>
