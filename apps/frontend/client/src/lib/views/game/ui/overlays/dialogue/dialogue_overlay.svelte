<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
  import { gameStateService } from '$services';
  import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';

  type Props = {
    viewModel: DialogueOverlayViewModelInterface;
  };

  const { viewModel }: Props = $props();

  /** Reference to the scrollable message container for auto-scroll. */
  let messageContainer = $state<HTMLDivElement>();

  /** Reference to the textarea for mode-aware autofocus. */
  let inputElement = $state<HTMLTextAreaElement>();

  /** Mode-aware autofocus: focus the textarea when DIALOGUE mode is active. */
  $effect(() => {
    if (gameStateService.currentMode === 'DIALOGUE' && inputElement) {
      inputElement.focus();
    }
  });

  /** Auto-scroll to the bottom when new messages arrive or AI is streaming. */
  $effect(() => {
    // Track message count and streaming state to trigger scroll
    const count = viewModel.messages.length;
    const streaming = viewModel.isStreaming;
    void count;
    void streaming;

    if (messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
    }
  });
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

  <!-- d20 Skill Check Dice Overlay (C-157 / C-162 Interactive) -->
  {#if viewModel.skillCheckState}
    <div
      class="dice-check-overlay absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div
        class="dice-container flex flex-col items-center gap-3 rounded-2xl bg-base-100/95 p-8 shadow-2xl"
      >
        <!-- Check type label -->
        <span class="text-xs font-semibold uppercase tracking-widest text-base-content/70">
          {viewModel.skillCheckState.checkType}
          Check
        </span>

        <!-- DC indicator -->
        <span class="text-sm text-base-content/70">
          DC {viewModel.skillCheckState.difficultyClass}
        </span>

        <!-- d20 die -->
        {#if viewModel.skillCheckState.phase === 'awaiting_click'}
          <!-- Interactive: player must click to roll (C-162) -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="d20-die d20-interactive cursor-pointer"
            role="button"
            tabindex="0"
            aria-label="Click to roll d20"
            onclick={() => viewModel.rollDice()}
            onkeydown={(e) => e.key === 'Enter' && viewModel.rollDice()}
          >
            <span class="d20-question">?</span>
          </div>
          <span class="text-sm font-medium text-base-content/60 animate-pulse">Click to roll</span>
        {:else if viewModel.skillCheckState.phase === 'rolling'}
          <!-- Spinning animation -->
          <div class="d20-die d20-spinning">
            <span class="d20-question">?</span>
          </div>
        {:else if viewModel.skillCheckState.phase === 'revealed'}
          <!-- Revealed result -->
          <div
            class="d20-die d20-reveal"
            class:d20-success={viewModel.skillCheckState.isSuccess === true}
            class:d20-failure={viewModel.skillCheckState.isSuccess === false}
          >
            <span class="d20-value">{viewModel.skillCheckState.rollValue}</span>
          </div>
        {/if}

        <!-- Result label -->
        {#if viewModel.skillCheckState.phase === 'revealed'}
          <span
            class="text-lg font-bold"
            class:text-success={viewModel.skillCheckState.isSuccess}
            class:text-error={!viewModel.skillCheckState.isSuccess}
          >
            {viewModel.skillCheckState.isSuccess ? 'SUCCESS!' : 'FAILURE'}
          </span>
        {/if}
      </div>
    </div>
  {/if}

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

    <!-- Scrollable message history -->
    <div bind:this={messageContainer} class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
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

      <!-- Error message -->
      {#if viewModel.streamError}
        <div class="rounded-lg bg-error/10 p-2 text-center text-xs text-error">
          {viewModel.streamError}
        </div>
      {/if}

      <!-- Skill check resolving indicator -->
      {#if viewModel.isResolvingSkillCheck}
        <div class="flex items-center justify-center gap-2 py-2 text-xs text-base-content/60">
          <span class="loading loading-spinner loading-xs"></span>
          <span>Resolving skill check...</span>
        </div>
      {/if}
    </div>

    <!-- Input area — action context menu or text input (C-162) -->
    <div class="border-t border-base-300 px-4 py-3">
      {#if viewModel.dialoguePhase === 'MENU'}
        <!-- Action Context Menu — BG3-style skill check buttons -->
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
        <!-- Custom freeform text input -->
        <div class="flex items-end gap-2">
          <textarea
            bind:this={inputElement}
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
        <!-- Standard chat input (DICE / CHAT / RESOLVING phases — fallback) -->
        <div class="flex items-end gap-2">
          <textarea
            bind:this={inputElement}
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

<style>
  .d20-die {
    width: 80px;
    height: 80px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: 900;
    font-family: monospace;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    border: 3px solid #4a6fa5;
    color: #e0e0e0;
    box-shadow: 0 0 20px rgba(74, 111, 165, 0.4);
    transition:
      transform 0.3s ease,
      box-shadow 0.3s ease,
      background 0.3s ease;
  }

  /* Interactive dice — pulsing glow to invite click (C-162) */
  .d20-interactive {
    animation: d20-pulse 2s ease-in-out infinite;
    box-shadow: 0 0 30px rgba(74, 111, 165, 0.7);
  }

  .d20-interactive:hover {
    transform: scale(1.15);
    box-shadow: 0 0 40px rgba(74, 111, 165, 0.9);
  }

  .d20-spinning {
    animation:
      d20-shake 0.15s ease-in-out infinite alternate,
      d20-spin 0.8s linear infinite;
    box-shadow: 0 0 30px rgba(74, 111, 165, 0.7);
  }

  .d20-reveal {
    animation: d20-pop 0.4s ease-out;
  }

  .d20-success {
    background: linear-gradient(135deg, #1a3a1a 0%, #225522 50%, #2d7a2d 100%);
    border-color: #4ade80;
    box-shadow: 0 0 30px rgba(74, 222, 128, 0.6);
    color: #4ade80;
  }

  .d20-failure {
    background: linear-gradient(135deg, #3a1a1a 0%, #552222 50%, #7a2d2d 100%);
    border-color: #f87171;
    box-shadow: 0 0 30px rgba(248, 113, 113, 0.6);
    color: #f87171;
  }

  @keyframes d20-shake {
    0% {
      transform: translateX(-3px) translateY(-2px) rotate(-5deg);
    }
    100% {
      transform: translateX(3px) translateY(2px) rotate(5deg);
    }
  }

  @keyframes d20-pulse {
    0%,
    100% {
      box-shadow: 0 0 30px rgba(74, 111, 165, 0.5);
    }
    50% {
      box-shadow: 0 0 50px rgba(74, 111, 165, 0.9);
    }
  }

  @keyframes d20-spin {
    0% {
      transform: rotateY(0deg) rotateX(0deg);
    }
    100% {
      transform: rotateY(360deg) rotateX(360deg);
    }
  }

  @keyframes d20-pop {
    0% {
      transform: scale(0.8);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
</style>
