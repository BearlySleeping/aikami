// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_sandbox_projections.ts
//
// Pure, side-effect-free projections and copy for the Obsidian Chronicle
// sandbox. Keeping these out of the ViewModel module keeps that class focused
// on state ownership and lets the display math be unit-tested directly.

import { OBSIDIAN_ENEMY_ID, OBSIDIAN_NPC_ID, OBSIDIAN_REPLIES } from './obsidian_fixtures';
import type {
  ObsidianActor,
  ObsidianCheck,
  ObsidianCheckDisplay,
  ObsidianCombatAction,
  ObsidianComparisonRow,
  ObsidianEquippedRow,
  ObsidianEquipSlot,
  ObsidianHistoryFilter,
  ObsidianInitiativeEntry,
  ObsidianItem,
  ObsidianNavItem,
  ObsidianPartyRow,
  ObsidianRecipient,
  ObsidianRecipientOption,
  ObsidianSuggestion,
  ObsidianTimelineEntry,
} from './obsidian_types';

/** Rules reminder shown beneath a pending ability check. */
export const SKILL_CHECK_NOTE =
  'A natural 20 is not automatic success on an ability check — only the total against the DC decides.';

/** Empty scoped drafts keyed by recipient. */
export const EMPTY_DRAFTS: Record<ObsidianRecipient, string> = { npc: '', party: '', dm: '' };

/** Default action economy for a fresh turn. */
export const DEFAULT_ECONOMY = { action: 1, bonus: 1, reaction: 1, movement: 30 };

/** Codex navigation entries. */
export const NAV_ITEMS: readonly ObsidianNavItem[] = [
  { id: 'character', label: 'Character', shortcut: 'C' },
  { id: 'inventory', label: 'Inventory', shortcut: 'I' },
  { id: 'journal', label: 'Journal', shortcut: 'J' },
  { id: 'party', label: 'Party', shortcut: 'P' },
  { id: 'world', label: 'World', shortcut: 'W' },
];

/** Composer recipient options. */
export const RECIPIENT_OPTIONS: readonly ObsidianRecipientOption[] = [
  { id: 'npc', label: 'Mira — Gatekeeper', hint: 'In-world conversation' },
  { id: 'party', label: 'Party', hint: 'Speak to your companions' },
  { id: 'dm', label: 'Dungeon Master', hint: 'Out of character' },
];

/** Secondary composer suggestions. */
export const SUGGESTION_CHIPS: readonly ObsidianSuggestion[] = [
  {
    id: 'show-letter',
    label: 'Show her the sealed letter',
    prefill: 'I set the sealed letter on the counter and turn the crest toward her.',
  },
  {
    id: 'ask-crest',
    label: 'Ask about the crest',
    prefill: 'That flinch — you know this crest. Tell me what it means to you.',
  },
];

/** Formats a value with an explicit leading sign. */
export const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

/** Maps an HP ratio to a semantic tone. */
export const hpTone = (ratio: number): 'success' | 'warning' | 'danger' => {
  if (ratio <= 0.25) {
    return 'danger';
  }
  if (ratio <= 0.5) {
    return 'warning';
  }
  return 'success';
};

/** History filter — presentation only. */
export const filterTimeline = (
  entries: readonly ObsidianTimelineEntry[],
  filter: ObsidianHistoryFilter,
): readonly ObsidianTimelineEntry[] => {
  if (filter === 'all') {
    return entries;
  }
  if (filter === 'conversation') {
    return entries.filter((entry) => entry.kind === 'speech' || entry.kind === 'narration');
  }
  return entries.filter(
    (entry) =>
      entry.kind === 'check' ||
      entry.kind === 'consequence' ||
      entry.kind === 'action' ||
      entry.kind === 'event',
  );
};

/** Builds the party rail rows. */
export const buildPartyRows = (
  actors: readonly ObsidianActor[],
  activeActorId: string,
): readonly ObsidianPartyRow[] =>
  actors
    .filter((actor) => actor.kind !== 'npc')
    .map((actor) => ({
      id: actor.id,
      name: actor.name,
      role: actor.role,
      hue: actor.hue,
      hp: actor.hp,
      maxHp: actor.maxHp,
      hpPercent: Math.round((actor.hp / actor.maxHp) * 100),
      hpTone: hpTone(actor.hp / actor.maxHp),
      isActive: actor.id === activeActorId,
      isPlayer: actor.kind === 'player',
      conditionLabels: actor.conditions.map((condition) => condition.label),
    }));

/** Builds comparison rows for the selected item against its equipped slot. */
export const buildComparisonRows = (
  items: readonly ObsidianItem[],
  equippedBySlot: Record<ObsidianEquipSlot, string | undefined>,
  selected: ObsidianItem | undefined,
): readonly ObsidianComparisonRow[] => {
  if (!selected?.equippedSlot) {
    return [];
  }
  const slot = selected.equippedSlot;
  const current = items.find((item) => item.id === equippedBySlot[slot]);
  const labels = new Set<string>([
    ...selected.modifiers.map((modifier) => modifier.label),
    ...(current?.modifiers ?? []).map((modifier) => modifier.label),
  ]);
  return [...labels].map((label) => {
    const incoming = selected.modifiers.find((modifier) => modifier.label === label)?.delta ?? 0;
    const existing = current?.modifiers.find((modifier) => modifier.label === label)?.delta ?? 0;
    const delta = incoming - existing;
    return {
      label,
      currentLabel: signed(existing),
      incomingLabel: signed(incoming),
      delta,
      isGain: delta >= 0,
    };
  });
};

/** Builds equipped-slot summary rows. */
export const buildEquippedRows = (
  items: readonly ObsidianItem[],
  equippedBySlot: Record<ObsidianEquipSlot, string | undefined>,
): readonly ObsidianEquippedRow[] => {
  const slotLabels: Record<ObsidianEquipSlot, string> = {
    mainHand: 'Main hand',
    offHand: 'Off hand',
    armor: 'Armor',
    trinket: 'Trinket',
  };
  return (Object.keys(slotLabels) as ObsidianEquipSlot[]).map((slot) => {
    const item = items.find((candidate) => candidate.id === equippedBySlot[slot]);
    return { slot, slotLabel: slotLabels[slot], itemName: item?.name ?? 'Empty' };
  });
};

/** Joins the non-empty equipped item names. */
export const buildEquipmentSummary = (rows: readonly ObsidianEquippedRow[]): string =>
  rows
    .filter((row) => row.itemName !== 'Empty')
    .map((row) => row.itemName)
    .join(' · ');

/** Whether the selected item is the one currently equipped in its slot. */
export const isItemEquipped = (
  item: ObsidianItem | undefined,
  equippedBySlot: Record<ObsidianEquipSlot, string | undefined>,
): boolean => {
  if (!item?.equippedSlot) {
    return false;
  }
  return equippedBySlot[item.equippedSlot] === item.id;
};

/** Precomputes check labels for rendering. */
export const buildCheckDisplay = (check: ObsidianCheck): ObsidianCheckDisplay => {
  const modifier = check.abilityModifier + (check.proficient ? check.proficiencyBonus : 0);
  return {
    abilityLabel: check.abilityLabel,
    abilityModifierLabel: signed(check.abilityModifier),
    proficiencyLabel: check.proficient ? `+${check.proficiencyBonus}` : '—',
    modifierLabel: signed(modifier),
    dcLabel: check.hiddenDc ? 'DC hidden' : `DC ${check.dc}`,
    targetLabel: check.hiddenDc ? 'hidden' : `${check.dc - modifier}`,
  };
};

/** Human label for a check phase. */
export const checkPhaseLabel = (check: ObsidianCheck): string => {
  if (check.phase === 'pending') {
    return 'Check';
  }
  if (check.phase === 'rolling') {
    return 'Rolling';
  }
  return 'Result';
};

/** Display label for the active recipient. */
export const recipientLabelFor = (recipient: ObsidianRecipient): string => {
  if (recipient === 'npc') {
    return 'Mira — Gatekeeper';
  }
  if (recipient === 'party') {
    return 'Party';
  }
  return 'Dungeon Master';
};

/** Audience disclosure for the composer. */
export const audienceLabelFor = (recipient: ObsidianRecipient): string => {
  if (recipient === 'npc') {
    return 'Heard by: nearby party';
  }
  if (recipient === 'party') {
    return 'Heard by: the selected companion';
  }
  return 'Out of character · no one in-world';
};

/** First canned reply for a recipient context. */
export const replyFor = (recipient: ObsidianRecipient): string => {
  const replies = OBSIDIAN_REPLIES[recipient] ?? OBSIDIAN_REPLIES.npc;
  return replies?.[0] ?? '';
};

/** Speaker name for a recipient context. */
export const speakerFor = (recipient: ObsidianRecipient): string => {
  if (recipient === 'npc') {
    return 'Mira';
  }
  if (recipient === 'party') {
    return 'Kael';
  }
  return 'Dungeon Master';
};

/** Actor id attached to a recipient's reply. */
export const actorIdFor = (recipient: ObsidianRecipient): string | undefined => {
  if (recipient === 'npc') {
    return OBSIDIAN_NPC_ID;
  }
  if (recipient === 'party') {
    return 'kael';
  }
  return undefined;
};

/** Recomputes combat action availability against the current economy. */
export const buildAvailableCombatActions = (
  base: readonly ObsidianCombatAction[],
  economy: { readonly action: number; readonly bonus: number },
): readonly ObsidianCombatAction[] =>
  base.map((action) => {
    if (action.id === 'combat-attack' && economy.action <= 0) {
      return { ...action, available: false, unavailableReason: 'Action already used this turn.' };
    }
    if (action.id === 'combat-cast' && economy.bonus <= 0) {
      return {
        ...action,
        available: false,
        unavailableReason: 'Bonus action already used this turn.',
      };
    }
    return action;
  });

/** Resolves after the given delay. */
export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Rolls a single d20. */
export const rollD20 = (): number => Math.floor(Math.random() * 20) + 1;

/** Initiative after a hit, or the same array when the target is absent. */
export const applyDamageToInitiative = (
  initiative: readonly ObsidianInitiativeEntry[],
  actorId: string,
  amount: number,
): ObsidianInitiativeEntry[] =>
  initiative.map((entry) =>
    entry.actorId === actorId ? { ...entry, hp: Math.max(0, entry.hp - amount) } : entry,
  );

/** Actors after a hit. */
export const applyDamageToActor = (
  actors: readonly ObsidianActor[],
  actorId: string,
  amount: number,
): ObsidianActor[] =>
  actors.map((actor) =>
    actor.id === actorId ? { ...actor, hp: Math.max(0, actor.hp - amount) } : actor,
  );

/** Initiative with exactly one actor marked current. */
export const markCurrentActor = (
  initiative: readonly ObsidianInitiativeEntry[],
  actorId: string,
): ObsidianInitiativeEntry[] =>
  initiative.map((entry) => ({ ...entry, isCurrent: entry.actorId === actorId }));

/** The outcome of ending a turn. */
export type TurnAdvance = {
  readonly currentActorId: string;
  readonly round: number;
  readonly enemyActs: boolean;
};

/** Advances initiative, reporting a wrap and whether the enemy acts next. */
export const advanceTurn = (
  initiative: readonly ObsidianInitiativeEntry[],
  currentActorId: string,
  round: number,
): TurnAdvance => {
  const currentIndex = initiative.findIndex((entry) => entry.actorId === currentActorId);
  const nextIndex = (currentIndex + 1) % initiative.length;
  const nextActorId = initiative[nextIndex]?.actorId ?? '';
  if (nextActorId === OBSIDIAN_ENEMY_ID) {
    return { currentActorId: nextActorId, round, enemyActs: true };
  }
  if (nextIndex === 0) {
    return { currentActorId: nextActorId, round: round + 1, enemyActs: false };
  }
  return { currentActorId: nextActorId, round, enemyActs: false };
};

/** Finds a check record by id in the timeline. */
export const findCheck = (
  entries: readonly ObsidianTimelineEntry[],
  checkId: string,
): ObsidianCheck | undefined => {
  for (const entry of entries) {
    if (entry.kind === 'check' && entry.check.id === checkId) {
      return entry.check;
    }
  }
  return undefined;
};
