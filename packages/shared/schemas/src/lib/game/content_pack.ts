// packages/shared/schemas/src/lib/game/content_pack.ts
//
// Content Pack Manifest schema — validates versioned content pack manifests.
// These manifests declare maps, NPCs, items, dialogues, quests, encounters,
// and credits for a game world.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader
// Contract: C-316 Build the Authored Emberwatch Demo Adventure
// Contract: C-327 AC-3 — optional onboarding section added

import Type, { type Static } from 'typebox';
import { ConsumableEffectSchema, EquipmentSlotSchema } from '../database/item.ts';
import { FactionDefinitionSchema } from './faction_standing.ts';
import { OnboardingSectionSchema } from './onboarding_hints.ts';

// ---------------------------------------------------------------------------
// Semver validation pattern (x.y.z with optional pre-release + build)
// ---------------------------------------------------------------------------

const SEMVER_PATTERN =
  '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

// ---------------------------------------------------------------------------
// Vendor inventory item ID pattern (comma-separated alphanumeric + underscore)
// ---------------------------------------------------------------------------

const VENDOR_ITEM_ID_PATTERN = '^[a-zA-Z0-9_]+(,\\s*[a-zA-Z0-9_]+)*$';

// ---------------------------------------------------------------------------
// ContentPackMapEntry — a single map in the content pack
// ---------------------------------------------------------------------------

export const ContentPackMapEntrySchema = Type.Object({
  /** File path relative to the pack root (e.g. "maps/starting_village.jton") */
  file: Type.String({ minLength: 1, description: 'Relative file path to the map' }),
  /** Human-readable map name */
  name: Type.String({ description: 'Display name for the map' }),
  /** Spawn point ID for the default entry location */
  defaultSpawnId: Type.Optional(Type.String({ description: 'Default spawn point ID' })),
  /** Pixel X fallback if no spawn entity matches */
  defaultX: Type.Optional(Type.Number({ description: 'Fallback spawn X pixel coordinate' })),
  /** Pixel Y fallback if no spawn entity matches */
  defaultY: Type.Optional(Type.Number({ description: 'Fallback spawn Y pixel coordinate' })),
});

export type ContentPackMapEntry = Static<typeof ContentPackMapEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackCombatStats — combat stats for NPCs (C-316)
// ---------------------------------------------------------------------------

export const ContentPackCombatStatsSchema = Type.Object({
  /** Max HP */
  hitPoints: Type.Number({ minimum: 1, description: 'Max HP' }),
  /** AC — d20 attack must meet or exceed */
  armorClass: Type.Number({ minimum: 0, description: 'Armor class' }),
  /** Added to d20 attack roll */
  attackBonus: Type.Number({ description: 'Attack bonus' }),
  /** Damage dice e.g. "1d6+2" */
  damage: Type.String({
    pattern: '^\\d+d\\d+(\\+\\d+)?$',
    description: 'Damage dice e.g. "1d6+2"',
  }),
  /** Added to initiative roll */
  initiativeBonus: Type.Optional(Type.Number({ default: 0, description: 'Initiative bonus' })),
  /** XP granted on defeat */
  xpValue: Type.Optional(Type.Number({ default: 0, description: 'XP granted on defeat' })),
});

export type ContentPackCombatStats = Static<typeof ContentPackCombatStatsSchema>;

// ---------------------------------------------------------------------------
// ContentPackNpcEntry — NPC definition in the pack
// ---------------------------------------------------------------------------

export const ContentPackNpcEntrySchema = Type.Object({
  /** Display name shown in dialog and hover */
  name: Type.String({ description: 'NPC display name' }),
  /** Default dialogue key (references dialogues{} in the manifest) */
  defaultDialogueKey: Type.Optional(Type.String({ description: 'Default dialogue key' })),
  /** Optional: appearance layer IDs for LPC sprite composition */
  appearanceLayers: Type.Optional(
    Type.Array(Type.Number(), { description: 'LPC appearance layer IDs' }),
  ),
  /** Whether this NPC is a vendor */
  isVendor: Type.Optional(Type.Boolean({ description: 'Whether this NPC is a vendor' })),
  /** Comma-separated item IDs e.g. "ironSword,healthPotion" */
  vendorInventory: Type.Optional(
    Type.String({
      pattern: VENDOR_ITEM_ID_PATTERN,
      description: 'Comma-separated item IDs e.g. "ironSword,healthPotion"',
    }),
  ),
  /** Combat stats for enemy NPCs (C-316) */
  combatStats: Type.Optional(ContentPackCombatStatsSchema),
  // ── Companion fields (C-340) ──
  /** Whether this NPC can be recruited as a companion. */
  isCompanion: Type.Optional(Type.Boolean({ default: false })),
  /** Dialogue key that triggers the recruit offer. */
  recruitDialogueKey: Type.Optional(Type.String()),
  /** Dialogue key for dismiss conversation. */
  dismissDialogueKey: Type.Optional(Type.String()),
  /** Class ID from the class registry (C-337). e.g. 'cleric', 'fighter'. */
  companionClassId: Type.Optional(Type.String()),
  /** Optional personal quest ID (references a quest in the manifest). */
  personalQuestId: Type.Optional(Type.String()),
  /** Initial approval score (-100 to 100). */
  initialApproval: Type.Optional(Type.Integer({ minimum: -100, maximum: 100, default: 0 })),
  /** Pool of banter dialogue keys for inter-party chatter. */
  banterPool: Type.Optional(Type.Array(Type.String(), { default: [] })),
});

export type ContentPackNpcEntry = Static<typeof ContentPackNpcEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackItemEntry — item definition in the pack
// ---------------------------------------------------------------------------

// Re-exported from database/item.ts — single source of truth (C-331).
export { type ItemType, ItemTypeSchema } from '../database/item.ts';

const BaseContentPackItemSchema = Type.Object({
  /** Display name */
  name: Type.String({ description: 'Item display name' }),
  /** Optional attack bonus */
  attackBonus: Type.Optional(Type.Number({ description: 'Attack bonus value' })),
  /** Optional defense bonus */
  defenseBonus: Type.Optional(Type.Number({ description: 'Defense bonus value' })),
  /** Optional reference to an equipment slot (weapon | armor) */
  equipmentSlot: Type.Optional(EquipmentSlotSchema),
  /** Optional deterministic vendor base price in gold (0 = unsellable, or >= 2) — C-331 */
  basePrice: Type.Optional(
    Type.Union([Type.Literal(0), Type.Number({ minimum: 2 })], {
      description: 'Vendor base price in gold (0 = unsellable, or >= 2)',
    }),
  ),
});

const ConsumableContentPackItemSchema = Type.Intersect([
  BaseContentPackItemSchema,
  Type.Object({
    type: Type.Literal('consumable'),
    effect: ConsumableEffectSchema,
  }),
]);

const NonConsumableContentPackItemSchema = Type.Intersect([
  BaseContentPackItemSchema,
  Type.Object({
    type: Type.Union([
      Type.Literal('weapon'),
      Type.Literal('armor'),
      Type.Literal('key'),
      Type.Literal('misc'),
    ]),
  }),
]);

export const ContentPackItemEntrySchema = Type.Union([
  ConsumableContentPackItemSchema,
  NonConsumableContentPackItemSchema,
]);

export type ContentPackItemEntry = Static<typeof ContentPackItemEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackQuestObjective — a single quest objective (C-316, extended C-339)
// ---------------------------------------------------------------------------

/** Failure condition for an objective (only onTrigger is supported). */
export const QuestObjectiveFailureConditionSchema = Type.Object({
  kind: Type.Literal('onTrigger'),
  triggerType: Type.Union([
    Type.Literal('MAP_ENTERED'),
    Type.Literal('NPC_INTERACTED'),
    Type.Literal('ENCOUNTER_COMPLETED'),
  ]),
  triggerId: Type.String({ minLength: 1 }),
});

export type QuestObjectiveFailureCondition = Static<typeof QuestObjectiveFailureConditionSchema>;

/** Reveal trigger for hidden objectives. */
export const QuestObjectiveRevealOnSchema = Type.Object({
  type: Type.Union([
    Type.Literal('MAP_ENTERED'),
    Type.Literal('NPC_INTERACTED'),
    Type.Literal('ENCOUNTER_COMPLETED'),
    Type.Literal('ITEM_PICKED_UP'),
  ]),
  id: Type.String({ minLength: 1 }),
});

export const ContentPackQuestObjectiveSchema = Type.Object({
  /** Display text for the objective */
  text: Type.String({ minLength: 1, description: 'Display text for the objective' }),
  /** Map ID that completes this objective on enter */
  completeOnMapEnter: Type.Optional(
    Type.String({ description: 'Map ID that completes this objective on enter' }),
  ),
  /** NPC ID that completes this objective on interact */
  completeOnNpcInteract: Type.Optional(
    Type.String({ description: 'NPC ID that completes this objective on interact' }),
  ),
  /** Encounter ID that completes this objective */
  completeOnEncounterComplete: Type.Optional(
    Type.String({ description: 'Encounter ID that completes this objective' }),
  ),
  /** Item ID that completes this objective on pickup */
  completeOnItemPickup: Type.Optional(
    Type.String({ description: 'Item ID that completes this objective on pickup' }),
  ),
  /** Prerequisite objective indices — this objective only becomes active after all listed are complete or skipped. Empty = available immediately. (C-339) */
  prerequisiteIndices: Type.Optional(
    Type.Array(Type.Integer({ minimum: 0 }), {
      description: 'Indices of objectives that must be complete/skipped before this becomes active',
    }),
  ),
  /** If true, this objective is not shown in the journal until a reveal trigger fires. (C-339) */
  hidden: Type.Optional(
    Type.Boolean({ description: 'Hidden until revealed via revealOn trigger' }),
  ),
  /** Trigger that reveals a hidden objective. (C-339) */
  revealOn: Type.Optional(QuestObjectiveRevealOnSchema),
  /** If true, completing this objective is NOT required for quest completion. (C-339) */
  optional: Type.Optional(
    Type.Boolean({ description: 'Optional — not required to complete quest' }),
  ),
  /** How many must be completed for counter objectives. Defaults to maxCount if not specified. (C-339) */
  requiredCount: Type.Optional(
    Type.Integer({ minimum: 1, description: 'How many must be completed (counter objectives)' }),
  ),
  /** Maximum progress count. >1 for counter objectives ("kill 5 goblins"). Default 1. (C-339) */
  maxCount: Type.Optional(
    Type.Integer({ minimum: 1, description: 'Maximum progress count (default 1)' }),
  ),
  /** If set, this objective fails if the timer expires. Wall-clock seconds from when it becomes active. (C-339) */
  timeLimitSeconds: Type.Optional(
    Type.Integer({ minimum: 1, description: 'Wall-clock seconds before objective expires' }),
  ),
  /** How this objective can fail. (C-339) */
  failureConditions: Type.Optional(
    Type.Array(QuestObjectiveFailureConditionSchema, {
      description: 'Conditions that fail this objective',
    }),
  ),
});

export type ContentPackQuestObjective = Static<typeof ContentPackQuestObjectiveSchema>;

// ---------------------------------------------------------------------------
// ContentPackQuestRewardType — reward category (C-316)
// ---------------------------------------------------------------------------

export const ContentPackQuestRewardTypeSchema = Type.Union([
  Type.Literal('item'),
  Type.Literal('gold'),
  Type.Literal('xp'),
  Type.Literal('equipment'),
]);

export type ContentPackQuestRewardType = Static<typeof ContentPackQuestRewardTypeSchema>;

// ---------------------------------------------------------------------------
// ContentPackQuestReward — a quest completion reward (C-316)
// ---------------------------------------------------------------------------

export const ContentPackQuestRewardSchema = Type.Object({
  /** Reward type */
  type: ContentPackQuestRewardTypeSchema,
  /** Item ID for item/equipment rewards */
  itemId: Type.Optional(Type.String({ description: 'Item ID for item/equipment rewards' })),
  /** Gold or XP amount */
  amount: Type.Optional(Type.Number({ minimum: 1, description: 'Gold or XP amount' })),
});

export type ContentPackQuestReward = Static<typeof ContentPackQuestRewardSchema>;

// ---------------------------------------------------------------------------
// ContentPackQuestEnding — a quest ending variation (C-316)
// ---------------------------------------------------------------------------

export const ContentPackQuestEndingSchema = Type.Object({
  /** Ending title */
  title: Type.String({ minLength: 1, description: 'Ending title' }),
  /** Authored narration text (50+ chars) */
  narration: Type.String({ minLength: 50, description: 'Authored narration text (50+ chars)' }),
  /** NPC reaction dialogue key */
  reactionDialogueKey: Type.Optional(Type.String({ description: 'NPC reaction dialogue key' })),
  /** World-state flag set on activation */
  worldStateFlag: Type.String({
    minLength: 1,
    pattern: '^[a-zA-Z0-9_.]+$',
    description: 'World-state flag set on activation',
  }),
});

export type ContentPackQuestEnding = Static<typeof ContentPackQuestEndingSchema>;

// ---------------------------------------------------------------------------
// ContentPackQuestEntry — a quest definition (C-316, extended C-339)
// ---------------------------------------------------------------------------

export const ContentPackQuestEntrySchema = Type.Object({
  /** Unique quest identifier */
  id: Type.String({ minLength: 1, description: 'Unique quest identifier' }),
  /** Quest display name */
  name: Type.String({ minLength: 1, description: 'Quest display name' }),
  /** Quest flavor text */
  description: Type.String({ minLength: 1, description: 'Quest flavor text' }),
  /** Quest objectives (at least 1) */
  objectives: Type.Array(ContentPackQuestObjectiveSchema, {
    minItems: 1,
    description: 'Quest objectives',
  }),
  /** Dialogue key when quest is offered */
  offerDialogueKey: Type.String({ description: 'Dialogue key when quest is offered' }),
  /** Dialogue key while quest is active */
  progressDialogueKey: Type.String({ description: 'Dialogue key while quest is active' }),
  /** Completion rewards */
  rewards: Type.Array(ContentPackQuestRewardSchema, { description: 'Completion rewards' }),
  /** Optional dialogue key when quest is declined */
  declineDialogueKey: Type.Optional(
    Type.String({ description: 'Dialogue key when quest is declined' }),
  ),
  /** Optional NPC ID that offers this quest. When set, only this NPC can offer it. */
  offeredByNpcId: Type.Optional(
    Type.String({ description: 'NPC ID that offers this quest (filters dialogue choices)' }),
  ),
  /** Ending variations keyed by ending ID */
  endings: Type.Record(Type.String(), ContentPackQuestEndingSchema, {
    description: 'Ending variations keyed by ending ID',
  }),
  /** Quest IDs that must be completed before this quest can be offered. (C-339) */
  prerequisiteQuestIds: Type.Optional(
    Type.Array(Type.String(), { description: 'Quest IDs that must be completed first' }),
  ),
  /** If true, the quest can be re-offered after completion. (C-339) */
  repeatable: Type.Optional(Type.Boolean({ description: 'Can be re-offered after completion' })),
  /** Minimum days between completions for repeatable quests. (C-339) */
  repeatCooldownDays: Type.Optional(
    Type.Number({ minimum: 0, description: 'Minimum days between completions' }),
  ),
  /** Optional chain grouping ID — quests in the same chain are displayed together. (C-339) */
  questChainId: Type.Optional(
    Type.String({ description: 'Chain grouping ID for journal display' }),
  ),
  /** Order within the chain for journal display. (C-339) */
  chainOrder: Type.Optional(
    Type.Integer({ minimum: 0, description: 'Display order within chain' }),
  ),
});

export type ContentPackQuestEntry = Static<typeof ContentPackQuestEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackSkillStat — skill stat for skill checks (C-316)
// ---------------------------------------------------------------------------

export const ContentPackSkillStatSchema = Type.Union([
  Type.Literal('strength'),
  Type.Literal('dexterity'),
  Type.Literal('intelligence'),
  Type.Literal('charisma'),
  Type.Literal('wisdom'),
]);

export type ContentPackSkillStat = Static<typeof ContentPackSkillStatSchema>;

// ---------------------------------------------------------------------------
// ContentPackSkillCheck — a skill check definition (C-316)
// ---------------------------------------------------------------------------

export const ContentPackSkillCheckSchema = Type.Object({
  /** Skill label e.g. "persuasion" */
  skill: Type.String({ minLength: 1, description: 'Skill label e.g. "persuasion"' }),
  /** Difficulty class — d20 must meet or exceed */
  dc: Type.Number({ minimum: 1, description: 'Difficulty class' }),
  /** Stat modifier applied to the roll */
  statModifier: ContentPackSkillStatSchema,
  /** Dialogue on skill check success */
  successDialogueKey: Type.String({ description: 'Dialogue on skill check success' }),
  /** Dialogue on skill check failure */
  failureDialogueKey: Type.String({ description: 'Dialogue on skill check failure' }),
});

export type ContentPackSkillCheck = Static<typeof ContentPackSkillCheckSchema>;

// ---------------------------------------------------------------------------
// ContentPackLootEntry — a loot drop entry (C-316)
// ---------------------------------------------------------------------------

export const ContentPackLootEntrySchema = Type.Object({
  /** Item ID dropped */
  itemId: Type.String({ minLength: 1, description: 'Item ID dropped' }),
  /** Quantity dropped */
  quantity: Type.Number({ minimum: 1, description: 'Quantity dropped' }),
  /** Drop probability 0.0–1.0 */
  dropChance: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Drop probability 0.0–1.0',
  }),
});

export type ContentPackLootEntry = Static<typeof ContentPackLootEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackInteractableEntry — world interactable definitions (C-342)
// ---------------------------------------------------------------------------

const BaseContentPackInteractableSchema = Type.Object({
  /** Unique spawn identifier for state persistence across map revisits. */
  spawnId: Type.String({ minLength: 1, description: 'Unique spawn identifier' }),
  /** Map ID where this interactable lives. */
  mapId: Type.String({ minLength: 1, description: 'Map ID where this interactable lives' }),
});

const ContentPackInteractableDoorSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('door'),
    lockedByDefault: Type.Boolean({ description: 'Whether the door starts locked' }),
    requiredItemId: Type.Optional(
      Type.String({ description: 'Item ID required to unlock (e.g., rustyKey)' }),
    ),
    startsOpen: Type.Boolean({ description: 'Whether the door starts open' }),
    activatedBySpawnIds: Type.Array(Type.String(), {
      description: 'Spawn IDs of interactables that activate (open) this door when toggled',
    }),
  }),
]);

const ContentPackInteractableChestSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('chest'),
    lockedByDefault: Type.Boolean({ description: 'Whether the chest starts locked' }),
    requiredItemId: Type.Optional(
      Type.String({ description: 'Item ID required to unlock (e.g., rustyKey)' }),
    ),
    lootTableKey: Type.String({
      minLength: 1,
      description: 'Key into the manifest lootTables record',
    }),
    respawns: Type.Boolean({ description: 'Whether the chest respawns loot after being looted' }),
  }),
]);

const ContentPackInteractableLeverSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('lever'),
    startsToggled: Type.Boolean({
      description: 'Whether the lever starts in the toggled position',
    }),
    activatesSpawnIds: Type.Array(Type.String(), {
      description: 'Spawn IDs of interactables that activate when this lever is toggled',
    }),
    staysToggled: Type.Boolean({
      description: 'If true, lever stays toggled after use. If false, springs back.',
    }),
  }),
]);

const ContentPackInteractablePressurePlateSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('pressure_plate'),
    activatesSpawnIds: Type.Array(Type.String(), {
      description: 'Spawn IDs activated while the plate is pressed',
    }),
    deactivatesOnReleaseSpawnIds: Type.Array(Type.String(), {
      description: 'Spawn IDs deactivated when the plate is released',
    }),
  }),
]);

const ContentPackInteractableContainerSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('container'),
    lootTableKey: Type.String({
      minLength: 1,
      description: 'Key into the manifest lootTables record',
    }),
    respawns: Type.Boolean({
      description: 'Whether the container respawns loot after being looted',
    }),
  }),
]);

const ContentPackInteractableReadableSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('readable'),
    textDialogueKey: Type.String({
      minLength: 1,
      description: 'Dialogue key for text displayed on inspect',
    }),
  }),
]);

const ContentPackInteractableTrapSchema = Type.Intersect([
  BaseContentPackInteractableSchema,
  Type.Object({
    kind: Type.Literal('trap'),
    damageDice: Type.String({
      pattern: '^\\d+d\\d+(\\+\\d+)?$',
      description: 'Damage dice (e.g., 2d6) dealt when triggered',
    }),
    disarmDc: Type.Number({
      minimum: 0,
      description: 'DC for disarm skill check. 0 = no disarm possible.',
    }),
    visible: Type.Boolean({ description: 'Whether the trap is visible before triggering' }),
    reArms: Type.Boolean({ description: 'Whether the trap re-arms after triggering' }),
  }),
]);

export const ContentPackInteractableEntrySchema = Type.Union([
  ContentPackInteractableDoorSchema,
  ContentPackInteractableChestSchema,
  ContentPackInteractableLeverSchema,
  ContentPackInteractablePressurePlateSchema,
  ContentPackInteractableContainerSchema,
  ContentPackInteractableReadableSchema,
  ContentPackInteractableTrapSchema,
]);

export type ContentPackInteractableEntry = Static<typeof ContentPackInteractableEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackPuzzle — puzzle DAG definition (C-342)
// ---------------------------------------------------------------------------

export const ContentPackPuzzleSchema = Type.Object({
  /** Unique puzzle ID for journal/quest tracking. */
  puzzleId: Type.String({ minLength: 1, description: 'Unique puzzle identifier' }),
  /** Human-readable name. */
  name: Type.String({ minLength: 1, description: 'Puzzle display name' }),
  /** Map ID where this puzzle lives. */
  mapId: Type.String({ minLength: 1, description: 'Map ID where this puzzle lives' }),
  /** Spawn IDs that participate in this puzzle. */
  interactableSpawnIds: Type.Array(Type.String(), {
    minItems: 2,
    description: 'Spawn IDs that participate in this puzzle (at least 2)',
  }),
  /** Dialogue key shown when the puzzle is solved. */
  solvedDialogueKey: Type.String({ description: 'Dialogue key shown when the puzzle is solved' }),
});

export type ContentPackPuzzle = Static<typeof ContentPackPuzzleSchema>;

// ---------------------------------------------------------------------------
// ContentPackEncounterEntry — a combat encounter definition (C-316)
// ---------------------------------------------------------------------------

export const ContentPackEncounterEntrySchema = Type.Object({
  /** Unique encounter identifier */
  id: Type.String({ minLength: 1, description: 'Unique encounter identifier' }),
  /** Map ID where this encounter triggers */
  mapId: Type.String({ minLength: 1, description: 'Map ID where this encounter triggers' }),
  /** Encounter display name */
  name: Type.String({ minLength: 1, description: 'Encounter display name' }),
  /** NPC IDs that participate as enemies */
  enemyNpcIds: Type.Array(Type.String(), {
    minItems: 1,
    description: 'NPC IDs that participate as enemies',
  }),
  /** Whether non-combat resolution is available */
  allowNonCombatResolution: Type.Boolean({
    description: 'Whether non-combat resolution is available',
  }),
  /** Skill check for non-combat resolution */
  nonCombatSkillCheck: Type.Optional(ContentPackSkillCheckSchema),
  /** Dialogue on encounter start */
  startDialogueKey: Type.String({ description: 'Dialogue on encounter start' }),
  /** Dialogue on combat victory */
  victoryDialogueKey: Type.String({ description: 'Dialogue on combat victory' }),
  /** Dialogue on non-combat success */
  nonCombatSuccessDialogueKey: Type.Optional(
    Type.String({ description: 'Dialogue on non-combat success' }),
  ),
  /** Loot dropped on victory */
  loot: Type.Array(ContentPackLootEntrySchema, { description: 'Loot dropped on victory' }),
});

export type ContentPackEncounterEntry = Static<typeof ContentPackEncounterEntrySchema>;

// ---------------------------------------------------------------------------
// ContentPackCredits — adventure credits (C-316)
// ---------------------------------------------------------------------------

export const ContentPackCreditsSchema = Type.Object({
  /** Adventure design credits */
  design: Type.Array(Type.String(), { description: 'Adventure design credits' }),
  /** Writing credits */
  writing: Type.Array(Type.String(), { description: 'Writing credits' }),
  /** Art asset credits */
  art: Type.Array(Type.String(), { description: 'Art asset credits' }),
  /** Music credits */
  music: Type.Array(Type.String(), { description: 'Music credits' }),
  /** Special thanks */
  thanks: Type.Array(Type.String(), { description: 'Special thanks' }),
});

export type ContentPackCredits = Static<typeof ContentPackCreditsSchema>;

// ---------------------------------------------------------------------------
// Internal: record schema helpers for quests and encounters in manifest
// ---------------------------------------------------------------------------

export const ManifestQuestMapSchema = Type.Record(Type.String(), ContentPackQuestEntrySchema);
export const ManifestEncounterMapSchema = Type.Record(
  Type.String(),
  ContentPackEncounterEntrySchema,
);

// ---------------------------------------------------------------------------
// ContentPackManifest — top-level content pack manifest
// ---------------------------------------------------------------------------

export const ContentPackManifestSchema = Type.Object({
  /** Pack identifier — matches Campaign.contentPackId */
  id: Type.String({ minLength: 1, description: 'Content pack identifier' }),
  /** Human-readable name */
  name: Type.String({ description: 'Pack display name' }),
  /** Semantic version string (e.g. "1.0.0") */
  version: Type.String({
    pattern: SEMVER_PATTERN,
    description: 'Semantic version string (x.y.z)',
  }),
  /** ISO 8601 timestamp of last modification */
  updatedAt: Type.String({ description: 'ISO 8601 last modification timestamp' }),
  /** Optional short description of the adventure (shown in pack browser detail panel) */
  description: Type.Optional(Type.String({ description: 'Short adventure description' })),
  /** Map ID of the entry point — first map loaded on campaign start */
  startingMapId: Type.String({ minLength: 1, description: 'Starting map ID' }),
  /** All maps in this pack, keyed by map ID */
  maps: Type.Record(Type.String(), ContentPackMapEntrySchema, {
    description: 'Map definitions keyed by map ID',
  }),
  /** NPC definitions, keyed by NPC ID */
  npcs: Type.Record(Type.String(), ContentPackNpcEntrySchema, {
    description: 'NPC definitions keyed by NPC ID',
  }),
  /** Item definitions, keyed by item ID */
  items: Type.Record(Type.String(), ContentPackItemEntrySchema, {
    description: 'Item definitions keyed by item ID',
  }),
  /** Dialogue fallback strings, keyed by dialogue key */
  dialogues: Type.Record(Type.String(), Type.String(), {
    description: 'Dialogue fallback strings keyed by dialogue key',
  }),
  /** Optional: quest definitions, keyed by quest ID (C-316) */
  quests: Type.Optional(ManifestQuestMapSchema),
  /** Optional: encounter definitions, keyed by encounter ID (C-316) */
  encounters: Type.Optional(ManifestEncounterMapSchema),
  /** Optional: adventure credits (C-316) */
  credits: Type.Optional(ContentPackCreditsSchema),
  /** Optional: onboarding/tutorial hints (C-327) */
  onboarding: Type.Optional(OnboardingSectionSchema),
  /** Optional: class definitions (C-337) */
  classes: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'Class definitions keyed by class ID',
    }),
  ),
  /** Optional: ability definitions (C-337) */
  abilities: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'Ability definitions keyed by feature ID',
    }),
  ),
  /** Optional: faction definitions keyed by faction ID (C-341) */
  factions: Type.Optional(
    Type.Record(Type.String(), FactionDefinitionSchema, {
      description: 'Faction definitions keyed by faction ID',
    }),
  ),
  /** Optional: world interactable definitions keyed by spawn ID (C-342) */
  interactables: Type.Optional(
    Type.Record(Type.String(), ContentPackInteractableEntrySchema, {
      description: 'World interactable definitions keyed by spawn ID',
    }),
  ),
  /** Optional: puzzle definitions keyed by puzzle ID (C-342) */
  puzzles: Type.Optional(
    Type.Record(Type.String(), ContentPackPuzzleSchema, {
      description: 'Puzzle definitions keyed by puzzle ID',
    }),
  ),
  /** Optional: loot tables keyed by table key (C-342). Each table is an array of loot entries. */
  lootTables: Type.Optional(
    Type.Record(Type.String(), Type.Array(ContentPackLootEntrySchema), {
      description: 'Loot tables keyed by table key',
    }),
  ),
});

export type ContentPackManifest = Static<typeof ContentPackManifestSchema>;
