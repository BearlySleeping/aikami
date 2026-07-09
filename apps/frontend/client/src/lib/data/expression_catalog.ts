// apps/frontend/client/src/lib/data/expression_catalog.ts
//
// Expression catalog — 19 canonical expressions with keyword patterns
// and LPC sprite overlay asset paths. Client-local LPC asset data.
//
// Contract: C-239 Expression Emotion System

import type { ExpressionEntry, ExpressionId } from '$types/expression';

/**
 * Complete expression catalog — 19 entries.
 *
 * Each entry maps an expression ID to human-readable label, keyword
 * patterns for Tier 2 regex detection, and LPC sprite overlay paths
 * for character portrait rendering.
 *
 * Keywords are RegExp source strings compiled at detection time.
 * Priority: first match in message text wins.
 */
export const EXPRESSION_CATALOG = [
  {
    id: 'neutral',
    label: 'Neutral',
    keywords: ['neutral', 'calm', 'stoic', 'blank', 'expressionless', 'poker face'],
    lpcOverlays: {},
  },
  {
    id: 'happy',
    label: 'Happy',
    keywords: [
      'happy',
      'joyful',
      'cheerful',
      'smile',
      'smiles',
      'smiling',
      'grin',
      'grins',
      'grinning',
      'beam',
      'beams',
      'beaming',
      'delighted',
      'overjoyed',
      'elated',
      'laughs',
      'laughing',
      'laughter',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/happy.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/happy.png',
    },
  },
  {
    id: 'sad',
    label: 'Sad',
    keywords: [
      'sad',
      'sadly',
      'sorrow',
      'sorrowful',
      'cry',
      'cries',
      'crying',
      'tear',
      'tears',
      'sob',
      'sobs',
      'sobbing',
      'mourn',
      'mournful',
      'grief',
      'weep',
      'weeping',
      'upset',
      'heartbroken',
      'despair',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/sad.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/sad.png',
      eyes: '/assets/lpc/body/heads/human/male/eyes/half.png',
    },
  },
  {
    id: 'angry',
    label: 'Angry',
    keywords: [
      'angry',
      'anger',
      'furious',
      'fury',
      'rage',
      'raging',
      'enraged',
      'mad',
      'snarl',
      'snarls',
      'snarling',
      'growl',
      'growls',
      'growling',
      'scowl',
      'scowls',
      'scowling',
      'glare',
      'glares',
      'glaring',
      'livid',
      'irate',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/angry.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/angry.png',
      eyes: '/assets/lpc/body/heads/human/male/eyes/angry.png',
    },
  },
  {
    id: 'surprised',
    label: 'Surprised',
    keywords: [
      'surprised',
      'surprise',
      'shock',
      'shocked',
      'startled',
      'astonished',
      'amazed',
      'gasp',
      'gasps',
      'gasping',
      'stunned',
      'jaw drop',
      'wide-eyed',
      'unexpected',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/surprised.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/surprised.png',
    },
  },
  {
    id: 'fearful',
    label: 'Fearful',
    keywords: [
      'fearful',
      'fear',
      'afraid',
      'scared',
      'terrified',
      'frightened',
      'tremble',
      'trembles',
      'trembling',
      'shiver',
      'shivers',
      'shivering',
      'horror',
      'panic',
      'panicked',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/fearful.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/fearful.png',
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/fearful.png',
    },
  },
  {
    id: 'disgusted',
    label: 'Disgusted',
    keywords: [
      'disgusted',
      'disgust',
      'revolted',
      'repulsed',
      'sneer',
      'sneers',
      'sneering',
      'nauseated',
      'gag',
      'gags',
      'gagging',
      'retch',
    ],
    lpcOverlays: {
      mouth: '/assets/lpc/body/heads/human/male/mouth/disgusted.png',
    },
  },
  {
    id: 'amused',
    label: 'Amused',
    keywords: [
      'amused',
      'amusement',
      'chuckle',
      'chuckles',
      'chuckling',
      'whimsical',
      'entertained',
      'titter',
      'snicker',
      'snickers',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/amused.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/amused.png',
    },
  },
  {
    id: 'annoyed',
    label: 'Annoyed',
    keywords: [
      'annoyed',
      'annoyance',
      'irritated',
      'irked',
      'frustrated',
      'exasperated',
      'sigh',
      'sighs',
      'sighing',
      'grunt',
      'grunts',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/annoyed.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/annoyed.png',
    },
  },
  {
    id: 'blushing',
    label: 'Blushing',
    keywords: [
      'blush',
      'blushes',
      'blushing',
      'embarrassed',
      'flushed',
      'flustered',
      'bashful',
      'sheepish',
      'timid',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/blushing.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/blushing.png',
    },
  },
  {
    id: 'confused',
    label: 'Confused',
    keywords: [
      'confused',
      'confusion',
      'puzzled',
      'baffled',
      'perplexed',
      'bewildered',
      'unsure',
      'uncertain',
      'scratching head',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/confused.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/confused.png',
    },
  },
  {
    id: 'determined',
    label: 'Determined',
    keywords: [
      'determined',
      'resolve',
      'resolute',
      'focused',
      'focusing',
      'grim',
      'grit',
      'steady',
      'steadfast',
      'unyielding',
      'unwavering',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/determined.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/determined.png',
    },
  },
  {
    id: 'flirty',
    label: 'Flirty',
    keywords: [
      'flirty',
      'flirtatious',
      'wink',
      'winks',
      'winking',
      'playful',
      'teasing',
      'coy',
      'suggestive',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/wink.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/flirty.png',
    },
  },
  {
    id: 'innocent',
    label: 'Innocent',
    keywords: [
      'innocent',
      'innocently',
      'wide-eyed',
      'naive',
      'naively',
      'guileless',
      'sweet',
      'pure',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/innocent.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/innocent.png',
    },
  },
  {
    id: 'mischievous',
    label: 'Mischievous',
    keywords: [
      'mischievous',
      'mischief',
      'sly',
      'cunning',
      'smirk',
      'smirks',
      'smirking',
      'impish',
      'roguish',
      'devious',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/mischievous.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/mischievous.png',
      eyes: '/assets/lpc/body/heads/human/male/eyes/mischievous.png',
    },
  },
  {
    id: 'pained',
    label: 'Pained',
    keywords: [
      'pained',
      'pain',
      'hurt',
      'hurting',
      'agony',
      'agonized',
      'wince',
      'winces',
      'wincing',
      'grimace',
      'grimaces',
      'aching',
      'wounded',
      'injured',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/pained.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/pained.png',
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/pained.png',
    },
  },
  {
    id: 'relieved',
    label: 'Relieved',
    keywords: [
      'relieved',
      'relief',
      'sigh of relief',
      'calmed',
      'calming',
      'reassured',
      'soothed',
      'thankful',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/relieved.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/relieved.png',
    },
  },
  {
    id: 'sleepy',
    label: 'Sleepy',
    keywords: [
      'sleepy',
      'tired',
      'exhausted',
      'drowsy',
      'yawn',
      'yawns',
      'yawning',
      'weary',
      'fatigued',
      'half-lidded',
    ],
    lpcOverlays: {
      eyes: '/assets/lpc/body/heads/human/male/eyes/half.png',
      mouth: '/assets/lpc/body/heads/human/male/mouth/sleepy.png',
    },
  },
  {
    id: 'thoughtful',
    label: 'Thoughtful',
    keywords: [
      'thoughtful',
      'pensive',
      'contemplative',
      'musing',
      'pondering',
      'wondering',
      'considering',
      'thoughtfully',
      'curious',
      'curiosity',
    ],
    lpcOverlays: {
      eyebrows: '/assets/lpc/body/heads/human/male/eyebrows/thoughtful.png',
      eyes: '/assets/lpc/body/heads/human/male/eyes/thoughtful.png',
    },
  },
] as const satisfies readonly ExpressionEntry[];

/**
 * Lookup an expression entry by ID.
 * Returns undefined if no entry exists for the given ID.
 */
export const getExpressionEntry = (expressionId: ExpressionId): ExpressionEntry | undefined => {
  return EXPRESSION_CATALOG.find((entry) => entry.id === expressionId);
};

/**
 * Compiled keyword RegExp cache — keyed by expression ID.
 * Built lazily on first access to avoid startup cost.
 */
const _keywordRegexCache = new Map<ExpressionId, RegExp>();

/**
 * Returns a compiled RegExp for the keyword set of the given expression.
 * Matches any keyword as a whole word (case-insensitive).
 *
 * @param expressionId - The expression ID to compile keywords for.
 * @returns A compiled RegExp matching any keyword for that expression.
 */
export const getKeywordRegex = (expressionId: ExpressionId): RegExp => {
  const cached = _keywordRegexCache.get(expressionId);
  if (cached) {
    return cached;
  }

  const entry = getExpressionEntry(expressionId);
  if (!entry) {
    const fallback = /(?!)/;
    _keywordRegexCache.set(expressionId, fallback);
    return fallback;
  }

  const pattern = entry.keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  const regex = new RegExp(`\\b(?:${pattern})\\b`, 'i');
  _keywordRegexCache.set(expressionId, regex);
  return regex;
};
