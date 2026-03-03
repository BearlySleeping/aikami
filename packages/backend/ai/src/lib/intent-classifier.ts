import { googleAI } from '@genkit-ai/googleai';
import { genkit, z } from 'genkit';

const ai = genkit({
  plugins: [googleAI()],
});

const ROLL_TRIGGER_PHRASES = [
  'try to',
  'attempt to',
  'want to',
  'going to',
  'I will',
  'I want to',
  'can I',
  'should I',
  'roll',
  'check',
  'save',
  'attack',
  'hit',
  'sneak',
  'climb',
  'jump',
  'swim',
  'run',
  'hide',
  'pick',
  'lock',
  'persuade',
  'intimidate',
  'deceive',
  'insight',
  'perception',
  'investigation',
  'arcana',
  'religion',
  'nature',
  'survival',
  'animal',
  'performance',
  'acrobatics',
  'athletics',
  'sleight',
  'stealth',
];

const SKILL_KEYWORDS: Record<string, string[]> = {
  athletics: ['climb', 'jump', 'swim', 'strength', 'athletic', 'climbing', 'jumping', 'swimming'],
  acrobatics: ['flip', 'tumble', 'roll', 'balance', 'acrobatics', 'balancing'],
  'sleight of hand': ['pick pocket', 'steal', 'sleight', 'palming', 'conceal'],
  stealth: ['sneak', 'hide', 'stealth', 'sneaking', 'hidden', 'quiet'],
  arcana: ['magic', 'spell', 'arcane', 'spellcasting', 'magical'],
  history: ['history', 'historical', 'past', 'ancient', 'lore'],
  investigation: ['investigate', 'search', 'find', 'clue', 'evidence', 'investigation'],
  medicine: ['heal', 'medicine', 'treat', 'wound', 'medical'],
  nature: ['nature', 'animal', 'plant', 'weather', 'environment'],
  perception: ['notice', 'see', 'hear', 'spot', 'perception', 'watch'],
  religion: ['god', 'deity', 'religious', 'prayer', 'divine', 'holy'],
  survival: ['track', 'hunt', 'survival', 'forage', 'navigate', 'survive'],
  'animal handling': ['animal', 'beast', 'creature', 'handle', 'calm', 'ride'],
  insight: ['read', 'sense', 'intention', 'motivation', 'insight', 'feeling'],
  deception: ['lie', 'deceive', 'bluff', 'trick', 'deception', 'dishonest'],
  intimidation: ['intimidate', 'threaten', 'frighten', 'scare', 'bully'],
  performance: ['perform', 'act', 'sing', 'dance', 'entertain', 'play'],
  persuasion: ['persuade', 'convince', 'negotiate', 'charm', 'plead', 'argue'],
};

const ABILITY_KEYWORDS: Record<string, string[]> = {
  strength: ['lift', 'push', 'break', 'force', 'strength', 'powerful'],
  dexterity: ['dodge', 'reflex', 'agile', 'quick', 'dexterity', 'nimble'],
  constitution: ['endure', 'stamina', 'health', 'constitution', 'tough'],
  intelligence: ['remember', 'learn', 'reason', 'intelligence', 'smart', ' IQ'],
  wisdom: ['perceive', 'understand', 'intuit', 'wisdom', 'wise', 'judge'],
  charisma: ['lead', 'inspire', 'social', 'charisma', 'charismatic', 'speak'],
};

const ActionTypeEnum = z.enum([
  'attack',
  'skill-check',
  'saving-throw',
  'ability-check',
  'damage',
  'heal',
  'none',
]);

const SkillTypeEnum = z.enum([
  'athletics',
  'acrobatics',
  'sleight of hand',
  'stealth',
  'arcana',
  'history',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'religion',
  'survival',
  'animal handling',
  'insight',
  'deception',
  'intimidation',
  'performance',
  'persuasion',
]);

const AbilityTypeEnum = z.enum([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

const IntentClassificationSchema = z.object({
  requiresRoll: z.boolean().describe('Whether the action requires a dice roll'),
  action: ActionTypeEnum.describe('Type of action being attempted'),
  skill: SkillTypeEnum.optional().describe('The specific skill being used'),
  ability: AbilityTypeEnum.optional().describe('The ability score relevant to the check'),
  difficulty: z
    .enum(['very-easy', 'easy', 'medium', 'hard', 'very-hard', 'near-impossible'])
    .optional()
    .describe('Estimated difficulty'),
  description: z.string().describe('Description of what the character is attempting'),
  target: z.string().optional().describe('Target of the action'),
  weapon: z.string().optional().describe('Weapon being used for attack'),
  damageType: z.string().optional().describe('Type of damage for attacks'),
});

export type IntentClassification = z.infer<typeof IntentClassificationSchema>;
export type ActionType = z.infer<typeof ActionTypeEnum>;
export type SkillType = z.infer<typeof SkillTypeEnum>;
export type AbilityType = z.infer<typeof AbilityTypeEnum>;

export const classifyIntent = ai.defineFlow(
  {
    name: 'classifyIntent',
    inputSchema: z.object({
      message: z.string().describe('The player message to analyze'),
    }),
    outputSchema: IntentClassificationSchema,
  },
  async ({ message }) => {
    return classifyIntentSimple(message);
  },
);

export const classifyIntentSimple = (message: string): IntentClassification => {
  const lowerMessage = message.toLowerCase();

  const triggersRoll = ROLL_TRIGGER_PHRASES.some((phrase) => lowerMessage.includes(phrase));

  if (!triggersRoll) {
    return {
      requiresRoll: false,
      action: 'none',
      description: message,
    };
  }

  let detectedSkill: SkillType | undefined;
  let detectedAbility: AbilityType | undefined;

  for (const [skill, keywords] of Object.entries(SKILL_KEYWORDS)) {
    if (keywords.some((keyword) => lowerMessage.includes(keyword))) {
      detectedSkill = skill as SkillType;
      break;
    }
  }

  if (!detectedSkill) {
    for (const [ability, keywords] of Object.entries(ABILITY_KEYWORDS)) {
      if (keywords.some((keyword) => lowerMessage.includes(keyword))) {
        detectedAbility = ability as AbilityType;
        break;
      }
    }
  }

  const isAttack =
    lowerMessage.includes('attack') ||
    lowerMessage.includes('hit') ||
    lowerMessage.includes('strike') ||
    lowerMessage.includes('shoot') ||
    lowerMessage.includes('stab') ||
    lowerMessage.includes('slash');

  const isSave =
    lowerMessage.includes('save') ||
    lowerMessage.includes('resist') ||
    (lowerMessage.includes('check') && lowerMessage.includes('against'));

  if (isAttack) {
    return {
      requiresRoll: true,
      action: 'attack',
      description: message,
    };
  }

  if (isSave) {
    return {
      requiresRoll: true,
      action: 'saving-throw',
      description: message,
    };
  }

  if (detectedSkill) {
    return {
      requiresRoll: true,
      action: 'skill-check',
      skill: detectedSkill,
      description: message,
    };
  }

  if (detectedAbility) {
    return {
      requiresRoll: true,
      action: 'ability-check',
      ability: detectedAbility,
      description: message,
    };
  }

  return {
    requiresRoll: true,
    action: 'skill-check',
    description: message,
  };
};
