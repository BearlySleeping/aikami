// apps/frontend/client/src/lib/services/game/combat_narration_service.test.ts
//
// C-526 AC-11: outcome narration is facts-only, bounded, and degrades to
// templates.
//
//   AC-11  consumes only `narrationFactsFromEvents` output via the existing
//          `buildOutcomeNarrationPrompt`; length-capped prose with no mechanics,
//          numbers, conditions or outcomes absent from the events; soft
//          deadline else the wired template; cancellable/idempotent by
//          narration id; never blocks; provenance recorded
//
// The provider is always a stub: these tests assert schema/policy/fallback and
// never assert live-model prose.
//
// Contract: C-526 AC-11

import { describe, expect, it } from 'bun:test';
import type { CombatEvent, CombatNarrationRequest } from '@aikami/types';
import {
  buildOutcomeNarration,
  buildOutcomeNarrationPrompt,
} from '../../views/combat/combat_narration';
import { validateCombatNarrationText } from './combat_narration_policy';
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
  it('returns length-capped llm prose with llm provenance', async () => {
    const { service } = makeService({ text: 'The archer reels as the blade bites home.' });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('llm');
    expect(result.text).toBe('The archer reels as the blade bites home.');
    expect(result.narrationId).toBe('narration-1');
    expect(result.encounterId).toBe(ENCOUNTER);
    expect(result.basedOnRevision).toBe(9);
  });

  it('sends the combat-narration task and the existing facts-only prompt', async () => {
    const { calls, service } = makeService({ text: 'The blow lands.' });
    await service.narrate(requestOf());
    expect(calls[0]?.schemaName).toBe('CombatNarrationDraft');
    expect(calls[0]?.task).toBe('combat-narration');
    expect(calls[0]?.prompt).toBe(buildOutcomeNarrationPrompt({ events: events(), names: NAMES }));
  });

  it('falls back to the authored template for malformed, refused and thrown output', async () => {
    const template = buildOutcomeNarration({ events: events(), names: NAMES });
    for (const stub of [
      { nonsense: true },
      { text: '' },
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
    const { service } = makeService(() => new Promise(() => {}), { softDeadlineMs: 5 });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('template');
  });

  it('rejects prose that adds a number, a condition or an unearned outcome', async () => {
    const template = buildOutcomeNarration({ events: events(), names: NAMES });
    for (const text of [
      'Mara strikes the archer for 9 damage.',
      'The goblin is poisoned and reels.',
      'Mara is victorious over the archer.',
    ]) {
      const { service } = makeService({ text });
      const result = await service.narrate(requestOf({ narrationId: `n-${text.length}` }));
      expect(result.source).toBe('template');
      expect(result.text).toBe(template);
    }
  });

  it('accepts a truthful rephrase that names no mechanics', async () => {
    const { service } = makeService({ text: 'Mara cuts the archer down where it stands.' });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('llm');
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
    resolveProvider?.({ text: 'The blow lands.' });
    const result = await pending;
    expect(result.source).toBe('template');
    expect(service.activeNarrationCount).toBe(0);
  });

  it('is idempotent by narration id — one model call, one answer', async () => {
    const { calls, service } = makeService({ text: 'The archer falls.' });
    const [first, second] = await Promise.all([
      service.narrate(requestOf()),
      service.narrate(requestOf()),
    ]);
    expect(calls.length).toBe(1);
    expect(first).toEqual(second);
    await service.narrate(requestOf());
    expect(calls.length).toBe(1);
  });

  it('discards a late reply after the encounter ended and keeps the template', async () => {
    const { service } = makeService({ text: 'The archer falls.' }, { isStale: () => true });
    const result = await service.narrate(requestOf());
    expect(result.source).toBe('template');
  });

  it('never calls the provider when the flag is off and returns template prose (AC-9)', async () => {
    const { calls, service } = makeService({ text: 'unused' }, { enabled: false });
    const result = await service.narrate(requestOf());
    expect(calls.length).toBe(0);
    expect(result.source).toBe('template');
    expect(result.text).toBe(buildOutcomeNarration({ events: events(), names: NAMES }));
  });
});

// ── Policy unit coverage ───────────────────────────────────────────────────

describe('validateCombatNarrationText (AC-11)', () => {
  it('rejects empty, over-long, numeric and invented-mechanic prose', () => {
    expect(validateCombatNarrationText({ text: '  ', events: events() })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(validateCombatNarrationText({ text: 'x'.repeat(601), events: events() })).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(validateCombatNarrationText({ text: 'a blow for 3', events: events() })).toEqual({
      ok: false,
      reason: 'numeric',
    });
    expect(
      validateCombatNarrationText({
        text: 'the poisoned foe',
        events: events(),
      }),
    ).toEqual({ ok: false, reason: 'invented_condition' });
  });

  it('requires the matching fact before allowing death or victory language', () => {
    expect(
      validateCombatNarrationText({ text: 'the archer is slain', events: [attackEvent] }),
    ).toEqual({ ok: false, reason: 'invented_outcome' });
    expect(validateCombatNarrationText({ text: 'the archer is slain', events: events() })).toEqual({
      ok: true,
      text: 'the archer is slain',
    });
    expect(
      validateCombatNarrationText({ text: 'a victory at last', events: [attackEvent] }),
    ).toEqual({ ok: false, reason: 'invented_outcome' });
  });
});
