/** biome-ignore-all lint/style/useNamingConvention: Character card format uses snake_case fields */
// apps/frontend/pwa/src/lib/utils/ai_prompt.ts

// ---------------------------------------------------------------------------
// Core emotions that the LLM may emit as <emotion:value> tags (AC2).
//
// Must match the EXPRESSION_MAP keys in
// packages/frontend/engine/src/components/appearance.ts
// so the expression system can resolve them.
// ---------------------------------------------------------------------------

const CORE_EMOTIONS = [
  'neutral',
  'joy',
  'anger',
  'sadness',
  'surprise',
  'fear',
  'disgust',
  'blush',
  'wink',
  'pout',
] as const;

/**
 * Builds the emotion tag instruction string for the system prompt.
 *
 * Tells the LLM exactly when and how to emit `<emotion:value>` tags
 * so the StreamOrchestrator can extract them invisibly from the SSE
 * stream and drive the hybrid expression pipeline.
 *
 * @param emotions — The list of allowed emotion values.
 * @returns A string to append to the system prompt.
 */
export const buildEmotionTagInstruction = (emotions: readonly string[] = CORE_EMOTIONS): string => {
  const list = emotions.map((e) => `\`${e}\``).join(', ');
  return [
    '',
    '## Expression Tags',
    "You control the character's facial expression using inline tags.",
    "When the character's emotion changes, emit a tag at the exact moment:",
    '',
    'Format: `<emotion:value>`',
    '',
    `Allowed values: ${list}`,
    '',
    'Rules:',
    '- Place the tag at the exact point the emotion shifts.',
    '- Only emit a tag when the emotion actually changes — do not repeat the same tag consecutively.',
    '- The tag is invisible to the player — it only drives visuals.',
    '- Do NOT use angle brackets `<` or `>` for any other purpose in your response.',
    '- If you need to express "less than" or "greater than", use words ("less than", "greater than").',
    '',
    'Example:',
    '`<emotion:joy> Welcome, traveler! It is so good to see you.`',
  ].join('\n');
};

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
 * Data shape for an active spatial context entry injected into the prompt.
 */
export type SpatialContextEntry = {
  entityId: string;
  npcId: string;
  npcName: string;
  dialog: string;
  interactionRadius: number;
};

/**
 * Builds a system prompt segment from a list of active spatial contexts.
 *
 * Serializes active_contexts as JSON and wraps it in a descriptive
 * instruction so the AI understands the player's current surroundings.
 *
 * @param activeContexts - Array of context entries the player is near.
 * @returns A string to append to the system prompt, or empty string.
 */
export function buildSpatialContextPrompt(activeContexts: SpatialContextEntry[]): string {
  if (activeContexts.length === 0) {
    return '';
  }

  const contexts = activeContexts.map((ctx) => ({
    nearby: ctx.npcName,
    // eslint-disable-next-line perfectionist/sort-objects -- intentionally in order of significance
    context: ctx.dialog,
  }));

  return (
    `

The player is currently near the following characters or points of interest:
${JSON.stringify(contexts, null, 2)}
` +
    'Use this spatial context to inform your responses. ' +
    'Reference nearby characters naturally when relevant.'
  );
}

/**
 * Creates a complete prompt context for the AI including
 * system prompt, spatial context, and conversation history.
 *
 * @param character - The character data to format.
 * @param messages - The conversation history.
 * @param activeContexts - Optional spatial context entries to inject.
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
  activeContexts?: SpatialContextEntry[],
): {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let systemPrompt = formatCharacterPrompt(character);

  // Inject emotion tag instructions so the LLM emits <emotion:value>
  // tags that the StreamOrchestrator intercepts invisibly (AC2)
  systemPrompt += buildEmotionTagInstruction();

  if (activeContexts && activeContexts.length > 0) {
    systemPrompt += buildSpatialContextPrompt(activeContexts);
  }

  return {
    systemPrompt,
    messages: formatChatHistory(messages),
  };
}
