// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_fixtures.ts
//
// Typed, deterministic fixtures for the Obsidian Chronicle sandbox. These are
// deliberately authored (not model-generated) so the design probe renders the
// same way every run and never depends on a live provider.

import type {
  ObsidianActor,
  ObsidianCheck,
  ObsidianCombatAction,
  ObsidianGalleryItem,
  ObsidianItem,
  ObsidianNote,
  ObsidianQuest,
  ObsidianScene,
  ObsidianSummary,
  ObsidianTimelineEntry,
  ObsidianWorldEntry,
} from './obsidian_types';

/** Stable actor IDs shared by the timeline and shell. */
export const OBSIDIAN_PLAYER_ID = 'player';

/** The NPC the default conversation is addressed to. */
export const OBSIDIAN_NPC_ID = 'mira';

/** The enemy in the scripted encounter. */
export const OBSIDIAN_ENEMY_ID = 'goblin-raider';

/** Scene / context header fixture. */
export const OBSIDIAN_SCENE: ObsidianScene = {
  locationName: 'Ashfen Gate — North Watch',
  timeLabel: 'Dusk, 2nd Bell',
  weatherLabel: 'Cold drizzle',
  saveLabel: 'Saved · just now',
  objective: 'Gain entry to Ashfen before curfew',
  objectiveDetail: 'Gatekeeper Mira is wary. Convince her the sealed letter is genuine.',
  sceneCaption: 'Rain streaks the gatehouse. A lantern gutters above the portcullis.',
  sceneHue: 232,
};

/** Party roster fixture. Player first, companions after. */
export const OBSIDIAN_ACTORS: readonly ObsidianActor[] = [
  {
    id: OBSIDIAN_PLAYER_ID,
    name: 'Rook',
    role: 'Warden · Lv 3',
    kind: 'player',
    hp: 26,
    maxHp: 34,
    ac: 16,
    hue: 285,
    conditions: [],
    summary:
      'A disgraced warden carrying a sealed letter and more questions than answers. Quiet, watchful, slow to trust.',
    abilities: [
      { label: 'STR', value: 14 },
      { label: 'DEX', value: 12 },
      { label: 'CON', value: 15 },
      { label: 'INT', value: 10 },
      { label: 'WIS', value: 13 },
      { label: 'CHA', value: 15 },
    ],
    skills: [
      { label: 'Insight', bonus: 3, proficient: true },
      { label: 'Intimidation', bonus: 4, proficient: true },
      { label: 'Perception', bonus: 3, proficient: false },
      { label: 'Persuasion', bonus: 4, proficient: true },
      { label: 'Survival', bonus: 3, proficient: false },
    ],
    features: [
      {
        name: 'Warden\u2019s Oath',
        description: 'Once per rest, reroll a failed Wisdom save.',
      },
      {
        name: 'Letter of Passage',
        description: 'Holds a sealed writ bearing the crest of House Vael.',
      },
    ],
    spells: [
      {
        id: 'spell-shield',
        name: 'Shield',
        level: 1,
        cost: 'Reaction',
        range: 'Self',
        concentration: false,
        description: '+5 AC until the start of your next turn.',
      },
      {
        id: 'spell-hunters-mark',
        name: "Hunter's Mark",
        level: 1,
        cost: 'Bonus Action · 1 slot',
        range: '90 ft',
        concentration: true,
        description: 'Deal +1d6 to the marked target.',
      },
    ],
  },
  {
    id: 'kael',
    name: 'Kael',
    role: 'Blade · Lv 3',
    kind: 'companion',
    hp: 22,
    maxHp: 30,
    ac: 15,
    hue: 12,
    conditions: [{ id: 'bleeding', label: 'Bleeding', tone: 'danger' }],
    relationship: { standing: 'Trusted ally', recent: 'Held the line at the bridge.' },
    summary: 'Sardonic, loyal, and always the first through the door.',
    abilities: [
      { label: 'STR', value: 16 },
      { label: 'DEX', value: 14 },
      { label: 'CON', value: 13 },
      { label: 'INT', value: 9 },
      { label: 'WIS', value: 11 },
      { label: 'CHA', value: 12 },
    ],
    skills: [
      { label: 'Athletics', bonus: 5, proficient: true },
      { label: 'Acrobatics', bonus: 4, proficient: true },
      { label: 'Stealth', bonus: 4, proficient: false },
    ],
    features: [{ name: 'Second Wind', description: 'Regain 1d10 + 3 HP once per rest.' }],
    spells: [],
  },
  {
    id: OBSIDIAN_NPC_ID,
    name: 'Mira',
    role: 'Gatekeeper',
    kind: 'npc',
    hp: 18,
    maxHp: 18,
    ac: 13,
    hue: 45,
    conditions: [],
    relationship: { standing: 'Wary', recent: 'You refused to answer her first question.' },
    summary: 'Tired, careful, and accountable to a captain she does not trust.',
    abilities: [
      { label: 'STR', value: 11 },
      { label: 'DEX', value: 13 },
      { label: 'CON', value: 12 },
      { label: 'INT', value: 12 },
      { label: 'WIS', value: 14 },
      { label: 'CHA', value: 12 },
    ],
    skills: [{ label: 'Insight', bonus: 4, proficient: true }],
    features: [
      { name: 'Gate Authority', description: 'Can bar or admit travellers to Ashfen.' },
      {
        name: 'Crest Skeptic',
        description: 'Has seen three forged writs this season. Advantage on detecting fraud.',
      },
    ],
    spells: [],
  },
];

/** Opening conversation transcript. */
export const OBSIDIAN_TIMELINE: readonly ObsidianTimelineEntry[] = [
  {
    kind: 'narration',
    id: 'seed-narration-1',
    speaker: 'Chronicle',
    text: 'Rain needles the gatehouse roof. The portcullis hangs half-drawn, and a lantern throws long shadows across the mud.',
  },
  {
    kind: 'speech',
    id: 'seed-speech-mira',
    speaker: 'Mira',
    actorId: OBSIDIAN_NPC_ID,
    recipient: 'npc',
    altCount: 0,
    streaming: false,
    text: '"Hold there. Curfew\u2019s past, warden or not. State your business and be quick about it."',
  },
  {
    kind: 'event',
    id: 'seed-event-quest',
    label: 'Quest updated',
    text: 'Gain entry to Ashfen before curfew \u2014 talk your way through the north gate.',
  },
];

/** The pending persuasion check the sandbox can commit. */
export const OBSIDIAN_PERSUASION_CHECK: ObsidianCheck = {
  id: 'check-mira-gate',
  label: 'Persuasion — convince Mira to open the gate',
  abilityLabel: 'CHA',
  abilityModifier: 2,
  proficient: true,
  proficiencyBonus: 2,
  dc: 15,
  hiddenDc: false,
  stakes: {
    success: 'Mira opens the gate and admits your party.',
    failure: 'She refuses and calls for the watch.',
  },
  phase: 'pending',
  committed: false,
};

/** A second, optional check for the combat preview. */
export const OBSIDIAN_ATTACK_CHECK: ObsidianCheck = {
  id: 'check-brazier',
  label: 'Athletics — kick the brazier into the goblins',
  abilityLabel: 'STR',
  abilityModifier: 3,
  proficient: true,
  proficiencyBonus: 2,
  dc: 12,
  hiddenDc: true,
  stakes: {
    success: 'The coals scatter across the raiders.',
    failure: 'The brazier topples short of them.',
  },
  phase: 'pending',
  committed: false,
};

/** Bag contents, including the equipped longsword for comparison. */
export const OBSIDIAN_ITEMS: readonly ObsidianItem[] = [
  {
    id: 'item-longsword',
    name: 'Vael Longsword',
    type: 'Weapon · Martial melee',
    quantity: 1,
    weight: 3,
    value: '35 gp',
    description: 'A pitted longsword bearing the crest of House Vael on the pommel.',
    equippedSlot: 'mainHand',
    favorite: true,
    properties: ['Versatile (1d10)', 'Silvered'],
    modifiers: [
      { label: 'Attack', delta: 5 },
      { label: 'Damage', delta: 3 },
    ],
    attunement: false,
  },
  {
    id: 'item-shortsword',
    name: 'Wayfarer Shortsword',
    type: 'Weapon · Simple melee',
    quantity: 1,
    weight: 2,
    value: '10 gp',
    description: 'Balanced and light. Easier to hide under a cloak than the longsword.',
    equippedSlot: 'offHand',
    favorite: false,
    properties: ['Finesse', 'Light'],
    modifiers: [
      { label: 'Attack', delta: 4 },
      { label: 'Damage', delta: 2 },
    ],
    attunement: false,
  },
  {
    id: 'item-chainmail',
    name: 'Riveted Chainmail',
    type: 'Armor · Heavy',
    quantity: 1,
    weight: 55,
    value: '75 gp',
    description: 'Dented but sound. The left shoulder bears a fresh, unstitched gash.',
    equippedSlot: 'armor',
    favorite: false,
    properties: ['AC 16', 'Stealth disadvantage'],
    modifiers: [{ label: 'AC', delta: 16 }],
    attunement: false,
  },
  {
    id: 'item-warden-ward',
    name: 'Warden\u2019s Ward',
    type: 'Trinket · Wondrous',
    quantity: 1,
    weight: 0,
    value: 'Priceless',
    description: 'A cold iron token that hums near old magic.',
    equippedSlot: 'trinket',
    favorite: true,
    properties: ['Requires attunement'],
    modifiers: [{ label: 'WIS save', delta: 1 }],
    attunement: true,
  },
  {
    id: 'item-potion-heal',
    name: 'Potion of Healing',
    type: 'Consumable',
    quantity: 3,
    weight: 0.5,
    value: '50 gp',
    description: 'Red liquid that tastes of iron and honey.',
    favorite: false,
    properties: ['Action', 'Regain 2d4 + 2 HP'],
    modifiers: [],
    attunement: false,
  },
  {
    id: 'item-rope',
    name: 'Hempen Rope',
    type: 'Gear',
    quantity: 1,
    weight: 10,
    value: '1 gp',
    description: 'Fifty feet, coiled and oiled.',
    favorite: false,
    properties: ['50 ft'],
    modifiers: [],
    attunement: false,
  },
];

/** Journal quests — authoritative progress. */
export const OBSIDIAN_QUESTS: readonly ObsidianQuest[] = [
  {
    id: 'quest-gate',
    title: 'The Ashfen Gate',
    status: 'active',
    objective: 'Gain entry to Ashfen before curfew',
    steps: [
      { id: 'step-1', label: 'Reach the north gate', done: true },
      { id: 'step-2', label: 'Convince Mira to raise the portcullis', done: false },
      { id: 'step-3', label: 'Report to the Warden\u2019s Keep', done: false },
    ],
  },
  {
    id: 'quest-letter',
    title: 'A Sealed Letter',
    status: 'active',
    objective: 'Deliver the Vael writ without breaking the seal',
    steps: [
      { id: 'step-1', label: 'Find someone who recognises the crest', done: false },
      { id: 'step-2', label: 'Protect the letter at all costs', done: true },
    ],
  },
];

/** Player-authored notes. */
export const OBSIDIAN_NOTES: readonly ObsidianNote[] = [
  {
    id: 'note-1',
    title: 'Gatehouse details',
    body: 'Two guards on the wall, one at the winch. The lantern is the only light on the west face.',
    updatedLabel: 'Edited by you · 4 min ago',
  },
  {
    id: 'note-2',
    title: 'The crest',
    body: 'Three towers over a broken wheel. Mira flinched when she saw it — she knows it.',
    updatedLabel: 'Edited by you · yesterday',
  },
];

/** AI-generated summaries with source links. */
export const OBSIDIAN_SUMMARIES: readonly ObsidianSummary[] = [
  {
    id: 'summary-1',
    title: 'Arrival at Ashfen',
    body: 'The party reached the north gate after dusk. Mira challenged them and refused passage pending proof of the writ.',
    sourceLabel: 'From 12 messages · this session',
    stale: false,
  },
  {
    id: 'summary-2',
    title: 'The bridge ambush',
    body: 'Kael was wounded holding the bridge. The attackers carried no insignia, but their boots were new.',
    sourceLabel: 'From 38 messages · yesterday',
    stale: true,
  },
];

/** World knowledge — people, places, factions. */
export const OBSIDIAN_WORLD: readonly ObsidianWorldEntry[] = [
  {
    id: 'world-mira',
    name: 'Mira',
    kind: 'person',
    detail: 'Gatekeeper at Ashfen. Accountable to Captain Rhal. Suspicious of the Vael crest.',
  },
  {
    id: 'world-ashfen',
    name: 'Ashfen',
    kind: 'place',
    detail: 'A river town under curfew. The keep sits above the old flood plain.',
  },
  {
    id: 'world-house-vael',
    name: 'House Vael',
    kind: 'faction',
    detail: 'A diminished noble house. Its crest is rare this far north — and often forged.',
  },
];

/** Gallery references. */
export const OBSIDIAN_GALLERY: readonly ObsidianGalleryItem[] = [
  {
    id: 'gallery-1',
    alt: 'The Ashfen gatehouse at dusk',
    source: 'Scene · this session',
    hue: 232,
  },
  {
    id: 'gallery-2',
    alt: 'Mira, gatekeeper, by lantern light',
    source: 'Portrait · this session',
    hue: 45,
  },
  { id: 'gallery-3', alt: 'The bridge ambush', source: 'Encounter · yesterday', hue: 12 },
];

/** Exploration and combat action dock entries. */
export const OBSIDIAN_ACTIONS_EXPLORATION: readonly ObsidianCombatAction[] = [
  {
    id: 'explore-talk',
    label: 'Talk',
    cost: 'action',
    description: 'Address the nearest character.',
    available: true,
  },
  {
    id: 'explore-inspect',
    label: 'Inspect',
    cost: 'action',
    description: 'Examine an object or mark.',
    available: true,
  },
  {
    id: 'explore-potion',
    label: 'Use Potion',
    cost: 'action',
    description: 'Drink a Potion of Healing.',
    available: true,
  },
];

/** Combat actions with an unavailable example that explains itself. */
export const OBSIDIAN_ACTIONS_COMBAT: readonly ObsidianCombatAction[] = [
  {
    id: 'combat-attack',
    label: 'Attack',
    cost: 'action',
    description: 'Swing the Vael longsword at a target.',
    available: true,
    targetLabel: 'Goblin Raider',
  },
  {
    id: 'combat-cast',
    label: "Hunter's Mark",
    cost: 'bonus',
    description: 'Mark the raider; +1d6 damage on each hit.',
    available: true,
    targetLabel: 'Goblin Raider',
  },
  {
    id: 'combat-dash',
    label: 'Dash',
    cost: 'action',
    description: 'Double your movement for the turn.',
    available: false,
    unavailableReason: 'Action already used this turn.',
  },
  {
    id: 'combat-kick-brazier',
    label: 'Kick the brazier',
    cost: 'action',
    description: 'Scatter burning coals across the raiders. Requires an Athletics check.',
    available: false,
    unavailableReason: 'Out of melee range — move adjacent first.',
    targetLabel: 'Goblin Raider',
  },
];

/** Response text streamed for each recipient context. */
export const OBSIDIAN_REPLIES: Record<string, readonly string[]> = {
  npc: [
    '*Mira studies the wax seal, jaw tight.*\n"Vael. I\u2019ve burned three of these this season. But the wax is old, and you\u2019re not running."\n\nShe steps aside and nods at the winch.\n\n"Go on, then. Keep to the lantern road."',
  ],
  party: [
    '*Kael shoulders his pack and glances at the gate.*\n"About time. I\u2019ll watch the winch — you handle the talking next time."',
  ],
  dm: [
    'The gate opens onto a lantern-lit causeway. Beyond it, Ashfen\u2019s keep glows faintly above the flood plain. What would you like to establish about the town\u2019s mood tonight?',
  ],
};

/** Alternate NPC wordings for the Rephrase control (presentation only). */
export const OBSIDIAN_REPHRASES: readonly string[] = [
  '*Mira turns the seal toward the lantern, then exhales.*\n"Vael. Could be genuine, could be clever. Either way, curfew\u2019s already broken."\n\nShe signals the winch and steps back.\n\n"Inside. Keep to the lantern road and cause no trouble."',
  '*Mira presses her thumb into the wax and frowns.*\n"An old seal. I\u2019ll allow it — but I\u2019m noting your face."\n\nWith a creak, the portcullis lifts.\n\n"Move along. The watch is watching."',
];
