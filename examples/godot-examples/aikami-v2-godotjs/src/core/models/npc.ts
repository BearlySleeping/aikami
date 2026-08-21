// apps/frontend/gamejs/src/core/models/npc.ts
/**
 * Pure TypeScript NPC model types.
 * No Godot imports — safe for unit testing.
 */

import { VoiceType } from '../api/types';

/** Predefined NPC identifiers. */
export enum NpcId {
    NONE = 'none',
    GANDALF = 'gandalf',
    ARAGORN = 'aragorn',
    ORC = 'orc',
    TROLL = 'troll',
}

/** Portrait paths per mood. */
export type NpcPortraits = Record<string, string>;

/** Static NPC template data. */
export type NpcTemplate = {
    id: NpcId;
    name: string;
    race: string;
    characterClass: string;
    age: number;
    gender: string;
    portraits: NpcPortraits;
    unitSpritePath: string;
    animationSpriteSheetPath: string;
    appearance: string[];
    location: string;
    personality: string;
    demeanorAndSpeech: string;
    backstory: string;
    goals: string;
    fears: string;
    likes: string;
    dislikes: string;
    abilities: string;
    weaknesses: string;
    relationships: string;
    voiceType: VoiceType;
};

/** Dynamic per-save NPC data (memory, relationship). */
export type NpcDynamicData = {
    lastTimeSpokeAt: number;
    recollections: string[];
    relationshipLevelWithPlayer: number;
};

/** Combined NPC instance with static template + dynamic data. */
export type NpcInstance = {
    template: NpcTemplate;
    dynamic: NpcDynamicData;
    currentMood: string;
};

/** Predefined NPC templates shipped with the game. */
export const PREDEFINED_NPCS: Record<NpcId, NpcTemplate> = {
    [NpcId.GANDALF]: {
        id: NpcId.GANDALF,
        name: 'Gandalf the Grey',
        race: 'human',
        characterClass: 'wizard',
        age: 900,
        gender: 'male',
        portraits: {
            neutral: 'res://assets/npc/gandalf/neutral.webp',
            happy: 'res://assets/npc/gandalf/happy.webp',
            sad: 'res://assets/npc/gandalf/sad.webp',
            angry: 'res://assets/npc/gandalf/angry.webp',
        },
        unitSpritePath: 'res://assets/npc/gandalf/unit.png',
        animationSpriteSheetPath: 'res://assets/npc/gandalf/animation_sprite_sheet.png',
        appearance: ['Tall', 'Grey robe', 'Long white beard'],
        location: 'Middle-earth',
        personality: 'Wise and powerful',
        demeanorAndSpeech: 'Commanding and eloquent',
        backstory: 'A wizard sent to combat the threat of Sauron.',
        goals: 'Aid in the defeat of Sauron',
        fears: 'The rise of darkness',
        likes: 'Pipe-weed, hobbits',
        dislikes: 'Evil, folly',
        abilities: 'Magic, wisdom',
        weaknesses: 'Physical form limitations',
        relationships: 'Member of the Fellowship of the Ring',
        voiceType: VoiceType.MALE_OLD,
    },
    [NpcId.ARAGORN]: {
        id: NpcId.ARAGORN,
        name: 'Aragorn',
        race: 'human',
        characterClass: 'fighter',
        age: 87,
        gender: 'male',
        portraits: {
            neutral: 'res://assets/npc/aragon/neutral.webp',
            happy: 'res://assets/npc/aragon/happy.webp',
            sad: 'res://assets/npc/aragon/sad.webp',
            angry: 'res://assets/npc/aragon/angry.webp',
        },
        unitSpritePath: 'res://assets/npc/aragon/unit.png',
        animationSpriteSheetPath: 'res://assets/npc/aragon/animation_sprite_sheet.png',
        appearance: ['Tall', 'Rugged'],
        location: 'Rohan, Gondor',
        personality: 'Brave and noble',
        demeanorAndSpeech: 'Leader-like and inspiring',
        backstory: "Heir to the throne of Gondor, leader of the Fellowship after Gandalf's fall.",
        goals: 'Defeat Sauron, reclaim the throne',
        fears: 'Failure to protect the free peoples',
        likes: 'Peace, nature',
        dislikes: 'Tyranny, oppression',
        abilities: 'Swordsmanship, leadership',
        weaknesses: 'Heavy burden of destiny',
        relationships: 'Loves Arwen, friend of the Fellowship',
        voiceType: VoiceType.MALE_DEFAULT,
    },
    [NpcId.ORC]: {
        id: NpcId.ORC,
        name: 'Orc Grunt',
        race: 'half-orc',
        characterClass: 'barbarian',
        age: 25,
        gender: 'male',
        portraits: {
            neutral: 'res://assets/npc/orc/neutral.webp',
        },
        unitSpritePath: 'res://assets/npc/orc/unit.png',
        animationSpriteSheetPath: 'res://assets/npc/orc/animation_sprite_sheet.png',
        appearance: ['Muscular', 'Green skin', 'Crude armor'],
        location: 'Dark caverns, wastelands',
        personality: 'Savage and aggressive',
        demeanorAndSpeech: 'Rough and gruff',
        backstory: 'A common soldier in the service of dark forces.',
        goals: 'Serve the dark lord, crush enemies',
        fears: 'Bright light, powerful magic',
        likes: 'Violence, spoils of war',
        dislikes: 'Elves, weakness',
        abilities: 'Brute strength, intimidation',
        weaknesses: 'Low intelligence, disorganized',
        relationships: 'Part of the Orc Horde',
        voiceType: VoiceType.MALE_OLD,
    },
    [NpcId.TROLL]: {
        id: NpcId.TROLL,
        name: 'Mountain Troll',
        race: 'half-orc',
        characterClass: 'barbarian',
        age: 50,
        gender: 'male',
        portraits: {
            neutral: 'res://assets/npc/troll/neutral.webp',
        },
        unitSpritePath: 'res://assets/npc/troll/unit.png',
        animationSpriteSheetPath: 'res://assets/npc/troll/animation_sprite_sheet.png',
        appearance: ['Massive size', 'Rocky skin', 'Primitive weapons'],
        location: 'Mountain caves',
        personality: 'Dim-witted but dangerous',
        demeanorAndSpeech: 'Slow and brutish',
        backstory: "Guardians of the dark lord's strongholds, feared for their immense power.",
        goals: 'Protect the stronghold, destroy intruders',
        fears: 'Fire, sunlight',
        likes: 'Crushing things, eating',
        dislikes: 'Small and fast enemies',
        abilities: 'Overwhelming strength, durability',
        weaknesses: 'Slow movement, low intelligence',
        relationships: 'Servants of dark forces',
        voiceType: VoiceType.MALE_OLD,
    },
    [NpcId.NONE]: {
        id: NpcId.NONE,
        name: '',
        race: '',
        characterClass: '',
        age: 0,
        gender: '',
        portraits: {},
        unitSpritePath: '',
        animationSpriteSheetPath: '',
        appearance: [],
        location: '',
        personality: '',
        demeanorAndSpeech: '',
        backstory: '',
        goals: '',
        fears: '',
        likes: '',
        dislikes: '',
        abilities: '',
        weaknesses: '',
        relationships: '',
        voiceType: VoiceType.MALE_DEFAULT,
    },
};

/**
 * Create fresh dynamic data for an NPC.
 */
export const createNpcDynamicData = (): NpcDynamicData => ({
    lastTimeSpokeAt: -1,
    recollections: [],
    relationshipLevelWithPlayer: 50,
});

/**
 * Get the default portrait path for a given mood, falling back to neutral.
 */
export const getPortraitPath = (npc: NpcTemplate, mood: string): string => {
    const path = npc.portraits[mood];
    if (path) {
        return path;
    }
    return npc.portraits.neutral ?? '';
};

/**
 * Get all available mood keys for an NPC.
 */
export const getAvailableMoods = (npc: NpcTemplate): string[] => Object.keys(npc.portraits);

/**
 * Serialize dynamic NPC data to JSON.
 */
export const npcDynamicDataToJson = (data: NpcDynamicData): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    if (data.lastTimeSpokeAt !== -1) {
        result.lastTimeSpokeAt = data.lastTimeSpokeAt;
    }
    if (data.recollections.length > 0) {
        result.recollections = data.recollections;
    }
    if (data.relationshipLevelWithPlayer !== 50) {
        result.relationshipLevelWithPlayer = data.relationshipLevelWithPlayer;
    }
    return result;
};

/**
 * Deserialize dynamic NPC data from JSON.
 */
export const npcDynamicDataFromJson = (data: Record<string, unknown>): NpcDynamicData => ({
    lastTimeSpokeAt: (data.lastTimeSpokeAt as number) ?? -1,
    recollections: (data.recollections as string[]) ?? [],
    relationshipLevelWithPlayer: (data.relationshipLevelWithPlayer as number) ?? 50,
});
