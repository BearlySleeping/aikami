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
  /** Toggles between the compact stage and full view. */
  toggleFullscreen(): void;
};

/**
 * Creates the per-overlay stage state. Kept here rather than in the production
 * ViewModel: fullscreen is pure presentation, and the ViewModel is at its
 * source-size baseline (it may shrink, never grow).
 */
export const createDialogueStageState = (): DialogueStageState => {
  const state = $state<{ isFullscreen: boolean }>({ isFullscreen: false });
  return {
    get isFullscreen(): boolean {
      return state.isFullscreen;
    },
    toggleFullscreen(): void {
      state.isFullscreen = !state.isFullscreen;
    },
  };
};

// ── Escape scopes ───────────────────────────────────────────────────────

/** The confirmation-modal surface an Escape keydown needs. */
export type DialogueEscapeTarget = {
  /** The message id pending delete confirmation, or null. */
  readonly pendingDeleteMessageId: string | null;
  /** Cancels the pending deletion. */
  cancelDelete(): void;
};

/**
 * Escape closes ONE scope at a time. The composer's own keydown handler
 * dismisses the slash-autocomplete popup and then ends the chat; this handler
 * covers the delete-confirmation modal, which owns focus while it is open, so
 * Escape cancels the deletion instead of tearing down the whole conversation.
 */
export const createStageEscapeHandler =
  (target: DialogueEscapeTarget) =>
  (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && target.pendingDeleteMessageId) {
      event.preventDefault();
      target.cancelDelete();
    }
  };
