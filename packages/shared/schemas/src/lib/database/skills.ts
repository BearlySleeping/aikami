// packages/shared/schemas/src/lib/database/skills.ts
import Type from 'typebox';

export const AbilityTypeSchema = Type.Union([
  Type.Literal('strength'),
  Type.Literal('dexterity'),
  Type.Literal('constitution'),
  Type.Literal('intelligence'),
  Type.Literal('wisdom'),
  Type.Literal('charisma'),
]);

export type AbilityType = Type.Static<typeof AbilityTypeSchema>;

export const SkillSchema = Type.Object({
  name: Type.String({ description: 'Skill name (e.g., Athletics, Persuasion)' }),
  ability: AbilityTypeSchema,
  isProficient: Type.Boolean({
    description: 'Whether the character is proficient in this skill',
    default: false,
  }),
  isExpertise: Type.Boolean({
    description: 'Whether the character has expertise (double proficiency)',
    default: false,
  }),
});

export type SkillData = Type.Static<typeof SkillSchema>;

export const SavingThrowSchema = Type.Object({
  ability: AbilityTypeSchema,
  isProficient: Type.Boolean({
    description: 'Whether the character is proficient in this save',
    default: false,
  }),
  isExpertise: Type.Boolean({
    description: 'Whether the character has expertise (double proficiency)',
    default: false,
  }),
});

export type SavingThrowData = Type.Static<typeof SavingThrowSchema>;

export const SKILL_ABILITY_MAP: Record<string, AbilityType> = {
  athletics: 'strength',
  acrobatics: 'dexterity',
  'sleight of hand': 'dexterity',
  stealth: 'dexterity',
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  religion: 'intelligence',
  survival: 'wisdom',
  animalHandling: 'wisdom',
  insight: 'wisdom',
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
};

export const DEFAULT_SKILLS: SkillData[] = [
  { name: 'Acrobatics', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Animal Handling', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Arcana', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Athletics', ability: 'strength', isProficient: false, isExpertise: false },
  { name: 'Deception', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'History', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Insight', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Intimidation', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Investigation', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Medicine', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Nature', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Perception', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Performance', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Persuasion', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Religion', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Sleight of Hand', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Stealth', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Survival', ability: 'wisdom', isProficient: false, isExpertise: false },
];

export const DEFAULT_SAVING_THROWS: SavingThrowData[] = [
  { ability: 'strength', isProficient: false, isExpertise: false },
  { ability: 'dexterity', isProficient: false, isExpertise: false },
  { ability: 'constitution', isProficient: false, isExpertise: false },
  { ability: 'intelligence', isProficient: false, isExpertise: false },
  { ability: 'wisdom', isProficient: false, isExpertise: false },
  { ability: 'charisma', isProficient: false, isExpertise: false },
];
