// apps/frontend/client/src/lib/services/npc/npc_background_context.test.ts
import { expect, mock, test } from 'bun:test';
import { createNpcBackgroundContextReader } from './npc_background_context.ts';

test('compiled prompts read only the persona and expose cache snapshots', () => {
  const readGameStateFacts = mock(() => ['Gold: 5']);
  const readPersona = mock(() => 'A gruff cartographer.');
  const context = createNpcBackgroundContextReader({ readGameStateFacts, readPersona });
  const subject = { npcId: 'ivo', npcName: 'Ivo' };
  const initial = context.cacheStats();
  context.digestSystemPrompt(subject);
  context.openerSystemPrompt(subject);
  context.digestSystemPrompt(subject);
  context.openerSystemPrompt(subject);
  expect(readGameStateFacts).not.toHaveBeenCalled();
  expect(readPersona).toHaveBeenCalledTimes(4);
  expect(context.cacheStats()).toMatchObject({ entries: 2, misses: 2, hits: 2 });
  expect(initial).toMatchObject({ entries: 0, misses: 0, hits: 0 });
  expect(context.inputs(subject).gameStateFacts).toEqual(['Gold: 5']);
  expect(readGameStateFacts).toHaveBeenCalledTimes(1);
});
