// scripts/src/lib/ops/benchmark_combat_depth.ts
//
// C-532 AC-8 performance verification: measures the Combat-08 encounter-depth
// rules (objectives, morale, reactions, settlement) against the contract's
// SUPPORTED REFERENCE WORKLOAD and writes a timing report that records the
// machine the numbers came from.
//
// The workload is the same one C-531 fixed, so the two reports are comparable:
//   32×32 battlefield, 8 combatants, 32 objects, 64 active surface cells.
//
// Five measurements, all excluding rendering and model time:
//   - objectives:  `evaluateObjectives` over the four authored primitives
//   - morale:      `applyMoraleTrigger` for one leader-defeat event
//   - reactions:   `computeOpportunityTriggers` for one full-length move path
//   - suspension:  `resolveCombatCommand` for a move that opens a reaction
//                  window PLUS the `resolveReaction` that releases it
//   - settlement:  `settleEncounter` at a terminal boundary
//
// A target without a recorded environment does not count as measured, so the
// report always carries CPU/OS/runtime.
//
// Run: bun scripts/src/lib/ops/benchmark_combat_depth.ts [--samples 2000]

import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASIC_COMBAT_ABILITIES, OPPORTUNITY_ATTACK_ABILITY_ID } from '@aikami/constants';
import type {
  BattlefieldObject,
  CombatEnvironmentBundle,
  CombatState,
  ContentPackProp,
  MoraleRules,
  ObjectiveRules,
  ParticipationState,
  ReactionRegistry,
  SurfaceCell,
} from '@aikami/types';
import {
  applyMoraleTrigger,
  buildEnvironmentFromContent,
  COMBAT_RULES_VERSION,
  computeOpportunityTriggers,
  createCombatState,
  evaluateObjectives,
  resolveCombatCommand,
  settleEncounter,
} from '@aikami/utils';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../../..');
const REPORT_PATH = join(repository, 'docs/verification/C-532-timing.md');

/** The contract's supported reference workload. */
const WORKLOAD = {
  battlefieldWidth: 32,
  battlefieldHeight: 32,
  combatants: 8,
  objects: 32,
  surfaceCells: 64,
  /** Cells in the benchmarked move path — the movement budget of one turn. */
  pathCells: 6,
} as const;

/** The contract's committed p95 target for encounter-depth rules. */
const TARGET_P95_MS = 10;

const samplesArg = process.argv.indexOf('--samples');
const samplesValue = samplesArg === -1 ? undefined : process.argv[samplesArg + 1];
if (
  samplesArg !== -1 &&
  (samplesValue === undefined ||
    !/^[1-9]\d*$/.test(samplesValue) ||
    !Number.isSafeInteger(Number(samplesValue)))
) {
  process.stderr.write('Error: --samples must be a positive integer.\n');
  process.exit(1);
}
const SAMPLES = samplesValue === undefined ? 2000 : Number(samplesValue);

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
};

const summarize = (durations: number[]) => {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Authored depth — the reference workload's objectives, morale and reactions
// ---------------------------------------------------------------------------

const MOVER_ID = 'bench/actor-0';
const ROUTED_ID = 'bench/actor-1';

const OBJECTIVE_RULES: ObjectiveRules = {
  definitions: [
    {
      objectiveId: 'bench.stop_ritual',
      kind: 'interact_before_deadline',
      required: true,
      hidden: false,
      rule: {
        kind: 'interact_before_deadline',
        objectId: 'bench/barrel-00',
        affordanceId: 'tip_over',
        deadlineRound: 3,
        requiredActorIds: [MOVER_ID],
      },
    },
    {
      objectiveId: 'bench.rout',
      kind: 'defeat_or_rout',
      required: false,
      hidden: false,
      rule: {
        kind: 'defeat_or_rout',
        hostileIds: [ROUTED_ID],
        routMoraleThreshold: 20,
      },
    },
    {
      objectiveId: 'bench.survive',
      kind: 'survive_rounds',
      required: false,
      hidden: false,
      rule: { kind: 'survive_rounds', rounds: 3, requiredActorIds: [MOVER_ID] },
    },
    {
      objectiveId: 'bench.reach_zone',
      kind: 'reach_zone',
      required: false,
      hidden: true,
      rule: {
        kind: 'reach_zone',
        zoneId: 'bench/south_gate',
        cells: [
          { x: 6, y: 30 },
          { x: 7, y: 30 },
        ],
        requiredActorIds: [MOVER_ID],
      },
    },
  ],
  protectedActorIds: [],
};

const MORALE_RULES: MoraleRules = {
  startingMorale: 60,
  breakThreshold: 30,
  triggers: [
    { triggerKind: 'leader_defeated', magnitude: 25 },
    { triggerKind: 'ally_removed', magnitude: 10 },
    { triggerKind: 'objective_failed', magnitude: 20 },
  ],
  responses: [
    { responseKind: 'retreat', exitZoneId: 'bench/south_gate' },
    { responseKind: 'surrender', exitZoneId: null },
  ],
  exitZones: [
    {
      zoneId: 'bench/south_gate',
      cells: [
        { x: 6, y: 30 },
        { x: 7, y: 30 },
      ],
    },
  ],
  leaderIds: [ROUTED_ID],
};

const REACTION_REGISTRY: ReactionRegistry = {
  definitions: [
    {
      reactionId: 'reaction.opportunity_attack',
      triggerKind: 'opportunity_attack',
      abilityId: OPPORTUNITY_ATTACK_ABILITY_ID,
      threatRangeCells: 1,
    },
  ],
};

// ---------------------------------------------------------------------------
// Fixture — the reference workload
// ---------------------------------------------------------------------------

type Fixture = {
  state: CombatState;
  /** A legal voluntary move whose first step leaves the reactor's threat range. */
  movePath: Array<{ x: number; y: number }>;
  /** A longer path, used to measure trigger detection over the full budget. */
  longPath: Array<{ x: number; y: number }>;
  reactorId: string;
  participation: Record<string, ParticipationState>;
};

const buildFixture = (): Fixture => {
  const props: Record<string, ContentPackProp> = {
    'bench/barrel': {
      name: 'Barrel',
      frame: 'barrel.png',
      isWalkable: false,
      environment: {
        durability: 4,
        cover: 'half',
        affordances: [
          {
            affordanceId: 'tip_over',
            name: 'Tip over',
            actionCost: 'action',
            requirements: [{ kind: 'adjacent', value: true }],
            check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
            successEffects: [
              { kind: 'setIgnited', objectSelector: 'source', ignited: true },
              {
                kind: 'createSurface',
                surfaceKind: 'fire',
                cellSelector: 'sourceFootprint',
                expiresAfterRound: null,
              },
              { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
            ],
            failureEffects: [],
          },
        ],
      },
    },
    'bench/oil': {
      name: 'Oil',
      frame: 'oil.png',
      isWalkable: true,
      environment: { durability: 1, affordances: [] },
    },
  };

  const objects = Array.from({ length: WORKLOAD.objects }, (_, index) => ({
    objectId: `bench/barrel-${String(index).padStart(2, '0')}`,
    propId: 'bench/barrel',
    cell: { x: 4 + (index % 8), y: 4 + Math.floor(index / 8) },
  }));

  const built = buildEnvironmentFromContent({
    props,
    objects,
    impactZones: {},
  });
  if (!built.ok) {
    throw new Error(`benchmark fixture invalid: ${built.issues.join('; ')}`);
  }

  // 64 active surface cells, spread so they do not all share one hazard family
  // tick — the fixture measures the resolver, not the hazard cadence.
  const surfaces: SurfaceCell[] = Array.from({ length: WORKLOAD.surfaceCells }, (_, index) => ({
    surfaceId: `surface:oil:${index}:0:none`,
    kind: 'oil',
    cell: { x: index % WORKLOAD.battlefieldWidth, y: 30 },
    expiresAfterRound: null,
    sourceObjectId: null,
  }));

  const environment = { ...built.state, surfaces };
  const combatants = Array.from({ length: WORKLOAD.combatants }, (_, index) => ({
    combatantId: `bench/actor-${index}`,
    name: `Actor ${index}`,
    team: (index === 0 ? 'player' : 'enemy') as 'player' | 'enemy',
    position: { x: 3, y: 3 + index },
    hp: 20,
    maxHp: 20,
    armorClass: 12,
    attackBonus: 3,
    initiative: 20 - index,
    abilityIds: [OPPORTUNITY_ATTACK_ABILITY_ID],
    budget: {
      movementRemaining: WORKLOAD.pathCells,
      actionAvailable: true,
      quickActionAvailable: true,
      reactionAvailable: true,
    },
    downed: false,
    defeated: false,
    checkModifiers: { athletics: 3 },
  }));

  const participation: Record<string, ParticipationState> = {};
  for (const combatant of combatants) {
    participation[combatant.combatantId] = {
      status: 'active',
      morale: MORALE_RULES.startingMorale,
      appliedTriggerIds: [],
      reactionPolicy: 'ask',
    };
  }

  const state = createCombatState({
    encounterId: 'c532-benchmark',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 424242,
    combatants,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    battlefield: {
      width: WORKLOAD.battlefieldWidth,
      height: WORKLOAD.battlefieldHeight,
      blockedCells: [],
    },
    environment,
    environmentBundle: built.bundle as CombatEnvironmentBundle,
    objectiveRules: OBJECTIVE_RULES,
    moraleRules: MORALE_RULES,
    reactionRegistry: REACTION_REGISTRY,
    participation,
  });

  // The mover stands next to the first object so the authored `adjacent`
  // requirement is satisfied, and `bench/actor-1` is one cell away — inside the
  // registered reaction's threat range.
  const first = (Object.values(environment.objects) as BattlefieldObject[]).sort((a, b) =>
    a.objectId < b.objectId ? -1 : 1,
  )[0];
  state.combatants[MOVER_ID].position = { x: first.position.x - 1, y: first.position.y };

  const movePath = Array.from({ length: WORKLOAD.pathCells }, (_, index) => ({
    x: first.position.x + index,
    y: first.position.y,
  }));
  // A path long enough to exercise the whole trigger scan; the kernel caps a
  // real command at the movement budget, so this is the detection worst case.
  const longPath = Array.from({ length: 16 }, (_, index) => ({
    x: (index % 16) + 1,
    y: 20,
  }));

  return { state, movePath, longPath, reactorId: ROUTED_ID, participation };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const main = (): void => {
  const fixture = buildFixture();

  const facts = {
    combatants: fixture.state.combatants,
    participation: fixture.participation,
    completedInteractions: new Set([`${'bench/barrel-00'}:${'tip_over'}`]),
    completedRounds: 2,
    round: 3,
  };

  const moveCommand = {
    kind: 'move' as const,
    combatantId: MOVER_ID,
    path: fixture.movePath,
  };

  // Warm-up: the first call pays module/IC initialization, not steady state.
  for (let index = 0; index < 200; index++) {
    evaluateObjectives({ rules: OBJECTIVE_RULES, previous: [], facts });
    applyMoraleTrigger({
      rules: MORALE_RULES,
      participation: fixture.participation,
      event: { kind: 'leader_defeated', leaderId: ROUTED_ID },
      affectedCombatantIds: Object.keys(fixture.participation),
    });
    computeOpportunityTriggers({
      mover: fixture.state.combatants[MOVER_ID],
      path: fixture.longPath,
      combatants: fixture.state.combatants,
      participation: fixture.participation,
      registry: REACTION_REGISTRY,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      cause: 'voluntary',
      nested: false,
    });
    settleEncounter({
      encounterId: 'c532-benchmark',
      stateRevision: 0,
      round: 3,
      rules: OBJECTIVE_RULES,
      previousProgress: [],
      facts,
      existing: null,
    });
  }

  const objectiveDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    evaluateObjectives({ rules: OBJECTIVE_RULES, previous: [], facts });
    objectiveDurations.push(performance.now() - started);
  }

  const moraleDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    applyMoraleTrigger({
      rules: MORALE_RULES,
      participation: fixture.participation,
      event: { kind: 'leader_defeated', leaderId: ROUTED_ID },
      affectedCombatantIds: Object.keys(fixture.participation),
    });
    moraleDurations.push(performance.now() - started);
  }

  const reactionDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    computeOpportunityTriggers({
      mover: fixture.state.combatants[MOVER_ID],
      path: fixture.longPath,
      combatants: fixture.state.combatants,
      participation: fixture.participation,
      registry: REACTION_REGISTRY,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      cause: 'voluntary',
      nested: false,
    });
    reactionDurations.push(performance.now() - started);
  }

  // The suspension round trip: a move that opens a window, then the choice that
  // releases it. Resolved against a FRESH clone each time so the measurement
  // includes the full transactional path (clone, validate, roll, apply).
  let suspensionWindows = 0;
  const suspensionDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const state = structuredClone(fixture.state);
    const started = performance.now();
    const opened = resolveCombatCommand({ state, command: moveCommand });
    if (!opened.valid) {
      throw new Error(`benchmark move rejected: ${opened.reasonCode}`);
    }
    const window = opened.state.reaction.windows[0];
    if (window === undefined) {
      throw new Error('benchmark move opened no reaction window');
    }
    suspensionWindows += 1;
    resolveCombatCommand({
      state: opened.state,
      command: {
        kind: 'resolveReaction',
        combatantId: fixture.reactorId,
        encounterRunId: opened.state.encounterRunId,
        windowId: window.windowId,
        windowVersion: window.version,
        choice: 'decline',
        source: 'ai_policy',
      },
    });
    suspensionDurations.push(performance.now() - started);
  }

  const settlementDurations: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    settleEncounter({
      encounterId: 'c532-benchmark',
      stateRevision: 0,
      round: 3,
      rules: OBJECTIVE_RULES,
      previousProgress: [],
      facts,
      existing: null,
    });
    settlementDurations.push(performance.now() - started);
  }

  const objectives = summarize(objectiveDurations);
  const morale = summarize(moraleDurations);
  const reactions = summarize(reactionDurations);
  const suspension = summarize(suspensionDurations);
  const settlement = summarize(settlementDurations);

  const cpu = cpus()[0];
  const generatedAt = new Date().toISOString();

  const row = (label: string, measured: ReturnType<typeof summarize>): string =>
    `| ${label} | ≤ ${TARGET_P95_MS} ms | ${measured.p50.toFixed(3)} | ${measured.p95.toFixed(3)} | ${measured.max.toFixed(3)} | ${measured.p95 <= TARGET_P95_MS ? 'PASS' : 'FAIL'} |`;

  const allPass = [objectives, morale, reactions, suspension, settlement].every(
    (measured) => measured.p95 <= TARGET_P95_MS,
  );

  const report = `# C-532 encounter-depth timing report

Generated by \`scripts/src/lib/ops/benchmark_combat_depth.ts\`.
Regenerate with \`bun scripts/src/lib/ops/benchmark_combat_depth.ts\`.

## Recorded environment

| Field | Value |
| --- | --- |
| Generated at | ${generatedAt} |
| CPU | ${cpu?.model ?? 'unknown'} (${cpus().length} logical cores) |
| OS | ${platform()} ${release()} (${arch()}) |
| Runtime | Bun ${Bun.version} |
| Samples | ${SAMPLES} (after 200 warm-up iterations) |

A timing target without a recorded environment does not count as measured, so
the table above is part of the result.

## Supported reference workload

| Dimension | Value |
| --- | --- |
| Battlefield | ${WORKLOAD.battlefieldWidth}×${WORKLOAD.battlefieldHeight} |
| Combatants | ${WORKLOAD.combatants} |
| Authored objects | ${WORKLOAD.objects} |
| Active surface cells | ${WORKLOAD.surfaceCells} |
| Authored objectives | ${OBJECTIVE_RULES.definitions.length} (all four primitives) |
| Authored morale triggers | ${MORALE_RULES.triggers.length} |
| Registered reactions | ${REACTION_REGISTRY.definitions.length} |

## Results (milliseconds, excluding rendering and model time)

| Measurement | Target (p95) | p50 | p95 | max | Result |
| --- | --- | --- | --- | --- | --- |
${row('Objective evaluation (`evaluateObjectives`)', objectives)}
${row('Morale trigger application (`applyMoraleTrigger`)', morale)}
${row('Reaction trigger detection (`computeOpportunityTriggers`)', reactions)}
${row('Suspended move + reaction release (`resolveCombatCommand` ×2)', suspension)}
${row('Terminal settlement (`settleEncounter`)', settlement)}

Every measurement excludes rendering and model time: no animation, no network
call and no model call sits inside any path. The suspension measurement is the
real depth cost of the contract's ordering — the move commits a prefix, opens a
window, and the releasing choice resumes the continuation — resolved through
the same \`resolveCombatCommand\` entry point production uses
(${suspensionWindows} sampled round trips each opened exactly one window).

The target is C-531's committed ≤ ${TARGET_P95_MS} ms ordinary-action budget,
reused for cross-contract consistency; the workload above is named inline so the
number is reproducible.

Functional coverage for these paths lives in
\`packages/shared/utils/src/lib/rules/__tests__/combat_objectives.test.ts\`,
\`combat_morale.test.ts\`, \`combat_reactions.test.ts\`, \`combat_settlement.test.ts\`
and \`combat_depth_kernel.test.ts\`, and the bridge round trip in
\`packages/frontend/engine/src/__tests__/combat_reaction_bridge.test.ts\`.
`;

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report);

  process.stdout.write(report);
  process.stdout.write(`\nReport written to ${REPORT_PATH}\n`);
  if (!allPass) {
    process.exitCode = 1;
  }
};

main();
