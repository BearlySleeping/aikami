// packages/shared/types/src/lib/endpoints/chat.ts

/** A single chat message in the character creation DM conversation. */
export type CharacterCreationMessage = {
  role: 'dm' | 'user' | 'system';
  text: string;
};

/** AI-generated character sheet. */
export type CharacterSheet = {
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

/** A single message in the NPC dialogue conversation. */
export type DialogueMessage = {
  role: 'npc' | 'player' | 'system';
  text: string;
};

/**
 * Chat API event types.
 *
 * Each entry maps an event name to a `[Request, Response]` tuple.
 */
export type ChatApiEvents = {
  promptCharacterCreation: [
    {
      messages: CharacterCreationMessage[];
      userMessage: string;
      phase: string;
    },
    {
      reply: string;
      complete: boolean;
      characterJson?: Record<string, unknown>;
    },
  ];
  promptNpcDialogue: [
    {
      npcId: string;
      personaId: string;
      npcName: string;
      playerData: Record<string, unknown>;
      relationshipValue: number;
      messageHistory: DialogueMessage[];
    },
    {
      reply: string;
      relationshipDelta: number;
    },
  ];
};

export type ChatMessageType = keyof ChatApiEvents;

export type ChatMessageData<T extends ChatMessageType = ChatMessageType> = {
  payload: ChatMessagePayload<T>;
  type: T;
};

export type ChatMessagePayload<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][0];

export type ChatMessageResponse<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][1];
