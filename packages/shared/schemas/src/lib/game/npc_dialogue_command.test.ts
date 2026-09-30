// packages/shared/schemas/src/lib/game/npc_dialogue_command.test.ts
//
// Negative + positive fixtures for the NPC dialogue command protocol.
// Model output is untrusted — these tests prove unknown kinds, extra
// fields, and out-of-range values are rejected (C-328 AC-2).

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  NpcDialogueAiEnvelopeSchema,
  NpcDialogueChoiceSchema,
  NpcDialogueCommandSchema,
  NpcDialogueExtractionSchema,
  NpcDialogueTurnSchema,
} from './npc_dialogue_command.ts';

describe('NpcDialogueCommandSchema', () => {
  test('accepts every valid command variant', () => {
    const valid = [
      { kind: 'trade' },
      { kind: 'offerQuest', questId: 'fading_ward' },
      { kind: 'skillCheck', skill: 'Persuasion', difficultyClass: 12 },
      { kind: 'skillCheck', skill: 'Intimidation', difficultyClass: 5 },
      { kind: 'skillCheck', skill: 'Sleight_of_Hand', difficultyClass: 20 },
      { kind: 'giveItem', itemId: 'wardShard', quantity: 1 },
      { kind: 'startCombat' },
      { kind: 'startCombat', encounterId: 'ruined_ward_encounter' },
      { kind: 'presentEvidence', evidenceId: 'the_ledger' },
    ];
    for (const command of valid) {
      expect(Value.Check(NpcDialogueCommandSchema, command)).toBe(true);
    }
  });

  test('rejects unknown kind values', () => {
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'teleport' })).toBe(false);
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'give_item', itemId: 'x' })).toBe(false);
  });

  test('rejects extra/unknown fields (additionalProperties: false)', () => {
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'trade', discount: 100 })).toBe(false);
    expect(
      Value.Check(NpcDialogueCommandSchema, {
        kind: 'giveItem',
        itemId: 'wardShard',
        quantity: 1,
        gold: 9999,
      }),
    ).toBe(false);
  });

  test('rejects skillCheck DC outside 5–20', () => {
    expect(
      Value.Check(NpcDialogueCommandSchema, {
        kind: 'skillCheck',
        skill: 'Persuasion',
        difficultyClass: 4,
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcDialogueCommandSchema, {
        kind: 'skillCheck',
        skill: 'Persuasion',
        difficultyClass: 21,
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcDialogueCommandSchema, {
        kind: 'skillCheck',
        skill: 'Acrobatics',
        difficultyClass: 10,
      }),
    ).toBe(false);
  });

  test('rejects giveItem with quantity < 1 or missing fields', () => {
    expect(
      Value.Check(NpcDialogueCommandSchema, { kind: 'giveItem', itemId: 'x', quantity: 0 }),
    ).toBe(false);
    expect(
      Value.Check(NpcDialogueCommandSchema, { kind: 'giveItem', itemId: '', quantity: 1 }),
    ).toBe(false);
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'giveItem', quantity: 1 })).toBe(false);
  });

  test('rejects offerQuest without questId', () => {
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'offerQuest' })).toBe(false);
    expect(Value.Check(NpcDialogueCommandSchema, { kind: 'offerQuest', questId: '' })).toBe(false);
  });

  test('rejects non-object payloads', () => {
    expect(Value.Check(NpcDialogueCommandSchema, 'trade')).toBe(false);
    expect(Value.Check(NpcDialogueCommandSchema, undefined)).toBe(false);
    expect(Value.Check(NpcDialogueCommandSchema, 42)).toBe(false);
  });
});

describe('NpcDialogueChoiceSchema', () => {
  test('accepts conversational and command choices', () => {
    expect(Value.Check(NpcDialogueChoiceSchema, { id: 'talk', label: 'Ask around' })).toBe(true);
    expect(
      Value.Check(NpcDialogueChoiceSchema, {
        id: 'trade',
        label: 'Trade',
        command: { kind: 'trade' },
      }),
    ).toBe(true);
    expect(
      Value.Check(NpcDialogueChoiceSchema, {
        id: 'more',
        label: 'Tell me more',
        nextDialogueKey: 'elder_thalia_offer',
      }),
    ).toBe(true);
  });

  test('rejects empty labels, extra fields, and invalid commands', () => {
    expect(Value.Check(NpcDialogueChoiceSchema, { id: 'x', label: '' })).toBe(false);
    expect(Value.Check(NpcDialogueChoiceSchema, { id: 'x', label: 'ok', onClick: 'evil' })).toBe(
      false,
    );
    expect(
      Value.Check(NpcDialogueChoiceSchema, { id: 'x', label: 'ok', command: { kind: 'nuke' } }),
    ).toBe(false);
  });
});

describe('NpcDialogueTurnSchema', () => {
  const baseTurn = {
    narrative: 'The elder nods slowly.',
    choices: [
      { id: 'talk', label: 'Ask about the ward' },
      { id: 'leave', label: 'Leave' },
    ],
    source: 'authored',
  };

  test('accepts a valid authored turn', () => {
    expect(Value.Check(NpcDialogueTurnSchema, baseTurn)).toBe(true);
  });

  test('accepts an AI turn with a command', () => {
    expect(
      Value.Check(NpcDialogueTurnSchema, {
        ...baseTurn,
        source: 'ai',
        command: { kind: 'offerQuest', questId: 'fading_ward' },
      }),
    ).toBe(true);
  });

  test('rejects more than 4 choices', () => {
    const choices = Array.from({ length: 5 }, (_, index) => ({
      id: `c${index}`,
      label: `Choice ${index}`,
    }));
    expect(Value.Check(NpcDialogueTurnSchema, { ...baseTurn, choices })).toBe(false);
  });

  test('rejects unknown source and extra fields', () => {
    expect(Value.Check(NpcDialogueTurnSchema, { ...baseTurn, source: 'plugin' })).toBe(false);
    expect(Value.Check(NpcDialogueTurnSchema, { ...baseTurn, sideEffects: [] })).toBe(false);
  });
});

describe('NpcDialogueAiEnvelopeSchema', () => {
  test('accepts narrative-only output', () => {
    expect(Value.Check(NpcDialogueAiEnvelopeSchema, { narrative: 'Hello there.' })).toBe(true);
  });

  test('accepts narrative + command + choices', () => {
    expect(
      Value.Check(NpcDialogueAiEnvelopeSchema, {
        narrative: 'Take this.',
        command: { kind: 'giveItem', itemId: 'wardShard', quantity: 1 },
        choices: [{ id: 'thanks', label: 'Thank you' }],
      }),
    ).toBe(true);
  });

  test('rejects empty narrative, unknown fields, and invalid commands', () => {
    expect(Value.Check(NpcDialogueAiEnvelopeSchema, { narrative: '' })).toBe(false);
    expect(Value.Check(NpcDialogueAiEnvelopeSchema, { narrative: 'x', systemPrompt: 'leak' })).toBe(
      false,
    );
    expect(
      Value.Check(NpcDialogueAiEnvelopeSchema, {
        narrative: 'x',
        command: { kind: 'giveItem', itemId: 'anything', quantity: -5 },
      }),
    ).toBe(false);
  });
});

describe('NpcDialogueExtractionSchema (C-401 call 2)', () => {
  test('accepts an empty object — no command and no choices is a valid outcome', () => {
    expect(Value.Check(NpcDialogueExtractionSchema, {})).toBe(true);
  });

  test('accepts command-only and choices-only output', () => {
    expect(
      Value.Check(NpcDialogueExtractionSchema, {
        command: { kind: 'giveItem', itemId: 'wardShard', quantity: 1 },
      }),
    ).toBe(true);
    expect(
      Value.Check(NpcDialogueExtractionSchema, { choices: [{ id: 'thanks', label: 'Thank you' }] }),
    ).toBe(true);
  });

  test('does NOT accept a narrative — call 2 must not regenerate call-1 prose', () => {
    // The whole point of the call-2 schema: the narrative was already streamed
    // by call 1, and asking the model to return it again spent the budget
    // (issue #382). A response carrying one is malformed here, not salvaged.
    expect(Value.Check(NpcDialogueExtractionSchema, { narrative: 'Hello there.' })).toBe(false);
    expect(
      Value.Check(NpcDialogueExtractionSchema, { narrative: 'x', command: { kind: 'skillCheck' } }),
    ).toBe(false);
  });

  test('rejects unknown fields and invalid command payloads', () => {
    expect(
      Value.Check(NpcDialogueExtractionSchema, {
        command: { kind: 'skillCheck' },
        systemPrompt: 'leak',
      }),
    ).toBe(false);
    expect(
      Value.Check(NpcDialogueExtractionSchema, {
        command: { kind: 'giveItem', itemId: 'anything', quantity: -5 },
      }),
    ).toBe(false);
  });

  test('enforces the schema-level choice bound of 4', () => {
    const four = Array.from({ length: 4 }, (_, index) => ({ id: `c${index}`, label: `L${index}` }));
    expect(Value.Check(NpcDialogueExtractionSchema, { choices: four })).toBe(true);
    expect(
      Value.Check(NpcDialogueExtractionSchema, { choices: [...four, { id: 'c4', label: 'L4' }] }),
    ).toBe(false);
  });

  test('the legacy envelope schema is unchanged and still requires a narrative', () => {
    // Compatibility guard: option B is additive, so the old shape must keep
    // behaving exactly as it did for any other (future) consumer.
    expect(Value.Check(NpcDialogueAiEnvelopeSchema, { narrative: 'x' })).toBe(true);
    expect(Value.Check(NpcDialogueAiEnvelopeSchema, {})).toBe(false);
  });
});
