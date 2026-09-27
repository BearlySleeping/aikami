<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
//
// NPC dialogue overlay — compact bottom stage (C-547).
//
// One stage anchored above an always-visible composer: the speaker identity is
// attached to the stage header, the transcript is a single scroll region that
// sizes to its content and is capped relative to the viewport, and the composer
// never leaves the screen. Full view stays reachable from the same toggle.
//
// The View is logicless (svelte-conventions Pillar 3): the RichMessage
// projection, chip class/icon mapping, row-action dispatch and the stage's
// fullscreen flag all live in ./dialogue_stage_presentation.svelte.ts.
//
// - Free-text-first input (C-371): always-visible textarea + send
// - Marinara-style texting bubbles with role-colored tails
// - Animated suggestion chips with intent icons
// - Skill check dice overlay (C-162)
// - Message actions, branches, editing, TTS (C-343)
//
// C-424: the message list and composer are the shared RichMessageList /
// GuidedComposer components. Surface-specific concerns (skill-check dice,
// speaker identity, spatial speech bubble, suggestion chips, combat
// escalation) are preserved here via snippets.
import { CapabilityErrorBanner, Image, SlashAutocomplete } from '@aikami/frontend/components';
import GameDice from '$lib/components/game/game_dice.svelte';
import GuidedComposer from '$lib/components/messaging/guided_composer.svelte';
import RichMessageList from '$lib/components/messaging/rich_message_list.svelte';
import RichMessageRow from '$lib/components/messaging/rich_message_row.svelte';
import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';
import {
  cancelDeleteAndRefocus,
  chipClassFor,
  chipIconFor,
  chipLabelFor,
  confirmDeleteAndRefocus,
  createDialogueStageState,
  dispatchDialogueRowAction,
  findDialogueMessage,
  focusOnMount,
  handleDialogueEscape,
  initialsFor,
  isPartyMateMessage,
  routeComposerKeyDown,
  toRichMessages,
} from './dialogue_stage_presentation.svelte';
import PendingMessageBanner from './pending_message_banner.svelte';

type Props = {
  viewModel: DialogueOverlayViewModelInterface;
};

const { viewModel }: Props = $props();

/** Stage presentation state (fullscreen) — moved out of the View. */
const stage = createDialogueStageState();
</script>

<div
  class="game-scrim pointer-events-auto absolute inset-0 z-10 flex flex-col justify-end"
  role="dialog"
  aria-modal="true"
  aria-label="Dialogue with {viewModel.npcName}"
  data-testid="dialogue-overlay"
  data-aikami-theme-scope
  tabindex="-1"
  onkeydown={(event) => handleDialogueEscape(event, viewModel, stage)}
>
  <!-- Spatial speech bubble — positioned over the NPC's rendered sprite (C-161).
       The viewport clamp is expressed in CSS so no per-frame JS is needed. -->
  {#if viewModel.hasNpcScreenPosition && !stage.isFullscreen}
    <div
      class="speech-bubble game-surface--raised pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg px-3 py-1.5 text-xs font-semibold text-base-content shadow-lg backdrop-blur-sm"
      style="left: clamp(1rem, {viewModel.npcScreenX}px, calc(100vw - 1rem)); top: clamp(1rem, calc({viewModel.npcScreenY}px - 3rem), calc(100dvh - 1rem));"
    >
      {viewModel.npcName}
    </div>
  {/if}

  <!-- Toast notification (overlay-scoped so the stage's overflow cannot clip it) -->
  {#if viewModel.toastMessage}
    <div class="absolute top-2 right-2 z-50">
      <div class="alert alert-success text-sm">{viewModel.toastMessage}</div>
    </div>
  {/if}

  <!-- Compact bottom stage: speaker identity + transcript + composer. -->
  <section
    class="game-stage"
    class:game-stage--full={stage.isFullscreen}
    aria-label="Dialogue transcript and composer"
  >
    <!-- Header: speaker identity attached to the transcript, plus controls. -->
    <header class="game-stage__header">
      <div
        class="game-stage__portrait"
        class:game-stage__portrait--speaking={viewModel.highlightSpeaker === 'npc'}
      >
        {#if stage.portraitFailed}
          <!-- Composed fallback: initials on the inset surface, never alt text
               overflowing the frame. `role="img"` keeps the name for a11y. -->
          <span class="game-stage__portrait-fallback" role="img" aria-label={viewModel.npcName}>
            {initialsFor(viewModel.npcName)}
          </span>
        {:else}
          <Image
            src={viewModel.npcAvatarUrl}
            alt={viewModel.npcName}
            class="h-full w-full object-cover"
            loading="lazy"
            onerror={() => stage.markPortraitFailed()}
          />
        {/if}
      </div>
      <div class="game-stage__identity">
        <h3 class="game-section-title">{viewModel.npcName}</h3>
        <span class="game-metadata">
          {viewModel.highlightSpeaker === 'player' ? 'Listening…' : 'Speaking'}
        </span>
      </div>
      <div class="game-stage__controls">
        {#if viewModel.isTtsSpeaking}
          <span class="text-xs animate-pulse" title="TTS speaking">🔊</span>
        {/if}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => stage.toggleFullscreen()}
          title={stage.isFullscreen ? 'Exit full view' : 'Full view'}
          aria-label={stage.isFullscreen ? 'Exit full view' : 'Enter full view'}
          aria-pressed={stage.isFullscreen}
        >
          {stage.isFullscreen ? '⊡' : '⛶'}
        </button>
        <button
          type="button"
          class="btn btn-xs game-control--neutral"
          onclick={() => viewModel.endChat()}
        >
          End Chat
        </button>
      </div>
    </header>

    {#snippet imageBlock(image: {
  id: string;
  url: string | null;
  status: string;
})}
      <div class="flex justify-center py-1">
        {#if image.status === 'generating'}
          <div class="skeleton h-48 w-64 rounded-xl"></div>
        {:else if image.status === 'done' && image.url}
          <div class="overflow-hidden rounded-xl shadow-md max-w-xs">
            <Image
              src={image.url}
              alt="Generated scene"
              class="w-full h-auto object-cover"
              loading="lazy"
            />
          </div>
        {:else if image.status === 'error'}
          <span class="text-xs text-error italic">Image generation failed</span>
        {/if}
      </div>
    {/snippet}

    <!-- Scrollable transcript — the one scroll region (shared RichMessageList). -->
    <RichMessageList
      messages={toRichMessages(viewModel.messages)}
      containerClass="game-stage__transcript space-y-3"
      isStreaming={viewModel.isStreaming}
    >
      {#snippet before()}
        <!-- Images created before any message -->
        {#each viewModel.generatedImages.filter((img) => img.afterMessageId === null) as image (image.id)}
          {@render imageBlock(image)}
        {/each}
      {/snippet}

      {#snippet renderRow(
  message,
  index,
)}
        {@const original = findDialogueMessage(viewModel.messages, message.id)}
        <RichMessageRow
          {message}
          variant="dialogue"
          characterName={viewModel.npcName}
          npcAvatarUrl={viewModel.npcAvatarUrl}
          playerAvatarUrl={viewModel.playerAvatarUrl}
          showPartyUi={viewModel.showPartyUi}
          senderName={original?.senderName}
          isPartyMate={isPartyMateMessage(original, viewModel.npcName)}
          editing={viewModel.editingMessageId === message.id}
          editText={viewModel.editText}
          disableTranscriptEditing={viewModel.isCampaignPlay}
          onEditChange={(t) => viewModel.setEditText(t)}
          onEditSave={(id) => viewModel.editMessage({ messageId: id, newText: viewModel.editText })}
          onEditCancel={() => viewModel.cancelEdit()}
          isStreaming={viewModel.isStreaming}
          isLast={index === viewModel.messages.length - 1}
          showRephrase={viewModel.canRephraseMessage(message.id)}
          streamingText={viewModel.streamingText}
          isResolvingSkillCheck={viewModel.isResolvingSkillCheck}
          alternativeLabel={original?.alternativeLabel ?? ''}
          canSwipeLeft={original?.canSwipeLeft ?? false}
          canSwipeRight={original?.canSwipeRight ?? false}
          ttsAvailable={viewModel.streamingTtsEnabled}
          onSwipe={(id, direction) => viewModel.swipeAlternative(id, direction)}
          onAction={(id, action) => dispatchDialogueRowAction(viewModel, id, action)}
        >
          {#snippet renderFooter(
  messageId,
)}
            <!-- Images anchored to this message -->
            {#each viewModel.generatedImages.filter((img) => img.afterMessageId === messageId) as image (image.id)}
              {@render imageBlock(image)}
            {/each}

            <!-- Dice roll result banner — anchored to the message it appeared after -->
            {#if viewModel.rollResultBanner && viewModel.rollResultBanner.afterMessageId === messageId}
              <div class="flex justify-center py-2">
                <div class="game-surface--inset rounded-xl px-4 py-2 text-center shadow-md">
                  <span class="game-metadata"
                    >{viewModel.rollResultBanner.checkType}
                    Check</span
                  >
                  <div class="flex items-baseline justify-center gap-2">
                    <span
                      class="game-numeric text-2xl font-bold {viewModel.rollResultBanner.isSuccess
  ? 'text-success'
  : 'text-error'}"
                      >{viewModel.rollResultBanner.value}</span
                    >
                    <span class="game-metadata">vs DC {viewModel.rollResultBanner.dc}</span>
                  </div>
                  <span
                    class="text-sm font-bold {viewModel.rollResultBanner.isSuccess
  ? 'text-success'
  : 'text-error'}"
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
        <!-- Pending skill check — an inline card in the conversation
             rather than a screen-covering overlay (Phase 2 / C-162). -->
        <GameDice dice={viewModel.diceState} />

        <!-- Typing indicator — shown while waiting for NPC response -->
        {#if viewModel.isTyping}
          <div class="flex gap-2">
            <div class="game-surface--inset rounded-2xl rounded-bl-md px-4 py-2.5 shadow-sm">
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

        <CapabilityErrorBanner
          error={viewModel.capabilityError}
          ondismiss={() => viewModel.dismissCapabilityError()}
          onsettings={() => viewModel.goToSettingsCapability()}
        />

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

        <!-- Interrupted skill check recovered from the operation ledger:
             the roll is preserved, so resolving never rerolls. -->
        {#if viewModel.interruptedCheck}
          <div
            class="game-surface--inset rounded-lg px-3 py-2"
            data-testid="interrupted-check-banner"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="game-metadata">
                A {viewModel.interruptedCheck.checkType} check was interrupted — the roll was
                <span class="font-semibold">{viewModel.interruptedCheck.natural}</span>
                vs DC {viewModel.interruptedCheck.difficultyClass}.
              </span>
              <div class="flex shrink-0 gap-1">
                <button
                  type="button"
                  class="btn btn-warning btn-xs"
                  data-testid="interrupted-check-resolve"
                  onclick={() => void viewModel.resumeInterruptedCheck()}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  onclick={() => viewModel.dismissInterruptedCheck()}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Pending queued messages retained after a failed/cancelled stream;
             require an explicit Send before any is delivered. -->
        <PendingMessageBanner
          messages={viewModel.pendingMessages}
          onRetry={() => viewModel.retryPending()}
        />

        <!-- Suggestion chips — inline in the transcript, above the composer -->
        {#if viewModel.suggestedChips.length > 0}
          {#key viewModel.suggestedChips.map((c) => c.id).join('|')}
            <div class="flex flex-wrap gap-1.5 px-1 py-1" data-testid="suggestion-chips">
              {#each viewModel.suggestedChips as chip (chip.id)}
                <button
                  type="button"
                  class="btn btn-xs game-chip gap-1 normal-case {chipClassFor(chip.intentType)}"
                  disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}
                  onclick={() => viewModel.handleChipTap(chip.id)}
                  aria-label={chip.label}
                >
                  <span class="game-chip__icon" aria-hidden="true"
                    >{chipIconFor(chip.intentType)}</span
                  >
                  {chipLabelFor(chip.label)}
                </button>
              {/each}
            </div>
          {/key}
        {/if}

        <!-- Recruitment offer — inline, so the composer stays visible. -->
        {#if viewModel.recruitAvailable}
          <div class="flex items-center justify-center gap-3 py-1" data-testid="recruit-offer">
            <div class="badge badge-success badge-lg gap-1">🤝 Recruitable</div>
            <button
              type="button"
              class="btn btn-success btn-sm"
              onclick={() => viewModel.recruitCompanion()}
            >
              Recruit {viewModel.npcName}
            </button>
          </div>
        {/if}

        <!-- Branch selector (C-490: hidden in campaign play — rewinding is gated) -->
        {#if viewModel.showBranchSelector}
          <div class="border-t border-base-content/10 px-3 py-1">
            <div class="flex items-center gap-1 text-xs">
              <span class="game-metadata">Branch:</span>
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

    <!-- Delete confirmation modal -->
    {#if viewModel.pendingDeleteMessageId}
      <!-- Aikami UI v5: modal-box needs the .modal.modal-open wrapper to be visible -->
      <div class="modal modal-open game-scrim">
        <div class="modal-box w-80">
          <h3 class="game-section-title">Delete Message?</h3>
          <p class="py-4 text-sm">This will remove the message and all subsequent replies.</p>
          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              use:focusOnMount
              onclick={() => cancelDeleteAndRefocus(viewModel)}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-error btn-sm"
              onclick={() => confirmDeleteAndRefocus(viewModel)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Composer — always visible, including with long streaming replies. -->
    <div class="game-stage__composer">
      <SlashAutocomplete
        show={viewModel.showSlashCompletions}
        completions={viewModel.slashCompletions}
        selectedIndex={viewModel.selectedSlashCompletion}
        onselect={(index) => viewModel.selectAndApplySlashCompletion(index)}
      />
      <GuidedComposer
        value={viewModel.inputText}
        onInput={(t) => viewModel.setInput(t)}
        onSend={() => viewModel.sendMessage()}
        onKeyDown={(e) => routeComposerKeyDown(e, viewModel, stage)}
        placeholder="Reply to {viewModel.npcName}..."
        disabled={viewModel.isResolvingSkillCheck}
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
        {#snippet extras()}
          <div class="flex items-center justify-between">
            <!-- TTS toggle (C-417 AC-5: accessible name + visible label) -->
            <label class="flex cursor-pointer items-center gap-1.5">
              <span class="game-metadata">🔊 TTS</span>
              <input
                type="checkbox"
                class="toggle toggle-xs game-toggle"
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
    </div>
  </section>
</div>
