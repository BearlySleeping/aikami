<script lang="ts">
  import GameDice from '$lib/components/game/game_dice.svelte';
  // apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
  import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';

  type Props = {
    viewModel: DialogueOverlayViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-base-300/60 to-transparent"
  role="dialog"
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

  <!-- Dialogue Box — positioned at the bottom 40% of the screen -->
  <div
    class="mx-auto mb-8 flex w-full max-w-2xl flex-col rounded-xl border border-base-300 bg-base-200/95 shadow-2xl"
    style="height: 40vh;"
  >
    <!-- Header: NPC name + End Chat button -->
    <div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
      <h3 class="text-sm font-bold text-primary">{viewModel.npcName}</h3>
      <button class="btn btn-ghost btn-xs text-error" onclick={() => viewModel.endChat()}>
        End Chat
      </button>
    </div>

    <!-- Scrollable message history — DOM ref bound to VM for auto-scroll -->
    <div
      bind:this={viewModel.messageContainerElement}
      class="flex-1 space-y-2 overflow-y-auto px-4 py-3"
    >
      {#each viewModel.messages as message (message.id)}
        <div class="chat {message.role === 'player' ? 'chat-end' : 'chat-start'}">
          <div class="chat-header mb-0.5 text-xs text-base-content/50">
            {message.role === 'player' ? 'You' : viewModel.npcName}
          </div>
          <div
            class="chat-bubble text-sm {message.role === 'player'
              ? 'chat-bubble-primary'
              : 'chat-bubble-secondary'}"
          >
            {#if message.content}
              {message.content}
            {:else if viewModel.isStreaming}
              <span class="loading loading-dots loading-xs"></span>
            {/if}
          </div>
        </div>
      {/each}

      {#if viewModel.streamError}
        <div class="rounded-lg bg-error/10 p-2 text-center text-xs text-error">
          {viewModel.streamError}
        </div>
      {/if}

      {#if viewModel.isResolvingSkillCheck}
        <div class="flex items-center justify-center gap-2 py-2 text-xs text-base-content/60">
          <span class="loading loading-spinner loading-xs"></span>
          <span>Resolving skill check...</span>
        </div>
      {/if}
    </div>

    <!-- Input area -->
    <div class="border-t border-base-300 px-4 py-3">
      {#if viewModel.dialoguePhase === 'MENU'}
        <div class="flex flex-wrap gap-2">
          {#each viewModel.actionOptions as action (action.id)}
            <button
              class="btn btn-sm {action.type === 'direct_combat' ? 'btn-error' : action.type === 'skill_check' ? 'btn-outline btn-info' : 'btn-ghost'}"
              onclick={() => viewModel.selectAction(action.id)}
              disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
            >
              {#if action.type === 'direct_combat'}
                ⚔️
              {:else if action.skill === 'persuasion'}
                🗣️
              {:else if action.skill === 'intimidation'}
                😠
              {:else if action.skill === 'sleight_of_hand'}
                🤫
              {:else}
                ✏️
              {/if}
              {action.label}
            </button>
          {/each}
        </div>
      {:else if viewModel.dialoguePhase === 'CUSTOM_INPUT'}
        <div class="flex items-end gap-2">
          <textarea
            bind:this={viewModel.inputElement}
            class="textarea textarea-bordered textarea-sm flex-1 resize-none text-sm"
            rows="2"
            placeholder="Type your message..."
            value={viewModel.inputText}
            oninput={(e) => viewModel.setInput(e.currentTarget.value)}
            onkeydown={(e) => viewModel.handleKeyDown(e)}
            disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
          ></textarea>
          <button
            class="btn btn-primary btn-sm"
            onclick={() => viewModel.sendMessage()}
            disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck || !viewModel.inputText.trim()}
          >
            {#if viewModel.isStreaming || viewModel.isResolvingSkillCheck}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              Send
            {/if}
          </button>
        </div>
        <button class="btn btn-ghost btn-xs mt-2" onclick={() => viewModel.goToMenu()}>
          ← Back to actions
        </button>
      {:else}
        <div class="flex items-end gap-2">
          <textarea
            bind:this={viewModel.inputElement}
            class="textarea textarea-bordered textarea-sm flex-1 resize-none text-sm"
            rows="2"
            placeholder="Type your message..."
            value={viewModel.inputText}
            oninput={(e) => viewModel.setInput(e.currentTarget.value)}
            onkeydown={(e) => viewModel.handleKeyDown(e)}
            disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
          ></textarea>
          <button
            class="btn btn-primary btn-sm"
            onclick={() => viewModel.sendMessage()}
            disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck || !viewModel.inputText.trim()}
          >
            {#if viewModel.isStreaming || viewModel.isResolvingSkillCheck}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              Send
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
