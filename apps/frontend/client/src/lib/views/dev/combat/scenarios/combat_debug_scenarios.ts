// apps/frontend/client/src/lib/views/dev/combat/scenarios/combat_debug_scenarios.ts
//
// Versioned, typed, deterministic scenario registry for the combat debug
// workspace. Scenarios are declarative data only — adding one never requires a
// new route or a new engine branch, and no imported content expression is ever
// executed.
//
// Authored-content scenarios reference the real Emberwatch pack by id; the
// workspace loads them through the production content-pack path. When the pack
// or an asset prerequisite is unavailable the workspace surfaces that fact
// instead of substituting a synthetic lookalike.
//
// Contract: combat debug workspace (execution prompt §5)

import type {
  CombatDebugBattlefieldSource,
  CombatDebugScenarioDefinition,
} from '../types/combat_debug_types.ts';

const playerDirect = {
  player: 'direct',
  companion: null,
  enemies: 'engine-policy',
} as const satisfies CombatDebugScenarioDefinition['controllerPolicies'];

const withCompanion = {
  player: 'direct',
  companion: 'direct',
  enemies: 'engine-policy',
} as const satisfies CombatDebugScenarioDefinition['controllerPolicies'];

const syntheticBattlefield = (width: number, height: number): CombatDebugBattlefieldSource => ({
  kind: 'synthetic',
  width,
  height,
  blockedCells: [],
});

const authoredBattlefield = (mapId: string, encounterId: string): CombatDebugBattlefieldSource => ({
  kind: 'authored',
  mapId,
  encounterId,
});

/** Base fields shared by every synthetic scenario; overridden per entry. */
const syntheticBase = {
  version: 1,
  defaultEngine: 'v2',
  requiresContentPack: false,
  synthetic: true,
  seed: 1337,
  defaultFaultMode: 'disabled',
} as const;

/**
 * The canonical scenario registry. Order is presentation order in the toolbar.
 */
export const COMBAT_DEBUG_SCENARIOS: readonly CombatDebugScenarioDefinition[] = [
  {
    ...syntheticBase,
    id: 'basic-direct-turn',
    title: 'Basic direct turn',
    purpose: 'Attack, move before/after action, explicit end turn, live ownership.',
    proves: 'A direct player command commits through admission and advances revision.',
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'encounter-started', description: 'Round 1 begins with the player owning the turn.' },
      { name: 'attack-committed', description: 'One attack resolves and increments revision.' },
      { name: 'turn-ended', description: 'Explicit end turn passes ownership to the enemy.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'movement-geometry',
    title: 'Movement and geometry',
    purpose: 'Different actor allowances, blocked/weighted cells, occupancy, LOS and cover.',
    proves: 'Movement budgets and blocked cells are enforced by the kernel, not the UI.',
    seed: 2024,
    battlefield: {
      kind: 'synthetic',
      width: 10,
      height: 10,
      blockedCells: [
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 5, y: 4 },
      ],
    },
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'blocked-rejected', description: 'A move into a blocked cell is rejected.' },
      { name: 'budget-exhausted', description: 'Movement beyond the allowance is rejected.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'stale-duplicate-input',
    title: 'Stale / duplicate input',
    purpose: 'Delayed confirmation, duplicate command ID, old-run delivery after retry.',
    proves: 'Stale revision, duplicate command IDs and old-run commands spend nothing.',
    seed: 7,
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'duplicate-rejected', description: 'A duplicate command ID is not double-applied.' },
      { name: 'stale-rejected', description: 'A command based on an old revision is rejected.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'direct-companion',
    title: 'Direct companion',
    purpose: 'Move/attack/interact/end turn while the companion owns the turn.',
    proves: 'Companion direct control uses production ownership checks.',
    seed: 4242,
    battlefield: syntheticBattlefield(10, 8),
    controllerPolicies: withCompanion,
    expectedCheckpoints: [
      { name: 'companion-owns-turn', description: 'Ownership transfers to the companion.' },
      { name: 'companion-acted', description: 'The companion command commits under its own id.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'suggest-continuation',
    title: 'Suggest continuation',
    purpose: 'Edit, approve, decline, replan, take control and multi-step continuation.',
    proves: 'A suggested companion plan can be edited and approved without bypassing the kernel.',
    seed: 9001,
    battlefield: syntheticBattlefield(10, 8),
    controllerPolicies: { player: 'direct', companion: 'suggest', enemies: 'engine-policy' },
    expectedCheckpoints: [
      { name: 'plan-proposed', description: 'A suggested plan is offered, not committed.' },
      { name: 'plan-approved', description: 'Approval commits the grounded command.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'ability-support',
    title: 'Ability support',
    purpose: 'Honest unsupported action, entitlement/resource boundary, target-count validation.',
    proves: 'Unsupported abilities and invalid target counts are rejected honestly.',
    seed: 55,
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      {
        name: 'unsupported-rejected',
        description: 'An unsupported ability is declined, not faked.',
      },
      { name: 'target-count-enforced', description: 'Wrong target count is rejected.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'reaction-only-ability',
    title: 'Reaction-only ability',
    purpose: 'Ordinary use rejected; valid trigger resolves once.',
    proves: 'A reaction-only ability cannot be used as an ordinary action.',
    seed: 314,
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'ordinary-use-rejected', description: 'Direct use of the reaction is rejected.' },
      { name: 'trigger-resolved-once', description: 'The valid trigger resolves exactly once.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'environmental-action',
    title: 'Environmental action',
    purpose: 'Brazier/oil/support, failed check, manual/language equivalence, changed geometry.',
    proves: 'Object affordances apply real effects and a failed check applies none.',
    seed: 808,
    battlefield: syntheticBattlefield(12, 12),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'preview-failed-check', description: 'Preview shows a check before commit.' },
      { name: 'object-changed', description: 'A committed interaction changes object state.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'reaction-queue',
    title: 'Reaction queue',
    purpose: 'Ask/Auto/Never, multiple reactors, decline, mover downed, continuation resumption.',
    proves: 'A reaction window suspends the encounter and resumes the continuation.',
    seed: 616,
    battlefield: syntheticBattlefield(10, 10),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'window-opened', description: 'A reaction window owns the encounter.' },
      {
        name: 'continuation-resumed',
        description: 'The interrupted command resumes after resolution.',
      },
    ],
  },
  {
    ...syntheticBase,
    id: 'objective-boundary',
    title: 'Objective boundary',
    purpose: 'Last valid interaction, deadline failure, protected-actor precedence.',
    proves: 'Objective deadlines and protected actors follow authored precedence.',
    seed: 1919,
    battlefield: syntheticBattlefield(12, 12),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'deadline-tracked', description: 'The objective deadline is visible and enforced.' },
      {
        name: 'precedence-applied',
        description: 'Protected-actor precedence wins over a later failure.',
      },
    ],
  },
  {
    ...syntheticBase,
    id: 'morale-nonlethal',
    title: 'Morale / non-lethal',
    purpose: 'Retreat, blocked retreat, surrender and correct participation/targeting.',
    proves: 'Morale break produces a retreat or surrender rather than an invisible kill.',
    seed: 77,
    battlefield: syntheticBattlefield(12, 10),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'morale-break', description: 'Morale drops below the break threshold.' },
      { name: 'retreat-or-surrender', description: 'A non-lethal resolution is recorded.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'knowledge-boundary',
    title: 'Knowledge boundary',
    purpose: 'Hidden nearer hostile/object/objective and visible permitted choices.',
    proves:
      'Hidden entities stay out of the player-facing choices while the engine still tracks them.',
    seed: 1111,
    battlefield: syntheticBattlefield(10, 10),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      {
        name: 'hidden-excluded',
        description: 'A hidden nearer hostile is not offered as a target.',
      },
    ],
  },
  {
    ...syntheticBase,
    id: 'save-reload-retry',
    title: 'Save / reload / retry',
    purpose: 'Mid-turn, mid-reaction, after object change and same-seed fresh attempt.',
    proves:
      'A checkpoint round-trips through the real session-checkpoint API in a debug namespace.',
    seed: 1234,
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'checkpoint-captured', description: 'A stable checkpoint is captured mid-turn.' },
      { name: 'retry-same-seed', description: 'A same-seed retry reproduces the opening state.' },
    ],
  },
  {
    ...syntheticBase,
    id: 'terminal-recovery',
    title: 'Terminal recovery',
    purpose: 'Escape/victory/defeat, final narration, duplicate settlement and recovery.',
    proves: 'Settlement happens exactly once and recovery restores a playable state.',
    seed: 5005,
    battlefield: syntheticBattlefield(8, 8),
    controllerPolicies: playerDirect,
    expectedCheckpoints: [
      { name: 'settled-once', description: 'Exactly one settlement record is produced.' },
      {
        name: 'recovered',
        description: 'Recovery restores exploration without a second settlement.',
      },
    ],
  },
  {
    ...syntheticBase,
    id: 'emberwatch-proof',
    title: 'Emberwatch proof encounter',
    purpose:
      'Real player, village_guard and three authored enemies plus environment/depth, via the pack.',
    proves: 'The authored Emberwatch encounter loads and runs through the real production path.',
    version: 1,
    seed: 424242,
    requiresContentPack: true,
    synthetic: false,
    battlefield: authoredBattlefield('inn', 'proof_encounter'),
    controllerPolicies: { player: 'direct', companion: 'direct', enemies: 'engine-policy' },
    expectedCheckpoints: [
      { name: 'pack-loaded', description: 'The Emberwatch manifest and inn map are available.' },
      {
        name: 'encounter-started',
        description: 'proof_encounter starts with its authored roster.',
      },
      {
        name: 'environment-projected',
        description: 'Authored objects and objectives are visible.',
      },
    ],
  },
] as const satisfies readonly CombatDebugScenarioDefinition[];

/** Look up a scenario by id. Returns undefined for unknown ids. */
export const findCombatDebugScenario = (id: string): CombatDebugScenarioDefinition | undefined =>
  COMBAT_DEBUG_SCENARIOS.find((scenario) => scenario.id === id);

/** The scenario shown when no valid id is supplied — a safe default. */
export const DEFAULT_COMBAT_DEBUG_SCENARIO_ID = 'basic-direct-turn';

/** Resolve a scenario id to a known definition, or the safe default. */
export const resolveCombatDebugScenario = (id: string | undefined): CombatDebugScenarioDefinition =>
  (id ? findCombatDebugScenario(id) : undefined) ??
  (findCombatDebugScenario(DEFAULT_COMBAT_DEBUG_SCENARIO_ID) as CombatDebugScenarioDefinition);
