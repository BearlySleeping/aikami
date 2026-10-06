// apps/frontend/client/src/lib/utils/journal/conversation_recap.ts
import type { PlayerJournalEntry } from '$types';

/** Reserved tag separates automatic records from player-authored notes. */
export const CONVERSATION_RECAP_TAG = 'conversation-recap';

/** A factual recap never promotes dialogue claims or attempted actions to world facts. */
export const buildConversationRecap = (options: {
  npcName: string;
  messages: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
}): { objective: string; diary: string } | undefined => {
  const lines = options.messages.filter((message) => message.content.trim().length > 0);
  // An authored greeting alone is not a conversation. Extra NPC lines can be
  // executed-action notices (recruitment/combat) without a player utterance.
  if (!lines.some((line) => line.role === 'player') && lines.length < 2) {
    return undefined;
  }
  const name = options.npcName.replace(/\s+/g, ' ').trim().slice(0, 80);
  const relevant = lines[0]?.role === 'npc' ? lines.slice(1) : lines;
  const render = (diary: boolean): string => {
    const heading = diary ? `I talked with ${name}.` : `Talked with ${name}.`;
    const details = relevant.slice(-20).map((line) => {
      const player = diary ? 'I' : 'The player';
      const speaker = line.role === 'npc' ? name : player;
      const text = line.content.replace(/\s+/g, ' ').trim().slice(0, 200);
      return `${speaker} said: “${text}”`;
    });
    return [heading, ...details].join('\n');
  };
  return { objective: render(false), diary: render(true) };
};

/** Validates saved recap prose rather than trusting arbitrary note JSON. */
export const readConversationRecap = (
  entry: PlayerJournalEntry,
):
  | {
      id: string;
      title: string;
      objective: string;
      diary: string;
    }
  | undefined => {
  if (!entry.tags.includes(CONVERSATION_RECAP_TAG)) {
    return undefined;
  }
  try {
    const content: unknown = JSON.parse(entry.content);
    if (
      typeof content !== 'object' ||
      content === null ||
      !('objective' in content) ||
      typeof content.objective !== 'string' ||
      !('diary' in content) ||
      typeof content.diary !== 'string'
    ) {
      return undefined;
    }
    return { id: entry.id, title: entry.title, objective: content.objective, diary: content.diary };
  } catch {
    return undefined;
  }
};
