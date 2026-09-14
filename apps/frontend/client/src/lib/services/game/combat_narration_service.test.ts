// apps/frontend/client/src/lib/services/game/combat_narration_service.test.ts
//
// C-526 AC-11: outcome narration is facts-only, bounded, and degrades to
// templates.
//
//   AC-11  consumes only `narrationFactsFromEvents` output via
//          `buildOutcomeNarrationPrompt`; bounded prose with no mechanics absent
//          from the events; soft deadline else the wired template;
//          cancellable/idempotent by narration id; never blocks; provenance
//          recorded.
//
// The facts-only guarantee is STRUCTURAL (C-526 review finding F7): the model
// authors REFERENCES to resolved facts, never mechanical wording, so the tests
// below assert that an unresolvable or invented claim has no path to the screen.
//
// The provider is always a stub: these tests assert schema/policy/fallback and
// never assert live-model prose.
//
// Contract: C-526 AC-11

import { describe, expect, it } from 'bun:test';
import type { CombatEvent, CombatNarrationRequest } from '@aikami/types';
import { createCombatState } from '@aikami/utils';
import {
  buildOutcomeNarration,
  buildOutcomeNarrationPrompt,
  renderNarrationClaims,
} from '../../views/combat/combat_narration';
import { validateCombatNarrationDraft } from './combat_narration_policy';
import {
  type CombatNarrationServiceOptions,
  getCombatNarrationService,
} from './combat_narration_service.svelte';

// ── Fixtures ───────────────────────────────────────────────────────────────

const ENCOUNTER = 'emberwatch-encounter-1';
const NAMES = { 'player-hero': 'Mara', 'emberwatch:goblin-1': 'Goblin Archer' };

const attackEvent: CombatEvent = {
  kind: 'attackRolled',
  encounterId: ENCOUNTER,
  turnId: 'r1:player-hero',
  stateRevision: 8,
  round: 1,
  attackerId: 'player-hero',
  targetId: 'emberwatch:goblin-1',
  abilityId: 'basic_melee',
  naturalRoll: 18,
  totalRoll: 21,
  hit: true,
  isCriticalHit: false,
};

const defeatEvent: CombatEvent = {
  kind: 'combatantDefeated',
  encounterId: ENCOUNTER,
  turnId: 'r1:player-hero',
  stateRevision: 9,
  round: 1,
  combatantId: 'emberwatch:goblin-1',
};

const events = (): CombatEvent[] => [attackEvent, defeatEvent];

/** The full draft the model would author for `events()`: both real facts. */
const truthfulDraft = () => ({
  claims: [
    { kind: 'attack' as const, index: 0 },
    { kind: 'defeated' as const, index: 0 },
  ],
});

const requestOf = (overrides: Partial<CombatNarrationRequest> = {}): CombatNarrationRequest => ({
  narrationId: 'narration-1',
  encounterId: ENCOUNTER,
  basedOnRevision: 9,
  events: events(),
  names: NAMES,
  ...overrides,
});

type StubCall = { schemaName: string; prompt: string; task?: string; signal?: AbortSignal };

const makeService = (
  result: unknown | (() => unknown),
  overrides: Omit<CombatNarrationServiceOptions, 'text' | 'className'> = {},
): { calls: StubCall[]; service: ReturnType<typeof getCombatNarrationService> } => {
  const calls: StubCall[] = [];
  const service = getCombatNarrationService({
    className: 'CombatNarrationServiceTest',
    enableAutoDebug: false,
    enabled: true,
    text: {
      extractStructure: async (options) => {
        calls.push({
          schemaName: options.schemaName,
          prompt: options.prompt,
          ...(options.task === undefined ? {} : { task: options.task }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return typeof result === 'function' ? (result as () => unknown)() : result;
      },
    },
    ...overrides,
  });
  return { calls, service };
};

// ── AC-11: facts-only prose ────────────────────────────────────────────────

describe('CombatNarrationService.narrate (AC-11)', () => {
  it('renders the mechanical clauses deterministically from referenced facts', async () => {
    const { service } = makeService(truthfulDraft());
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('llm');
    // The wording is produced by the renderer, not by the stub.
    expect(result.text).toBe('Mara hits Goblin Archer. Goblin Archer falls.');
    expect(result.narrationId).toBe('narration-1');
    expect(result.encounterId).toBe(ENCOUNTER);
    expect(result.basedOnRevision).toBe(9);
  });

  it('sends the combat-narration task and the fact-indexed prompt', async () => {
    const { calls, service } = makeService(truthfulDraft());
    await service.narrate(requestOf());
    expect(calls[0]?.schemaName).toBe('CombatNarrationDraft');
    expect(calls[0]?.task).toBe('combat-narration');
    expect(calls[0]?.prompt).toBe(buildOutcomeNarrationPrompt({ events: events(), names: NAMES }));
    // The prompt indexes every fact so the model can reference it.
    expect(calls[0]?.prompt).toContain('attack[0]: Mara -> Goblin Archer (hit)');
    expect(calls[0]?.prompt).toContain('defeated[0]: Goblin Archer');
  });

  it('falls back to the authored template for malformed, refused and thrown output', async () => {
    const template = buildOutcomeNarration({ events: events(), names: NAMES });
    for (const stub of [
      { nonsense: true },
      { claims: [] },
      () => {
        throw new Error('down');
      },
    ]) {
      const { service } = makeService(stub);
      const result = await service.narrate(requestOf());
      expect(result.source).toBe('template');
      expect(result.text).toBe(template);
    }
  });

  it('uses the template on a soft-deadline timeout', async () => {
    const { calls, service } = makeService(() => new Promise(() => {}), { softDeadlineMs: 5 });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('template');
    expect(await service.narrate(requestOf())).toEqual(result);
    expect(calls).toHaveLength(1);
  });

  it('rejects an unresolvable claim instead of showing partial prose', async () => {
    const template = buildOutcomeNarration({ events: events(), names: NAMES });
    for (const draft of [
      // Past the end of the attacks list.
      { claims: [{ kind: 'attack', index: 5 }] },
      // No damage event resolved this turn.
      { claims: [{ kind: 'damage', index: 0 }] },
      // The encounter never ended.
      { claims: [{ kind: 'ended' }] },
      // One real claim followed by an invented one: the whole draft is refused.
      {
        claims: [
          { kind: 'attack', index: 0 },
          { kind: 'downed', index: 3 },
        ],
      },
    ]) {
      const { service } = makeService(draft);
      const result = await service.narrate(
        requestOf({ narrationId: `n-${JSON.stringify(draft)}` }),
      );
      expect(result.source).toBe('template');
      expect(result.text).toBe(template);
    }
  });

  it('refuses a flavour sentence that names a combatant, a number or an outcome', async () => {
    const template = buildOutcomeNarration({ events: events(), names: NAMES });
    for (const flavor of [
      'Mara is victorious over the archer.',
      'The goblin is poisoned and reels.',
      'It takes 9 of them to bring her down.',
      'The archer is slain where it stands.',
      'The goblin falls at last.',
    ]) {
      // A verified claim is present, so the FLAVOUR rule is what refuses these.
      const { service } = makeService({ claims: [{ kind: 'attack', index: 0 }], flavor });
      const result = await service.narrate(requestOf({ narrationId: `f-${flavor.length}` }));
      expect(result.source).toBe('template');
      expect(result.text).toBe(template);
    }
  });

  it('appends an inert flavour sentence after the verified clauses', async () => {
    const { service } = makeService({
      claims: [{ kind: 'attack', index: 0 }],
      flavor: 'Steel rings once against the packed earth.',
    });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('llm');
    expect(result.text).toBe('Mara hits Goblin Archer. Steel rings once against the packed earth.');
  });

  it('is cancellable by narration id', async () => {
    let resolveProvider: ((value: unknown) => void) | undefined;
    const { calls, service } = makeService(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
      { softDeadlineMs: 1000 },
    );
    const pending = service.narrate(requestOf());
    expect(service.activeNarrationCount).toBe(1);
    service.cancel('narration-1');
    expect(calls[0]?.signal?.aborted).toBe(true);
    resolveProvider?.(truthfulDraft());
    const result = await pending;
    expect(result.source).toBe('template');
    expect(service.activeNarrationCount).toBe(0);
  });

  it('is idempotent by narration id — one model call, one answer', async () => {
    const { calls, service } = makeService(truthfulDraft());
    const [first, second] = await Promise.all([
      service.narrate(requestOf()),
      service.narrate(requestOf()),
    ]);
    expect(calls.length).toBe(1);
    expect(first).toEqual(second);
    await service.narrate(requestOf());
    expect(calls.length).toBe(1);
  });

  it('honours a custom terminal-result cache cap', async () => {
    const { calls, service } = makeService(truthfulDraft(), { maxCachedResults: 1 });
    await service.narrate(requestOf({ narrationId: 'narration-1' }));
    await service.narrate(requestOf({ narrationId: 'narration-2' }));
    await service.narrate(requestOf({ narrationId: 'narration-1' }));
    expect(calls).toHaveLength(3);
  });

  it('discards a late reply after the encounter ended and keeps the template', async () => {
    const { service } = makeService(truthfulDraft(), { isStale: () => true });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('template');
  });

  it('never calls the provider when the flag is off and returns template prose (AC-9)', async () => {
    const { calls, service } = makeService({ text: 'unused' }, { enabled: false });
    const result = await service.narrate(requestOf());
    expect(calls.length).toBe(0);
    expect(result.source).toBe('template');
    expect(result.text).toBe(buildOutcomeNarration({ events: events(), names: NAMES }));
    expect(await service.narrate(requestOf())).toEqual(result);
    expect(calls.length).toBe(0);
  });
});

// ── Policy unit coverage ───────────────────────────────────────────────────

describe('validateCombatNarrationDraft (AC-11)', () => {
  it('renders a claim only from the fact it references', () => {
    const rendered = renderNarrationClaims({
      claims: [{ kind: 'defeated', index: 0 }],
      facts: {
        attacks: [],
        damages: [],
        movements: [],
        downed: [],
        defeated: ['emberwatch:goblin-1'],
        turnEnded: [],
        ended: null,
      },
      names: NAMES,
    });
    expect(rendered).toBe('Goblin Archer falls.');
  });

  it('refuses a draft with no claims and no flavour', () => {
    expect(validateCombatNarrationDraft({ draft: { claims: [] }, events: events() })).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('refuses an unresolved reference', () => {
    expect(
      validateCombatNarrationDraft({
        draft: { claims: [{ kind: 'defeated', index: 1 }] },
        events: events(),
        names: NAMES,
      }),
    ).toEqual({ ok: false, reason: 'unresolved_claim' });
  });

  it('does not let a DEFEAT authorise a victory sentence', () => {
    const defeatEnding: CombatEvent[] = [
      ...events(),
      {
        kind: 'combatEnded',
        encounterId: ENCOUNTER,
        turnId: 'r1:player-hero',
        stateRevision: 10,
        round: 1,
        victory: false,
        reason: 'partyDefeated',
      },
    ];
    const result = validateCombatNarrationDraft({
      draft: { claims: [{ kind: 'ended' }] },
      events: defeatEnding,
      names: NAMES,
    });
    // The renderer chooses the template from the EVENT, so a model that wanted a
    // victory sentence has no way to express one.
    expect(result).toEqual({ ok: true, text: 'The fight slips away.', source: 'llm' });
  });

  it("does not let one actor's defeat authorise another actor's death", () => {
    const result = validateCombatNarrationDraft({
      draft: { claims: [{ kind: 'defeated', index: 1 }] },
      events: events(),
      names: NAMES,
    });
    expect(result.ok).toBe(false);
    // Only the actor the kernel actually defeated can be referenced.
    expect(
      validateCombatNarrationDraft({
        draft: { claims: [{ kind: 'defeated', index: 0 }] },
        events: events(),
        names: NAMES,
      }),
    ).toEqual({ ok: true, text: 'Goblin Archer falls.', source: 'llm' });
  });

  it('rejects a bounded-but-mechanical flavour sentence', () => {
    for (const flavor of [
      'The goblin is slain.',
      'A hard-won victory.',
      'She takes the wound without flinching.',
    ]) {
      const result = validateCombatNarrationDraft({
        draft: { claims: [{ kind: 'attack', index: 0 }], flavor },
        events: events(),
        names: NAMES,
      });
      expect(result).toEqual({ ok: false, reason: 'flavor_mechanical_vocabulary' });
    }
  });

  it('refuses a flavour-only draft — ornament never replaces verified mechanics', () => {
    // "Four of them" carries a count no regex can verify, so an unverifiable
    // sentence must never be the whole narration.
    expect(
      validateCombatNarrationDraft({
        draft: { claims: [], flavor: 'Four of them close in.' },
        events: events(),
      }),
    ).toEqual({ ok: false, reason: 'flavor_without_claims' });
  });

  it('rejects an over-long flavour sentence and an over-long rendered block', () => {
    const flavorResult = validateCombatNarrationDraft({
      draft: { claims: [{ kind: 'attack', index: 0 }], flavor: 'a'.repeat(241) },
      events: events(),
    });
    expect(flavorResult).toEqual({ ok: false, reason: 'too_long' });

    const renderedResult = validateCombatNarrationDraft({
      draft: { claims: [{ kind: 'attack', index: 0 }] },
      events: events(),
      names: { ...NAMES, 'player-hero': 'M'.repeat(600) },
    });
    expect(renderedResult).toEqual({ ok: false, reason: 'too_long' });
  });

  it('rejects flavour that names a state-only combatant', () => {
    const state = createCombatState({
      encounterId: ENCOUNTER,
      rulesVersion: 'combat-2.0.0',
      seed: 1,
      combatants: [
        {
          combatantId: 'spectator',
          name: 'Silent Sentinel',
          team: 'neutral',
          position: { x: 0, y: 0 },
          hp: 10,
          maxHp: 10,
          armorClass: 10,
          attackBonus: 0,
          initiative: 0,
          abilityIds: [],
          budget: {
            movementRemaining: 0,
            actionAvailable: false,
            quickActionAvailable: false,
            reactionAvailable: false,
          },
          downed: false,
          defeated: false,
        },
      ],
      abilityCatalog: {},
      battlefield: { width: 1, height: 1, blockedCells: [] },
    });
    const result = validateCombatNarrationDraft({
      draft: {
        claims: [{ kind: 'attack', index: 0 }],
        flavor: 'The Silent Sentinel watches from the ridge.',
      },
      events: events(),
      state,
    });
    expect(result).toEqual({ ok: false, reason: 'flavor_names_combatant' });
  });
});
