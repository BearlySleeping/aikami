// apps/frontend/client/src/lib/views/combat/combat_ai_controller.test.ts
//
// C-526 AC-5 / AC-9: the client half of the deferred AI turn.
//
//   AC-5  a prefetched decision is served for the matching revision; a cache
//         miss is planned with a bounded deadline; a miss past the deadline
//         submits `null` (deterministic fallback); a different revision is
//         never served from the cache
//   AC-9  with the layer disabled nothing is planned and the fallback is
//         submitted explicitly
//
// The engine bridge is the in-memory `MockEngineBridge`; the decision service
// is always a stub, so no live model is ever involved.
//
// Contract: C-526 AC-5, AC-9

import { describe, expect, it } from 'bun:test';
import { MockEngineBridge } from '@aikami/frontend/engine';
import type {
  AiCombatDecision,
  CombatAbilityDefinition,
  CombatAiDecisionRequest,
  CombatAiDecisionResult,
  CombatantState,
  CombatState,
  IntentStep,
} from '@aikami/types';
import { createCombatState } from '@aikami/utils';
import { createEncounterRunTracker } from '../../services/game/combat_ai_lifecycle';
import { getCombatAiService } from '../../services/game/combat_ai_service.svelte';
import { createCombatAiController } from './combat_ai_controller.svelte';

const ENCOUNTER_ID = 'c526/ai_controller';
const PLAYER_ID = 'player';
const ENEMY_ID = 'emberwatch/rat';

const combatant = (
  combatantId: string,
  overrides: Partial<CombatantState> = {},
): CombatantState => ({
  combatantId,
  name: combatantId,
  team: combatantId === PLAYER_ID ? 'player' : 'enemy',
  position: { x: combatantId === PLAYER_ID ? 1 : 3, y: 1 },
  hp: 10,
  maxHp: 10,
  armorClass: 12,
  attackBonus: 3,
  initiative: combatantId === PLAYER_ID ? 50 : 40,
  abilityIds: ['basic_melee'],
  budget: {
    movementRemaining: 6,
    actionAvailable: true,
    quickActionAvailable: true,
    reactionAvailable: true,
  },
  downed: false,
  defeated: false,
  ...overrides,
});

const BASIC_MELEE: CombatAbilityDefinition = {
  abilityId: 'basic_melee',
  name: 'Basic Melee',
  kind: 'melee_attack',
  actionCost: 'action',
  attackBonus: 3,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 3,
  requiresLineOfSight: false,
};

const makeState = (stateRevision = 0): CombatState => ({
  ...createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: 'combat-2.0.0',
    seed: 99,
    combatants: [combatant(PLAYER_ID), combatant(ENEMY_ID)],
    // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
    abilityCatalog: { basic_melee: BASIC_MELEE },
    battlefield: { width: 8, height: 8, blockedCells: [] },
    objectives: [],
  }),
  stateRevision,
});

const decisionFor = (overrides: Partial<AiCombatDecision> = {}): AiCombatDecision => ({
  decisionId: 'decision-1',
  encounterId: ENCOUNTER_ID,
  actorId: ENEMY_ID,
  basedOnRevision: 0,
  goal: 'close-the-gap',
  intent: [{ kind: 'defend' }],
  fallback: [],
  confidence: 'medium',
  ...overrides,
});

type Submission = {
  requestId: string;
  combatantId: string;
  stateRevision: number;
  decision: AiCombatDecision | null;
  resolution?: 'fallback' | 'decline' | 'stale' | 'end_turn';
  stepwise?: boolean;
};

type SnapshotRequest = { requestId: string; encounterId: string };

type RecordedProposal = {
  requestId: string;
  combatantId: string;
  steps: readonly IntentStep[];
  stepIndex?: number;
};

type HarnessOptions = {
  enabled?: boolean;
  responseDeadlineMs?: number;
  snapshotDeadlineMs?: number;
  prefetch?: boolean;
  decide?: (request: CombatAiDecisionRequest) => Promise<CombatAiDecisionResult>;
  decideBatch?: (requests: readonly CombatAiDecisionRequest[]) => Promise<CombatAiDecisionResult[]>;
  requiresApproval?: (combatantId: string) => boolean;
  isPlayerControlled?: (combatantId: string) => boolean;
  continuationFor?: (
    combatantId: string,
  ) =>
    | { steps: readonly IntentStep[]; fallback: readonly IntentStep[]; stepIndex: number }
    | undefined;
};

/** Wires a controller over a scripted decision stub. */
const makeHarness = (options: HarnessOptions) => {
  const bridge = new MockEngineBridge();
  const submissions: Submission[] = [];
  const proposals: RecordedProposal[] = [];
  const snapshotRequests: SnapshotRequest[] = [];
  const decideCalls: CombatAiDecisionRequest[] = [];
  const batchCalls: CombatAiDecisionRequest[][] = [];

  bridge.onCommand('COMBAT_AI_DECISION_SUBMITTED', (command) => {
    submissions.push(command as Submission);
  });
  bridge.onCommand('COMBAT_STATE_SNAPSHOT_REQUESTED', (command) => {
    snapshotRequests.push(command);
  });

  const ok = (decision: AiCombatDecision): CombatAiDecisionResult => ({
    ok: true,
    decision,
    latencyMs: 1,
    record: {
      decisionId: decision.decisionId,
      encounterId: ENCOUNTER_ID,
      actorId: ENEMY_ID,
      basedOnRevision: 0,
      source: 'llm',
      latencyMs: 1,
    },
  });

  const decide =
    options.decide ??
    (async (request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult> =>
      ok(decisionFor({ decisionId: request.decisionId })));

  const decideBatch =
    options.decideBatch ??
    (async (requests: readonly CombatAiDecisionRequest[]): Promise<CombatAiDecisionResult[]> => {
      batchCalls.push([...requests]);
      return requests.map((request) => ok(decisionFor({ decisionId: request.decisionId })));
    });

  // C-526 lifecycle repair: every cache key and callback is bound to the
  // encounter RUN, so the harness must declare one (as `COMBAT_STARTED` does in
  // production). An authored encounter id alone recurs on retry.
  const run = createEncounterRunTracker();
  run.begin(ENCOUNTER_ID);

  const controller = createCombatAiController({
    bridge: () => bridge,
    enabled: options.enabled ?? true,
    currentRun: () => run.current(),
    decide: async (request) => {
      decideCalls.push(request);
      return decide(request);
    },
    decideBatch,
    cancel: () => {},
    cancelAll: () => {},
    playerCombatantId: PLAYER_ID,
    debug: () => {},
    info: () => {},
    deliverProposal: (proposal) => {
      proposals.push({
        requestId: proposal.requestId,
        combatantId: proposal.combatantId,
        steps: proposal.steps,
        ...(proposal.stepIndex === undefined ? {} : { stepIndex: proposal.stepIndex }),
      });
    },
    ...(options.requiresApproval === undefined
      ? {}
      : { requiresApproval: options.requiresApproval }),
    ...(options.isPlayerControlled === undefined
      ? {}
      : { isPlayerControlled: options.isPlayerControlled }),
    ...(options.continuationFor === undefined ? {} : { continuationFor: options.continuationFor }),
    ...(options.responseDeadlineMs === undefined
      ? {}
      : { responseDeadlineMs: options.responseDeadlineMs }),
    ...(options.snapshotDeadlineMs === undefined
      ? {}
      : { snapshotDeadlineMs: options.snapshotDeadlineMs }),
    ...(options.prefetch === undefined ? {} : { prefetch: options.prefetch }),
  });

  const dispose = controller.attach();
  return {
    bridge,
    controller,
    dispose,
    submissions,
    proposals,
    snapshotRequests,
    decideCalls,
    batchCalls,
    beginRun: () => run.begin(ENCOUNTER_ID),
  };
};

type Harness = ReturnType<typeof makeHarness>;

/** Answers the latest outstanding snapshot request with `state`. */
const answerSnapshot = (harness: Harness, state: CombatState): void => {
  const request = harness.snapshotRequests.at(-1);
  harness.bridge.emit({
    type: 'COMBAT_STATE_SNAPSHOT',
    requestId: request?.requestId ?? '',
    state,
  });
};

const settle = async (ms = 20): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const requestEvent = (options: { requestId: string; stateRevision: number }) => ({
  type: 'COMBAT_AI_DECISION_REQUESTED' as const,
  requestId: options.requestId,
  encounterId: ENCOUNTER_ID,
  combatantId: ENEMY_ID,
  stateRevision: options.stateRevision,
});

describe('createCombatAiController (AC-5)', () => {
  it('prefetches after a committed action and serves the cached decision', async () => {
    const harness = makeHarness({});
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    expect(harness.snapshotRequests).toHaveLength(1);
    answerSnapshot(harness, makeState(0));
    await settle();
    expect(harness.batchCalls).toHaveLength(1);
    expect(harness.batchCalls[0]?.map((request) => request.actorId)).toEqual([ENEMY_ID]);

    harness.bridge.emit(requestEvent({ requestId: 'req-1', stateRevision: 0 }));
    await settle(5);

    // Served from the prefetch: no fresh call, but an immediate submission.
    expect(harness.decideCalls).toHaveLength(0);
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]?.requestId).toBe('req-1');
    expect(harness.submissions[0]?.combatantId).toBe(ENEMY_ID);
    expect(harness.submissions[0]?.stateRevision).toBe(0);
    expect(harness.submissions[0]?.decision).not.toBeNull();
    harness.dispose();
  });

  it('does not prefetch the active actor after wrapping past skipped combatants', async () => {
    const harness = makeHarness({});
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    const state = makeState(0);
    state.initiative.activeIndex = state.initiative.order.indexOf(ENEMY_ID);
    answerSnapshot(harness, state);
    await settle();

    expect(harness.batchCalls).toHaveLength(0);
    harness.dispose();
  });

  it('plans a fresh decision on a cache miss and submits it', async () => {
    const harness = makeHarness({ prefetch: false });
    harness.bridge.emit(requestEvent({ requestId: 'req-2', stateRevision: 4 }));
    // The controller asks the engine for the live state first.
    expect(harness.snapshotRequests).toHaveLength(1);
    answerSnapshot(harness, makeState(4));
    await settle();

    expect(harness.decideCalls).toHaveLength(1);
    expect(harness.decideCalls[0]?.decisionId).toBe('req-2');
    expect(harness.decideCalls[0]?.actorId).toBe(ENEMY_ID);
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]?.decision).not.toBeNull();
    harness.dispose();
  });

  it('never serves a cached decision for a different revision', async () => {
    const harness = makeHarness({});
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    answerSnapshot(harness, makeState(0));
    await settle();
    expect(harness.batchCalls).toHaveLength(1);

    // The fight moved on: revision 5 is a cache miss and must be planned.
    harness.bridge.emit(requestEvent({ requestId: 'req-3', stateRevision: 5 }));
    answerSnapshot(harness, makeState(5));
    await settle();

    expect(harness.decideCalls).toHaveLength(1);
    expect(harness.decideCalls[0]?.basedOnRevision).toBe(5);
    expect(harness.snapshotRequests).toHaveLength(2);
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]?.stateRevision).toBe(5);
    harness.dispose();
  });

  it('does not serve a late prefetched decision from an earlier run of the same encounter', async () => {
    let resolveBatch: ((results: CombatAiDecisionResult[]) => void) | undefined;
    const harness = makeHarness({
      decideBatch: () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        }),
    });
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    answerSnapshot(harness, makeState(0));
    await settle(0);
    expect(resolveBatch).toBeDefined();

    harness.beginRun();
    resolveBatch?.([
      {
        ok: true,
        decision: decisionFor({ decisionId: 'run-1-prefetch' }),
        latencyMs: 1,
        record: {
          decisionId: 'run-1-prefetch',
          encounterId: ENCOUNTER_ID,
          actorId: ENEMY_ID,
          basedOnRevision: 0,
          source: 'llm',
          latencyMs: 1,
        },
      },
    ]);
    await settle();

    harness.bridge.emit(requestEvent({ requestId: 'run-2-request', stateRevision: 0 }));
    answerSnapshot(harness, makeState(0));
    await settle();

    expect(harness.decideCalls).toHaveLength(1);
    expect(harness.submissions[0]?.requestId).toBe('run-2-request');
    expect(harness.submissions[0]?.decision?.decisionId).toBe('run-2-request');
    harness.dispose();
  });

  it('submits the deterministic fallback when the response deadline expires', async () => {
    const harness = makeHarness({
      prefetch: false,
      responseDeadlineMs: 10,
      decide: () => new Promise(() => {}),
    });
    harness.bridge.emit(requestEvent({ requestId: 'req-4', stateRevision: 0 }));
    answerSnapshot(harness, makeState(0));
    await settle(60);

    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]?.decision).toBeNull();
    harness.dispose();
  });

  it('submits null without planning anything when the layer is disabled (AC-9)', async () => {
    const harness = makeHarness({ enabled: false });
    harness.bridge.emit(requestEvent({ requestId: 'req-5', stateRevision: 0 }));
    await settle(5);

    expect(harness.decideCalls).toHaveLength(0);
    expect(harness.snapshotRequests).toHaveLength(0);
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]).toMatchObject({
      requestId: 'req-5',
      encounterId: ENCOUNTER_ID,
      combatantId: ENEMY_ID,
      stateRevision: 0,
      decision: null,
    });
    harness.dispose();
  });

  it('does not prefetch when disabled, and stops after dispose', async () => {
    const disabled = makeHarness({ enabled: false });
    disabled.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    await settle(5);
    expect(disabled.snapshotRequests).toHaveLength(0);
    disabled.dispose();

    const enabled = makeHarness({});
    enabled.dispose();
    enabled.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    await settle(5);
    expect(enabled.snapshotRequests).toHaveLength(0);
  });
});

// ── AC-6: the ownership/approval gate ──────────────────────────────────

describe('createCombatAiController — approval gate (AC-6)', () => {
  /**
   * A controlled SUCCESSFUL provider fixture at the existing gateway boundary
   * (`text.extractStructure`). Without it an unreachable provider can only ever
   * exercise the failure path, never a successful cache hit.
   */
  const makeSuccessfulService = () => {
    const gatewayCalls: string[] = [];
    const service = getCombatAiService({
      className: 'CombatAiServiceTest',
      provider: 'fixture',
      model: 'fixture',
      text: {
        extractStructure: async ({ schemaName }) => {
          gatewayCalls.push(schemaName);
          return {
            goal: 'protect-the-player',
            intent: [
              {
                kind: 'use_ability',
                ability: { kind: 'tag', value: 'basic_melee' },
                target: { kind: 'nearest_hostile' },
              },
            ],
            fallback: [],
            confidence: 'high',
          };
        },
      },
    });
    return { service, gatewayCalls };
  };

  it('gates a successful prefetched companion decision behind approval', async () => {
    const { service, gatewayCalls } = makeSuccessfulService();
    const harness = makeHarness({
      requiresApproval: (combatantId) => combatantId === ENEMY_ID,
      decide: (request) => service.decide(request),
      decideBatch: (requests) => service.decideBatch(requests),
    });

    // Prefetch plans the companion through the real service + gateway fixture.
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    answerSnapshot(harness, makeState(0));
    await settle();
    expect(gatewayCalls.length).toBeGreaterThan(0);

    // The engine asks for the SAME revision: the cached decision must become a
    // proposal, never a commit.
    harness.bridge.emit(requestEvent({ requestId: 'companion-req', stateRevision: 0 }));
    await settle();

    expect(harness.submissions).toHaveLength(0);
    expect(harness.proposals).toHaveLength(1);
    expect(harness.proposals[0]?.requestId).toBe('companion-req');
    expect(harness.proposals[0]?.combatantId).toBe(ENEMY_ID);
    expect(harness.proposals[0]?.steps.length).toBeGreaterThan(0);
    harness.dispose();
  });

  it('produces a deterministic proposal when the provider fails for an approval actor', async () => {
    const harness = makeHarness({
      prefetch: false,
      requiresApproval: (combatantId) => combatantId === ENEMY_ID,
      decide: async (request) => ({
        ok: false,
        reason: 'offline',
        latencyMs: 1,
        record: {
          decisionId: request.decisionId,
          encounterId: ENCOUNTER_ID,
          actorId: ENEMY_ID,
          basedOnRevision: 0,
          source: 'fallback',
          latencyMs: 1,
          fallbackReason: 'offline',
        },
      }),
    });

    harness.bridge.emit(requestEvent({ requestId: 'failing-req', stateRevision: 0 }));
    answerSnapshot(harness, makeState(0));
    await settle();

    // A failure NEVER authorises the fallback for an approval actor: it must
    // still produce a proposal the player can approve.
    expect(harness.submissions).toHaveLength(0);
    expect(harness.proposals).toHaveLength(1);
    expect(harness.proposals[0]?.steps.length).toBeGreaterThan(0);
    harness.dispose();
  });

  it('never plans or commits for a player-controlled (Direct) actor', async () => {
    const harness = makeHarness({
      isPlayerControlled: (combatantId) => combatantId === ENEMY_ID,
    });

    // Prefetch skips the direct actor entirely.
    harness.bridge.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names: {} });
    answerSnapshot(harness, makeState(0));
    await settle();
    expect(harness.batchCalls).toHaveLength(0);
    expect(harness.decideCalls).toHaveLength(0);

    harness.bridge.emit(requestEvent({ requestId: 'direct-req', stateRevision: 0 }));
    await settle(5);
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0]?.decision).toBeNull();
    expect(harness.submissions[0]?.resolution).toBe('end_turn');
    harness.dispose();
  });

  it('serves a pending continuation instead of planning a fresh decision', async () => {
    const continuation: {
      steps: readonly IntentStep[];
      fallback: readonly IntentStep[];
      stepIndex: number;
    } = {
      steps: [
        {
          kind: 'move',
          destination: {
            kind: 'relative',
            relativeTo: { kind: 'nearest_hostile' },
            band: 'melee',
          },
        },
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: 'basic_melee' },
          target: { kind: 'nearest_hostile' },
        },
      ],
      fallback: [],
      stepIndex: 1,
    };
    const harness = makeHarness({
      prefetch: false,
      requiresApproval: (combatantId) => combatantId === ENEMY_ID,
      continuationFor: (combatantId) => (combatantId === ENEMY_ID ? continuation : undefined),
    });

    harness.bridge.emit(requestEvent({ requestId: 'cont-req', stateRevision: 4 }));
    answerSnapshot(harness, makeState(4));
    await settle();

    // No provider call — the controller presents the stored continuation.
    expect(harness.decideCalls).toHaveLength(0);
    expect(harness.submissions).toHaveLength(0);
    expect(harness.proposals).toHaveLength(1);
    expect(harness.proposals[0]?.stepIndex).toBe(1);
    harness.dispose();
  });
});
