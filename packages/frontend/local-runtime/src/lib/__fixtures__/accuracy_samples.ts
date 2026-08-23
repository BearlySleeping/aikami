// packages/frontend/local-runtime/src/lib/__fixtures__/accuracy_samples.ts
//
// Hand-labelled accuracy samples for each micro-task type.
// Used by accuracy tests to validate local LLM output quality.
//
// Contract: C-427 AC-5

import type { MicroTask } from '../local_task_pool.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccuracySample<T extends MicroTask['type'] = MicroTask['type']> = {
  /** The micro-task to submit. */
  task: Extract<MicroTask, { type: T }>;
  /** Expected output string (exact match for expression/battle-trigger, relaxed for relationship). */
  expectedOutput: string;
  /** Whether this is an exact-match or substring-match test. */
  matchMode: 'exact' | 'substring';
};

// ---------------------------------------------------------------------------
// Expression samples (≥80% exact match required)
// ---------------------------------------------------------------------------

export const EXPRESSION_SAMPLES: AccuracySample<'expression'>[] = [
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Aria let out a joyful laugh, her eyes sparkling with delight as she embraced her friend.',
        characters: ['Aria'],
      },
    },
    expectedOutput: 'happy',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Kael slammed his fist on the table, his face red with fury.',
        characters: ['Kael'],
      },
    },
    expectedOutput: 'angry',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Lyra stared at the empty cradle, tears streaming silently down her cheeks.',
        characters: ['Lyra'],
      },
    },
    expectedOutput: 'sad',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Theron jumped back as the creature lunged, his eyes wide with terror.',
        characters: ['Theron'],
      },
    },
    expectedOutput: 'surprised',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Mira cautiously peered around the corner, her body tense and ready to flee.',
        characters: ['Mira'],
      },
    },
    expectedOutput: 'fearful',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Doran gazed out the window, his expression distant and unreadable as he considered the offer.',
        characters: ['Doran'],
      },
    },
    expectedOutput: 'thoughtful',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Elena shrugged and turned away, showing no particular interest in the conversation.',
        characters: ['Elena'],
      },
    },
    expectedOutput: 'neutral',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'The goblin wrinkled its nose and backed away from the strange food. "What is that smell?" it grumbled.',
        characters: ['goblin'],
      },
    },
    expectedOutput: 'disgusted',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Seraphina smiled warmly at the children, her gentle eyes full of kindness.',
        characters: ['Seraphina'],
      },
    },
    expectedOutput: 'happy',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'The old knight sighed heavily, his weathered hands trembling as he recounted the battle.',
        characters: ['knight'],
      },
    },
    expectedOutput: 'sad',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Vex narrowed his eyes, a slow grin spreading across his face as the plan came together.',
        characters: ['Vex'],
      },
    },
    expectedOutput: 'happy',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'The merchant threw his hands up in exasperation. "I cannot work under these conditions!"',
        characters: ['merchant'],
      },
    },
    expectedOutput: 'angry',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Luna blinked rapidly, trying to process what she had just witnessed. "Wait, how did you do that?"',
        characters: ['Luna'],
      },
    },
    expectedOutput: 'surprised',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'The scout crept through the underbrush, every sense alert for danger.',
        characters: ['scout'],
      },
    },
    expectedOutput: 'fearful',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Archmage Cinder studied the ancient runes, stroking his chin as he pieced together the meaning.',
        characters: ['Archmage Cinder'],
      },
    },
    expectedOutput: 'thoughtful',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'The guard stood at attention, his face a blank mask as the general passed.',
        characters: ['guard'],
      },
    },
    expectedOutput: 'neutral',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose: 'Ivy recoiled from the rotting carcass, covering her nose and gagging.',
        characters: ['Ivy'],
      },
    },
    expectedOutput: 'disgusted',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Bram let out a triumphant roar as he lifted the championship trophy above his head.',
        characters: ['Bram'],
      },
    },
    expectedOutput: 'happy',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'The innkeeper wiped down the counter with a tired expression, not bothering to look up.',
        characters: ['innkeeper'],
      },
    },
    expectedOutput: 'neutral',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'expression',
      payload: {
        prose:
          'Selene gasped and stumbled backward, her hand flying to her mouth. "No... it cannot be."',
        characters: ['Selene'],
      },
    },
    expectedOutput: 'surprised',
    matchMode: 'exact',
  },
];

// ---------------------------------------------------------------------------
// Battle-trigger samples (≥80% exact match required)
// ---------------------------------------------------------------------------

export const BATTLE_TRIGGER_SAMPLES: AccuracySample<'battle-trigger'>[] = [
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The bandits draw their swords and charge at the party with murderous intent.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The king welcomes you to his throne room and offers you a seat by the fire.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'A massive dragon descends from the sky, its eyes fixed on the village below.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The merchant shows you his wares and asks if you would like to browse.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: "An assassin leaps from the shadows, dagger aimed at the prince's throat.",
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The healer tends to your wounds with gentle hands, humming a soft melody.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'A pack of wolves encircles the camp, growling and snapping their jaws.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The librarian helps you find a rare book on ancient history.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The rival adventuring party draws their weapons and blocks your path.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The festival dancers twirl and spin in a colorful display of celebration.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'A giant stone golem awakens and begins smashing through the temple walls.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The chef presents a beautifully plated dish and describes its ingredients.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The necromancer raises his staff and the dead begin to rise from their graves.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The farmer thanks you for helping with the harvest and offers you a meal.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'A volley of arrows rains down from the castle battlements as the siege begins.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The minstrel strums his lute and begins a tale of heroes long past.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The dark elf mage conjures a ball of crackling lightning in her palm.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The children play tag in the village square, laughing and shouting.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'A horde of undead shambles toward the city gates, hungry for living flesh.',
      },
    },
    expectedOutput: 'true',
    matchMode: 'exact',
  },
  {
    task: {
      type: 'battle-trigger',
      payload: {
        prose: 'The sage shares ancient wisdom about the stars and their alignment.',
      },
    },
    expectedOutput: 'false',
    matchMode: 'exact',
  },
];

// ---------------------------------------------------------------------------
// Relationship samples (≥70% substring match required)
// ---------------------------------------------------------------------------

export const RELATIONSHIP_SAMPLES: AccuracySample<'relationship'>[] = [
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Aria',
        target: 'Kael',
        dialogue: 'I trust you with my life, Kael. You have never let me down.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Kael',
        target: 'Theron',
        dialogue: 'You abandoned me on the battlefield. I will never forgive you.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Lyra',
        target: 'Mira',
        dialogue:
          'Thank you for staying with me through the long night. Your presence meant everything.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Doran',
        target: 'Elena',
        dialogue:
          'You took credit for my work again. This is the last time I collaborate with you.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Seraphina',
        target: 'Vex',
        dialogue: 'Your cunning saved us all. I am proud to call you my ally.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Bram',
        target: 'Ivy',
        dialogue: 'You tricked me into signing that contract. You are no friend of mine.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Luna',
        target: 'Selene',
        dialogue: 'Sister, your wisdom guides our people. I am grateful for your counsel.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Cinder',
        target: 'Mira',
        dialogue: 'You questioned my authority in front of the council. That was a grave mistake.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Elena',
        target: 'Aria',
        dialogue: 'Your kindness to the refugees has restored my faith in humanity.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Theron',
        target: 'Kael',
        dialogue: "You saved my sister's life. I am in your debt forever.",
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Mira',
        target: 'Doran',
        dialogue:
          'Your spy network reported false information. Because of you, we walked into a trap.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Vex',
        target: 'Seraphina',
        dialogue: "Your healing magic pulled me from death's door. I owe you everything.",
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Ivy',
        target: 'Bram',
        dialogue: 'You destroyed the ancient forest for profit. I will never forget this betrayal.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Selene',
        target: 'Luna',
        dialogue: 'Together we uncovered the conspiracy. Our bond is stronger than ever.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Kael',
        target: 'Aria',
        dialogue: 'You chose the mission over our friendship. Some things cannot be undone.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Aria',
        target: 'Lyra',
        dialogue: 'Your lullaby calmed the frightened child. You have a gift for soothing others.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Doran',
        target: 'Cinder',
        dialogue:
          'Your reckless experiment nearly destroyed the laboratory. You are a danger to everyone.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Mira',
        target: 'Theron',
        dialogue: 'Your bravery inspired the troops. You led the charge that turned the tide.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Elena',
        target: 'Vex',
        dialogue: 'Your schemes put innocent lives at risk. I cannot stand by and watch.',
      },
    },
    expectedOutput: 'worsen',
    matchMode: 'substring',
  },
  {
    task: {
      type: 'relationship',
      payload: {
        speaker: 'Seraphina',
        target: 'Bram',
        dialogue:
          'Your strength and honor are an example to us all. I am honored to fight beside you.',
      },
    },
    expectedOutput: 'improve',
    matchMode: 'substring',
  },
];

// ---------------------------------------------------------------------------
// Aggregated export
// ---------------------------------------------------------------------------

export const ALL_ACCURACY_SAMPLES = {
  expression: EXPRESSION_SAMPLES,
  'battle-trigger': BATTLE_TRIGGER_SAMPLES,
  relationship: RELATIONSHIP_SAMPLES,
} as const;

export type TaskType = keyof typeof ALL_ACCURACY_SAMPLES;
