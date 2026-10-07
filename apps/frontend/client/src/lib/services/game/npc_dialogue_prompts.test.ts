// apps/frontend/client/src/lib/services/game/npc_dialogue_prompts.test.ts
//
// Regressions for the narrative system prompt's section ORDER (issue #382).
//
// These live beside the module that owns the order rather than in the
// service's test file, because the order is a property of a pure function —
// testing it through a configured service and a mocked transport would make a
// prompt-assembly bug look like a transport bug.

import { describe, expect, test } from 'bun:test';

import { buildNarrativeSystemPrompt, type NarrativePromptContext } from './npc_dialogue_prompts';

/** A projection in the shape a real mid-conversation turn produces. */
const context = (overrides: Partial<NarrativePromptContext> = {}): NarrativePromptContext => ({
  persona: 'Elder Thalia is the keeper of the ward records. Voice: warm but measured.',
  npcName: 'Elder Thalia',
  memory: ['Player: Good day.', 'Elder Thalia: Good day to you.'],
  gameStateFacts: ['Quest active: The Fading Ward', 'Gold: 412'],
  relationshipFacts: [],
  allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'presentEvidence'],
  companionWitnessed: [],
  ...overrides,
});

describe('buildNarrativeSystemPrompt — stable prefix precedes per-turn state', () => {
  test('places the STABLE blocks before the PER-TURN blocks', () => {
    const prompt = buildNarrativeSystemPrompt(context());
    const persona = prompt.indexOf('[NPC CONTEXT]');
    const actions = prompt.indexOf('[ALLOWED ACTIONS]');
    const state = prompt.indexOf('[GAME STATE]');
    const history = prompt.indexOf('[CONVERSATION HISTORY]');

    expect(persona).toBeGreaterThanOrEqual(0);
    expect(actions).toBeGreaterThan(persona);
    // The whole point: a provider prefix cache can only reuse a PREFIX, and
    // `[ALLOWED ACTIONS]` is derived from content-pack capabilities, so it does
    // not change turn to turn. After `[GAME STATE]` it re-transmits every time.
    expect(actions).toBeLessThan(state);
    expect(actions).toBeLessThan(history);
  });

  test('keeps EVERY section — reordering must not remove an instruction', () => {
    const prompt = buildNarrativeSystemPrompt(context());
    for (const section of [
      '[NPC CONTEXT]',
      '[ALLOWED ACTIONS]',
      '[GAME STATE]',
      '[CONVERSATION HISTORY]',
      'Quest active: The Fading Ward',
      'Player: Good day.',
      "Reply with the NPC's spoken narrative ONLY",
      'Stay in character at all times',
      'These are scene context only',
    ]) {
      expect(prompt).toContain(section);
    }
  });

  test('the STABLE prefix is byte-identical across two turns that differ only in state', () => {
    // This is the property the ordering exists for, stated as a fact about the
    // output rather than as an index comparison: everything before the first
    // per-turn section is the same string on both turns.
    const first = buildNarrativeSystemPrompt(context());
    const second = buildNarrativeSystemPrompt(
      context({
        gameStateFacts: ['Quest active: The Deep Road', 'Gold: 9'],
        memory: ['Player: Something else entirely.'],
      }),
    );
    const stableOf = (prompt: string): string => prompt.slice(0, prompt.indexOf('[GAME STATE]'));
    expect(stableOf(second)).toBe(stableOf(first));
  });

  test('an NPC with no allowed actions still renders the section', () => {
    const prompt = buildNarrativeSystemPrompt(context({ allowedCommands: [] }));
    expect(prompt).toContain('these actions available: none.');
  });

  test('relationship and companion-witness sections appear only when populated', () => {
    const bare = buildNarrativeSystemPrompt(context());
    expect(bare).not.toContain('[RELATIONSHIPS]');
    expect(bare).not.toContain('[COMPANION WITNESSED]');

    const full = buildNarrativeSystemPrompt(
      context({
        relationshipFacts: ['Trusts the player (rank 2).'],
        companionWitnessed: ['- The reeve threatened the mill.'],
      }),
    );
    expect(full).toContain('[RELATIONSHIPS]');
    expect(full).toContain('Trusts the player (rank 2).');
    expect(full).toContain('[COMPANION WITNESSED]');
    // And they stay AFTER the stable prefix, so they cannot truncate it.
    expect(full.indexOf('[COMPANION WITNESSED]')).toBeGreaterThan(
      full.indexOf('[ALLOWED ACTIONS]'),
    );
  });
});
