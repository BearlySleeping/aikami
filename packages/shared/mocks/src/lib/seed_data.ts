// packages/shared/mocks/src/lib/seed_data.ts
// Emulator seed data: test users, NPCs, personas, and other fixtures.

import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS } from '@aikami/schemas';
import type { NpcCreateData, PersonaCreateData } from '@aikami/types';

// ── Test Users & Password ──────────────────────────────────

export const EMULATOR_PASSWORD = 'asdasd';

export const EMULATOR_USERS = [
  { email: 'admin@example.com', displayName: 'Admin User', userRole: 'superAdmin' as const },
  { email: 'user@example.com', displayName: 'Regular User', userRole: 'member' as const },
] as const;

export type EmulatorUser = (typeof EMULATOR_USERS)[number];

// ── Google-Simulated Users for Emulator OAuth ─────────────────

/**
 * Pre-imported Google users for the Auth emulator.
 *
 * The emulator cannot perform real OAuth redirects — we simulate Google sign-in
 * by pre-importing users with `providerData[0].providerId: 'google.com'`.
 * Users select their account in the emulator's fake sign-in popup.
 *
 * - `preExisting` users get a Firestore user doc + persona (returning player).
 * - `fresh` users get only an Auth account (new player onboarding).
 */
export const EMULATOR_GOOGLE_USERS = [
  {
    email: 'aragorn.ranger@example.com',
    displayName: 'Aragorn the Ranger',
    userRole: 'member' as const,
    preExisting: true,
  },
  {
    email: 'new.adventurer@example.com',
    displayName: 'Fresh Adventurer',
    userRole: 'member' as const,
    preExisting: false,
  },
] as const;

export type EmulatorGoogleUser = (typeof EMULATOR_GOOGLE_USERS)[number];

// ── Persona for Pre-Existing Google User ─────────────────────

/** Rich ranger persona for the pre-existing Google user (aragorn.ranger). */
export const EMULATOR_GOOGLE_PERSONA_DATA = {
  name: 'Aragorn',
  race: 'Human',
  class: 'Ranger',
  level: 12,
  experiencePoints: 75000,
  abilityScores: {
    strength: 17,
    dexterity: 18,
    constitution: 16,
    intelligence: 15,
    wisdom: 17,
    charisma: 16,
  },
  hitPoints: 110,
  temporaryHitPoints: 0,
  savingThrows: DEFAULT_SAVING_THROWS,
  skills: DEFAULT_SKILLS,
  armorClass: 16,
  speed: 30,
  alignment: 'Lawful Good' as const,
  background: 'Noble',
  proficiencies: ['Longsword', 'Longbow', 'Survival', 'Stealth', 'Animal Handling'],
  languages: ['Common', 'Elvish', 'Sindarin', 'Orc'],
  equipment: ['Andúril', 'Bow of the Galadhrim', 'Elven Cloak', 'Healing Herbs'],
  inventory: [
    'Andúril',
    'Bow of the Galadhrim',
    'Elven Cloak',
    'Healing Herbs',
    'Map of Middle-earth',
    'Lembas Bread',
  ],
  isActive: true,
} satisfies Omit<import('@aikami/types').PersonaCreateData, 'uid'>;

// ── NPC Seed Data ──────────────────────────────────────────

export const EMULATOR_NPCS: NpcCreateData[] = [
  {
    name: 'aragon',
    race: 'Human',
    class: 'Ranger',
    level: 15,
    experiencePoints: 100000,
    abilityScores: {
      strength: 18,
      dexterity: 16,
      constitution: 16,
      intelligence: 14,
      wisdom: 15,
      charisma: 16,
    },
    hitPoints: 150,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 18,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Noble',
    proficiencies: ['Longsword', 'Bow', 'Survival', 'Athletics'],
    languages: ['Common', 'Elvish', 'Sindarin'],
    equipment: ['Andúril', 'Bow', 'Elven Cloak'],
    inventory: ['Andúril', 'Bow', 'Elven Cloak'],
    isFriendly: true,
    visibility: 'public',
  },
  {
    name: 'Gandalf',
    race: 'Maiar',
    class: 'Wizard',
    level: 20,
    experiencePoints: 355000,
    abilityScores: {
      strength: 14,
      dexterity: 14,
      constitution: 16,
      intelligence: 20,
      wisdom: 20,
      charisma: 18,
    },
    hitPoints: 120,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 12,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Sage',
    proficiencies: ['Staff', 'Arcana', 'History', 'Insight'],
    languages: ['Common', 'Elvish', 'Valarin'],
    equipment: ["Wizard's Staff", 'Glamdring', 'Narya'],
    inventory: ["Wizard's Staff", 'Glamdring', 'Narya'],
    isFriendly: true,
    visibility: 'public',
  },
  {
    name: 'Orc',
    race: 'Orc',
    class: 'Barbarian',
    level: 5,
    experiencePoints: 6500,
    abilityScores: {
      strength: 18,
      dexterity: 12,
      constitution: 16,
      intelligence: 8,
      wisdom: 10,
      charisma: 8,
    },
    hitPoints: 60,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 13,
    speed: 30,
    alignment: 'Chaotic Evil',
    background: 'Soldier',
    proficiencies: ['Greataxe', 'Intimidation', 'Athletics'],
    languages: ['Common', 'Orc'],
    equipment: ['Greataxe', 'Javelins', 'Leather Armor'],
    inventory: ['Greataxe', 'Javelins', 'Leather Armor', 'Trophy Teeth'],
    isFriendly: false,
    visibility: 'public',
  },
  {
    name: 'Troll',
    race: 'Troll',
    class: 'Monk',
    level: 8,
    experiencePoints: 24000,
    abilityScores: {
      strength: 20,
      dexterity: 14,
      constitution: 18,
      intelligence: 6,
      wisdom: 12,
      charisma: 6,
    },
    hitPoints: 95,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 14,
    speed: 40,
    alignment: 'Chaotic Evil',
    background: 'Outlander',
    proficiencies: ['Unarmed Strike', 'Intimidation', 'Survival'],
    languages: ['Common', 'Orc'],
    equipment: ['Claws (natural)', 'Greatclub'],
    inventory: ['Claws (natural)', 'Greatclub', 'Goblin Ears'],
    isFriendly: false,
    visibility: 'public',
  },
];

// ── Persona Seed Data ──────────────────────────────────────

export const EMULATOR_PERSONA_DATA = {
  name: 'Test User',
  race: 'Human',
  class: 'Wizard',
  level: 1,
  experiencePoints: 0,
  abilityScores: {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  },
  hitPoints: 10,
  temporaryHitPoints: 0,
  savingThrows: DEFAULT_SAVING_THROWS,
  skills: DEFAULT_SKILLS,
  armorClass: 10,
  speed: 30,
  alignment: 'Neutral' as const,
  background: 'Sage',
  proficiencies: [] as string[],
  languages: ['Common'] as string[],
  equipment: [] as string[],
  inventory: [] as string[],
  isActive: true,
} satisfies Omit<PersonaCreateData, 'uid'>;
