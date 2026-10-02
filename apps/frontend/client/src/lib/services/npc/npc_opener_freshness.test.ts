// apps/frontend/client/src/lib/services/npc/npc_opener_freshness.test.ts
//
// The pure half of opener freshness: may this prepared greeting still be shown?
//
// Split from the service-level suite on purpose. The service tests prove the
// BEHAVIOUR (a refusal degrades to the authored line, ten consumptions cost
// zero calls, a 91-second wait cannot cross-write a campaign). These prove the
// DECISION, exhaustively, including the cases gameplay never produces —
// a record with no opener, an opener belonging to an older conversation —
// which are exactly the ones a service-level test can only reach awkwardly.
//
// Age appears in exactly one test, and it asserts that age is NOT a rejection
// reason. That is the load-bearing boundary in this file: the previous code had
// one boolean for "expired" and one for "no longer true", and every regression
// in this area came from treating them as the same question.

import { describe, expect, it } from 'bun:test';
import type { NpcMemoryRecord } from '@aikami/types';
import { type OpenerInputs, revalidateOpener } from './npc_opener_freshness.ts';

const NOW: OpenerInputs = { worldFingerprint: 'w1', promptRevision: 'p1' };

const record = (overrides?: Partial<NpcMemoryRecord>): NpcMemoryRecord => ({
  npcId: 'ivo',
  npcName: 'Ivo',
  conversationCount: 3,
  lastTalkedAt: 0,
  summary: '',
  notes: [],
  lastExchange: [],
  opener: {
    text: 'Back already? Did the ridge hold up?',
    suggestions: [],
    generatedAt: 0,
    forConversation: 3,
    worldFingerprint: 'w1',
    promptRevision: 'p1',
  },
  ...overrides,
});

describe('revalidateOpener', () => {
  it('accepts an opener whose world and persona are unchanged', () => {
    expect(revalidateOpener(record(), NOW)).toBeUndefined();
  });

  it('rejects a record with no opener at all', () => {
    expect(revalidateOpener(record({ opener: undefined }), NOW)).toBe('no-opener');
  });

  it('rejects an opener prepared for an EARLIER conversation', () => {
    // The conversation it was written for has already happened. A recent
    // `generatedAt` does not make it relevant to this one.
    const stale = record({
      conversationCount: 4,
      opener: { ...record().opener, forConversation: 3, generatedAt: Date.now() },
    });
    expect(stale.opener?.generatedAt).toBeGreaterThan(0);
    expect(revalidateOpener(stale, NOW)).toBe('wrong-conversation');
  });

  it('rejects when the world state moved on', () => {
    expect(revalidateOpener(record(), { worldFingerprint: 'w2', promptRevision: 'p1' })).toBe(
      'world-moved-on',
    );
  });

  it('rejects when the persona or prompt template moved on', () => {
    // Byte-identical world. The only thing that changed is the voice, and the
    // world fingerprint cannot see it.
    expect(revalidateOpener(record(), { worldFingerprint: 'w1', promptRevision: 'p2' })).toBe(
      'prompt-revised',
    );
  });

  it('rejects a save that predates the stamps, because it cannot be checked', () => {
    const legacy = record({
      opener: { ...record().opener, promptRevision: undefined },
    });
    expect(revalidateOpener(legacy, NOW)).toBe('world-moved-on');
    const older = record({
      opener: { ...record().opener, worldFingerprint: undefined },
    });
    expect(revalidateOpener(older, NOW)).toBe('world-moved-on');
  });

  it('does NOT reject on age alone', () => {
    // The max age bounds how often memory is looked at, not whether the answer
    // became wrong. An old-but-current greeting is still the right line, and
    // re-asking the provider for it would be a full call spent on a
    // byte-identical prompt.
    const old = record({ opener: { ...record().opener, generatedAt: 0 } });
    expect(old.opener?.generatedAt).toBe(0);
    expect(revalidateOpener(old, NOW)).toBeUndefined();
  });

  it('checks the world before the persona, so the reported cause is the first thing that moved', () => {
    // Both moved. The world is the cheaper fact to have changed and the more
    // actionable one, and a reader acting on "the author rewrote my shopkeeper"
    // when the quest actually completed has been told the wrong thing.
    expect(revalidateOpener(record(), { worldFingerprint: 'w2', promptRevision: 'p2' })).toBe(
      'world-moved-on',
    );
  });
});
