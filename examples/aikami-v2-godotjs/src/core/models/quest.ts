// apps/frontend/gamejs/src/core/models/quest.ts
/**
 * Pure TypeScript quest model types.
 * No Godot imports — safe for unit testing.
 */

/** A single reward item for quest completion. */
export type QuestRewardItem = {
    itemId: string;
    quantity: number;
};

/** Definition of a quest template. */
export type QuestDefinition = {
    id: string;
    title: string;
    description: string;
    steps: string[];
    rewardXp: number;
    rewardItems: QuestRewardItem[];
};

/** Runtime state of an active or completed quest. */
export type QuestState = {
    id: string;
    title: string;
    isComplete: boolean;
    completedSteps: string[];
};

/** Predefined quest templates shipped with the game. */
export const PREDEFINED_QUESTS: Record<string, QuestDefinition> = {
    'find-flute': {
        id: 'find-flute',
        title: 'Recover Lost Magical Flute',
        description:
            'A magical flute was lost in the forest. Find it and return it to the owner.',
        steps: ['Find the flute', 'Return the flute to the owner'],
        rewardXp: 100,
        rewardItems: [{ itemId: 'flute', quantity: 1 }],
    },
};

/**
 * Create a fresh QuestState from a definition.
 */
export const createQuestState = (definition: QuestDefinition): QuestState => ({
    id: definition.id,
    title: definition.title,
    isComplete: false,
    completedSteps: [],
});

/**
 * Serialize a quest state to a plain object for saving.
 */
export const questStateToJson = (state: QuestState): Record<string, unknown> => ({
    id: state.id,
    title: state.title,
    isComplete: state.isComplete,
    completedSteps: state.completedSteps,
});

/**
 * Deserialize a quest state from a saved object.
 */
export const questStateFromJson = (data: Record<string, unknown>): QuestState => ({
    id: (data.id as string) ?? '',
    title: (data.title as string) ?? '',
    isComplete: (data.isComplete as boolean) ?? false,
    completedSteps: (data.completedSteps as string[]) ?? [],
});
