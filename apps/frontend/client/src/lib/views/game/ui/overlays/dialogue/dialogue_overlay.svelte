<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
//
// NPC dialogue overlay — Marinara-inspired modern chat UX.
// - Free-text-first input (C-371): always-visible textarea + send
// - Marinara-style texting bubbles with role-colored tails
// - Animated suggestion chips with intent icons
// - Skill check dice overlay (C-162)
// - Message actions, branches, editing, TTS (C-343)
import AutoResizeTextarea from '$lib/components/chat/auto_resize_textarea.svelte';
import GameDice from '$lib/components/game/game_dice.svelte';
import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';

type Props = {
  viewModel: DialogueOverlayViewModelInterface;
};

const { viewModel }: Props = $props();

/**
 * Parses NPC message text into styled segments.
 * - `*action*` → italic, muted
 * - `"dialogue"` → normal
 * - plain text → normal
 * - Unmatched `*` and `"` are captured as text
 */
const formatNpcText = (
  text: string,
): Array<{ type: 'action' | 'dialogue' | 'text'; content: string }> => {
  const segments: Array<{ type: 'action' | 'dialogue' | 'text'; content: string }> = [];
  const re = /(\*[^*]+\*)|("[^"]+")|([^*"]+)|(\*|")/g;
  let match = re.exec(text);
  while (match !== null) {
    if (match[1]) {
      // *action*
      segments.push({ type: 'action', content: match[1].replace(/^\*|\*$/g, '') });
    } else if (match[2]) {
      // "dialogue"
      segments.push({ type: 'dialogue', content: match[2].replace(/^"|"$/g, '') });
    } else if (match[3]) {
      // Plain text
      segments.push({ type: 'text', content: match[3] });
    } else if (match[4]) {
      // Unmatched delimiter (standalone * or ")
      segments.push({ type: 'text', content: match[4] });
    }
    match = re.exec(text);
  }
  return segments;
};
</script>

<div
  class="pointer-events-auto absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-base-300/60 to-transparent"
  role="dialog"
  aria-modal="true"
  aria-label="Dialogue with {viewModel.npcName}"
>
  <!-- Spatial speech bubble — positioned over the NPC's rendered sprite (C-161) -->
  {#if viewModel.hasNpcScreenPosition}
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

  <!-- Dialogue Box — glass card at bottom 45% of screen -->
  <div
    class="mx-auto mb-6 flex w-full max-w-2xl flex-col rounded-2xl border border-base-content/10 bg-base-200/90 shadow-2xl backdrop-blur-md"
    style="height: 45vh;"
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
          class="btn btn-ghost btn-xs text-error"
          onclick={() => viewModel.endChat()}
        >
          End Chat
        </button>
      </div>
    </div>

    <!-- Scrollable message history -->
    <div
      bind:this={viewModel.messageContainerElement}
      class="flex-1 space-y-3 overflow-y-auto px-4 py-3"
    >
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

      <!-- Images created before any message -->
      {#each viewModel.generatedImages.filter((img) => img.afterMessageId === null) as image (image.id)}
        {@render imageBlock(image)}
      {/each}

      {#each viewModel.messages as message, i (message.id)}
        {@const isPlayer = message.role === 'player'}
        {@const isPartyMate = message.senderName != null && message.senderName !== viewModel.npcName}
        {@const alignRight = isPlayer || isPartyMate}
        {@const isLast = i === viewModel.messages.length - 1}

        <div class="group flex gap-2 {alignRight ? 'flex-row-reverse' : 'flex-row'}">
          <!-- Bubble column -->
          <div class="flex max-w-[75%] flex-col gap-0.5">
            {#if viewModel.editingMessageId === message.id}
              <!-- Editing: inline textarea -->
              <div class="flex flex-col gap-1">
                <textarea
                  class="textarea textarea-bordered textarea-sm w-full"
                  rows={3}
                  value={viewModel.editText}
                  oninput={(e) => viewModel.setEditText((e.target as HTMLTextAreaElement).value)}
                ></textarea>
                <div class="flex gap-1 justify-end">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    onclick={() => viewModel.cancelEdit()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary btn-xs"
                    onclick={() => viewModel.editMessage({ messageId: message.id, newText: viewModel.editText })}
                  >
                    Save
                  </button>
                </div>
              </div>
            {:else}
              <!-- Party mode: show avatar + name above bubble -->
              {#if viewModel.showPartyUi}
                {@const avatarUrl = isPlayer
                  ? viewModel.playerAvatarUrl
                  : isPartyMate
                    ? '/assets/npc/gandalf/neutral.webp'
                    : viewModel.npcAvatarUrl}
                <div class="flex items-center gap-1.5 mb-0.5">
                  <img
                    src={avatarUrl}
                    alt={message.senderName || (isPlayer ? 'You' : viewModel.npcName)}
                    class="h-5 w-5 rounded-full object-cover"
                    loading="lazy"
                  >
                  <span class="text-xs font-medium text-base-content/50">
                    {message.senderName || (isPlayer ? 'You' : viewModel.npcName)}
                  </span>
                </div>
              {/if}
              <!-- Message bubble -->
              <div
                class="relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm {isPlayer
                  ? 'rounded-br-md bg-primary text-primary-content'
                  : isPartyMate
                    ? 'rounded-br-md bg-info/20 text-info-content border border-info/20'
                    : 'rounded-bl-md bg-base-100 text-base-content'}"
              >
                {#if message.content}
                  {#if isPlayer}
                    {message.content}
                  {:else}
                    {#each formatNpcText(message.content) as segment}
                      {#if segment.type === 'action'}
                        <span class="italic text-base-content/60">*{segment.content}*</span>
                      {:else}
                        {segment.content}
                      {/if}
                    {/each}
                  {/if}
                {:else if viewModel.isStreaming && isLast}
                  <span class="inline-flex items-center gap-1">
                    <span
                      class="h-1.5 w-1.5 rounded-full bg-current opacity-45 animate-bounce"
                      style="animation-delay: 0ms"
                    ></span>
                    <span
                      class="h-1.5 w-1.5 rounded-full bg-current opacity-65 animate-bounce"
                      style="animation-delay: 150ms"
                    ></span>
                    <span
                      class="h-1.5 w-1.5 rounded-full bg-current opacity-85 animate-bounce"
                      style="animation-delay: 300ms"
                    ></span>
                  </span>
                {/if}
              </div>
            {/if}

            <!-- Message action buttons (hover-visible) -->
            <div
              class="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 {alignRight ? 'justify-end' : 'justify-start'}"
            >
              {#if !isPlayer && !isPartyMate}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Copy"
                  aria-label="Copy"
                  onclick={() => viewModel.copyMessage(message.content)}
                >
                  📋
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Retry"
                  aria-label="Retry"
                  disabled={viewModel.isStreaming}
                  onclick={() => viewModel.regenerateResponse(message.id)}
                >
                  🔄
                </button>
                {#if viewModel.streamingTtsEnabled}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs px-1"
                    title="Speak"
                    aria-label="Speak"
                    onclick={() => viewModel.speakMessage(message.content)}
                  >
                    🔊
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Branch"
                  aria-label="Branch"
                  onclick={() => viewModel.createBranch({ parentMessageId: message.id })}
                >
                  🌿
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Copy"
                  aria-label="Copy"
                  onclick={() => viewModel.copyMessage(message.content)}
                >
                  📋
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Edit"
                  aria-label="Edit"
                  disabled={viewModel.isStreaming}
                  onclick={() => viewModel.startEdit(message.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Delete"
                  aria-label="Delete"
                  disabled={viewModel.isStreaming}
                  onclick={() => viewModel.deleteMessage(message.id)}
                >
                  🗑️
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  title="Branch"
                  aria-label="Branch"
                  onclick={() => viewModel.createBranch({ parentMessageId: message.id })}
                >
                  🌿
                </button>
              {/if}
            </div>

            <!-- Swipe controls for AI messages with alternatives -->
            {#if !isPlayer && !isPartyMate && message.alternativeLabel}
              <div class="flex items-center justify-center gap-1 mt-0.5">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  disabled={!message.canSwipeLeft}
                  onclick={() => viewModel.swipeAlternative(message.id, 'left')}
                  aria-label="Previous alternative"
                >
                  ◀
                </button>
                <span class="text-xs font-mono text-base-content/50"
                  >{message.alternativeLabel}</span
                >
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  disabled={!message.canSwipeRight}
                  onclick={() => viewModel.swipeAlternative(message.id, 'right')}
                  aria-label="Next alternative"
                >
                  ▶
                </button>
              </div>
            {/if}
          </div>
        </div>

        <!-- Images anchored to this message -->
        {#each viewModel.generatedImages.filter((img) => img.afterMessageId === message.id) as image (image.id)}
          {@render imageBlock(image)}
        {/each}

        <!-- Dice roll result banner — anchored to the message it appeared after -->
        {#if viewModel.rollResultBanner && viewModel.rollResultBanner.afterMessageId === message.id}
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
      {/each}

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
    </div>

    <!-- Suggestion chips — rendered inside the card, above the input -->
    {#if viewModel.suggestedChips.length > 0}
      {#key viewModel.suggestedChips.map(c => c.id).join('|')}
        <div
          class="flex shrink-0 gap-1.5 overflow-x-auto border-t border-base-content/5 px-4 py-2"
          data-testid="suggestion-chips"
        >
          {#each viewModel.suggestedChips as chip (chip.id)}
            <button
              type="button"
              class="btn btn-xs gap-1 shrink-0 normal-case border-base-content/15 {chip.intentType === 'combat'
                ? 'btn-outline btn-error'
                : chip.intentType === 'skill_check'
                  ? 'btn-outline btn-accent'
                  : chip.intentType === 'trade'
                    ? 'btn-outline btn-warning'
                    : chip.intentType === 'quest'
                      ? 'btn-outline btn-info'
                      : 'btn-outline'}"
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

    <!-- Input area -->
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
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <AutoResizeTextarea
              value={viewModel.inputText}
              onchange={(text) => viewModel.setInput(text)}
              onkeydown={(e) => viewModel.handleKeyDown(e)}
              disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
              placeholder="Reply to {viewModel.npcName}..."
              class="w-full"
            />
          </div>
          <div class="flex gap-1">
            <button
              type="button"
              class="btn btn-sm btn-square {viewModel.isStreaming ? 'btn-error' : 'btn-primary'}"
              onclick={() => viewModel.isStreaming ? viewModel.cancelStreaming() : viewModel.sendMessage()}
              disabled={viewModel.isResolvingSkillCheck}
              title={viewModel.isStreaming ? 'Cancel' : 'Send'}
            >
              {#if viewModel.isResolvingSkillCheck}
                <span class="loading loading-spinner loading-xs"></span>
              {:else if viewModel.isStreaming}
                <span class="text-lg">■</span>
              {:else}
                <span class="text-lg">↑</span>
              {/if}
            </button>
          </div>
        </div>
        <div class="mt-2 flex items-center justify-between">
          <!-- TTS toggle -->
          <div class="flex items-center gap-1">
            <span class="text-xs text-base-content/50">TTS</span>
            <input
              type="checkbox"
              class="toggle toggle-xs"
              checked={viewModel.streamingTtsEnabled}
              onclick={() => viewModel.toggleStreamingTts()}
            >
          </div>
          <!-- Draft recovery badge -->
          {#if viewModel.showDraftRecovery}
            <span class="badge badge-info badge-sm gap-1" aria-live="polite">
              📝 Draft restored
            </span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
