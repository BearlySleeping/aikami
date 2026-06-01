// packages/shared/types/src/lib/api/callable_functions.ts
// biome-ignore-all lint/style/useNamingConvention: Firestack derives Cloud Function names from file names, which must be snake_case. Keys in this type map match those file names.

import type { ChatMessageData, ChatMessageResponse } from './chat.ts';

/** A single chat message in the character creation DM conversation. */
type CharacterCreationMessage = {
  role: 'dm' | 'user' | 'system';
  text: string;
};

/** Input for the promptCharacterCreation callable. */
type CharacterCreationInput = {
  messages: CharacterCreationMessage[];
  userMessage: string;
  phase: string;
};

/** AI-generated character sheet. */
type CharacterSheet = {
  name: string;
  race: string;
  class: string;
  level: number;
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  appearanceDescription: string;
  background: string;
  alignment: string;
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
};

/** Output from the promptCharacterCreation callable. */
type CharacterCreationOutput = {
  reply: string;
  complete: boolean;
  characterJson?: CharacterSheet;
};

// ---------------------------------------------------------------------------
// promptNpcDialogue
// ---------------------------------------------------------------------------

/** A single message in the NPC dialogue conversation. */
type DialogueMessage = {
  role: 'npc' | 'player' | 'system';
  text: string;
};

/** Input for the promptNpcDialogue callable. */
type PromptNpcDialogueInput = {
  npcId: string;
  personaId: string;
  npcName: string;
  playerData: Record<string, unknown>;
  relationshipValue: number;
  messageHistory: DialogueMessage[];
};

/** Output from the promptNpcDialogue callable. */
type PromptNpcDialogueOutput = {
  reply: string;
  relationshipDelta: number;
};

/**
 * All registered callable functions. Each key maps to [Payload, Response].
 * Add new callables here to get full type safety in the onCall handler.
 *
 * No index signature — this ensures that `CallableFunctions['landing_chat']`
 * resolves to the exact `[LandingChatRequest, LandingChatResponse]` tuple,
 * not `unknown`.
 */
export type CallableFunctions = {
  chat: [ChatMessageData, ChatMessageResponse];
  promptCharacterCreation: [CharacterCreationInput, CharacterCreationOutput];
  promptNpcDialogue: [PromptNpcDialogueInput, PromptNpcDialogueOutput];
};

export type CallableFunction = keyof CallableFunctions;
export type CallableFunctionRequest<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][0];
export type CallableFunctionResponse<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][1];
