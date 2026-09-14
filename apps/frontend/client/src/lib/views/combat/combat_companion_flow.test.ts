// apps/frontend/client/src/lib/views/combat/combat_companion_flow.test.ts
//
// C-526 AC-6: companion control modes and the approval surface.
//
//   - `direct` never reaches the approval layer (the engine gives the turn to
//     the player); every other mode requires confirmation;
//   - a proposal is a PLAN, not a commit — nothing reaches the engine until an
//     explicit approve/decline;
//   - approve commits at most once, even if it is pressed twice;
//   - an edit recompiles and re-previews without sending anything;
//   - a revision change, a mode change and an engine withdrawal all drop an
//     obsolete proposal instead of leaving an approvable stale plan.
//
// Contract: C-526 AC-6

import { describe, expect, it } from 'bun:test';
import { MockEngineBridge } from '@aikami/frontend/engine';
import type {
  AiCombatDecision,
  CombatAbilityDefinition,
  CombatState,
  CompanionControlMode,
} from '@aikami/types';
import { createCombatState } from '@aikami/utils';
import {
  type CompanionModePreference,
  createCombatCompanionFlow,
} from './combat_companion_flow.svelte.ts';

const ENCOUNTER_ID = 'c526/companion_flow';
const PLAYER_ID = 'player';
const COMPANION_ID = 'emberwatch/mira';
const ENEMY_ID = 'emberwatch/rat';
const ENEMY_TWO_ID = 'emberwatch/rat-2';

const ability = (overrides: Partial<CombatAbilityDefinition> = {}): CombatAbilityDefinition => ({
  abilityId: 'basic_melee',
  name: 'Basic Melee',
  kind: 'melee_attack',
  actionCost: 'action',
  attackBonus: 3,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 3,
  requiresLineOfSight: false,
  ...overrides,
});

/** Stable, non-overlapping display name per combatant id. */
const combatantName = (combatantId: string): string => {
  if (combatantId === ENEMY_ID) {
    return 'Goblin Scout';
  }
  if (combatantId === ENEMY_TWO_ID) {
    return 'Orc Brute';
  }
  return combatantId;
};

const combatant = (
  combatantId: string,
  team: 'player' | 'ally' | 'enemy',
  x: number,
  overrides: Record<string, unknown> = {},
) => ({
  combatantId,
  // Distinct, non-overlapping names: `matchesNamedRef` also matches a name by
  // substring, so 'Rat' / 'Rat Two' would be an ambiguous reference.
  name: combatantName(combatantId),
  team,
  position: { x, y: 1 },
  hp: 10,
  maxHp: 10,
  armorClass: 12,
  attackBonus: 3,
  initiative: 10,
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

const makeState = (stateRevision = 0): CombatState => ({
  ...createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: 'combat-2.0.0',
    seed: 42,
    combatants: [
      combatant(PLAYER_ID, 'player', 0),
      // The companion sits between two hostiles, so an edited target is
      // observable in the compiled command.
      combatant(COMPANION_ID, 'ally', 3),
      combatant(ENEMY_ID, 'enemy', 6),
      combatant(ENEMY_TWO_ID, 'enemy', 4),
    ],
    // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
    abilityCatalog: { basic_melee: ability() },
    battlefield: { width: 8, height: 8, blockedCells: [] },
    objectives: [],
  }),
  stateRevision,
});

const decision = (overrides: Partial<AiCombatDecision> = {}): AiCombatDecision => ({
  decisionId: 'decision-1',
  encounterId: ENCOUNTER_ID,
  actorId: COMPANION_ID,
  basedOnRevision: 0,
  goal: 'protect-the-player',
  intent: [
    {
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'nearest_hostile' },
    },
  ],
  fallback: [],
  confidence: 'medium',
  ...overrides,
});

type SentCommand = { type: string } & Record<string, unknown>;

const makeFlow = (
  options: {
    mode?: CompanionControlMode;
    intent?: string;
    isCompanion?: boolean;
    revision?: number;
    snapshotDeadlineMs?: number;
  } = {},
) => {
  const bridge = new MockEngineBridge();
  const sent: SentCommand[] = [];
  bridge.onCommand('COMBAT_AI_DECISION_SUBMITTED', (command) => {
    sent.push(command as SentCommand);
  });
  bridge.onCommand('COMBAT_COMPANION_MODE_SET', (command) => {
    sent.push(command as SentCommand);
  });
  bridge.onCommand('COMBAT_STATE_SNAPSHOT_REQUESTED', (command) => {
    sent.push(command as SentCommand);
  });
  const persisted: Array<{ combatantId: string; preference: CompanionModePreference }> = [];
  let mode: CompanionControlMode = options.mode ?? 'suggest';
  let intent = options.intent ?? '';
  let revision = options.revision ?? 0;

  const flow = createCombatCompanionFlow({
    bridge: () => bridge,
    preferenceFor: (combatantId) =>
      (options.isCompanion ?? true) && combatantId === COMPANION_ID ? { mode, intent } : undefined,
    persistPreference: (change) => {
      persisted.push(change);
      mode = change.preference.mode;
      intent = change.preference.intent;
    },
    readRevision: () => revision,
    readEncounterId: () => ENCOUNTER_ID,
    displayNameFor: (combatantId) => (combatantId === ENEMY_ID ? 'Goblin Scout' : 'Mira'),
    appendLog: (text) => {
      sent.push({ type: 'LOG', text });
    },
    ...(options.snapshotDeadlineMs === undefined
      ? {}
      : { snapshotDeadlineMs: options.snapshotDeadlineMs }),
  });
  const dispose = flow.attach();
  return {
    bridge,
    flow,
    sent,
    persisted,
    dispose,
    setRevision: (next: number) => {
      revision = next;
    },
  };
};

const submitted = (sent: SentCommand[]): SentCommand[] =>
  sent.filter((command) => command.type === 'COMBAT_AI_DECISION_SUBMITTED');

describe('C-526 AC-6: approval policy by mode', () => {
  it('requires approval for every mode except `direct`', () => {
    for (const mode of ['suggest', 'intent', 'autonomous'] as const) {
      const harness = makeFlow({ mode });
      expect(harness.flow.requiresApproval(COMPANION_ID)).toBe(true);
      harness.dispose();
    }
    const direct = makeFlow({ mode: 'direct' });
    expect(direct.flow.requiresApproval(COMPANION_ID)).toBe(false);
    direct.dispose();
  });

  it('never claims approval for a non-companion', () => {
    const harness = makeFlow({ isCompanion: false });
    expect(harness.flow.requiresApproval(ENEMY_ID)).toBe(false);
    harness.dispose();
  });
});

describe('C-526 AC-6: a proposal is a plan, not a commit', () => {
  it('publishes a compiled, grounded preview without sending anything', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-1',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    const proposal = harness.flow.proposal;
    expect(proposal).not.toBeNull();
    expect(proposal?.preview.commandKind).toBe('useAbility');
    expect(proposal?.preview.requiresConfirmation).toBe(true);
    expect(proposal?.preview.hitPercentage).not.toBeNull();
    expect(proposal?.targets.map((target) => target.combatantId)).toContain(ENEMY_ID);
    expect(proposal?.targets.map((target) => target.combatantId)).toContain(ENEMY_TWO_ID);
    // Nothing mechanical left the client.
    expect(submitted(harness.sent)).toHaveLength(0);
    harness.dispose();
  });

  it('commits the approved step exactly once', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-2',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    harness.flow.approve();
    harness.flow.approve();
    const commands = submitted(harness.sent);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.requestId).toBe('req-2');
    expect(commands[0]?.combatantId).toBe(COMPANION_ID);
    const sentDecision = commands[0]?.decision as AiCombatDecision | null;
    expect(sentDecision?.intent).toHaveLength(1);
    expect(harness.flow.proposal).toBeNull();
    harness.dispose();
  });

  it('re-presents each remaining step for approval', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-multi',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: [...decision().intent, { kind: 'defend' }],
    });

    harness.flow.approve();
    expect(submitted(harness.sent)).toHaveLength(1);
    expect(harness.flow.proposal?.stepIndex).toBe(1);
    expect(harness.flow.proposal?.preview.commandKind).toBe('defend');

    harness.flow.approve();
    expect(submitted(harness.sent)).toHaveLength(2);
    expect(harness.flow.decision.status).toBe('idle');
    harness.dispose();
  });

  it('refuses a stale approval and falls the turn back instead', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-3',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    // The fight moved on while the player deliberated.
    harness.setRevision(4);
    harness.flow.approve();
    const commands = submitted(harness.sent);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.decision).toBeNull();
    expect(harness.flow.decision.status).toBe('declined');
    harness.dispose();
  });

  it('declines without committing anything', () => {
    const harness = makeFlow({ mode: 'autonomous' });
    harness.flow.presentProposal({
      requestId: 'req-4',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    harness.flow.decline();
    const commands = submitted(harness.sent);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.decision).toBeNull();
    harness.dispose();
  });

  it('recompiles an edited target and re-previews it without committing', async () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-5',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    // `nearest_hostile` picks the adjacent one…
    const initialTarget = harness.flow.proposal?.plan.command;
    expect(initialTarget?.kind).toBe('useAbility');
    expect(initialTarget?.kind === 'useAbility' ? initialTarget.targetIds[0] : undefined).toBe(
      ENEMY_TWO_ID,
    );

    // …and the player's edit re-points it, through a fresh compile. The edit is
    // asynchronous because a re-preview may need a fresh engine snapshot, so the
    // assertion waits for the flow to settle.
    harness.flow.editTarget(ENEMY_ID);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(submitted(harness.sent)).toHaveLength(0);
    const edited = harness.flow.proposal?.plan.command;
    expect(edited?.kind).toBe('useAbility');
    expect(edited?.kind === 'useAbility' ? edited.targetIds[0] : undefined).toBe(ENEMY_ID);
    harness.dispose();
  });

  it('does not decline a replacement proposal when a superseded re-preview times out', async () => {
    const harness = makeFlow({ mode: 'suggest', snapshotDeadlineMs: 5 });
    const staleState = makeState(0);
    harness.flow.presentProposal({
      requestId: 'req-old',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: staleState,
      steps: decision().intent,
    });
    staleState.stateRevision = 1;
    harness.flow.editTarget(ENEMY_ID);

    harness.flow.presentProposal({
      requestId: 'req-replacement',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(harness.flow.proposal?.requestId).toBe('req-replacement');
    expect(submitted(harness.sent)).toHaveLength(0);
    harness.dispose();
  });

  it('drops a proposal whose revision is superseded AND releases the engine', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-6',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    harness.flow.invalidate(1);
    expect(harness.flow.proposal).toBeNull();
    expect(harness.flow.decision.status).toBe('declined');
    // 🔴 An approval-required turn has no model deadline, so a dropped proposal
    // that did not release the turn would deadlock the encounter.
    const commands = submitted(harness.sent);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.decision).toBeNull();
    harness.dispose();
  });

  it('releases the engine when a mode change voids the proposal', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-9',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    harness.flow.setMode({ combatantId: COMPANION_ID, mode: 'autonomous' });
    const commands = submitted(harness.sent);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.decision).toBeNull();
    harness.dispose();
  });
});

describe('C-526 AC-6: mode selection is a persisted preference', () => {
  it('persists a mode change, tells the engine, and clears an open proposal', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.presentProposal({
      requestId: 'req-8',
      combatantId: COMPANION_ID,
      basedOnRevision: 0,
      state: makeState(0),
      steps: decision().intent,
    });
    harness.flow.setMode({ combatantId: COMPANION_ID, mode: 'direct' });
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]?.preference.mode).toBe('direct');
    expect(
      harness.sent.filter((command) => command.type === 'COMBAT_COMPANION_MODE_SET'),
    ).toHaveLength(1);
    // The proposal was grounded under the OLD preference: drop it.
    expect(harness.flow.proposal).toBeNull();
    harness.dispose();
  });

  it('keeps an Intent goal only while the mode is `intent`', () => {
    const harness = makeFlow({ mode: 'suggest' });
    harness.flow.setMode({
      combatantId: COMPANION_ID,
      mode: 'intent',
      intent: 'hold the bridge',
    });
    expect(harness.flow.standingIntent(COMPANION_ID)).toBe('hold the bridge');
    harness.flow.setMode({ combatantId: COMPANION_ID, mode: 'suggest' });
    // Switching away clears the goal so it cannot silently revive later.
    expect(harness.flow.standingIntent(COMPANION_ID)).toBeUndefined();
    const modeCommands = harness.sent.filter(
      (command) => command.type === 'COMBAT_COMPANION_MODE_SET',
    );
    expect(modeCommands[0]?.intent).toBe('hold the bridge');
    expect(modeCommands[1]?.intent).toBeUndefined();
    harness.dispose();
  });
});
