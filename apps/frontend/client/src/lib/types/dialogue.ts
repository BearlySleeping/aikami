// apps/frontend/client/src/lib/types/dialogue.ts
//
// Domain types for the dialogue overlay — shared by services, ViewModels,
// and the engine bridge. Moved here from dialogue_overlay_view_model.svelte.ts
// so any module can reference them without pulling in ViewModel dependencies.
//
// Extended by C-343: alternative tracking, conversation branching.
// Extended by C-371: free-text-first phases, suggestion chips.

/** A single chat message rendered in the dialogue history. */
export type DialogueMessage = {
  /** Unique identifier for the message (used as Svelte {#each} key). */
  id: string;
  /** The role of the speaker. */
  role: 'player' | 'npc';
  /** The message content text. */
  content: string;
  /** Total number of alternative NPC responses (0 for player, >= 1 for AI). Added by C-343. */
  alternativeCount: number;
  /** Display label for the alternative counter (e.g. "2/3"). Empty string when count <= 1. */
  alternativeLabel: string;
  /** Whether swipe left (previous alternative) is available. */
  canSwipeLeft: boolean;
  /** Whether swipe right (next alternative) is available. */
  canSwipeRight: boolean;
  /** Optional sender display name — when set and different from main NPC, renders on the right. */
  senderName?: string;
};

/** A forked conversation branch starting from a specific message. */
export type ConversationBranch = {
  /** Unique branch identifier. */
  branchId: string;
  /** The message ID this branch forks from. */
  parentMessageId: string;
  /** Messages in this branch (from the fork point onward). */
  messages: DialogueMessage[];
  /** When the branch was created. */
  createdAt: number;
  /** User-editable label ("Alternate path", "Intimidation route", etc.). */
  label?: string;
};

/** A pre-written action option shown in the BG3-style action context menu. */
export type ActionOption = {
  id: string;
  label: string;
  type: 'skill_check' | 'direct_combat' | 'custom';
  skill?: string;
};

/**
 * Phases of the dialogue interaction loop.
 *
 * - `FREE_TEXT`: Default state — free-text input always visible. (C-371)
 * - `DECLARED_DC`: DC declaration shown after intent analysis determines a roll. (C-371)
 * - `DICE`: Dice interactive — roll, animation, reveal. (C-162/C-371)
 * - `CHIPS`: Post-response state — suggestion chips shown below messages. (C-371)
 * - `MENU`: BG3-style action menu. Used when feature flag is off.
 * - `CUSTOM_INPUT`: Freeform text after selecting "Custom" action.
 * - `CHAT`: Standard chat phase.
 */
export type DialoguePhase =
  | 'FREE_TEXT'
  | 'DECLARED_DC'
  | 'DICE'
  | 'CHIPS'
  | 'MENU'
  | 'CUSTOM_INPUT'
  | 'CHAT';

/** Address modes available in the dialogue overlay (Scene and GM only; Party deferred to C-340). */
export type DialogueAddressMode = 'scene' | 'gm';
