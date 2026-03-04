import { googleAI } from '@genkit-ai/googleai';
import { genkit, z } from 'genkit';

const ai = genkit({
  plugins: [googleAI()],
});

export const ActionSuggestionSchema = z.object({
  aggressive: z.string().describe('An aggressive or confrontational action suggestion'),
  diplomatic: z.string().describe('A diplomatic or peaceful action suggestion'),
  creative: z.string().describe('A creative or unconventional action suggestion'),
});

export type ActionSuggestion = z.infer<typeof ActionSuggestionSchema>;

export const getActionSuggestions = ai.defineFlow(
  {
    name: 'getActionSuggestions',
    inputSchema: z.object({
      lastMessages: z.array(z.string()).describe('The last 5 messages in the conversation'),
      currentSituation: z.string().describe('Current situation description'),
      characterInfo: z.string().describe('Character name and abilities'),
    }),
    outputSchema: ActionSuggestionSchema,
  },
  async ({ lastMessages, currentSituation, characterInfo }) => {
    const messagesText = lastMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n');

    const prompt = `You are a D&D game master. Based on the recent conversation, suggest three different approaches the player could take.

Recent conversation:
${messagesText}

Current situation: ${currentSituation}

Player character: ${characterInfo}

Generate three distinct action suggestions:
1. Aggressive - A confrontational, bold, or combative approach
2. Diplomatic - A peaceful, negotiating, or social approach  
3. Creative - An unconventional, clever, or imaginative approach

Each suggestion should be 1-2 sentences and fit the D&D setting.`;

    const response = await ai.generate(prompt);
    const text = response.text();

    const lines = text.split('\n').filter((line) => line.trim());
    const findByKeyword = (keyword: string): string => {
      const match = lines.find((l) => l.toLowerCase().includes(keyword));
      return match ? match.replace(/^[A-Za-z\s]+:/i, '').trim() : '';
    };

    return {
      aggressive: findByKeyword('aggressive') || 'Attack the enemy head-on',
      diplomatic: findByKeyword('diplomatic') || 'Try to negotiate or reason with them',
      creative: findByKeyword('creative') || 'Find an unconventional solution',
    };
  },
);

export const getActionSuggestionsSimple = (
  lastMessages: string[],
  _currentSituation: string,
  _characterInfo: string,
): ActionSuggestion => {
  const hasCombat = lastMessages.some(
    (msg: string) =>
      msg.toLowerCase().includes('enemy') ||
      msg.toLowerCase().includes('fight') ||
      msg.toLowerCase().includes('attack') ||
      msg.toLowerCase().includes('monster'),
  );

  const hasSocial = lastMessages.some(
    (msg: string) =>
      msg.toLowerCase().includes('talk') ||
      msg.toLowerCase().includes('npc') ||
      msg.toLowerCase().includes('guard') ||
      msg.toLowerCase().includes('merchant'),
  );

  const hasPuzzle = lastMessages.some(
    (msg: string) =>
      msg.toLowerCase().includes('puzzle') ||
      msg.toLowerCase().includes('door') ||
      msg.toLowerCase().includes('trap') ||
      msg.toLowerCase().includes('mysterious'),
  );

  if (hasCombat) {
    return {
      aggressive: 'Launch a surprise attack on the nearest enemy before they can react.',
      diplomatic: 'Attempt to scare them off with a show of force or demand surrender.',
      creative: 'Use the environment to gain advantage - collapse a pillar or start a fire.',
    };
  }

  if (hasSocial) {
    return {
      aggressive: 'Intimidate them by drawing your weapon and making threats.',
      diplomatic: 'Use persuasion to convince them to help you or share information.',
      creative: 'Create a distraction or use deception to achieve your goals.',
    };
  }

  if (hasPuzzle) {
    return {
      aggressive: 'Force your way through - break the mechanism or destroy obstacles.',
      diplomatic: 'Search for clues or hints that might explain the puzzle.',
      creative: 'Look for hidden paths or unconventional solutions around the puzzle.',
    };
  }

  return {
    aggressive: 'Take direct action and pursue your goal aggressively.',
    diplomatic: 'Talk to NPCs and gather information before proceeding.',
    creative: 'Think of an unexpected approach that might yield better results.',
  };
};
