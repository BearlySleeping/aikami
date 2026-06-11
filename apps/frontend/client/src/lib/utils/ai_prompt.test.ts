// apps/frontend/client/src/lib/utils/ai_prompt.test.ts
import { describe, expect, test } from 'bun:test';
import { buildEmotionTagInstruction, createAIContext, formatCharacterPrompt } from './ai_prompt.ts';

// ---------------------------------------------------------------------------
// AC2: System Prompt Enforcement — emotion tag instruction in LLM payload
// ---------------------------------------------------------------------------

describe('ai_prompt — AC2: System Prompt Emotion Tag Instructions', () => {
  const sampleCharacter = {
    name: 'Elara',
    description: 'A wise elven mage from the Silverwood.',
    personality: 'Calm, thoughtful, protective.',
  };

  test('buildEmotionTagInstruction should include all core emotion values', () => {
    const instruction = buildEmotionTagInstruction();

    // All 10 core emotions should be listed
    expect(instruction).toInclude('`joy`');
    expect(instruction).toInclude('`anger`');
    expect(instruction).toInclude('`sadness`');
    expect(instruction).toInclude('`surprise`');
    expect(instruction).toInclude('`fear`');
    expect(instruction).toInclude('`disgust`');
    expect(instruction).toInclude('`blush`');
    expect(instruction).toInclude('`wink`');
    expect(instruction).toInclude('`pout`');
    expect(instruction).toInclude('`neutral`');
  });

  test('buildEmotionTagInstruction should include tag format instructions', () => {
    const instruction = buildEmotionTagInstruction();

    expect(instruction).toInclude('<emotion:value>');
    expect(instruction).toInclude('Format:');
    expect(instruction).toInclude('Expression Tags');
    expect(instruction).toInclude("character's facial expression");
  });

  test('buildEmotionTagInstruction should warn against using angle brackets for other purposes', () => {
    const instruction = buildEmotionTagInstruction();

    expect(instruction).toInclude('less than');
    expect(instruction).toInclude('greater than');
    expect(instruction).toInclude('Do NOT use angle brackets');
  });

  test('buildEmotionTagInstruction should include example usage', () => {
    const instruction = buildEmotionTagInstruction();

    expect(instruction).toInclude('<emotion:joy>');
    expect(instruction).toInclude('Welcome, traveler');
  });

  test('buildEmotionTagInstruction with custom emotion list', () => {
    const instruction = buildEmotionTagInstruction(['happy', 'sad']);

    expect(instruction).toInclude('`happy`');
    expect(instruction).toInclude('`sad`');
    expect(instruction).not.toInclude('`joy`');
  });

  test('createAIContext should include emotion tag instructions in systemPrompt', () => {
    const context = createAIContext(sampleCharacter, []);

    expect(context.systemPrompt).toInclude('Expression Tags');
    expect(context.systemPrompt).toInclude('<emotion:value>');
    expect(context.systemPrompt).toInclude('Elara');
  });

  test('createAIContext should place emotion instruction after character prompt', () => {
    const context = createAIContext(sampleCharacter, []);

    const charPromptEnd = context.systemPrompt.indexOf('protective.');
    const emotionStart = context.systemPrompt.indexOf('Expression Tags');

    expect(charPromptEnd).toBeGreaterThan(-1);
    expect(emotionStart).toBeGreaterThan(-1);
    expect(emotionStart).toBeGreaterThan(charPromptEnd);
  });

  test('formatCharacterPrompt should NOT include emotion tags (legacy contract)', () => {
    const prompt = formatCharacterPrompt(sampleCharacter);

    // formatCharacterPrompt should remain pure — emotion injection happens
    // at the createAIContext level
    expect(prompt).toInclude('Elara');
    expect(prompt).not.toInclude('Expression Tags');
  });

  test('createAIContext with spatial context should include both spatial + emotion instructions', () => {
    const context = createAIContext(
      sampleCharacter,
      [],
      [
        {
          entityId: 'e1',
          npcId: 'npc-1',
          npcName: 'Guard',
          dialog: 'Halt!',
          interactionRadius: 5,
        },
      ],
    );

    expect(context.systemPrompt).toInclude('Expression Tags');
    expect(context.systemPrompt).toInclude('nearby');
    expect(context.systemPrompt).toInclude('Guard');
  });
});
