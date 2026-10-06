// apps/frontend/client/src/lib/services/npc/conversation_recap.test.ts
import { describe, expect, test } from 'bun:test';
import { buildConversationRecap } from '$lib/utils/journal/conversation_recap.ts';

const messages = [
  { role: 'npc', content: 'Welcome, traveller.' },
  { role: 'player', content: 'Where is the tavern?' },
  { role: 'npc', content: 'There is a tavern near the road.' },
  { role: 'player', content: '*I try to steal her purse*' },
  { role: 'npc', content: '*Your attempt failed.*' },
] as const;

describe('factual conversation recap', () => {
  test('records replies and actions, attributes attempts, and changes voice without changing facts', () => {
    const recap = buildConversationRecap({ npcName: 'Ana', messages });
    expect(recap?.objective).toContain('Ana said: “There is a tavern near the road.”');
    expect(recap?.objective).toContain('The player said: “*I try to steal her purse*”');
    expect(recap?.objective).toContain('Ana said: “*Your attempt failed.*”');
    expect(recap?.diary).toContain('I talked with Ana.');
    expect(recap?.diary).toContain('I said: “Where is the tavern?”');
    expect(recap?.diary).not.toContain('I stole');
    expect(recap?.objective).not.toContain('Welcome, traveller');
  });

  test('greeting-only is empty, action-only executed notices are retained', () => {
    expect(
      buildConversationRecap({ npcName: 'Ana', messages: messages.slice(0, 1) }),
    ).toBeUndefined();
    expect(
      buildConversationRecap({
        npcName: 'Ana',
        messages: [messages[0], { role: 'npc', content: '*Ana has joined your party!*' }],
      })?.objective,
    ).toContain('joined your party');
  });
});
