// apps/frontend/client/src/lib/services/game/combat_ai_service.test.ts
//
// C-526 AC-3 / AC-5 / AC-8: the AI decision service honours deadlines,
// cancellation, idempotency, staleness, batching and telemetry.
//
//   AC-3  schema-valid decision or typed failure within the deadline; bounded
//         retry; cancellable/idempotent by decisionId; stale replies dropped;
//         a CombatAiDecisionRecord per attempt with no secrets
//   AC-5  same-squad batching issues ONE call while keeping a decision per actor
//   AC-8  difficulty/risk/obedience change policy fields, never the instruction
//
// The provider is always a stub: these tests assert schema/policy/fallback and
// never assert live-model prose.
//
// Contract: C-526 AC-3, AC-5, AC-8

import { describe, expect, it, spyOn } from 'bun:test';
import type { CombatAiDecisionRequest, CombatDecisionContext } from '@aikami/types';
import {
  buildCombatAiBatchPrompt,
  buildCombatAiPrompt,
  buildCombatAiSystemPrompt,
} from './combat_ai_prompt';
import { type CombatAiServiceOptions, getCombatAiService } from './combat_ai_service.svelte';

// ── Fixtures ───────────────────────────────────────────────────────────────

const ACTOR = 'emberwatch:goblin-1';
const ACTOR_TWO = 'emberwatch:goblin-2';
const ENCOUNTER = 'emberwatch-encounter-1';

const makeContext = (overrides: Partial<CombatDecisionContext> = {}): CombatDecisionContext => ({
  actor: {
    combatantId: ACTOR,
    role: 'skirmisher',
    personality: ['vengeful'],
    relationships: [],
    fears: [],
    emotionalState: 'wary',
  },
  objectives: [],
  visibleCombatants: [],
  capabilities: [],
  reachableTargets: [],
  candidatePositions: [],
  imminentThreats: [],
  morale: 'steady',
  riskTolerance: 'balanced',
  obedience: 'obedient',
  difficulty: 'normal',
  recentEvents: [],
  tokenBudget: 800,
  ...overrides,
});

const requestOf = (overrides: Partial<CombatAiDecisionRequest> = {}): CombatAiDecisionRequest => ({
  decisionId: 'decision-1',
  encounterId: ENCOUNTER,
  actorId: ACTOR,
  basedOnRevision: 3,
  context: makeContext(),
  ...overrides,
});

const validDraft = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  goal: 'protect-the-commander',
  intent: [
    {
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'nearest_hostile' },
    },
  ],
  fallback: [{ kind: 'defend' }],
  confidence: 'medium',
  proposedLine: 'drawing a bead on the healer',
  ...overrides,
});

type StubCall = {
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
  task?: string;
  signal?: AbortSignal;
};

type StubOptions = Pick<
  CombatAiServiceOptions,
  | 'softDeadlineMs'
  | 'hardDeadlineMs'
  | 'maxCachedResults'
  | 'provider'
  | 'model'
  | 'isStale'
  | 'onRecord'
>;

/** Builds a service over a scripted stub, recording every provider call. */
const makeService = (
  result: unknown | (() => unknown),
  overrides: StubOptions = {},
): { calls: StubCall[]; service: ReturnType<typeof getCombatAiService> } => {
  const calls: StubCall[] = [];
  const service = getCombatAiService({
    className: 'CombatAiServiceTest',
    enableAutoDebug: false,
    text: {
      extractStructure: async (options) => {
        calls.push({
          schemaName: options.schemaName,
          prompt: options.prompt,
          ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
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

// ── AC-3: typed decision + envelope identity ───────────────────────────────

describe('CombatAiService.decide (AC-3)', () => {
  it('returns a schema-valid decision whose envelope identity is client-minted', async () => {
    const { service } = makeService(validDraft());
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decisionId).toBe('decision-1');
      expect(result.decision.encounterId).toBe(ENCOUNTER);
      expect(result.decision.actorId).toBe(ACTOR);
      expect(result.decision.basedOnRevision).toBe(3);
      expect(result.decision.goal).toBe('protect-the-commander');
      expect(result.decision.intent[0]?.kind).toBe('use_ability');
      expect(result.decision.proposedLine).toBe('drawing a bead on the healer');
    }
  });

  it('sends the closed draft schema, the combat-ai task and the constant system prompt', async () => {
    const { calls, service } = makeService(validDraft());
    await service.decide(requestOf());
    expect(calls[0]?.schemaName).toBe('AiCombatDecisionDraft');
    expect(calls[0]?.task).toBe('combat-ai');
    expect(calls[0]?.systemPrompt).toBe(buildCombatAiSystemPrompt());
  });

  it('retries a malformed draft exactly once, then fails typed as invalid', async () => {
    let attempts = 0;
    const { calls, service } = makeService(() => {
      attempts++;
      return { goal: '', intent: [{ kind: 'teleport' }] };
    });
    const result = await service.decide(requestOf());
    expect(attempts).toBe(2);
    expect(calls.length).toBe(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
    }
  });

  it('accepts a valid second attempt', async () => {
    let attempts = 0;
    const { service } = makeService(() => {
      attempts++;
      return attempts === 1 ? { nonsense: true } : validDraft();
    });
    expect((await service.decide(requestOf())).ok).toBe(true);
  });

  it('cannot be tricked into accepting ids, coordinates or extra props', async () => {
    const { service } = makeService(
      validDraft({
        actorId: 'someone-else',
        encounterId: 'other',
        intent: [{ kind: 'move', cell: { x: 4, y: 2 } }],
      }),
    );
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
    }
  });

  it('returns a typed offline failure on a soft-deadline timeout', async () => {
    const { service } = makeService(() => new Promise(() => {}), { softDeadlineMs: 5 });
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
    }
  });

  it('aborts the outstanding transport immediately on a soft timeout', async () => {
    // C-526 lifecycle repair: a soft fallback either aborts the outstanding
    // transport or leaves a tracked hard-abort deadline alive. This service
    // aborts immediately, so no provider call is ever left running unobserved.
    const { calls, service } = makeService(() => new Promise(() => {}), {
      softDeadlineMs: 5,
      hardDeadlineMs: 1000,
    });
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
    }
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(service.activeDecisionCount).toBe(0);
  });

  it('bounds retries by the original budget instead of restarting the window', async () => {
    // Advance the budget clock without advancing timers: the first invalid
    // response arrives with only 5 ms left, so attempt two must inherit that
    // remainder instead of receiving a fresh window.
    //
    // 🔴 The window is deliberately long (5 s) rather than 60 ms. The assertion
    // below measures REAL wall-clock time, and a 5 ms remainder vs a 60 ms fresh
    // window left only a 40 ms margin — a loaded CI machine exceeded it through
    // scheduling jitter alone, with no defect present. A 5 ms remainder vs a
    // 5 s fresh window keeps the check just as strict (a restarted window still
    // fails it, by three orders of magnitude) while removing the noise.
    let now = 0;
    let attempt = 0;
    const nowSpy = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { calls, service } = makeService(
        () => {
          attempt += 1;
          if (attempt === 1) {
            now = 4_995;
            return { nonsense: true };
          }
          return new Promise(() => {});
        },
        { softDeadlineMs: 5_000, hardDeadlineMs: 5_000 },
      );
      const realStartedAt = performance.now();
      const result = await service.decide(requestOf());
      const realElapsedMs = performance.now() - realStartedAt;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('timeout');
      }
      expect(attempt).toBe(2);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.signal?.aborted).toBe(true);
      expect(realElapsedMs).toBeLessThan(1_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('aborts the provider request at the hard deadline', async () => {
    const { calls, service } = makeService(() => new Promise(() => {}), {
      softDeadlineMs: 100,
      hardDeadlineMs: 5,
    });
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('treats a provider rejection as a typed failure, never a throw', async () => {
    const { service } = makeService(() => {
      throw new Error('provider down');
    });
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('offline');
    }
  });

  it('discards a response for a cancelled request and never applies it', async () => {
    let resolveProvider: ((value: unknown) => void) | undefined;
    const { calls, service } = makeService(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
      { softDeadlineMs: 1000 },
    );
    const pending = service.decide(requestOf());
    expect(service.activeDecisionCount).toBe(1);
    service.cancel('decision-1');
    expect(calls[0]?.signal?.aborted).toBe(true);
    resolveProvider?.(validDraft());
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Cancellation keeps its own typed reason instead of being collapsed
      // into 'stale' — the repository's vocabulary preserves the distinction.
      expect(result.reason).toBe('cancelled');
    }
    expect(service.activeDecisionCount).toBe(0);
  });

  it('is idempotent by decisionId — one model call, one answer', async () => {
    const { calls, service } = makeService(validDraft());
    const [first, second] = await Promise.all([
      service.decide(requestOf()),
      service.decide(requestOf()),
    ]);
    expect(calls.length).toBe(1);
    expect(first).toEqual(second);
    const third = await service.decide(requestOf());
    expect(calls.length).toBe(1);
    expect(third).toEqual(first);
  });

  it('honours a custom terminal-result cache cap', async () => {
    const { calls, service } = makeService(validDraft(), { maxCachedResults: 1 });
    await service.decide(requestOf({ decisionId: 'decision-1' }));
    await service.decide(requestOf({ decisionId: 'decision-2' }));
    await service.decide(requestOf({ decisionId: 'decision-1' }));
    expect(calls).toHaveLength(3);
  });

  it('discards a stale-revision reply instead of applying it', async () => {
    const { service } = makeService(validDraft(), { isStale: () => true });
    const result = await service.decide(requestOf());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('stale');
    }
  });

  it('records provider/model/latency/fallback on every attempt without secrets', async () => {
    const { service } = makeService(validDraft(), { provider: 'local', model: 'qwen3-4b' });
    const ok = await service.decide(requestOf());
    expect(ok.record.source).toBe('llm');
    expect(ok.record.provider).toBe('local');
    expect(ok.record.model).toBe('qwen3-4b');
    expect(ok.record.goal).toBe('protect-the-commander');
    expect(ok.record.confidence).toBe('medium');
    expect(typeof ok.record.latencyMs).toBe('number');

    const failing = makeService(() => {
      throw new Error('down');
    });
    const failed = await failing.service.decide(requestOf({ decisionId: 'decision-2' }));
    expect(failed.record.source).toBe('fallback');
    expect(failed.record.fallbackReason).toBe('offline');
    const serialized = JSON.stringify(failed.record);
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('personality');
  });

  it('emits a record for each invalid provider attempt', async () => {
    const records: unknown[] = [];
    const { service } = makeService(
      { nonsense: true },
      { onRecord: (record) => records.push(record) },
    );
    await service.decide(requestOf());
    expect(records).toHaveLength(2);
  });
});

// ── AC-5: squad batching ───────────────────────────────────────────────────

describe('CombatAiService.decideBatch (AC-5)', () => {
  it('issues ONE call for a same-squad batch and yields a decision per actor', async () => {
    const { calls, service } = makeService({
      decisions: {
        [ACTOR]: validDraft({ goal: 'guard-the-shaman' }),
        [ACTOR_TWO]: validDraft({ goal: 'flank-the-healer' }),
      },
    });
    const results = await service.decideBatch([
      requestOf(),
      requestOf({
        decisionId: 'decision-2',
        actorId: ACTOR_TWO,
        context: makeContext({ actor: { ...makeContext().actor, combatantId: ACTOR_TWO } }),
      }),
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0]?.schemaName).toBe('AiCombatDecisionBatchDraft');
    expect(calls[0]?.prompt).toContain(`--- ${ACTOR_TWO}`);
    expect(calls[0]?.prompt).toContain(`"combatantId":"${ACTOR_TWO}"`);
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    if (results[0]?.ok && results[1]?.ok) {
      expect(results[0].decision.actorId).toBe(ACTOR);
      expect(results[1].decision.actorId).toBe(ACTOR_TWO);
      expect(results[0].decision.goal).toBe('guard-the-shaman');
      expect(results[1].decision.goal).toBe('flank-the-healer');
    }
  });

  it('degrades per actor, not per batch, when one entry is missing', async () => {
    const { service } = makeService({ decisions: { [ACTOR]: validDraft() } });
    const results = await service.decideBatch([
      requestOf(),
      requestOf({ decisionId: 'decision-2', actorId: ACTOR_TWO }),
    ]);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    if (results[1] !== undefined && !results[1].ok) {
      expect(results[1].reason).toBe('invalid');
    }
  });

  it('fails every actor typed when the single batch call fails', async () => {
    const { calls, service } = makeService(() => {
      throw new Error('down');
    });
    const results = await service.decideBatch([
      requestOf(),
      requestOf({ decisionId: 'decision-2', actorId: ACTOR_TWO }),
    ]);
    expect(calls.length).toBe(1);
    for (const result of results) {
      expect(result.ok).toBe(false);
    }
  });

  it('retries an invalid shared response and records every actor attempt', async () => {
    let attempt = 0;
    const records: unknown[] = [];
    const { calls, service } = makeService(
      () => {
        attempt += 1;
        return attempt === 1
          ? { nonsense: true }
          : { decisions: { [ACTOR]: validDraft(), [ACTOR_TWO]: validDraft() } };
      },
      { onRecord: (record) => records.push(record) },
    );
    const results = await service.decideBatch([
      requestOf(),
      requestOf({
        decisionId: 'decision-2',
        actorId: ACTOR_TWO,
        context: makeContext({ actor: { ...makeContext().actor, combatantId: ACTOR_TWO } }),
      }),
    ]);
    expect(calls).toHaveLength(2);
    expect(records).toHaveLength(4);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('cancels one batched decision without aborting or changing its sibling', async () => {
    let resolveProvider: ((value: unknown) => void) | undefined;
    const { calls, service } = makeService(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
      { softDeadlineMs: 1000 },
    );
    const requests = [
      requestOf(),
      requestOf({
        decisionId: 'decision-2',
        actorId: ACTOR_TWO,
        context: makeContext({ actor: { ...makeContext().actor, combatantId: ACTOR_TWO } }),
      }),
    ];
    const pending = service.decideBatch(requests);
    service.cancel('decision-1');
    expect(calls[0]?.signal?.aborted).toBe(false);
    expect(service.activeDecisionCount).toBe(1);
    resolveProvider?.({ decisions: { [ACTOR]: validDraft(), [ACTOR_TWO]: validDraft() } });
    const results = await pending;
    expect(results[0]?.ok).toBe(false);
    expect(results[1]?.ok).toBe(true);
    expect(await service.decideBatch(requests)).toEqual(results);
    expect(calls).toHaveLength(1);
  });

  it('delegates a single-actor batch to decide and returns [] for an empty batch', async () => {
    const { calls, service } = makeService(validDraft());
    const single = await service.decideBatch([requestOf()]);
    expect(single).toHaveLength(1);
    expect(calls[0]?.schemaName).toBe('AiCombatDecisionDraft');
    expect(await service.decideBatch([])).toEqual([]);
  });
});

// ── AC-8: character policy enters through the prompt ───────────────────────

describe('combat AI prompt policy (AC-8)', () => {
  it('keeps the instruction text constant across difficulty/risk/obedience', () => {
    const easy = buildCombatAiPrompt({
      context: makeContext({ difficulty: 'easy', riskTolerance: 'cautious' }),
    });
    const hard = buildCombatAiPrompt({
      context: makeContext({ difficulty: 'hard', riskTolerance: 'bold', obedience: 'independent' }),
    });
    // The instruction text lives in the system prompt and never changes.
    const instruction = buildCombatAiSystemPrompt();
    expect(instruction).toContain('Choose as the CHARACTER would');
    expect(instruction).toBe(buildCombatAiSystemPrompt());
    expect(easy).not.toContain('character-over-optimization');
    // The policy fields DO change.
    expect(easy).toContain('Difficulty policy: easy');
    expect(hard).toContain('Difficulty policy: hard');
    expect(hard).toContain('Risk tolerance: bold');
    expect(hard).toContain('Obedience: independent');
    // Only the policy lines differ between the two prompts.
    const linesOf = (prompt: string): string[] =>
      prompt.split('\n').filter((line) => line.includes(': '));
    expect(linesOf(easy)).not.toEqual(linesOf(hard));
  });

  it('carries the perception-limited snapshot and nothing more', () => {
    const prompt = buildCombatAiPrompt({ context: makeContext() });
    expect(prompt).toContain(ACTOR);
    expect(prompt).toContain('Perception-limited snapshot:');
    expect(prompt).not.toContain('abilityCatalog');
    expect(prompt).not.toContain('blockedCells');
  });

  it('builds one batch prompt containing every actor', () => {
    const prompt = buildCombatAiBatchPrompt({
      contexts: [
        makeContext(),
        makeContext({ actor: { ...makeContext().actor, combatantId: ACTOR_TWO } }),
      ],
    });
    expect(prompt).toContain(ACTOR);
    expect(prompt).toContain(ACTOR_TWO);
    expect(prompt).toContain('Return a decision for every actor');
  });
});
