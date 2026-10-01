// apps/frontend/client/src/lib/services/npc/npc_prompt_projection.test.ts
//
// Regressions for issue #382's context-reuse lane.
//
// Every test here fails against the pre-change behaviour unless it is a
// pure-invariant test. The point of each case is stated in its name, so a
// failure says which property broke rather than only which assertion did.

import { describe, expect, test } from 'bun:test';

import { buildGameStateFacts } from '../game/game_state_facts';
import {
  buildBackgroundWorldStateProjection,
  createNpcPromptCache,
  digestSystemPromptKey,
  openerSystemPromptKey,
  renderBackgroundFacts,
} from './npc_prompt_projection.ts';

/** Whether the production projection keeps this fact. */
const isProjected = (fact: string): boolean =>
  buildBackgroundWorldStateProjection([fact]).length === 1;

// A dialogue-grade fact list in the exact shape `buildGameStateFacts` emits.
const DIALOGUE_FACTS: string[] = [
  'Gold: 412',
  'Inventory: Ward Wand x1, Lantern (oil) x3, Cracked Seal',
  "Equipped: Ward Wand (main hand), Traveller's Cloak (chest)",
  'Active quest: "The Faded Stone" — next objective: Reach the mill before dusk',
  'Hint (easy mode only): the player needs "Ward Wand".',
  'Offerable quests: "A Debt Repaid" (id: debt_repaid) — elder_thalia can offer these.',
  'Game difficulty: easy. be very direct — openly name the item, person, and location the player needs (e.g. "Rollo at the inn has the Ward Wand"). NPCs volunteer helpful directions unprompted.',
  'Relationship: Elder Thalia trusts the player (rank 2).',
];

describe('background world-state projection', () => {
  test('a bounded background memory task is NOT given the GM guidance paragraph', () => {
    const projected = buildBackgroundWorldStateProjection(DIALOGUE_FACTS);
    expect(projected.some((fact) => fact.startsWith('Game difficulty:'))).toBe(false);
  });

  test('a bounded background memory task is NOT given the equipped-items list', () => {
    const projected = buildBackgroundWorldStateProjection(DIALOGUE_FACTS);
    expect(projected.some((fact) => fact.startsWith('Equipped:'))).toBe(false);
  });

  test('a bounded background memory task is NOT given the easy-mode item hint', () => {
    const projected = buildBackgroundWorldStateProjection(DIALOGUE_FACTS);
    expect(projected.some((fact) => fact.startsWith('Hint ('))).toBe(false);
  });

  test('the required facts survive, so a digest still knows what the player carries', () => {
    const projected = buildBackgroundWorldStateProjection(DIALOGUE_FACTS);
    expect(projected).toContain('Gold: 412');
    expect(projected.some((fact) => fact.startsWith('Inventory:'))).toBe(true);
    expect(projected.some((fact) => fact.startsWith('Active quest:'))).toBe(true);
    expect(projected.some((fact) => fact.startsWith('Offerable quests:'))).toBe(true);
  });

  test('relationship standing survives — a memory that forgets trust is a worse memory', () => {
    const projected = buildBackgroundWorldStateProjection(DIALOGUE_FACTS);
    expect(projected.some((fact) => fact.startsWith('Relationship:'))).toBe(true);
  });

  test('order is preserved, so a caller sees only removals', () => {
    const head = (fact: string): string => fact.split(':')[0] ?? '';
    expect(buildBackgroundWorldStateProjection(DIALOGUE_FACTS).map(head)).toEqual(
      DIALOGUE_FACTS.filter(isProjected).map(head),
    );
  });

  test('a fact the lane has never seen is still classified by its FAMILY', () => {
    // The exclusion matches a PREFIX, not a whole string, so a new value of a
    // known dialogue-only family is still dropped. This is the case that fails
    // if the exclusion is ever rewritten as an allow-list of exact strings —
    // and it is why these prefixes are spelled out here rather than imported:
    // the list IS the contract, and a test that read it back from the module
    // would agree with any rewrite of it.
    for (const prefix of ['Game difficulty:', 'Equipped:', 'Hint (easy mode only):']) {
      expect(isProjected(`${prefix} a value nobody has seen`)).toBe(false);
    }
  });

  test('an unknown future fact is INCLUDED, because guessing it is dialogue-only is the worse error', () => {
    expect(isProjected('Reputation with the reeve: 4')).toBe(true);
  });

  test('the real production fact list projects to fewer characters than it did', () => {
    // The live builder, not a fixture: this is the assertion that the saving
    // exists at all on the code that actually runs.
    const facts = buildGameStateFacts({ npcId: 'nobody' });
    const before = facts.join('\n').length;
    const after = buildBackgroundWorldStateProjection(facts).join('\n').length;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });
});

describe('renderBackgroundFacts', () => {
  test('an empty projection renders as unknown rather than as an empty section', () => {
    expect(renderBackgroundFacts([])).toBe('(unknown)');
  });

  test('truncation is OBSERVABLE in the rendered text', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Lore fact ${i}: ${'x'.repeat(80)}`);
    const rendered = renderBackgroundFacts(long);
    expect(rendered).toContain('omitted for length');
  });

  test('required facts are protected from the budget', () => {
    // A pathological optional list must not be able to push the gold line out.
    const optional = Array.from({ length: 60 }, (_, i) => `Noise ${i}: ${'y'.repeat(80)}`);
    const rendered = renderBackgroundFacts(['Gold: 7', 'Inventory: nothing', ...optional]);
    expect(rendered).toContain('Gold: 7');
    expect(rendered).toContain('Inventory: nothing');
    expect(rendered).toContain('omitted for length');
  });

  test('nothing is truncated when everything fits', () => {
    expect(renderBackgroundFacts(['Gold: 1', 'Inventory: nothing'])).not.toContain('omitted');
  });
});

describe('compiled prompt cache', () => {
  test('a repeated key compiles ONCE', () => {
    const cache = createNpcPromptCache();
    let compiles = 0;
    const compile = (): string => {
      compiles += 1;
      return 'compiled block';
    };
    for (let i = 0; i < 10; i += 1) {
      expect(cache.get('k', compile).text).toBe('compiled block');
    }
    expect(compiles).toBe(1);
    expect(cache.stats().hits).toBe(9);
  });

  test('a different key is a miss, not a stale hit', () => {
    const cache = createNpcPromptCache();
    expect(cache.get('a', () => 'first').text).toBe('first');
    expect(cache.get('b', () => 'second').text).toBe('second');
    expect(cache.get('a', () => 'SHOULD NOT COMPILE').text).toBe('first');
  });

  test('a hash collision does NOT serve the wrong block', () => {
    // The key is the FULL content, compared exactly. A 32-bit prefix narrows
    // the lookup; it never decides the answer. Two personas that collide in
    // FNV-1a must still compile separately.
    //
    // The bound is generous on purpose: this case is about KEY CORRECTNESS, and
    // an entry eviction would make it pass for the wrong reason (a recompile
    // returns the right text whether or not the key was sound). Eviction has
    // its own case below.
    const cache = createNpcPromptCache({ maxEntries: 1000 });
    const personas = ['a'.repeat(1), 'b'.repeat(1), 'ab', 'ba', 'aab', 'aba'];
    for (const persona of personas) {
      cache.get(digestSystemPromptKey(persona, 'Thalia'), () => `persona:${persona}`);
    }
    expect(cache.stats().misses).toBe(personas.length);
    for (const persona of personas) {
      expect(cache.get(digestSystemPromptKey(persona, 'Thalia'), () => 'WRONG').text).toBe(
        `persona:${persona}`,
      );
    }
  });

  test('the entry-count bound evicts the LEAST RECENTLY USED entry', () => {
    const cache = createNpcPromptCache({ maxEntries: 2 });
    cache.get('a', () => 'A');
    cache.get('b', () => 'B');
    cache.get('a', () => 'MUST NOT COMPILE');
    cache.get('c', () => 'C');
    // 'b' was least recently used once 'a' was refreshed, so 'b' is gone.
    expect(cache.get('b', () => 'B-again').text).toBe('B-again');
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });

  test('the size bound evicts even when the entry count is not reached', () => {
    const cache = createNpcPromptCache({ maxEntries: 1000, maxChars: 100 });
    cache.get('a', () => 'x'.repeat(80));
    cache.get('b', () => 'y'.repeat(80));
    expect(cache.stats().entries).toBe(1);
  });

  test('an entry larger than the whole budget is still returned to its caller', () => {
    const cache = createNpcPromptCache({ maxEntries: 10, maxChars: 10 });
    expect(cache.get('huge', () => 'z'.repeat(500)).text).toHaveLength(500);
  });

  test('clear() drops every entry and zeroes the counters', () => {
    const cache = createNpcPromptCache();
    cache.get('a', () => 'A');
    cache.get('a', () => 'MUST NOT COMPILE');
    cache.clear();
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, evictions: 0, entries: 0, chars: 0 });
    expect(cache.get('a', () => 'A2').text).toBe('A2');
  });

  test('the stats carry no prompt text', () => {
    const cache = createNpcPromptCache();
    cache.get('k', () => 'a secret persona');
    const serialized = JSON.stringify(cache.stats());
    expect(serialized).not.toContain('secret');
  });
});

describe('prompt cache keys', () => {
  test('a different persona is a different key', () => {
    expect(digestSystemPromptKey('A', 'Thalia')).not.toBe(digestSystemPromptKey('B', 'Thalia'));
  });

  test('a different NPC name is a different key', () => {
    expect(digestSystemPromptKey('A', 'Thalia')).not.toBe(digestSystemPromptKey('A', 'Rollo'));
  });

  test('namespaces never collide across block kinds', () => {
    expect(digestSystemPromptKey('A', 'B')).not.toBe(openerSystemPromptKey('A', 'B'));
  });

  test('a boundary-ambiguous pair is still two different keys', () => {
    // Naive separator joining would make these equal.
    expect(digestSystemPromptKey('a|b', 'c')).not.toBe(digestSystemPromptKey('a', 'b|c'));
    expect(openerSystemPromptKey('a|b', 'c')).not.toBe(openerSystemPromptKey('a', 'b|c'));
  });
});
