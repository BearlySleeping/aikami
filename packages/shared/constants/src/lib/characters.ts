// packages/shared/constants/src/lib/characters.ts
//
// Character onboarding data: pronouns, play-style tags, class presets,
// species options, starter heroes, appearance presets, random names,
// ability labels, and onboarding step constants.
// Contract: C-319 Replace /setup with Fast Character Onboarding

// ── Pronouns ─────────────────────────────────────────────────────────

export type PronounSet = {
  id: string;
  subjective: string; // "he", "she", "they"
  objective: string; // "him", "her", "them"
  possessive: string; // "his", "her", "their"
  reflexive: string; // "himself", "herself", "themself"
};

export const PRONOUN_SETS: readonly PronounSet[] = [
  { id: 'he_him', subjective: 'he', objective: 'him', possessive: 'his', reflexive: 'himself' },
  { id: 'she_her', subjective: 'she', objective: 'her', possessive: 'her', reflexive: 'herself' },
  {
    id: 'they_them',
    subjective: 'they',
    objective: 'them',
    possessive: 'their',
    reflexive: 'themself',
  },
] as const;

// ── Play-Style Tags ──────────────────────────────────────────────────

export type PlayStyleTag = {
  id: string;
  label: string;
  description: string;
};

export const PLAY_STYLE_TAGS: readonly PlayStyleTag[] = [
  { id: 'melee', label: 'Melee', description: 'Up-close combat with weapons' },
  { id: 'ranged', label: 'Ranged', description: 'Attacks from a distance' },
  { id: 'magic', label: 'Magic', description: 'Spellcasting and arcane arts' },
  { id: 'support', label: 'Support', description: 'Healing, buffs, and utility' },
  { id: 'stealth', label: 'Stealth', description: 'Sneaking, traps, and subterfuge' },
  { id: 'social', label: 'Social', description: 'Persuasion, deception, and charm' },
] as const;

// ── Ability Key (shared across data models) ──────────────────────────

export type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

// ── Class Presets ────────────────────────────────────────────────────

export type ClassPreset = {
  id: string;
  label: string;
  description: string;
  playStyleIds: string[];
  primaryAbility: AbilityKey;
  secondaryAbility: AbilityKey;
  suggestedEquipment: string[];
};

export const CLASS_PRESETS: readonly ClassPreset[] = [
  {
    id: 'fighter',
    label: 'Fighter',
    description: 'A master of martial combat, skilled with a variety of weapons and armor.',
    playStyleIds: ['melee', 'ranged'],
    primaryAbility: 'strength',
    secondaryAbility: 'constitution',
    suggestedEquipment: ['Longsword', 'Shield', 'Chain Mail', "Explorer's Pack"],
  },
  {
    id: 'wizard',
    label: 'Wizard',
    description: 'A scholarly magic-user capable of manipulating the structures of reality.',
    playStyleIds: ['magic'],
    primaryAbility: 'intelligence',
    secondaryAbility: 'constitution',
    suggestedEquipment: ['Spellbook', 'Quarterstaff', "Scholar's Pack"],
  },
  {
    id: 'rogue',
    label: 'Rogue',
    description: 'A scoundrel who uses stealth and trickery to overcome obstacles.',
    playStyleIds: ['stealth', 'melee'],
    primaryAbility: 'dexterity',
    secondaryAbility: 'intelligence',
    suggestedEquipment: ['Shortsword', 'Shortbow', 'Leather Armor', "Burglar's Pack"],
  },
  {
    id: 'cleric',
    label: 'Cleric',
    description: 'A priestly champion who wields divine magic in service of a higher power.',
    playStyleIds: ['support', 'magic'],
    primaryAbility: 'wisdom',
    secondaryAbility: 'strength',
    suggestedEquipment: ['Mace', 'Shield', 'Scale Mail', "Priest's Pack"],
  },
  {
    id: 'ranger',
    label: 'Ranger',
    description: 'A warrior who combats threats on the edges of civilization.',
    playStyleIds: ['ranged', 'melee'],
    primaryAbility: 'dexterity',
    secondaryAbility: 'wisdom',
    suggestedEquipment: ['Longbow', 'Shortsword', 'Leather Armor', "Explorer's Pack"],
  },
  {
    id: 'bard',
    label: 'Bard',
    description: 'An inspiring performer whose words and music weave magic.',
    playStyleIds: ['magic', 'social'],
    primaryAbility: 'charisma',
    secondaryAbility: 'dexterity',
    suggestedEquipment: ['Rapier', 'Lute', 'Leather Armor', "Entertainer's Pack"],
  },
  {
    id: 'paladin',
    label: 'Paladin',
    description: 'A holy warrior bound to a sacred oath.',
    playStyleIds: ['melee', 'support'],
    primaryAbility: 'strength',
    secondaryAbility: 'charisma',
    suggestedEquipment: ['Longsword', 'Shield', 'Chain Mail', "Priest's Pack"],
  },
  {
    id: 'druid',
    label: 'Druid',
    description: 'A nature priest who draws power from the primal forces.',
    playStyleIds: ['magic', 'support'],
    primaryAbility: 'wisdom',
    secondaryAbility: 'constitution',
    suggestedEquipment: ['Scimitar', 'Wooden Shield', 'Leather Armor', "Explorer's Pack"],
  },
] as const;

// ── Species/Races ────────────────────────────────────────────────────

export type SpeciesOption = {
  id: string;
  label: string;
  description: string;
  suggestedClasses: string[];
};

export const SPECIES_OPTIONS: readonly SpeciesOption[] = [
  {
    id: 'human',
    label: 'Human',
    description: 'Versatile and ambitious — the most common folk of the realms.',
    suggestedClasses: ['fighter', 'wizard', 'cleric'],
  },
  {
    id: 'elf',
    label: 'Elf',
    description: 'Graceful and long-lived, with keen senses and innate magic.',
    suggestedClasses: ['wizard', 'ranger', 'bard'],
  },
  {
    id: 'dwarf',
    label: 'Dwarf',
    description: 'Stout and hardy, masters of stone and forge.',
    suggestedClasses: ['fighter', 'cleric', 'paladin'],
  },
  {
    id: 'halfling',
    label: 'Halfling',
    description: 'Small, lucky, and surprisingly brave.',
    suggestedClasses: ['rogue', 'bard', 'ranger'],
  },
  {
    id: 'tiefling',
    label: 'Tiefling',
    description: 'Infernal heritage grants dark charisma and fire resistance.',
    suggestedClasses: ['wizard', 'bard', 'rogue'],
  },
  {
    id: 'dragonborn',
    label: 'Dragonborn',
    description: 'Proud draconic humanoids with breath weapons.',
    suggestedClasses: ['paladin', 'fighter', 'cleric'],
  },
  {
    id: 'gnome',
    label: 'Gnome',
    description: 'Clever inventors and illusionists with boundless curiosity.',
    suggestedClasses: ['wizard', 'rogue', 'bard'],
  },
  {
    id: 'half_orc',
    label: 'Half-Orc',
    description: 'Fierce and resilient, with a relentless spirit.',
    suggestedClasses: ['fighter', 'barbarian', 'ranger'],
  },
] as const;

// ── Starter Heroes ───────────────────────────────────────────────────

export type StarterHero = {
  id: string;
  name: string;
  pronouns: PronounSet;
  race: string;
  class: string;
  alignment: string;
  abilityScores: Record<string, number>;
  equipment: string[];
  appearance: string;
  personalityTraits: string;
  background: string;
  flavorText: string;
  /** Asset key for the starter card illustration (placeholder for now). */
  illustrationAsset: string;
};

export const STARTER_HEROES: readonly StarterHero[] = [
  {
    id: 'starter_thaldrin',
    name: 'Thaldrin',
    pronouns: {
      id: 'he_him',
      subjective: 'he',
      objective: 'him',
      possessive: 'his',
      reflexive: 'himself',
    },
    race: 'Human',
    class: 'Fighter',
    alignment: 'Lawful Good',
    abilityScores: {
      strength: 15,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 13,
      charisma: 8,
    },
    equipment: ['Longsword', 'Shield', 'Chain Mail', "Explorer's Pack"],
    appearance:
      'Tall and broad-shouldered with short brown hair and a scar across his left cheek. Wears polished chain mail with a faded military tabard.',
    personalityTraits: 'Disciplined and protective. Believes in second chances.',
    background:
      'A former town guard who left his post after failing to prevent a tragedy. Seeks redemption through heroic deeds.',
    flavorText: 'A steadfast protector seeking redemption for past failures.',
    illustrationAsset: 'starter_thaldrin',
  },
  {
    id: 'starter_lyra',
    name: 'Lyra',
    pronouns: {
      id: 'she_her',
      subjective: 'she',
      objective: 'her',
      possessive: 'her',
      reflexive: 'herself',
    },
    race: 'Elf',
    class: 'Wizard',
    alignment: 'Neutral Good',
    abilityScores: {
      strength: 8,
      dexterity: 14,
      constitution: 12,
      intelligence: 15,
      wisdom: 13,
      charisma: 10,
    },
    equipment: ['Spellbook', 'Quarterstaff', 'Component Pouch', "Scholar's Pack"],
    appearance:
      'Slender with silver-white hair and violet eyes. Wears deep blue robes embroidered with silver constellations.',
    personalityTraits: 'Curious and analytical. Speaks in precise, measured sentences.',
    background:
      'A former apprentice at the Arcane Academy who discovered forbidden knowledge about the Fading Ward. Now seeks to understand and contain the threat.',
    flavorText: 'A brilliant scholar drawn into adventure by forbidden knowledge.',
    illustrationAsset: 'starter_lyra',
  },
  {
    id: 'starter_zeph',
    name: 'Zeph',
    pronouns: {
      id: 'they_them',
      subjective: 'they',
      objective: 'them',
      possessive: 'their',
      reflexive: 'themself',
    },
    race: 'Tiefling',
    class: 'Rogue',
    alignment: 'Chaotic Good',
    abilityScores: {
      strength: 10,
      dexterity: 15,
      constitution: 12,
      intelligence: 13,
      wisdom: 8,
      charisma: 14,
    },
    equipment: ['Shortsword', 'Shortbow', 'Leather Armor', "Thieves' Tools", "Burglar's Pack"],
    appearance:
      'Lean with deep crimson skin, curved horns, and a perpetual smirk. Wears dark fitted leather with too many hidden pockets.',
    personalityTraits: 'Charming and irreverent. Uses humor to deflect serious situations.',
    background:
      'Grew up on the streets of a port city, running cons on corrupt merchants. Stole the wrong artifact and now has bounty hunters on their trail.',
    flavorText: 'A silver-tongued scoundrel with a heart of (mostly) gold.',
    illustrationAsset: 'starter_zeph',
  },
] as const;

// ── D&D Standard Array & Ability Labels ─────────────────────────────

export const DND_STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8] as const;

export const ABILITY_LABELS: Record<AbilityKey, { label: string; description: string }> = {
  strength: { label: 'STR', description: 'Physical power and melee attack bonus' },
  dexterity: { label: 'DEX', description: 'Agility, ranged attacks, and armor class' },
  constitution: { label: 'CON', description: 'Endurance and hit point bonus' },
  intelligence: { label: 'INT', description: 'Reasoning, memory, and wizard spell power' },
  wisdom: { label: 'WIS', description: 'Perception, insight, and cleric/druid spell power' },
  charisma: { label: 'CHA', description: 'Force of personality and bard/paladin spell power' },
} as const;

// ── Onboarding Steps ─────────────────────────────────────────────────

/** Step in the custom hero creation flow. */
export type OnboardingStep = 'identity' | 'play_style' | 'appearance' | 'review';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'identity',
  'play_style',
  'appearance',
  'review',
] as const;

// ── Appearance Presets ───────────────────────────────────────────────

export type AppearancePreset = {
  id: string;
  label: string;
  description: string;
};

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  {
    id: 'battle_scarred',
    label: 'Battle-Scarred Veteran',
    description: 'Weathered face marked by old battles. Scars tell stories of campaigns past.',
  },
  {
    id: 'scholarly',
    label: 'Scholarly Robes',
    description:
      'Practical academic attire — ink-stained fingers, well-worn robes, spectacles perched on the nose.',
  },
  {
    id: 'mysterious',
    label: 'Mysterious Wanderer',
    description:
      "A hooded cloak shadows the face; worn traveler's boots and a tattered map peeking from a pocket.",
  },
  {
    id: 'noble',
    label: 'Noble Bearing',
    description:
      "Fine clothes and impeccable posture. Jewelry that's elegant but practical — a sign of old money.",
  },
  {
    id: 'wild',
    label: 'Child of the Wilds',
    description:
      'Leather and fur garments, feathers woven into braided hair, dirt under the fingernails.',
  },
  {
    id: 'rogue_chic',
    label: "Rogue's Chic",
    description: 'Stylish but functional dark attire. Too many hidden pockets, a disarming smile.',
  },
  {
    id: 'divine',
    label: 'Divine Aura',
    description:
      'Simple robes with holy symbols. A calm, otherworldly presence that puts allies at ease.',
  },
  {
    id: 'arcane',
    label: 'Arcane Elegance',
    description:
      'Rich fabrics with subtle magical embroidery. The faint smell of incense and old parchment.',
  },
] as const;

// ── Random Names ─────────────────────────────────────────────────────

export const RANDOM_FANTASY_NAMES: readonly string[] = [
  'Aldric',
  'Brynn',
  'Caelum',
  'Darian',
  'Elara',
  'Finnian',
  'Gwendolyn',
  'Hadrian',
  'Ilyana',
  'Jorah',
  'Kaelen',
  'Liora',
  'Magnus',
  'Nerys',
  'Orianna',
  'Peregrine',
  'Quill',
  'Rowan',
  'Selene',
  'Theron',
  'Ursa',
  'Vesper',
  'Wren',
  'Xander',
  'Ysolde',
  'Zephyr',
  'Aurelia',
  'Balthazar',
  'Corvus',
  'Delphine',
] as const;

// ── Random Backgrounds ───────────────────────────────────────────────

export const RANDOM_BACKGROUNDS: readonly string[] = [
  'A former soldier haunted by the ghosts of fallen comrades.',
  'A street urchin who learned to survive by wit and charm.',
  'A scholar exiled from the academy for forbidden research.',
  'A merchant who lost everything to pirates and seeks a new life.',
  'A farmer whose village was destroyed — now wanders seeking purpose.',
  'A noble disowned for refusing an arranged marriage.',
  'A shipwreck survivor who spent years on a mysterious island.',
  'A temple acolyte who broke their vows to save a friend.',
  "A travelling performer who witnessed something they shouldn't have.",
  'A hunter from the deep woods who rarely speaks of the past.',
] as const;

// ── Random Personality Traits ────────────────────────────────────────

export const RANDOM_PERSONALITIES: readonly string[] = [
  'Quiet and observant, but fiercely loyal to those they trust.',
  'Boisterous and charismatic — the life of any tavern.',
  'Methodical and precise — everything in its proper place.',
  'Reckless and daring, with a laugh that defies danger.',
  'Kind-hearted but naive, always seeing the best in people.',
  'Cynical and world-weary, but unable to walk away from those in need.',
  'Curious to a fault — cannot resist a mystery or locked door.',
  'Proud and stubborn, but with a deep sense of honor.',
] as const;
