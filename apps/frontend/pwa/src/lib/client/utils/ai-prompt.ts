/**
 * Formats a character/NPC into a system prompt for AI conversations.
 * Creates a detailed prompt that includes the character's personality,
 * background, and speaking style.
 */
export function formatCharacterPrompt(character: {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
}): string {
  const parts: string[] = [];

  parts.push(`You are ${character.name}.`);

  if (character.description) {
    parts.push(`\n\nDescription: ${character.description}`);
  }

  if (character.personality) {
    parts.push(`\nPersonality: ${character.personality}`);
  }

  if (character.scenario) {
    parts.push(`\nScenario: ${character.scenario}`);
  }

  if (character.system_prompt) {
    parts.push(`\n\nSystem Instructions: ${character.system_prompt}`);
  }

  if (character.mes_example) {
    parts.push(`\n\nExample of how you speak: ${character.mes_example}`);
  }

  if (character.post_history_instructions) {
    parts.push(`\n\nRemember: ${character.post_history_instructions}`);
  }

  if (character.creator_notes) {
    parts.push(`\n\nNote from creator: ${character.creator_notes}`);
  }

  return parts.join('');
}

/**
 * Formats chat history into AI message format.
 * Converts stored messages into the format expected by AI providers.
 */
export function formatChatHistory(
  messages: Array<{ text: string; sender: 'user' | 'ai'; timestamp?: Date }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((msg) => ({
    role: msg.sender === 'user' ? ('user' as const) : ('assistant' as const),
    content: msg.text,
  }));
}

/**
 * Creates a complete prompt context for the AI including
 * system prompt and conversation history.
 */
export function createAIContext(
  character: {
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
  },
  messages: Array<{ text: string; sender: 'user' | 'ai'; timestamp?: Date }>,
): {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  return {
    systemPrompt: formatCharacterPrompt(character),
    messages: formatChatHistory(messages),
  };
}
