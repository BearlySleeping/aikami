// apps/frontend/client/src/lib/views/dev/combat/fixtures/combat_debug_fixtures.ts
//
// Typed presentation-fixture projections for the combat debug workspace's
// "Presentation fixtures" mode. These are deliberately authored, deterministic
// data (never model-generated, never simulated) so the workspace's presentation
// surfaces render identically on every machine and every run.
//
// Pure data + one clone builder only: no `$services`, no Svelte runes, no DOM,
// no clock reads. Both the workspace ViewModel and headless Bun tests import
// this module, so it must stay free of environment-bound dependencies.
//
// Contract: combat debug workspace (execution prompt §2, §3, §5)

import {
  type EnrichedCombatLogEntry,
  fullActionEconomy,
  type InitiativeEntry,
  type QueuedRoll,
  type StatusEffectDisplay,
  type TurnState,
} from '$views/combat/types/combat_enhancements.ts';

// ---------------------------------------------------------------------------
// Fixture identity
// ---------------------------------------------------------------------------

/**
 * The presentation fixtures the "fixtures" mode can project. Order is
 * presentation order in the fixture selector; `initial` is the safe default.
 */
export const COMBAT_DEBUG_FIXTURE_PRESETS = [
  'initial',
  'log-filled',
  'low-hp',
  'victory',
  'defeat',
  'long-labels',
  'dice-queue',
] as const;

/**
 * Discriminates a presentation fixture. Derived from the registry array so a
 * new preset cannot be added without also updating the union.
 */
export type CombatDebugFixturePresetId = (typeof COMBAT_DEBUG_FIXTURE_PRESETS)[number];

/**
 * The full presentation projection for one fixture. Callers receive a fresh
 * clone per build so mutating a projection never corrupts another caller or a
 * later `buildCombatDebugPresentationFixture` call.
 */
export type CombatDebugPresentationFixture = {
  readonly id: CombatDebugFixturePresetId;
  readonly title: string;
  readonly description: string;
  readonly initiativeEntries: readonly InitiativeEntry[];
  readonly turnState: TurnState;
  readonly logEntries: readonly EnrichedCombatLogEntry[];
  readonly queuedRolls: readonly QueuedRoll[];
  readonly statusEffects: readonly StatusEffectDisplay[];
};

/**
 * Banner copy shown whenever fixtures mode is active, so nobody mistakes
 * fixture-rendered values for a live encounter's real state.
 */
export const COMBAT_DEBUG_FIXTURE_NOTICE = 'Presentation fixture — no live simulation';

// ---------------------------------------------------------------------------
// Compact authors — single-argument mappers over tuple rows
// ---------------------------------------------------------------------------

/** Per-row roster extras; omit for the common no-condition, not-defeated case. */
type RosterExtras = Partial<
  Pick<
    InitiativeEntry,
    'isCurrentTurn' | 'isDefeated' | 'isDowned' | 'statusEffectIds' | 'combatRole'
  >
>;
/** `[name, initiative, currentHp, maxHp, extras?]`; entityId is the row index + 1. */
type RosterRow = readonly [string, number, number, number, RosterExtras?];

/** Builds a roster cleanly, numbering entities by array position. */
const rosterRows = (rows: readonly RosterRow[]): InitiativeEntry[] =>
  rows.map((row, index) => ({
    name: row[0],
    initiative: row[1],
    currentHp: row[2],
    maxHp: row[3],
    entityId: index + 1,
    isCurrentTurn: row[4]?.isCurrentTurn ?? false,
    isDefeated: row[4]?.isDefeated ?? false,
    ...(row[4]?.isDowned === undefined ? {} : { isDowned: row[4].isDowned }),
    statusEffectIds: row[4]?.statusEffectIds ? [...row[4].statusEffectIds] : [],
    ...(row[4]?.combatRole === undefined ? {} : { combatRole: row[4].combatRole }),
  }));

/** Log row where `isPlainText` defaults to false when omitted. */
type LogRow = Omit<EnrichedCombatLogEntry, 'isPlainText'> & {
  readonly isPlainText?: boolean;
};
/** Builds log rows, filling the `isPlainText` default. */
const logs = (rows: readonly LogRow[]): EnrichedCombatLogEntry[] =>
  rows.map((row) => ({ ...row, isPlainText: row.isPlainText ?? false }));

/** Builds an active status-effect list from `[effectId, name, tag, turns, source]` rows. */
const statuses = (
  rows: ReadonlyArray<readonly [string, string, StatusEffectDisplay['tag'], number, number]>,
): StatusEffectDisplay[] =>
  rows.map(([effectId, name, tag, remainingDuration, sourceEntityId]) => ({
    effectId,
    name,
    tag,
    remainingDuration,
    sourceEntityId,
  }));

/** Builds a queued roll from `[id, count, sides, label]`; timestamp is fixed at 0. */
const rolls = (rows: ReadonlyArray<readonly [string, number, number, string]>): QueuedRoll[] =>
  rows.map(([id, count, sides, label]) => ({
    id,
    notation: {
      count,
      sides,
      label: count === 1 ? `d${sides}` : `${count}d${sides}`,
    },
    label,
    timestamp: 0,
  }));

/** A turn-state literal with the canonical full action budget applied. */
const turnState = (options: Omit<TurnState, 'actionEconomy'>): TurnState => ({
  ...options,
  actionEconomy: fullActionEconomy(),
});

/** Player-held turn for a given turn number. */
const turnPlayer = (turnNumber: number): TurnState =>
  turnState({ currentEntityId: 1, currentEntityName: 'Player', isPlayerTurn: true, turnNumber });

/** Enemy-held turn for a given turn number. */
const turnEnemy = (turnNumber: number): TurnState =>
  turnState({ currentEntityId: 2, currentEntityName: 'Goblin', isPlayerTurn: false, turnNumber });

// ---------------------------------------------------------------------------
// Authored fixture data
// ---------------------------------------------------------------------------

/** Default battlefield: player, a mid-fight goblin, a fallen skeleton. */
const baseRoster = (): InitiativeEntry[] =>
  rosterRows([
    ['Player', 18, 75, 100, { isCurrentTurn: true }],
    ['Goblin', 14, 42, 80, { combatRole: 'generic' }],
    ['Skeleton', 10, 0, 50, { isDefeated: true, combatRole: 'rusher' }],
  ]);

/** The four enriched log lines the historical "log-filled" dev preset produced. */
const filledLog = (): EnrichedCombatLogEntry[] =>
  logs([
    {
      rawText: 'Player rolls 18 (+5 = 23) to hit the Goblin for 12 slashing damage',
      diceValue: 18,
      damageType: 'slashing',
      damageValue: 12,
      targetName: 'the Goblin',
    },
    { rawText: 'Goblin rolls 5 (+2 = 7) — Miss!', diceValue: 5, targetName: 'the Goblin' },
    {
      rawText: 'Critical hit! Player rolls 20 for 30 piercing damage',
      diceValue: 20,
      isCritical: true,
      damageType: 'piercing',
      damageValue: 30,
      targetName: 'Player',
    },
    {
      rawText: 'Enemy casts fire breath — 22 fire damage',
      damageType: 'fire',
      damageValue: 22,
      targetName: 'the Player',
    },
    { rawText: 'The party catches its breath.', isPlainText: true },
  ]);

/** Five pending rolls spanning d4–d100, so the badge queue can be stress-tested. */
const diceQueue = (): QueuedRoll[] =>
  rolls([
    ['fixture-roll-1', 1, 20, 'Attack'],
    ['fixture-roll-2', 2, 6, 'Sneak Attack'],
    ['fixture-roll-3', 1, 8, 'Perception'],
    ['fixture-roll-4', 4, 4, 'Magic Missile'],
    ['fixture-roll-5', 1, 100, 'Wild Magic Surge'],
  ]);

/**
 * Overlong actor names and verbose damage types for responsive layout probes.
 * The names exceed any real catalogue entry on purpose; truncation, wrapping
 * and overflow behaviour are the point of this preset.
 */
const longLabelRoster = (): InitiativeEntry[] =>
  rosterRows([
    [
      'Seraphina Aldwinter, the Unyielding Bulwark of the Northern Marches',
      19,
      137,
      150,
      { isCurrentTurn: true, statusEffectIds: ['blessed', 'concentrating'] },
    ],
    [
      'Grzzt, Arch-Goblin Bombardier of the Ashen Warrens (Elite Vanguard)',
      16,
      94,
      220,
      { statusEffectIds: ['poisoned'], combatRole: 'boss' },
    ],
    [
      'Ancient Skeletal Dreadnought Wielding an Oversized Thunderhammer',
      12,
      0,
      180,
      { isDefeated: true, isDowned: true, combatRole: 'sniper' },
    ],
  ]);

const longLabelLog = (): EnrichedCombatLogEntry[] =>
  logs([
    {
      rawText:
        'Seraphina Aldwinter, the Unyielding Bulwark of the Northern Marches rolls 19 (+7 = 26) to strike Grzzt, Arch-Goblin Bombardier of the Ashen Warrens for 41 bludgeoning damage',
      diceValue: 19,
      damageType: 'bludgeoning',
      damageValue: 41,
      targetName: 'Grzzt, Arch-Goblin Bombardier of the Ashen Warrens',
    },
    {
      rawText:
        'Ancient Skeletal Dreadnought Wielding an Oversized Thunderhammer casts an impossible concatenation of descriptors — 33 thunder damage',
      damageType: 'thunder',
      damageValue: 33,
      targetName: 'the entire front rank of the Northern Marches',
    },
  ]);

/**
 * Every fixture as a pure factory. Factories (not shared literals) keep the
 * builder free to hand each caller fresh arrays without cross-fixture aliasing.
 */
const fixtureFactories: Record<
  CombatDebugFixturePresetId,
  () => Omit<CombatDebugPresentationFixture, 'id'>
> = {
  initial: () => ({
    title: 'Initial',
    description: 'Fresh encounter — full HP, empty log, no queued rolls.',
    initiativeEntries: rosterRows([
      ['Player', 18, 100, 100, { isCurrentTurn: true }],
      ['Goblin', 14, 80, 80, { combatRole: 'generic' }],
      ['Skeleton', 10, 50, 50, { combatRole: 'rusher' }],
    ]),
    turnState: turnPlayer(1),
    logEntries: [],
    queuedRolls: [],
    statusEffects: [],
  }),
  'log-filled': () => ({
    title: 'Log filled',
    description: 'Several enriched log entries covering hits, misses, crits and plain text.',
    initiativeEntries: baseRoster(),
    turnState: turnEnemy(3),
    logEntries: filledLog(),
    queuedRolls: [],
    statusEffects: statuses([['poisoned', 'Poisoned', 'harmful', 2, 2]]),
  }),
  'low-hp': () => ({
    title: 'Low HP',
    description: 'Player near death and a downed ally — the critical-health presentation.',
    initiativeEntries: rosterRows([
      ['Player', 18, 3, 100, { isCurrentTurn: true, statusEffectIds: ['bleeding'] }],
      ['Goblin', 14, 68, 80, { combatRole: 'generic' }],
      ['Skeleton', 10, 0, 50, { isDefeated: true, isDowned: true, combatRole: 'rusher' }],
    ]),
    turnState: turnPlayer(6),
    logEntries: logs([
      {
        rawText: 'Goblin rolls 17 (+3 = 20) — 19 slashing damage to Player',
        diceValue: 17,
        damageType: 'slashing',
        damageValue: 19,
        targetName: 'Player',
      },
      { rawText: 'Player is bleeding out!', isPlainText: true },
    ]),
    queuedRolls: [],
    statusEffects: statuses([['bleeding', 'Bleeding', 'harmful', 3, 2]]),
  }),
  victory: () => ({
    title: 'Victory',
    description: 'Enemy at zero HP, combat resolved in the player’s favour.',
    initiativeEntries: rosterRows([
      ['Player', 18, 61, 100],
      ['Goblin', 14, 0, 80, { isDefeated: true, combatRole: 'generic' }],
    ]),
    turnState: turnPlayer(8),
    logEntries: logs([
      { rawText: 'Player lands the final blow!', isPlainText: true },
      { rawText: 'Goblin has been defeated!', isPlainText: true },
    ]),
    queuedRolls: [],
    statusEffects: [],
  }),
  defeat: () => ({
    title: 'Defeat',
    description: 'Player at zero HP — the fallen-in-battle presentation.',
    initiativeEntries: rosterRows([
      ['Player', 18, 0, 100, { isDowned: true }],
      ['Goblin', 14, 34, 80, { isCurrentTurn: true, combatRole: 'generic' }],
    ]),
    turnState: turnEnemy(8),
    logEntries: logs([
      {
        rawText: 'Goblin rolls 20 — Critical hit!',
        diceValue: 20,
        isCritical: true,
        targetName: 'Player',
      },
      { rawText: 'You have fallen in battle…', isPlainText: true },
    ]),
    queuedRolls: [],
    statusEffects: [],
  }),
  'long-labels': () => ({
    title: 'Long labels',
    description: 'Overlong actor names and damage descriptions for responsive layout testing.',
    initiativeEntries: longLabelRoster(),
    turnState: turnState({
      currentEntityId: 1,
      currentEntityName: 'Seraphina Aldwinter, the Unyielding Bulwark of the Northern Marches',
      isPlayerTurn: true,
      turnNumber: 12,
    }),
    logEntries: longLabelLog(),
    queuedRolls: [],
    statusEffects: statuses([
      [
        'blessed',
        'Blessed — advantage on all attack rolls until the consecration ends',
        'beneficial',
        10,
        1,
      ],
      ['concentrating', 'Concentrating (Greater Aegis of the Unbroken Dawn)', 'neutral', 99, 1],
      ['poisoned', 'Poisoned', 'harmful', 4, 3],
    ]),
  }),
  'dice-queue': () => ({
    title: 'Dice queue',
    description: 'Five pending rolls in the badge queue, spanning d4 through d100.',
    initiativeEntries: baseRoster(),
    turnState: turnPlayer(4),
    logEntries: logs([
      {
        rawText: 'Player rolls 15 (+5 = 20) to hit the Goblin for 9 piercing damage',
        diceValue: 15,
        damageType: 'piercing',
        damageValue: 9,
        targetName: 'the Goblin',
      },
    ]),
    queuedRolls: diceQueue(),
    statusEffects: [],
  }),
};

/**
 * Builds a fresh, deep-cloned presentation fixture for the given preset. Each
 * call returns brand-new arrays and objects, so a caller (or test) that mutates
 * a projection can never leak state into another caller or a later build.
 *
 * Deterministic by construction: fixed timestamps, fixed dice metadata, no
 * clock or RNG access anywhere in the builder.
 */
export const buildCombatDebugPresentationFixture = (
  preset: CombatDebugFixturePresetId,
): CombatDebugPresentationFixture => {
  const projection = fixtureFactories[preset]();
  return {
    id: preset,
    title: projection.title,
    description: projection.description,
    initiativeEntries: projection.initiativeEntries.map((entry) => ({
      ...entry,
      statusEffectIds: [...entry.statusEffectIds],
    })),
    turnState: turnState(projection.turnState),
    logEntries: projection.logEntries.map((entry) => ({ ...entry })),
    queuedRolls: projection.queuedRolls.map((roll) => ({
      ...roll,
      notation: { ...roll.notation },
    })),
    statusEffects: projection.statusEffects.map((effect) => ({ ...effect })),
  };
};
