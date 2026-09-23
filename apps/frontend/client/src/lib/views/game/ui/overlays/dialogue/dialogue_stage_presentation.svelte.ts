// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_stage_presentation.svelte.ts
//
// Presentation helpers for the compact dialogue stage (C-547).
//
// The dialogue overlay View stays logicless (svelte-conventions Pillar 3).
// The pure mappings it used to compute inline — the RichMessage projection,
// the suggestion-chip class/icon mapping and the row-action dispatch table —
// live here. The stage's own `isFullscreen` flag is a tiny sub-VM in the same
// module so the production ViewModel (3,000+ lines, under a source-size
// baseline that may not grow) does not have to carry UI-only state.
//
// This module owns no transport, no services and no domain state: every
// function is a pure transformation over values passed in.
//
// Contract: C-547 Compact Dialogue Stage

import type { MessageAction, RichMessage } from '$types';

// ── Row projection ──────────────────────────────────────────────────────

/**
 * The minimal dialogue-message shape this module needs. The production
 * `DialogueMessage` structurally satisfies it (extra fields are ignored), so
 * the View can pass `viewModel.messages` directly.
 */
export type DialogueStageMessage = {
  /** Unique identifier (the RichMessageList `{#each}` key). */
  readonly id: string;
  /** Speaker role. */
  readonly role: 'player' | 'npc';
  /** Message body. */
  readonly content: string;
  /** Optional sender name (party mate / System). */
  readonly senderName?: string;
  /** Alternative counter label, e.g. "2/3". */
  readonly alternativeLabel?: string;
  /** Whether the previous alternative is available. */
  readonly canSwipeLeft?: boolean;
  /** Whether the next alternative is available. */
  readonly canSwipeRight?: boolean;
};

/**
 * Projects dialogue messages onto the shared `RichMessageList` row shape
 * (C-424). The timestamp is a stable placeholder — dialogue rows are ordered
 * by the message array, not by time.
 */
export const toRichMessages = (messages: readonly DialogueStageMessage[]): RichMessage[] =>
  messages.map((message) => ({
    id: message.id,
    text: message.content,
    sender: message.role === 'player' ? ('user' as const) : ('ai' as const),
    timestamp: new Date(0),
  }));

/** Finds the dialogue message behind a projected row id. */
export const findDialogueMessage = <T extends { id: string }>(
  messages: readonly T[],
  messageId: string,
): T | undefined => messages.find((message) => message.id === messageId);

/**
 * Whether a message renders on the right as a party-mate line: it carries a
 * `senderName` that differs from the main NPC.
 */
export const isPartyMateMessage = (
  message: DialogueStageMessage | undefined,
  npcName: string,
): boolean => message?.senderName != null && message.senderName !== npcName;

// ── Suggestion chip presentation ────────────────────────────────────────

/**
 * Game-UI role modifier for a suggestion chip's intent. Applied alongside
 * `.btn .btn-outline`; each modifier sets `--btn-color` from a theme token.
 */
export const chipClassFor = (intentType: string): string => {
  if (intentType === 'combat') {
    return 'game-chip--danger';
  }
  if (intentType === 'skill_check') {
    return 'game-chip--check';
  }
  if (intentType === 'trade') {
    return 'game-chip--trade';
  }
  if (intentType === 'quest') {
    return 'game-chip--quest';
  }
  return 'game-chip--neutral';
};

/** Leading icon for a suggestion chip's intent. */
export const chipIconFor = (intentType: string): string => {
  if (intentType === 'skill_check') {
    return '🎲';
  }
  if (intentType === 'combat') {
    return '⚔️';
  }
  if (intentType === 'trade') {
    return '💰';
  }
  if (intentType === 'quest') {
    return '📋';
  }
  return '💬';
};

/**
 * Chip label with any leading decorative emoji stripped. The chip renders
 * exactly ONE icon — the intent icon — so an authored label like
 * "⚔️ Offer your sword" must not also show its own emoji.
 */
export const chipLabelFor = (label: string): string => label.replace(/^[^\p{L}\p{N}]+/u, '').trim();

// ── Row action dispatch ─────────────────────────────────────────────────

/**
 * The ViewModel surface a transcript row action needs. The production
 * `DialogueOverlayViewModelInterface` structurally satisfies it, so the View
 * passes `viewModel` straight through.
 */
export type DialogueRowActionTarget = {
  /** Whether transcript rewinding (branch/edit/delete) is gated out (C-490). */
  readonly isCampaignPlay: boolean;
  /** Conversation history, for resolving the message text behind a row id. */
  readonly messages: readonly DialogueStageMessage[];
  copyMessage(text: string): Promise<void>;
  rephraseResponse(messageId: string): void;
  speakMessage(text: string): void;
  createBranch(options: { parentMessageId: string }): void;
  startEdit(messageId: string): void;
  deleteMessage(messageId: string): void;
};

/**
 * Dispatches a shared `MessageAction` from a transcript row to the dialogue
 * ViewModel. In campaign play the transcript-rewinding actions are ignored as
 * defense-in-depth — the controls are already hidden, and rewinding must never
 * desync the world from the transcript (C-490).
 */
export const dispatchDialogueRowAction = (
  target: DialogueRowActionTarget,
  messageId: string,
  action: MessageAction,
): void => {
  const message = findDialogueMessage(target.messages, messageId);
  if (!message) {
    return;
  }

  switch (action) {
    case 'copy':
      void target.copyMessage(message.content);
      return;
    case 'retry':
      // C-490: campaign retry is presentation-only "Rephrase" — it never
      // re-runs NpcStateDelta / quest / command mutations.
      target.rephraseResponse(messageId);
      return;
    case 'speak':
      target.speakMessage(message.content);
      return;
    case 'branch':
      if (target.isCampaignPlay) {
        return;
      }
      target.createBranch({ parentMessageId: messageId });
      return;
    case 'edit':
      if (target.isCampaignPlay) {
        return;
      }
      target.startEdit(messageId);
      return;
    case 'delete':
      if (target.isCampaignPlay) {
        return;
      }
      target.deleteMessage(messageId);
      return;
  }
};

// ── Stage state (tiny sub-VM) ───────────────────────────────────────────

/** Presentation state for one dialogue stage instance. */
export type DialogueStageState = {
  /** Whether the stage is expanded to full view. */
  readonly isFullscreen: boolean;
  /** Whether the header portrait failed to load (fallback is shown). */
  readonly portraitFailed: boolean;
  /** Toggles between the compact stage and full view. */
  toggleFullscreen(): void;
  /** Collapses full view (used by the Escape scope ladder). */
  exitFullscreen(): void;
  /** Records that the header portrait failed to load. */
  markPortraitFailed(): void;
};

/**
 * Creates the per-overlay stage state. Kept here rather than in the production
 * ViewModel: fullscreen and portrait-fallback are pure presentation, and the
 * ViewModel is at its source-size baseline (it may shrink, never grow).
 */
export const createDialogueStageState = (): DialogueStageState => {
  const state = $state<{ isFullscreen: boolean; portraitFailed: boolean }>({
    isFullscreen: false,
    portraitFailed: false,
  });
  return {
    get isFullscreen(): boolean {
      return state.isFullscreen;
    },
    get portraitFailed(): boolean {
      return state.portraitFailed;
    },
    toggleFullscreen(): void {
      state.isFullscreen = !state.isFullscreen;
    },
    exitFullscreen(): void {
      state.isFullscreen = false;
    },
    markPortraitFailed(): void {
      state.portraitFailed = true;
    },
  };
};

// ── Portrait fallback ───────────────────────────────────────────────────

/**
 * Composed fallback initials for a speaker with no usable portrait: the first
 * letter of up to two words, uppercased. A missing name yields a neutral dot so
 * the fallback never renders as empty alt text.
 */
export const initialsFor = (name: string): string => {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
};

// ── Escape scopes ───────────────────────────────────────────────────────

/**
 * The ordered Escape scopes for the dialogue stage. Escape closes exactly ONE
 * of these, from the innermost outward.
 */
export type DialogueEscapeScope =
  | 'delete-confirm'
  | 'slash-autocomplete'
  | 'full-view'
  | 'end-chat';

/** The observable scope flags Escape resolves against. */
export type DialogueEscapeScopes = {
  /** Whether the delete-confirmation modal is open. */
  readonly hasPendingDelete: boolean;
  /** Whether the slash-autocomplete popup is open. */
  readonly hasSlashCompletions: boolean;
  /** Whether the stage is expanded to full view. */
  readonly isFullscreen: boolean;
};

/**
 * Resolves which single scope Escape should close:
 * delete-confirm modal → slash autocomplete → full view → end chat.
 */
export const resolveDialogueEscapeScope = (scopes: DialogueEscapeScopes): DialogueEscapeScope => {
  if (scopes.hasPendingDelete) {
    return 'delete-confirm';
  }
  if (scopes.hasSlashCompletions) {
    return 'slash-autocomplete';
  }
  if (scopes.isFullscreen) {
    return 'full-view';
  }
  return 'end-chat';
};

/** The ViewModel surface the Escape ladder and composer routing need. */
export type DialogueEscapeViewModel = {
  /** The message id pending delete confirmation, or null. */
  readonly pendingDeleteMessageId: string | null;
  /** Whether the slash-autocomplete popup is open. */
  readonly showSlashCompletions: boolean;
  /** The composer textarea, restored after the delete modal closes. */
  readonly inputElement: HTMLTextAreaElement | undefined;
  /** Cancels the pending deletion. */
  cancelDelete(): void;
  /** Confirms the pending deletion. */
  confirmDelete(): void;
  /** Dismisses the slash-autocomplete popup. */
  dismissSlashCompletions(): void;
  /** Ends the conversation. */
  endChat(): void;
};

/** Cancels the delete confirmation and returns focus to the composer. */
export const cancelDeleteAndRefocus = (viewModel: DialogueEscapeViewModel): void => {
  viewModel.cancelDelete();
  viewModel.inputElement?.focus();
};

/** Confirms the delete and returns focus to the composer. */
export const confirmDeleteAndRefocus = (viewModel: DialogueEscapeViewModel): void => {
  viewModel.confirmDelete();
  viewModel.inputElement?.focus();
};

/**
 * Svelte action: focus the node when it mounts. Used to move focus into the
 * delete-confirmation modal as it opens, so Escape is handled inside the modal
 * scope rather than ending the conversation.
 */
export const focusOnMount = (node: HTMLElement): { destroy(): void } => {
  node.focus();
  return {
    destroy(): void {
      // Nothing to clean up — the node is removed with the modal.
    },
  };
};

/**
 * Handles Escape by closing exactly one scope. Returns `true` when the event
 * was an Escape this handler consumed. `stopPropagation()` is essential: the
 * game overlay service also listens for Escape on `window` and would otherwise
 * end the dialogue even when an inner scope should close first.
 */
export const handleDialogueEscape = (
  event: KeyboardEvent,
  viewModel: DialogueEscapeViewModel,
  stage: DialogueStageState,
): boolean => {
  if (event.key !== 'Escape') {
    return false;
  }

  const scope = resolveDialogueEscapeScope({
    hasPendingDelete: viewModel.pendingDeleteMessageId !== null,
    hasSlashCompletions: viewModel.showSlashCompletions,
    isFullscreen: stage.isFullscreen,
  });

  event.preventDefault();
  event.stopPropagation();

  switch (scope) {
    case 'delete-confirm':
      cancelDeleteAndRefocus(viewModel);
      return true;
    case 'slash-autocomplete':
      viewModel.dismissSlashCompletions();
      return true;
    case 'full-view':
      stage.exitFullscreen();
      return true;
    case 'end-chat':
      viewModel.endChat();
      return true;
  }
};

/** The ViewModel surface composer key routing needs (Escape + the VM's keys). */
export type DialogueComposerKeyTarget = DialogueEscapeViewModel & {
  handleKeyDown(event: KeyboardEvent): void;
};

/**
 * Routes a composer keydown: Escape goes through the scope ladder (and never
 * reaches the ViewModel's own Escape → endChat), every other key is delegated
 * to the ViewModel (Enter to send, slash-completion navigation, …).
 */
export const routeComposerKeyDown = (
  event: KeyboardEvent,
  viewModel: DialogueComposerKeyTarget,
  stage: DialogueStageState,
): void => {
  if (handleDialogueEscape(event, viewModel, stage)) {
    return;
  }
  viewModel.handleKeyDown(event);
};
