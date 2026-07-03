// apps/frontend/client/src/lib/types/dialogue.ts
//
// Domain types for the dialogue overlay — shared by services, ViewModels,
// and the engine bridge. Moved here from dialogue_overlay_view_model.svelte.ts
// so any module can reference them without pulling in ViewModel dependencies.

/** A single chat message rendered in the dialogue history. */
export type DialogueMessage = {
  /** Unique identifier for the message (used as Svelte {#each} key). */
  id: string;
  /** The role of the speaker. */
  role: 'player' | 'npc';
  /** The message content text. */
  content: string;
};

/** A pre-written action option shown in the BG3-style action context menu. */
export type ActionOption = {
  id: string;
  label: string;
  type: 'skill_check' | 'direct_combat' | 'custom';
  skill?: string;
};

/** Phases of the dialogue interaction loop. */
export type DialoguePhase = 'MENU' | 'CUSTOM_INPUT' | 'DICE' | 'CHAT';
